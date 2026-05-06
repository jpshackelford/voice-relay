import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { useResourceFetch } from '../hooks/useResourceFetch';
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

/** Result of auto-join attempt (success/error only - attempted is tracked via ref) */
interface AutoJoinResult {
  success: boolean | null;  // null = not yet attempted or in progress
  error: string | null;
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

  // Auto-join state for handling 403 on workspace fetch
  // Use ref for synchronous guard against double-execution, state for render updates
  const autoJoinAttempted = useRef(false);
  const [autoJoinResult, setAutoJoinResult] = useState<AutoJoinResult>({
    success: null,
    error: null,
  });

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

  // Auto-join workspace when we get a 403 (access denied)
  // Uses structured error type instead of brittle string matching
  useEffect(() => {
    if (
      workspaceErrorInfo?.type === 'ACCESS_DENIED' &&
      isAuthenticated &&
      workspaceId &&
      !autoJoinAttempted.current
    ) {
      // Mark as attempted synchronously to prevent re-runs
      autoJoinAttempted.current = true;

      // Attempt auto-join
      (async () => {
        try {
          await ensureValidToken();
          const res = await fetch(`/api/workspaces/${workspaceId}/auto-join`, {
            method: 'POST',
            credentials: 'include',
          });

          if (res.ok) {
            const data = await res.json();
            setAutoJoinResult({ success: true, error: null });
            setShowJoinedBanner(data.joined === true);
            // Trigger workspace refetch
            refetchWorkspace();
          } else if (res.status === 404) {
            setAutoJoinResult({ success: false, error: 'Workspace not found' });
          } else {
            const errorData = await res.json().catch(() => null);
            setAutoJoinResult({
              success: false,
              error: errorData?.error || 'Failed to join workspace',
            });
          }
        } catch (err) {
          console.error('[SessionView] Auto-join failed:', err);
          setAutoJoinResult({
            success: false,
            error: 'Failed to join workspace',
          });
        }
      })();
    }
  }, [workspaceErrorInfo, isAuthenticated, workspaceId, ensureValidToken, refetchWorkspace]);

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

  // Auto-join in progress: ref indicates attempt started, null result means still waiting
  const autoJoinInProgress = autoJoinAttempted.current && autoJoinResult.success === null;

  // Consolidated loading state for easier reasoning
  const isLoading = authLoading || workspaceLoading || sessionLoading || deviceTokenValidating || autoJoinInProgress;

  // Determine loading message based on current state
  const getLoadingMessage = (): string => {
    if (deviceTokenValidating) return 'Validating device...';
    if (autoJoinInProgress) return 'Joining workspace...';
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
  if (autoJoinAttempted.current && autoJoinResult.success === false) {
    return (
      <div className="workspace-error">
        <h2>⚠️ {autoJoinResult.error || 'Failed to join workspace'}</h2>
        <p>Unable to automatically join this workspace.</p>
        <button onClick={() => navigate('/dashboard')}>← Go to Dashboard</button>
      </div>
    );
  }

  // Workspace or session error (only show if auto-join wasn't triggered or has completed)
  if ((workspaceError && !autoJoinAttempted.current) || (!workspace && !autoJoinInProgress)) {
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
