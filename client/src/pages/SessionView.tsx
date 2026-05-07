import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { WaitingForApproval } from '../components/WaitingForApproval';
import { JoinRequestStack } from '../components/JoinRequestNotification';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { useResourceFetch } from '../hooks/useResourceFetch';
import { useWorkspaceAutoJoin } from '../hooks/useWorkspaceAutoJoin';
import { getStoredDeviceToken, storeDeviceToken } from '../utils/deviceToken';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent, JoinResolvedMessage, JoinRequestMessage } from '../types';

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

  // Handle join-resolved message (for pending join request flow)
  const handleJoinResolvedMessage = useCallback((message: JoinResolvedMessage) => {
    autoJoin.handleJoinResolved(message);
  }, [autoJoin.handleJoinResolved]);

  // Join request state for kiosk (owner) devices - use refs to avoid circular deps
  const [pendingJoinRequests, setPendingJoinRequests] = useState<JoinRequestMessage['request'][]>([]);
  
  // Handle join-request message (for kiosk to receive join requests)
  const handleJoinRequestMessage = useCallback((message: JoinRequestMessage) => {
    // Only handle on kiosk mode devices (owners)
    if (workspace?.isOwner) {
      setPendingJoinRequests(prev => {
        if (prev.some(r => r.id === message.request.id)) {
          return prev;
        }
        return [...prev, message.request];
      });
      
      // Auto-remove after 5 minutes (expiry)
      setTimeout(() => {
        setPendingJoinRequests(prev => prev.filter(r => r.id !== message.request.id));
      }, 5 * 60 * 1000);
    }
  }, [workspace?.isOwner]);

  // Connect WebSocket with specific session ID
  const { connected, devices, sendText, updateDevice, sendJoinResponse } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode,
    workspaceId: workspace?.id,
    sessionId: session?.id,
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
    onDisplayMessage: handleDisplayMessage,
    onJoinResolvedMessage: handleJoinResolvedMessage,
    onJoinRequestMessage: handleJoinRequestMessage,
  });

  // Approve/deny join requests (kiosk only)
  const handleApproveRequest = useCallback((requestId: string) => {
    sendJoinResponse({ type: 'join-response', requestId, approved: true });
    setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendJoinResponse]);

  const handleDenyRequest = useCallback((requestId: string) => {
    sendJoinResponse({ type: 'join-response', requestId, approved: false });
    setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendJoinResponse]);

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

  const handleExit = () => {
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

  // Auto-join failed (but not due to pending request)
  if (autoJoin.attempted && autoJoin.result.success === false && !autoJoin.pendingRequest) {
    return (
      <div className="workspace-error">
        <h2>⚠️ {autoJoin.result.error || 'Failed to join workspace'}</h2>
        <p>Unable to automatically join this workspace.</p>
        <button onClick={() => navigate('/dashboard')}>← Go to Dashboard</button>
      </div>
    );
  }

  // Show waiting for approval overlay if there's a pending join request
  if (autoJoin.pendingRequest) {
    return (
      <WaitingForApproval
        request={autoJoin.pendingRequest}
        onCancel={autoJoin.cancelRequest}
      />
    );
  }

  // Workspace or session error - only show if auto-join wasn't triggered or has completed.
  // Two cases handled:
  // 1. Access denied before auto-join attempted (show initial 403 error)
  // 2. Workspace is null after auto-join completed (catch refetch failures post-join)
  // We don't show errors while auto-join is in progress since it will refetch on success.
  if ((workspaceError && !autoJoin.attempted) || (!workspace && !autoJoin.inProgress)) {
    // If auto-join succeeded but workspace is still null, refetch failed - show appropriate message
    const errorMessage = autoJoin.result.success
      ? 'Failed to load workspace after joining. Please refresh the page.'
      : workspaceError || 'Workspace not found';
    return (
      <div className="workspace-error">
        <h2>⚠️ {errorMessage}</h2>
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
  // Use auto-join response data directly to eliminate race condition with refetch
  const joinedBanner = showJoinedBanner ? (
    <div className="device-reconnect-banner" style={{ backgroundColor: '#4ade80' }}>
      <span className="banner-text">✓ Joined workspace: {autoJoin.result.workspace?.name || workspace?.name}</span>
      <button className="reconnect-btn" onClick={handleDismissJoinedBanner}>
        Dismiss
      </button>
    </div>
  ) : null;

  // Convert pending join requests to the format expected by JoinRequestStack
  const joinRequestsForStack = pendingJoinRequests.map(r => ({
    id: r.id,
    workspaceId: r.workspaceId,
    user: r.user,
    createdAt: r.createdAt,
  }));

  // Render kiosk or mobile mode based on auto-detected/current mode
  if (mode === 'kiosk') {
    return (
      <>
        {reconnectBanner}
        {joinedBanner}
        {/* Show join request notifications for workspace owner */}
        {workspace?.isOwner && (
          <JoinRequestStack
            requests={joinRequestsForStack}
            onApprove={handleApproveRequest}
            onDeny={handleDenyRequest}
          />
        )}
        <KioskMode
          deviceId={deviceId}
          displayName={displayName}
          connected={connected}
          devices={devices}
          utterances={utterances}
          displayContent={displayContent}
          sendText={sendText}
          onModeChange={handleModeChange}
          onExit={handleExit}
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
