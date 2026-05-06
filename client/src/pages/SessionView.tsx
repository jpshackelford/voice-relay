import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { useResourceFetch } from '../hooks/useResourceFetch';
import { useWorkspaceAutoJoin } from '../hooks/useWorkspaceAutoJoin';
import { getStoredDeviceToken, storeDeviceToken } from '../utils/deviceToken';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from '../types';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joinCode?: string;
  joined?: boolean;  // True if user was just added to workspace via auto-join
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
 * Supports QR code join flow with auto-join for non-members.
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

  const [showReconnectBanner, setShowReconnectBanner] = useState(false);
  const [showJoinedBanner, setShowJoinedBanner] = useState(false);

  // Auto-detect mode based on screen size
  const autoMode = useAutoDetectMode();
  const [mode, setMode] = useState<DeviceMode>(autoMode);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  // Memoize extractors to avoid unnecessary re-fetches
  const extractWorkspace = useCallback((data: unknown) => data as WorkspaceInfo, []);
  const extractSession = useCallback((data: unknown) => (data as { session: SessionInfo }).session, []);

  // Fetch workspace using shared hook
  const {
    data: workspace,
    loading: workspaceLoading,
    error: workspaceError,
    errorInfo: workspaceErrorInfo,
    refetch: refetchWorkspace,
  } = useResourceFetch<WorkspaceInfo>({
    url: workspaceId && isAuthenticated ? `/api/workspaces/${workspaceId}` : null,
    extractData: extractWorkspace,
    notFoundMessage: 'Workspace not found',
    forbiddenMessage: 'You do not have access to this workspace',
    failurePrefix: 'Failed to load workspace',
    ensureAuth: ensureValidToken,
    enabled: !!workspaceId && isAuthenticated,
  });

  // Handle auto-join callback
  const handleAutoJoinSuccess = useCallback(
    (wasNewlyJoined: boolean) => {
      setShowJoinedBanner(wasNewlyJoined);
      refetchWorkspace();
    },
    [refetchWorkspace]
  );

  // Auto-join workspace when we get a 403 (access denied)
  // Encapsulated in custom hook for better separation of concerns
  const autoJoin = useWorkspaceAutoJoin({
    workspaceId,
    isAuthenticated,
    workspaceErrorInfo,
    ensureValidToken,
    onJoinSuccess: handleAutoJoinSuccess,
  });

  // Fetch session using shared hook - only after workspace loads
  const {
    data: session,
    loading: sessionLoading,
    error: sessionError,
  } = useResourceFetch<SessionInfo>({
    url: workspaceId && sessionId && workspace ? `/api/workspaces/${workspaceId}/sessions/${sessionId}` : null,
    extractData: extractSession,
    notFoundMessage: 'Session not found',
    forbiddenMessage: 'You do not have access to this session',
    failurePrefix: 'Failed to load session',
    ensureAuth: ensureValidToken,
    enabled: !!workspaceId && !!sessionId && isAuthenticated && !!workspace,
  });

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

  const handleDismissJoinedBanner = () => {
    setShowJoinedBanner(false);
  };

  // Consolidated loading state for easier reasoning
  const isLoading = authLoading || workspaceLoading || sessionLoading || deviceTokenValidating || autoJoin.inProgress;

  // Determine loading message based on current state
  const getLoadingMessage = (): string => {
    if (deviceTokenValidating) return 'Validating device...';
    if (autoJoin.inProgress) return 'Joining workspace...';
    if (sessionLoading) return 'Loading session...';
    return 'Loading workspace...';
  };

  // Loading states
  if (isLoading) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <div className="spinner"></div>
          <p className="loading-text">{getLoadingMessage()}</p>
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

  // Auto-join failed
  if (autoJoin.attempted && autoJoin.result.success === false) {
    return (
      <div className="workspace-error">
        <h2>⚠️ {autoJoin.result.error || 'Failed to join workspace'}</h2>
        <p>Unable to automatically join this workspace.</p>
        <button onClick={() => navigate('/dashboard')}>← Go to Dashboard</button>
      </div>
    );
  }

  // Workspace or session error (only show if auto-join wasn't triggered or has completed)
  if ((workspaceError && !autoJoin.attempted) || (!workspace && !autoJoin.inProgress)) {
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

  // Joined workspace banner (shown when user was auto-added to workspace)
  const joinedBanner = showJoinedBanner ? (
    <div className="device-reconnect-banner" style={{ backgroundColor: '#4ade80' }}>
      <span className="banner-text">✓ Joined workspace: {workspace?.name}</span>
      <button className="reconnect-btn" onClick={handleDismissJoinedBanner}>
        Dismiss
      </button>
    </div>
  ) : null;

  // Render kiosk or mobile mode based on auto-detected/current mode
  if (mode === 'kiosk') {
    return (
      <>
        {reconnectBanner}
        {joinedBanner}
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
      {joinedBanner}
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
