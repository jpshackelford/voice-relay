import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DeviceSetup } from '../components/DeviceSetup';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { generateUUID } from '../utils/uuid';
import { generateDefaultDeviceName } from '../utils/deviceName';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joinCode?: string;
}

function getOrCreateDeviceId(): string {
  let id = sessionStorage.getItem('deviceId');
  if (!id) {
    id = generateUUID();
    sessionStorage.setItem('deviceId', id);
  }
  return id;
}

function getOrCreateDisplayName(): string {
  let name = sessionStorage.getItem('displayName');
  if (!name) {
    name = generateDefaultDeviceName();
    sessionStorage.setItem('displayName', name);
  }
  return name;
}

export function Workspace() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [deviceId] = useState(getOrCreateDeviceId);
  const [displayName, setDisplayName] = useState(getOrCreateDisplayName);
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  // Fetch workspace info to validate access
  useEffect(() => {
    async function fetchWorkspace() {
      if (!workspaceId || !isAuthenticated) {
        setWorkspaceLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/workspaces/${workspaceId}`, {
          credentials: 'include', // Use httpOnly cookie auth
        });

        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
          setWorkspaceError(null);
        } else if (res.status === 404) {
          setWorkspaceError('Workspace not found');
        } else if (res.status === 403) {
          setWorkspaceError('You do not have access to this workspace');
        } else {
          setWorkspaceError('Failed to load workspace');
        }
      } catch (err) {
        console.error('Failed to fetch workspace:', err);
        setWorkspaceError('Failed to connect to server');
      } finally {
        setWorkspaceLoading(false);
      }
    }

    fetchWorkspace();
  }, [workspaceId, isAuthenticated]);

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

  // Only connect WebSocket if we have a valid workspace
  const { connected, devices, sendText, updateDevice } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode: mode || 'mobile',
    workspaceId: workspace?.id,
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
    onDisplayMessage: handleDisplayMessage,
  });

  // Store display name in session
  useEffect(() => {
    if (displayName) {
      sessionStorage.setItem('displayName', displayName);
    }
  }, [displayName]);

  const handleSetup = (name: string, selectedMode: DeviceMode) => {
    setDisplayName(name);
    setMode(selectedMode);
  };

  const handleModeChange = (newMode: DeviceMode) => {
    setMode(newMode);
    updateDevice({ mode: newMode });
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard');
  };

  // Loading states
  if (authLoading || workspaceLoading) {
    return (
      <div className="workspace-loading">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="workspace-error">
        <h2>Authentication Required</h2>
        <p>Please log in to access this workspace.</p>
        <button onClick={() => navigate(`/login?returnTo=/workspace/${workspaceId}`)}>
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
        <button onClick={handleBackToDashboard}>← Back to Dashboard</button>
      </div>
    );
  }

  // Show setup if not configured
  if (!mode) {
    return (
      <div className="workspace-container">
        <div className="workspace-header-bar">
          <button className="back-btn" onClick={handleBackToDashboard}>← Back</button>
          <span className="workspace-name">{workspace.name}</span>
        </div>
        <DeviceSetup initialName={displayName} onSubmit={handleSetup} />
      </div>
    );
  }

  // Validate mode
  if (mode !== 'mobile' && mode !== 'kiosk') {
    throw new Error(`Invalid device mode: "${mode}". Valid modes are 'mobile' or 'kiosk'.`);
  }

  // Kiosk mode
  if (mode === 'kiosk') {
    return (
      <KioskMode
        deviceId={deviceId}
        displayName={displayName}
        connected={connected}
        devices={devices}
        utterances={utterances}
        displayContent={displayContent}
        sendText={sendText}
        onModeChange={handleModeChange}
      />
    );
  }

  // Mobile mode (default)
  return (
    <MobileMode
      deviceId={deviceId}
      displayName={displayName}
      connected={connected}
      devices={devices}
      utterances={utterances}
      sendText={sendText}
      onModeChange={handleModeChange}
    />
  );
}
