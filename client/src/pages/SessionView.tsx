import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { storeDeviceToken } from '../utils/deviceToken';
import { getUserFriendlyMessage } from '../utils/errors';
import { KioskLayout } from '../components/KioskLayout';
import { ConversationLayout } from '../components/ConversationLayout';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joinCode?: string;
}

const MOBILE_BREAKPOINT = 768;

function useResponsiveMode(): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>(() => 
    window.innerWidth >= MOBILE_BREAKPOINT ? 'kiosk' : 'mobile'
  );

  useEffect(() => {
    const handleResize = () => {
      setMode(window.innerWidth >= MOBILE_BREAKPOINT ? 'kiosk' : 'mobile');
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return mode;
}

export function SessionView() {
  const { workspaceId, sessionId } = useParams<{ workspaceId: string; sessionId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, ensureValidToken } = useAuth();

  const {
    deviceId,
    displayName,
    deviceToken,
    isValidating: deviceTokenValidating,
  } = useDeviceRestoration(workspaceId);

  const autoDetectedMode = useResponsiveMode();

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Start collapsed per AC #4

  // Fetch workspace info to validate access
  useEffect(() => {
    async function fetchWorkspace() {
      if (!workspaceId || !isAuthenticated) {
        setWorkspaceLoading(false);
        return;
      }

      try {
        await ensureValidToken();

        const res = await fetch(`/api/workspaces/${workspaceId}`, {
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
          setWorkspaceError(null);
        } else if (res.status === 404) {
          setWorkspaceError('Workspace not found');
        } else if (res.status === 403) {
          setWorkspaceError('You do not have access to this workspace');
        } else if (res.status === 401) {
          setWorkspaceError('Session expired. Please log in again.');
        } else {
          const errorData = await res.json().catch(() => null);
          setWorkspaceError(getUserFriendlyMessage(errorData || 'Failed to load workspace'));
        }
      } catch (err) {
        console.error('Failed to fetch workspace:', err);
        setWorkspaceError(getUserFriendlyMessage(err as Error));
      } finally {
        setWorkspaceLoading(false);
      }
    }

    fetchWorkspace();
  }, [workspaceId, isAuthenticated, ensureValidToken]);

  const handleTextMessage = useCallback((message: ServerMessage & { type: 'text' }) => {
    setUtterances(prev => {
      const next = new Map(prev);
      next.set(message.utteranceId, {
        id: message.utteranceId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        partial: message.partial,
        receivedAt: prev.get(message.utteranceId)?.receivedAt || new Date(),
      });
      return next;
    });
  }, []);

  const handleHistoryMessage = useCallback((message: ServerMessage & { type: 'history' }) => {
    setUtterances(prev => {
      const next = new Map(prev);
      for (const msg of message.messages) {
        if (!next.has(msg.utteranceId)) {
          next.set(msg.utteranceId, {
            id: msg.utteranceId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            text: msg.text,
            partial: msg.partial,
            receivedAt: new Date(),
          });
        }
      }
      return next;
    });
  }, []);

  const handleDisplayMessage = useCallback((message: ServerMessage & { type: 'display' }) => {
    if (message.display.type === 'clear') {
      setDisplayContent(null);
    } else {
      setDisplayContent(message.display);
    }
  }, []);

  // Only connect WebSocket if we have a valid workspace and session
  const { connected, devices, sendText, updateDevice } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode: autoDetectedMode,
    workspaceId: workspace?.id,
    sessionId,
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
    onDisplayMessage: handleDisplayMessage,
  });

  // Update device mode on server when screen size changes
  useEffect(() => {
    if (connected) {
      updateDevice({ mode: autoDetectedMode });
    }
  }, [autoDetectedMode, connected, updateDevice]);

  // Store device token when connected
  useEffect(() => {
    if (workspace?.id && deviceToken) {
      storeDeviceToken({
        deviceId,
        deviceToken,
        workspaceId: workspace.id,
        name: displayName,
        mode: autoDetectedMode,
      });
    }
  }, [workspace?.id, deviceToken, deviceId, displayName, autoDetectedMode]);

  const handleBackToWorkspace = () => {
    navigate(`/workspace/${workspaceId}`);
  };

  // Check if display is idle (no AI content)
  const isIdle = !displayContent;

  // Loading states
  if (authLoading || workspaceLoading || deviceTokenValidating) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <div className="spinner"></div>
          <p className="loading-text">
            {deviceTokenValidating ? 'Validating device...' : 'Loading session...'}
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="workspace-error">
        <h2>Authentication Required</h2>
        <p>Please log in to access this session.</p>
        <button onClick={() => navigate(`/login?returnTo=/workspace/${workspaceId}/session/${sessionId}`)}>
          Log in
        </button>
      </div>
    );
  }

  // Workspace error
  if (workspaceError || !workspace) {
    return (
      <div className="workspace-error">
        <h2>⚠️ {workspaceError || 'Workspace not found'}</h2>
        <button onClick={handleBackToWorkspace}>← Back to Workspace</button>
      </div>
    );
  }

  // Render based on auto-detected mode
  if (autoDetectedMode === 'kiosk') {
    return (
      <KioskLayout
        deviceId={deviceId}
        displayName={displayName}
        connected={connected}
        devices={devices}
        utterances={utterances}
        displayContent={displayContent}
        sendText={sendText}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen(prev => !prev)}
        workspaceId={workspaceId!}
        sessionId={sessionId!}
        isIdle={isIdle}
      />
    );
  }

  // Mobile mode - conversation layout
  return (
    <ConversationLayout
      deviceId={deviceId}
      displayName={displayName}
      connected={connected}
      devices={devices}
      utterances={utterances}
      sendText={sendText}
    />
  );
}
