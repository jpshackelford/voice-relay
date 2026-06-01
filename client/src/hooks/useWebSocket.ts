import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, ServerMessage, DeviceMode, DeviceInfo, SessionInfo, SessionTtsSettings, JoinResponseMessage, DisplayResultMessage, SessionTtsSettingsMessage, AudioInputChunkMessage, AudioInputEndMessage, AgentActionMessage } from '../types';
import { storeDeviceToken, clearDeviceToken } from '../utils/deviceToken';

// Reconnect tuning. Matches the values agreed in issue #285.
//   base   = 250 ms grows as 250 * 2^attempts capped at 30 000 ms
//   jitter = 0.75 + 0.5 * random()  → multiplier in [0.75, 1.25)
// The cap keeps worst-case end-to-end recovery under ~30 s per the
// acceptance criteria, while jitter avoids thundering-herd reconnects
// when many kiosks come back at once after a proxy blip.
const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 30_000;
const JITTER_MIN = 0.75;
const JITTER_SPREAD = 0.5;

/**
 * Compute the delay (ms) before the next reconnect attempt.
 * Exponential backoff with multiplicative jitter, capped at RECONNECT_MAX_MS.
 *
 * @param attempts - Number of consecutive failed attempts so far (0-based).
 *                   Pass 0 for the first reconnect after a close.
 * @returns Delay in milliseconds, in the range
 *          [base * jitterMin, RECONNECT_MAX_MS * (jitterMin + jitterSpread)).
 */
export function computeReconnectDelay(attempts: number): number {
  const exp = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempts), RECONNECT_MAX_MS);
  const jitter = JITTER_MIN + JITTER_SPREAD * Math.random();
  return exp * jitter;
}

interface UseWebSocketOptions {
  deviceId: string;
  displayName: string;
  mode: DeviceMode;
  workspaceId?: string;
  sessionId?: string;  // Optional: if omitted, server auto-assigns to active session
  onTextMessage?: (message: ServerMessage & { type: 'text' }) => void;
  onHistoryMessage?: (message: ServerMessage & { type: 'history' }) => void;
  onDisplayMessage?: (message: ServerMessage & { type: 'display' }) => void;
  onAIStatusMessage?: (message: ServerMessage & { type: 'ai-status' }) => void;
  onAIThinkingMessage?: (message: ServerMessage & { type: 'ai-thinking' }) => void;
  onSessionAIStatusMessage?: (message: ServerMessage & { type: 'session-ai-status' }) => void;
  /**
   * Unified `session-state` callback (issue #295). When the server emits
   * one of these, the client should prefer it over the legacy
   * `session-ai-status` + `ai-thinking` pair. See `useAI` for the reducer.
   */
  onSessionStateMessage?: (message: ServerMessage & { type: 'session-state' }) => void;
  /**
   * Fires when a new WebSocket connection is opened (initial connect or
   * reconnect). Use this to clear per-connection state — e.g. `useAI.reset`
   * which clears the "have we seen a session-state yet" preference. Without
   * this hook a reconnect would silently inherit the previous connection's
   * decision about whether to honor legacy messages.
   */
  onOpen?: () => void;
  onAgentActionMessage?: (message: AgentActionMessage) => void;
  onJoinRequestMessage?: (message: ServerMessage & { type: 'join-request' }) => void;
  onJoinResolvedMessage?: (message: ServerMessage & { type: 'join-resolved' }) => void;
  onDeviceRemovedMessage?: (message: ServerMessage & { type: 'device-removed' }) => void;
  onWorkspaceDeletedMessage?: (message: ServerMessage & { type: 'workspace-deleted' }) => void;
  onAudioChunkMessage?: (message: ServerMessage & { type: 'audio-chunk' }) => void;
  onAudioEndMessage?: (message: ServerMessage & { type: 'audio-end' }) => void;
  onSessionTtsSettingsChanged?: (message: ServerMessage & { type: 'session-tts-settings-changed' }) => void;
  onTranscriptionResultMessage?: (message: ServerMessage & { type: 'transcription-result' }) => void;
  onTranscriptionErrorMessage?: (message: ServerMessage & { type: 'transcription-error' }) => void;
}

export function useWebSocket({ deviceId, displayName, mode, workspaceId, sessionId, onTextMessage, onHistoryMessage, onDisplayMessage, onAIStatusMessage, onAIThinkingMessage, onSessionAIStatusMessage, onSessionStateMessage, onOpen, onAgentActionMessage, onJoinRequestMessage, onJoinResolvedMessage, onDeviceRemovedMessage, onWorkspaceDeletedMessage, onAudioChunkMessage, onAudioEndMessage, onSessionTtsSettingsChanged, onTranscriptionResultMessage, onTranscriptionErrorMessage }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const [wasRemoved, setWasRemoved] = useState(false);
  // Session-level TTS settings (synced across all devices)
  const [sessionTtsSettings, setSessionTtsSettings] = useState<SessionTtsSettings | null>(null);
  const registeredRef = useRef(false);
  const currentModeRef = useRef(mode);
  const onTextMessageRef = useRef(onTextMessage);
  const onHistoryMessageRef = useRef(onHistoryMessage);
  const onDisplayMessageRef = useRef(onDisplayMessage);
  const onAIStatusMessageRef = useRef(onAIStatusMessage);
  const onAIThinkingMessageRef = useRef(onAIThinkingMessage);
  const onSessionAIStatusMessageRef = useRef(onSessionAIStatusMessage);
  const onSessionStateMessageRef = useRef(onSessionStateMessage);
  const onOpenRef = useRef(onOpen);
  const onAgentActionMessageRef = useRef(onAgentActionMessage);
  const onJoinRequestMessageRef = useRef(onJoinRequestMessage);
  const onJoinResolvedMessageRef = useRef(onJoinResolvedMessage);
  const onDeviceRemovedMessageRef = useRef(onDeviceRemovedMessage);
  const onWorkspaceDeletedMessageRef = useRef(onWorkspaceDeletedMessage);
  const onAudioChunkMessageRef = useRef(onAudioChunkMessage);
  const onAudioEndMessageRef = useRef(onAudioEndMessage);
  const onSessionTtsSettingsChangedRef = useRef(onSessionTtsSettingsChanged);
  const onTranscriptionResultMessageRef = useRef(onTranscriptionResultMessage);
  const onTranscriptionErrorMessageRef = useRef(onTranscriptionErrorMessage);
  
  // Track last known device state to preserve during reconnection
  // This prevents UI flicker when WebSocket reconnects (e.g., during QR token refresh)
  const lastKnownDevicesRef = useRef<DeviceInfo[]>([]);

  // Auto-reconnect state (issue #285).
  //   reconnectAttemptsRef – consecutive failed attempts; resets only on
  //     receipt of the server's `registered` message, since an open socket
  //     that never registers is not a usable connection.
  //   reconnectTimerRef    – handle for the pending setTimeout, if any.
  //   intentionallyClosedRef – set to true on deliberate teardowns
  //     (hook cleanup, device-removed, workspace-deleted, app-layer close
  //     codes 4xxx). The onclose handler skips scheduling when set.
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionallyClosedRef = useRef(false);

  // Keep refs up to date
  onTextMessageRef.current = onTextMessage;
  onHistoryMessageRef.current = onHistoryMessage;
  onDisplayMessageRef.current = onDisplayMessage;
  onAIStatusMessageRef.current = onAIStatusMessage;
  onAIThinkingMessageRef.current = onAIThinkingMessage;
  onSessionAIStatusMessageRef.current = onSessionAIStatusMessage;
  onSessionStateMessageRef.current = onSessionStateMessage;
  onOpenRef.current = onOpen;
  onAgentActionMessageRef.current = onAgentActionMessage;
  onJoinRequestMessageRef.current = onJoinRequestMessage;
  onJoinResolvedMessageRef.current = onJoinResolvedMessage;
  onDeviceRemovedMessageRef.current = onDeviceRemovedMessage;
  onWorkspaceDeletedMessageRef.current = onWorkspaceDeletedMessage;
  onAudioChunkMessageRef.current = onAudioChunkMessage;
  onAudioEndMessageRef.current = onAudioEndMessage;
  onSessionTtsSettingsChangedRef.current = onSessionTtsSettingsChanged;
  onTranscriptionResultMessageRef.current = onTranscriptionResultMessage;
  onTranscriptionErrorMessageRef.current = onTranscriptionErrorMessage;

  // Connect WebSocket with auto-reconnect on transient close (issue #285).
  //
  // The connect routine is factored out of useEffect so the same code path
  // runs for the initial connection and for every reconnect attempt
  // scheduled from onclose. setTimeout is used to schedule the next attempt
  // (rather than re-creating the socket synchronously in the close handler)
  // so the close-handler stack unwinds first.
  useEffect(() => {
    // Effect-scoped guard: prevents a stale timer or in-flight onclose from
    // touching a socket that belongs to a previous effect run.
    let cancelled = false;
    // Reset deliberate-close flag at the start of each effect run. The
    // cleanup function below sets it back to true when this run unwinds.
    intentionallyClosedRef.current = false;
    // New connection attempt → reset the attempt counter so the first
    // reconnect after a fresh mount uses the base delay.
    reconnectAttemptsRef.current = 0;

    const connect = () => {
      if (cancelled || intentionallyClosedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('[WS] Connecting to', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      registeredRef.current = false;

      // Preserve last known devices during reconnection to prevent UI flicker.
      // This is critical for kiosk mode where mobileDevices.length > 0 controls
      // the display state between mini QR and full-screen QR.
      // We restore devices immediately and let the server update them once connected.
      if (lastKnownDevicesRef.current.length > 0) {
        console.log('[WS] Preserving', lastKnownDevicesRef.current.length, 'devices during reconnection');
        setDevices(lastKnownDevicesRef.current);
      }

      // Server keepalive (issue #286) is purely transport-layer: the
      // server sends WebSocket protocol-level ping frames every ~25 s, and
      // browsers respond with a pong frame automatically (RFC 6455 §5.5.3).
      // These frames are invisible to the JS WebSocket API by design — the
      // hook has nothing to handle for keepalive itself. If the server
      // decides the peer is dead, it terminates the socket and the
      // existing onclose/reconnect path (#285) takes over.
      ws.onopen = () => {
        console.log('[WS] Connected');
        setConnected(true);

        // Fire the consumer's onOpen hook so per-connection state can be
        // cleared (e.g. `useAI.reset` — see issue #295). Wrapped in a
        // try/catch so a buggy consumer hook can't abort registration.
        try {
          onOpenRef.current?.();
        } catch (err) {
          console.error('[WS] onOpen handler threw:', err);
        }

        // Register this device with current mode, workspace, session, and screen dimensions.
        // currentModeRef is used so the latest mode is sent on every reconnect
        // without requiring `mode` in the effect's dependency array.
        //
        // Issue #375: capture the speaker's local IANA timezone + UTC
        // offset at registration time so the OpenHands agent can answer
        // wall-clock and relative-time questions. Wrapped defensively —
        // older browsers without `Intl.DateTimeFormat` fall back to
        // sending no timezone, which the server tolerates.
        let timezone: string | undefined;
        let tzOffsetMinutes: number | undefined;
        try {
          timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          // `getTimezoneOffset` returns minutes WEST of UTC; negate so
          // we send the POSIX-style positive-east convention the server
          // expects.
          tzOffsetMinutes = -new Date().getTimezoneOffset();
        } catch {
          // Leave undefined; the server tolerates missing values.
        }

        const registerMsg: ClientMessage = {
          type: 'register',
          deviceId,
          displayName,
          mode: currentModeRef.current,
          workspaceId,
          sessionId,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          ...(timezone ? { timezone } : {}),
          ...(tzOffsetMinutes !== undefined ? { tzOffsetMinutes } : {}),
        };
        ws.send(JSON.stringify(registerMsg));
        registeredRef.current = true;
      };

      ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'registered':
              console.log('[WS] Registered as', message.deviceId, 'in session', message.session);
              setCurrentSession(message.session);
              // Backoff resets only when registration completes, not on raw
              // socket open. open-without-register is not a usable connection.
              reconnectAttemptsRef.current = 0;

              // Store device token if provided (first-time registration)
              if (message.deviceToken && workspaceId) {
                console.log('[WS] Storing device token for reconnection');
                storeDeviceToken({
                  deviceId: message.deviceId,
                  deviceToken: message.deviceToken,
                  workspaceId,
                  name: displayName,
                  mode,
                });
              }
              break;
            case 'device-list':
              // Update both state and ref to preserve across reconnections
              setDevices(message.devices);
              lastKnownDevicesRef.current = message.devices;
              break;
            case 'text':
              onTextMessageRef.current?.(message);
              break;
            case 'history':
              onHistoryMessageRef.current?.(message);
              break;
            case 'display':
              onDisplayMessageRef.current?.(message);
              break;
            case 'ai-status':
              onAIStatusMessageRef.current?.(message);
              break;
            case 'ai-thinking':
              onAIThinkingMessageRef.current?.(message);
              break;
            case 'session-ai-status':
              onSessionAIStatusMessageRef.current?.(message);
              break;
            case 'session-state':
              onSessionStateMessageRef.current?.(message);
              break;
            case 'agent-action':
              onAgentActionMessageRef.current?.(message);
              break;
            case 'join-request':
              onJoinRequestMessageRef.current?.(message);
              break;
            case 'join-resolved':
              onJoinResolvedMessageRef.current?.(message);
              break;
            case 'device-removed':
              console.log('[WS] Device removed from workspace:', message.deviceId);
              // Deliberate teardown — do not auto-reconnect when the socket
              // closes after this message.
              intentionallyClosedRef.current = true;
              // Clear stored token since it's now invalid
              clearDeviceToken(workspaceId);
              // Update state to indicate removal
              setWasRemoved(true);
              setConnected(false);
              // Notify callback if provided
              onDeviceRemovedMessageRef.current?.(message);
              break;
            case 'workspace-deleted':
              console.log('[WS] Workspace was deleted:', message.reason);
              // Deliberate teardown — workspace is gone; reconnecting would
              // just fail. Suppress auto-reconnect.
              intentionallyClosedRef.current = true;
              // Clear stored token since it's now invalid
              clearDeviceToken(workspaceId);
              setConnected(false);
              // Clear devices since workspace no longer exists
              setDevices([]);
              lastKnownDevicesRef.current = [];
              // Notify callback if provided
              onWorkspaceDeletedMessageRef.current?.(message);
              break;
            case 'audio-chunk':
              onAudioChunkMessageRef.current?.(message);
              break;
            case 'audio-end':
              onAudioEndMessageRef.current?.(message);
              break;
            case 'session-tts-settings-changed':
              console.log('[WS] Session TTS settings updated:', message);
              setSessionTtsSettings({
                enabled: message.enabled,
                outputDeviceId: message.outputDeviceId,
              });
              onSessionTtsSettingsChangedRef.current?.(message);
              break;
            case 'transcription-result':
              onTranscriptionResultMessageRef.current?.(message);
              break;
            case 'transcription-error':
              onTranscriptionErrorMessageRef.current?.(message);
              break;
          }
        } catch (err) {
          console.error('[WS] Error parsing message:', err);
        }
      };

      ws.onclose = (event) => {
        console.log('[WS] Disconnected', event.code, event.reason);
        setConnected(false);
        registeredRef.current = false;
        setCurrentSession(null);

        // If the hook has torn down or a deliberate close has been recorded,
        // do not attempt to reconnect.
        if (cancelled || intentionallyClosedRef.current) return;

        // 4xxx close codes are reserved for application-layer deliberate
        // closes (per RFC 6455 §7.4). Today the server emits none, but
        // honour the convention so future intent signaling works without a
        // client change.
        if (event.code >= 4000 && event.code < 5000) {
          console.log('[WS] App-layer close code', event.code, '— no reconnect');
          return;
        }

        const attempts = reconnectAttemptsRef.current;
        const delay = computeReconnectDelay(attempts);
        reconnectAttemptsRef.current = attempts + 1;
        console.log(`[WS] Scheduling reconnect attempt ${attempts + 1} in ${Math.round(delay)} ms`);

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    };

    connect();

    return () => {
      cancelled = true;
      intentionallyClosedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [deviceId, displayName, workspaceId, sessionId]);

  // Update mode on server when it changes (without reconnecting)
  useEffect(() => {
    currentModeRef.current = mode;
    
    if (wsRef.current?.readyState === WebSocket.OPEN && registeredRef.current) {
      const message: ClientMessage = {
        type: 'update-device',
        mode,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, [mode]);

  const sendText = useCallback((utteranceId: string, text: string, partial: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Issue #375: stamp the utterance with the client's UTC clock so
      // the agent's per-turn header reflects when the user actually
      // spoke, not when the server received the frame.
      const message: ClientMessage = {
        type: 'text',
        utteranceId,
        text,
        partial,
        clientTimestamp: new Date().toISOString(),
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const updateDevice = useCallback((updates: { displayName?: string; mode?: DeviceMode; ttsEnabled?: boolean }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: ClientMessage = {
        type: 'update-device',
        ...updates,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendJoinResponse = useCallback((response: JoinResponseMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(response));
    }
  }, []);

  const sendDisplayResult = useCallback((result: Omit<DisplayResultMessage, 'type'>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: DisplayResultMessage = {
        type: 'display-result',
        ...result,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /**
   * Update session-level TTS settings (synced across all devices).
   * @param settings - New TTS settings (enabled + outputDeviceId)
   */
  const updateSessionTtsSettings = useCallback((settings: SessionTtsSettings) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: SessionTtsSettingsMessage = {
        type: 'session-tts-settings',
        enabled: settings.enabled,
        outputDeviceId: settings.outputDeviceId,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Send audio input chunk for server-side transcription
  const sendAudioInputChunk = useCallback((chunkIndex: number, audioBase64: string, sampleRate: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: AudioInputChunkMessage = {
        type: 'audio-input-chunk',
        chunkIndex,
        audio: audioBase64,
        sampleRate,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Signal end of audio input stream
  const sendAudioInputEnd = useCallback((totalChunks: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: AudioInputEndMessage = {
        type: 'audio-input-end',
        totalChunks,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { 
    connected, 
    devices, 
    currentSession, 
    wasRemoved, 
    sessionTtsSettings,
    sendText, 
    updateDevice, 
    sendJoinResponse, 
    sendDisplayResult,
    updateSessionTtsSettings,
    sendAudioInputChunk,
    sendAudioInputEnd,
  };
}
