import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileMode } from '../components/MobileMode';
import { KioskMode } from '../components/KioskMode';
import { WaitingForApproval } from '../components/WaitingForApproval';
import { JoinRequestStack } from '../components/JoinRequestNotification';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAI } from '../hooks/useAI';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { useAgentActions } from '../hooks/useAgentActions';
import { useAgentEventHistory } from '../hooks/useAgentEventHistory';
import { useDeviceRestoration } from '../hooks/useDeviceRestoration';
import { useResourceFetch } from '../hooks/useResourceFetch';
import { useWorkspaceAutoJoin } from '../hooks/useWorkspaceAutoJoin';
import { useKioskConfig } from '../hooks/useKioskConfig';
import { getStoredDeviceToken, storeDeviceToken } from '../utils/deviceToken';
import { parseOhTimestamp } from '../utils/parseOhTimestamp';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent, JoinResolvedMessage, JoinRequestMessage, AudioChunkMessage, AudioEndMessage } from '../types';

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
  // Issue #393: kiosk receives `kiosk-attention` notifications and shows a
  // transient banner so the user can confirm they targeted the right
  // physical screen.
  const [kioskAttention, setKioskAttention] = useState<
    { mobileDeviceId: string; mobileDisplayName: string; ttlMs: number; at: number } | null
  >(null);

  // AI status - lifted from KioskMode for WebSocket wiring
  // Session ID is available from URL params; used to filter AI status messages
  const ai = useAI({ sessionId });

  // Audio playback for server-side TTS (ElevenLabs)
  const audioPlayback = useAudioPlayback();

  // Agent actions for showing AI activity in kiosk sidebar
  const agentActions = useAgentActions(sessionId);

  // Hydrate the agent-event timeline from the persisted store on session
  // render (issue #269). Gated on auth + session presence so we don't fire
  // a fetch that's guaranteed to 401/404. The hook itself manages the
  // sessionId-change refetch path.
  const agentEventHistory = useAgentEventHistory({
    sessionId,
    enabled: !!sessionId && isAuthenticated,
  });

  // Forward fetched history into the live-state hook. The dedupe-by-id rule
  // inside `seedActions` handles the WS-arrived-during-fetch race so live
  // events that beat the seed survive (and history events that overlap them
  // are skipped). Empty seed is a no-op (see `seedActions`).
  const { seedActions } = agentActions;
  const historyEvents = agentEventHistory.history;
  useEffect(() => {
    if (historyEvents.length > 0) {
      seedActions(historyEvents);
    }
  }, [historyEvents, seedActions]);

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

  // Issue #340: kiosk footer-ticker config (anonymous-safe public endpoint).
  const { config: kioskConfig } = useKioskConfig(workspaceId);

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
      // Prefer the OH-emitted server timestamp (normalized to ISO Zulu by the
      // server) so AI utterances share a clock with agent events on the kiosk
      // timeline (issue #264). Fall back to existing receivedAt (mid-utterance
      // partial → final update) or finally to `new Date()`.
      const serverTime = parseOhTimestamp(message.serverTimestamp);
      next.set(message.utteranceId, {
        id: message.utteranceId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        partial: message.partial,
        receivedAt: serverTime ?? prev.get(message.utteranceId)?.receivedAt ?? new Date(),
        ...(message.engineSpeakerLabel
          ? { engineSpeakerLabel: message.engineSpeakerLabel }
          : {}),
      });
      return next;
    });
  }, []);

  const handleHistoryMessage = useCallback((message: ServerMessage & { type: 'history' }) => {
    setUtterances(prev => {
      const next = new Map(prev);
      for (const msg of message.messages) {
        if (!next.has(msg.utteranceId)) {
          // Use the persisted createdAt (normalized to ISO Zulu by the server)
          // so historical messages render with their original time rather than
          // page-load time on reconnect (issue #264). serverTimestamp is also
          // honored as a fallback for older payloads.
          const createdAt =
            parseOhTimestamp(msg.createdAt) ?? parseOhTimestamp(msg.serverTimestamp);
          next.set(msg.utteranceId, {
            id: msg.utteranceId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            text: msg.text,
            partial: msg.partial,
            receivedAt: createdAt ?? new Date(),
            ...(msg.engineSpeakerLabel
              ? { engineSpeakerLabel: msg.engineSpeakerLabel }
              : {}),
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
    try {
      autoJoin.handleJoinResolved(message);
    } catch (err) {
      console.error('[SessionView] Failed to handle join-resolved:', err);
    }
  }, [autoJoin.handleJoinResolved]);

  // Join request state for kiosk (owner) devices - use refs to avoid circular deps
  const [pendingJoinRequests, setPendingJoinRequests] = useState<JoinRequestMessage['request'][]>([]);
  
  // Track timeout IDs for cleanup on unmount
  const joinRequestTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      joinRequestTimeoutsRef.current.forEach(clearTimeout);
      joinRequestTimeoutsRef.current.clear();
    };
  }, []);
  
  // Handle join-request message (for kiosk to receive join requests)
  const handleJoinRequestMessage = useCallback((message: JoinRequestMessage) => {
    try {
      // Only handle on kiosk mode devices (owners)
      if (workspace?.isOwner) {
        setPendingJoinRequests(prev => {
          // Don't add or create timer for duplicates
          if (prev.some(r => r.id === message.request.id)) {
            return prev;
          }
          
          // Register auto-remove timer only for new requests
          const timeoutId = setTimeout(() => {
            setPendingJoinRequests(p => p.filter(r => r.id !== message.request.id));
            joinRequestTimeoutsRef.current.delete(message.request.id);
          }, 5 * 60 * 1000);
          joinRequestTimeoutsRef.current.set(message.request.id, timeoutId);
          
          return [...prev, message.request];
        });
      }
    } catch (err) {
      console.error('[SessionView] Failed to handle join-request:', err);
    }
  }, [workspace?.isOwner]);

  // Connect WebSocket with specific session ID
  // Wire AI status handlers to receive session-centric AI status updates
  // Wire audio handlers for server-side TTS (ElevenLabs)
  const { 
    connected, 
    devices, 
    sessionTtsSettings,
    sendText, 
    updateDevice, 
    sendListeningState,
    sendJoinResponse, 
    sendDisplayResult,
    updateSessionTtsSettings,
  } = useWebSocket({
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
    onSessionAIStatusMessage: ai.handleSessionAIStatus,
    onAIThinkingMessage: ai.handleAIThinking,
    onSessionStateMessage: ai.handleSessionState,
    // Reset the AI reducer's "have we seen session-state" preference on
    // every WS open so reconnects don't carry the previous connection's
    // decision forward (issue #295).
    onOpen: ai.reset,
    onAgentActionMessage: agentActions.handleAgentAction,
    onAudioChunkMessage: (msg) => audioPlayback.handleAudioChunk(msg as AudioChunkMessage),
    onAudioEndMessage: (msg) => audioPlayback.handleAudioEnd(msg as AudioEndMessage),
    // Issue #393.
    onKioskAttentionMessage: (msg) =>
      setKioskAttention({
        mobileDeviceId: msg.mobileDeviceId,
        mobileDisplayName: msg.mobileDisplayName,
        ttlMs: msg.ttlMs,
        at: Date.now(),
      }),
  });

  // Helper to clear timeout for a request
  const clearRequestTimeout = useCallback((requestId: string) => {
    const timeoutId = joinRequestTimeoutsRef.current.get(requestId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      joinRequestTimeoutsRef.current.delete(requestId);
    }
  }, []);

  // Approve/deny join requests (kiosk only)
  const handleApproveRequest = useCallback((requestId: string) => {
    sendJoinResponse({ type: 'join-response', requestId, approved: true });
    clearRequestTimeout(requestId);
    setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendJoinResponse, clearRequestTimeout]);

  const handleDenyRequest = useCallback((requestId: string) => {
    sendJoinResponse({ type: 'join-response', requestId, approved: false });
    clearRequestTimeout(requestId);
    setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendJoinResponse, clearRequestTimeout]);

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
          sendListeningState={sendListeningState}
          onModeChange={handleModeChange}
          onExit={handleExit}
          workspaceId={workspaceId}
          sessionId={sessionId}
          ai={ai}
          isAudioPlaying={audioPlayback.isPlaying}
          onDisplayResult={sendDisplayResult}
          sessionTtsSettings={sessionTtsSettings}
          onSessionTtsSettingsChange={updateSessionTtsSettings}
          agentActions={agentActions.actions}
          showAgentActions={agentActions.showActions}
          onToggleAgentActions={agentActions.toggleShowActions}
          agentHistoryLoading={agentEventHistory.loading}
          agentHistoryRehydrationComplete={agentEventHistory.rehydrationComplete}
          agentHistoryError={agentEventHistory.error}
          agentHistoryConversationId={agentEventHistory.conversationId}
          onRetryAgentHistory={agentEventHistory.retry}
          kioskFooterTickersEnabled={kioskConfig?.kioskFooterTickersEnabled ?? false}
          // Issue #410: workspace-default engine; per-device override
          // lands in a future PR via `devices.config.stt_engine`.
          sttEngine={kioskConfig?.sttEngine ?? 'web-speech'}
          attention={kioskAttention}
          onAttentionDismiss={() => setKioskAttention(null)}
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
        sendListeningState={sendListeningState}
        onModeChange={handleModeChange}
        sessionId={sessionId}
        sessionTtsSettings={sessionTtsSettings}
        onSessionTtsSettingsChange={updateSessionTtsSettings}
        workspaceId={workspaceId}
        isOwner={workspace?.isOwner ?? false}
        // Issue #410: workspace-default engine; per-device override
        // lands in a future PR via `devices.config.stt_engine`.
        sttEngine={kioskConfig?.sttEngine ?? 'web-speech'}
      />
    </>
  );
}
