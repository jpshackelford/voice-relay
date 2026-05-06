import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { getStoredDeviceToken, storeDeviceToken } from '../utils/deviceToken';
import { getUserFriendlyMessage } from '../utils/errors';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

// Note: getStoredDeviceToken and storeDeviceToken are used for mode persistence

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joinCode?: string;
}

interface SessionInfo {
  id: string;
  name: string | null;
  status: string;
}

const KIOSK_BREAKPOINT = 768;

/**
 * Hook to auto-detect device mode based on screen width.
 * ≥768px = kiosk, <768px = mobile
 */
function useAutoDetectMode(): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>(() =>
    window.innerWidth >= KIOSK_BREAKPOINT ? 'kiosk' : 'mobile'
  );

  useEffect(() => {
    const handleResize = () => {
      setMode(window.innerWidth >= KIOSK_BREAKPOINT ? 'kiosk' : 'mobile');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return mode;
}

/**
 * SessionView - Direct session entry point without setup screen.
 * Auto-detects kiosk vs mobile mode based on screen size.
 */
export function SessionView() {
  const { workspaceId, sessionId } = useParams<{ workspaceId: string; sessionId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, ensureValidToken } = useAuth();

  // Device restoration hook handles token validation
  const {
    deviceId,
    displayName,
    wasRestored,
    isValidating: deviceTokenValidating,
  } = useDeviceRestoration(workspaceId);

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);

  // Auto-detect mode based on screen size
  const autoMode = useAutoDetectMode();
  const [mode, setMode] = useState<DeviceMode>(autoMode);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  // Sync mode with auto-detected mode
  useEffect(() => {
    setMode(autoMode);
  }, [autoMode]);

  // Show reconnect banner when device was restored
  useEffect(() => {
    if (wasRestored) {
      setShowReconnectBanner(true);
    }
  }, [wasRestored]);

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

  // Fetch session info
  useEffect(() => {
    async function fetchSession() {
      if (!workspaceId || !sessionId || !isAuthenticated || !workspace) {
        setSessionLoading(false);
        return;
      }

      try {
        await ensureValidToken();

        const res = await fetch(`/api/workspaces/${workspaceId}/sessions/${sessionId}`, {
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          setSession(data.session);
          setSessionError(null);
        } else if (res.status === 404) {
          setSessionError('Session not found');
        } else if (res.status === 403) {
          setSessionError('You do not have access to this session');
        } else {
          const errorData = await res.json().catch(() => null);
          setSessionError(getUserFriendlyMessage(errorData || 'Failed to load session'));
        }
      } catch (err) {
        console.error('Failed to fetch session:', err);
        setSessionError(getUserFriendlyMessage(err as Error));
      } finally {
        setSessionLoading(false);
      }
    }

    if (workspace) {
      fetchSession();
    }
  }, [workspaceId, sessionId, isAuthenticated, workspace, ensureValidToken]);

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

  // Connect WebSocket with specific session ID
  const { connected, devices, sendText, updateDevice } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode,
    workspaceId: workspace?.id,
    sessionId: session?.id,
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
    onDisplayMessage: handleDisplayMessage,
  });

  const handleModeChange = (newMode: DeviceMode) => {
    setMode(newMode);
    updateDevice({ mode: newMode });

    // Update stored token with new mode
    const storedDevice = getStoredDeviceToken();
    if (storedDevice && workspace?.id) {
      storeDeviceToken({
        ...storedDevice,
        mode: newMode,
      });
    }
  };

  const handleBackToWorkspace = () => {
    navigate(`/workspace/${workspaceId}`);
  };

  const handleDismissReconnectBanner = () => {
    setShowReconnectBanner(false);
  };

  // Loading states
  if (authLoading || workspaceLoading || sessionLoading || deviceTokenValidating) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <div className="spinner"></div>
          <p className="loading-text">
            {deviceTokenValidating
              ? 'Validating device...'
              : sessionLoading
              ? 'Loading session...'
              : 'Loading workspace...'}
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
        <button
          onClick={() =>
            navigate(`/login?returnTo=/workspace/${workspaceId}/session/${sessionId}`)
          }
        >
          Log in
        </button>
      </div>
    );
  }

  // Workspace or session error
  if (workspaceError || !workspace) {
    return (
      <div className="workspace-error">
        <h2>⚠️ {workspaceError || 'Workspace not found'}</h2>
        <button onClick={handleBackToWorkspace}>← Back to Workspace</button>
      </div>
    );
  }

  if (sessionError || !session) {
    return (
      <div className="workspace-error">
        <h2>⚠️ {sessionError || 'Session not found'}</h2>
        <button onClick={handleBackToWorkspace}>← Back to Workspace</button>
      </div>
    );
  }

  // Reconnect banner (shown when device was restored from token)
  const reconnectBanner = showReconnectBanner ? (
    <div className="device-reconnect-banner">
      <span className="banner-text">✓ Device session restored</span>
      <button className="reconnect-btn" onClick={handleDismissReconnectBanner}>
        Dismiss
      </button>
    </div>
  ) : null;

  // Render kiosk or mobile mode based on auto-detected/current mode
  if (mode === 'kiosk') {
    return (
      <>
        {reconnectBanner}
        <KioskMode
          deviceId={deviceId}
          displayName={displayName}
          connected={connected}
          devices={devices}
          utterances={utterances}
          displayContent={displayContent}
          sendText={sendText}
          onModeChange={handleModeChange}
          workspaceId={workspaceId}
          sessionId={sessionId}
        />
      </>
    );
  }

  // Mobile mode
  return (
    <>
      {reconnectBanner}
      <MobileMode
        deviceId={deviceId}
        displayName={displayName}
        connected={connected}
        devices={devices}
        utterances={utterances}
        sendText={sendText}
        onModeChange={handleModeChange}
      />
    </>
  );
}
