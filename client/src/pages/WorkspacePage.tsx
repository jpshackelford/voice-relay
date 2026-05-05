import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, getWorkspaceBySlug, type Workspace } from '../auth';
import { DeviceSetup } from '../components/DeviceSetup';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { generateUUID } from '../utils/uuid';
import { generateDefaultDeviceName } from '../utils/deviceName';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

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

export function WorkspacePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, token, isLoading: authLoading } = useAuth();
  
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  
  const [deviceId] = useState(getOrCreateDeviceId);
  const [displayName, setDisplayName] = useState(getOrCreateDisplayName);
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  // Load workspace info
  useEffect(() => {
    if (!slug) {
      setWorkspaceError('No workspace specified');
      setLoadingWorkspace(false);
      return;
    }

    if (authLoading) {
      return;
    }

    if (!isAuthenticated) {
      navigate(`/login?returnTo=${encodeURIComponent(`/workspace/${slug}`)}`);
      return;
    }

    const loadWorkspace = async () => {
      try {
        const ws = await getWorkspaceBySlug(slug);
        setWorkspace(ws);
        setWorkspaceError(null);
      } catch (err) {
        setWorkspaceError((err as Error).message);
      } finally {
        setLoadingWorkspace(false);
      }
    };

    loadWorkspace();
  }, [slug, isAuthenticated, authLoading, navigate]);

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

  const { connected, devices, sendText, updateDevice } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode: mode || 'mobile',
    workspaceId: workspace?.id,
    token: token || undefined,
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
    onDisplayMessage: handleDisplayMessage,
  });

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

  if (authLoading || loadingWorkspace) {
    return (
      <div className="workspace-loading">
        <h1>🔊 Voice Relay</h1>
        <p>Loading workspace...</p>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="workspace-error">
        <h1>🔊 Voice Relay</h1>
        <p>⚠️ {workspaceError}</p>
        <button onClick={handleBackToDashboard}>Back to Dashboard</button>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="workspace-error">
        <h1>🔊 Voice Relay</h1>
        <p>Workspace not found</p>
        <button onClick={handleBackToDashboard}>Back to Dashboard</button>
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="workspace-setup">
        <div className="workspace-header">
          <button className="back-btn" onClick={handleBackToDashboard}>
            ← Dashboard
          </button>
          <span className="workspace-name">{workspace.name}</span>
        </div>
        <DeviceSetup initialName={displayName} onSubmit={handleSetup} />
      </div>
    );
  }

  if (mode !== 'mobile' && mode !== 'kiosk') {
    throw new Error(`Invalid device mode: "${mode}". Valid modes are 'mobile' or 'kiosk'.`);
  }

  const workspaceHeader = (
    <div className="workspace-indicator">
      <button className="back-btn-small" onClick={handleBackToDashboard} title="Back to Dashboard">
        ←
      </button>
      <span className="workspace-name-small">{workspace.name}</span>
    </div>
  );

  if (mode === 'kiosk') {
    return (
      <>
        {workspaceHeader}
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
      </>
    );
  }

  return (
    <>
      {workspaceHeader}
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
