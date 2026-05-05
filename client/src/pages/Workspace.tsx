import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DeviceSetup } from '../components/DeviceSetup';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { generateUUID } from '../utils/uuid';
import { generateDefaultDeviceName } from '../utils/deviceName';
import { 
  getStoredDeviceToken, 
  storeDeviceToken, 
  validateDeviceToken,
  clearDeviceToken,
  storeSessionDeviceId,
  getSessionDeviceId,
} from '../utils/deviceToken';
import { getUserFriendlyMessage } from '../utils/errors';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joinCode?: string;
}

/**
 * Get device ID, preferring session storage but falling back to stored token.
 */
function getOrCreateDeviceId(): string {
  // First check session storage (for current tab)
  let id = getSessionDeviceId();
  if (id) return id;
  
  // Check if we have a stored device token
  const storedDevice = getStoredDeviceToken();
  if (storedDevice?.deviceId) {
    storeSessionDeviceId(storedDevice.deviceId);
    return storedDevice.deviceId;
  }
  
  // Generate new ID
  id = generateUUID();
  storeSessionDeviceId(id);
  return id;
}

function getOrCreateDisplayName(): string {
  let name = sessionStorage.getItem('displayName');
  if (!name) {
    // Check stored device
    const storedDevice = getStoredDeviceToken();
    if (storedDevice?.name) {
      name = storedDevice.name;
    } else {
      name = generateDefaultDeviceName();
    }
    sessionStorage.setItem('displayName', name);
  }
  return name;
}

function getStoredMode(): DeviceMode | null {
  // Check stored device for mode
  const storedDevice = getStoredDeviceToken();
  if (storedDevice?.mode) {
    return storedDevice.mode;
  }
  return null;
}

export function Workspace() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, ensureValidToken } = useAuth();

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [deviceTokenValidating, setDeviceTokenValidating] = useState(false);
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);

  const [deviceId] = useState(getOrCreateDeviceId);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(getOrCreateDisplayName);
  const [mode, setMode] = useState<DeviceMode | null>(getStoredMode);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  // TODO: Implement session-specific history loading using URL params
  // e.g., const sessionIdFromUrl = new URLSearchParams(window.location.search).get('session');

  // Validate stored device token on mount
  useEffect(() => {
    async function checkDeviceToken() {
      const storedDevice = getStoredDeviceToken();
      if (!storedDevice?.deviceToken || storedDevice.workspaceId !== workspaceId) {
        return;
      }

      setDeviceTokenValidating(true);
      try {
        const validatedDevice = await validateDeviceToken();
        if (validatedDevice && validatedDevice.workspaceId === workspaceId) {
          console.log('[Workspace] Device token validated, restoring session');
          setDeviceToken(storedDevice.deviceToken);
          // Restore mode from validated device if available
          if (validatedDevice.mode && !mode) {
            setMode(validatedDevice.mode);
          }
          setShowReconnectBanner(true);
        } else {
          // Token invalid for this workspace
          clearDeviceToken();
        }
      } catch (err) {
        console.error('[Workspace] Device token validation failed:', err);
      } finally {
        setDeviceTokenValidating(false);
      }
    }

    if (workspaceId) {
      checkDeviceToken();
    }
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch workspace info to validate access
  useEffect(() => {
    async function fetchWorkspace() {
      if (!workspaceId || !isAuthenticated) {
        setWorkspaceLoading(false);
        return;
      }

      try {
        // Proactively refresh token if close to expiry
        await ensureValidToken();

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
        } else if (res.status === 401) {
          // Token expired, redirect to login
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

  const handleSetup = async (name: string, selectedMode: DeviceMode) => {
    setDisplayName(name);
    setMode(selectedMode);
    
    // Store device token for reconnection
    // The device token is issued by the server when registering
    // For now, store the local device info - token will be obtained when connected
    if (workspace?.id) {
      storeDeviceToken({
        deviceId,
        deviceToken: deviceToken || '', // Will be updated when server sends token
        workspaceId: workspace.id,
        name,
        mode: selectedMode,
      });
    }
  };

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

  const handleBackToDashboard = () => {
    navigate('/dashboard');
  };

  const handleDismissReconnectBanner = () => {
    setShowReconnectBanner(false);
  };

  // Loading states
  if (authLoading || workspaceLoading || deviceTokenValidating) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <div className="spinner"></div>
          <p className="loading-text">
            {deviceTokenValidating ? 'Validating device...' : 'Loading workspace...'}
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

  // Reconnect banner (shown when device was restored from token)
  const reconnectBanner = showReconnectBanner ? (
    <div className="device-reconnect-banner">
      <span className="banner-text">✓ Device session restored</span>
      <button className="reconnect-btn" onClick={handleDismissReconnectBanner}>
        Dismiss
      </button>
    </div>
  ) : null;

  // Kiosk mode
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
        />
      </>
    );
  }

  // Mobile mode (default)
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
