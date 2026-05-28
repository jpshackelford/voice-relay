import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DeviceSetup } from '../components/DeviceSetup';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { useKioskConfig } from '../hooks/useKioskConfig';
import { getStoredDeviceToken, storeDeviceToken } from '../utils/deviceToken';
import { getUserFriendlyMessage } from '../utils/errors';
import { parseOhTimestamp } from '../utils/parseOhTimestamp';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joinCode?: string;
}

export function Workspace() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Redirect legacy session URLs: /workspace/:id/session?session=X -> /workspace/:id/session/X
  const sessionParam = searchParams.get('session');
  if (sessionParam) {
    return <Navigate to={`/workspace/${workspaceId}/session/${sessionParam}`} replace />;
  }
  const { isAuthenticated, loading: authLoading, ensureValidToken } = useAuth();

  // Device restoration hook handles token validation and session restoration
  const {
    deviceId,
    displayName,
    restoredMode,
    deviceToken,
    wasRestored,
    isValidating: deviceTokenValidating,
    setDisplayName,
  } = useDeviceRestoration(workspaceId);

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);

  // Mode state - use restored mode if available, otherwise null until setup
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  // Issue #340: anonymous-safe per-workspace ticker config for the kiosk.
  const { config: kioskConfig } = useKioskConfig(workspaceId);

  // Apply restored mode when available
  useEffect(() => {
    if (restoredMode && !mode) {
      setMode(restoredMode);
    }
  }, [restoredMode, mode]);

  // Show reconnect banner when device was restored
  useEffect(() => {
    if (wasRestored) {
      setShowReconnectBanner(true);
    }
  }, [wasRestored]);

  // TODO: Implement session-specific history loading using URL params
  // e.g., const sessionIdFromUrl = new URLSearchParams(window.location.search).get('session');

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
      // Prefer the OH-emitted server timestamp (issue #264) so AI utterances
      // share a clock with agent events on the kiosk timeline.
      const serverTime = parseOhTimestamp(message.serverTimestamp);
      next.set(message.utteranceId, {
        id: message.utteranceId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        partial: message.partial,
        receivedAt: serverTime ?? prev.get(message.utteranceId)?.receivedAt ?? new Date(),
      });
      return next;
    });
  }, []);

  const handleHistoryMessage = useCallback((message: ServerMessage & { type: 'history' }) => {
    setUtterances(prev => {
      const next = new Map(prev);
      for (const msg of message.messages) {
        if (!next.has(msg.utteranceId)) {
          // Use the persisted createdAt so historical messages render with
          // their original time on reconnect (issue #264).
          const createdAt =
            parseOhTimestamp(msg.createdAt) ?? parseOhTimestamp(msg.serverTimestamp);
          next.set(msg.utteranceId, {
            id: msg.utteranceId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            text: msg.text,
            partial: msg.partial,
            receivedAt: createdAt ?? new Date(),
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

  const handleSetup = async (name: string, selectedMode: DeviceMode) => {
    setDisplayName(name);
    setMode(selectedMode);
    
    // Only store device info if we have a validated token from the server.
    // New devices don't get tokens from the current WebSocket registration flow.
    // Token persistence is only useful for devices that have previously connected
    // and had their tokens validated via /api/devices/validate.
    // TODO: Implement device token issuance on first connection once the
    // backend device registration endpoint is integrated with WebSocket registration.
    // See: https://github.com/jpshackelford/voice-relay/issues/6 (Phase 4 integration)
    if (workspace?.id && deviceToken) {
      storeDeviceToken({
        deviceId,
        deviceToken,
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
          kioskFooterTickersEnabled={kioskConfig?.kioskFooterTickersEnabled ?? false}
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
