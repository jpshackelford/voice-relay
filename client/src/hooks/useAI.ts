import { useReducer, useCallback, useRef, useMemo } from 'react';
import type {
  AIThinkingMessage,
  AgentSessionStatusWire,
  SessionAIStatusMessage,
  SessionStateMessage,
} from '../types';
import {
  restartAISession,
  AISessionRequestError,
  type AISessionStatus,
} from '../api/aiSession';

interface UseAIOptions {
  sessionId?: string;  // VR session ID for session-centric AI
}

interface AIStatus {
  available: boolean;
  message: string;
}

/** Result of a `restart()` invocation, surfaced to the calling component. */
export type RestartResult =
  | { ok: true; status: AISessionStatus }
  | { ok: false; error: string; status?: number };

/**
 * Public AI state interface exposed to consuming components.
 * Excludes internal handlers used for WebSocket wiring.
 *
 * The underlying reducer state is the wire's `AgentSessionStatus`
 * (issue #295). The derived booleans below are computed at render-time
 * via `useMemo`; they are not stored in the reducer and exist purely
 * for the convenience of legacy callers (kiosk, mobile mode) that still
 * branch on `connected` / `thinking` / `connecting` rather than the
 * unified `state` enum. New code should prefer `state` directly.
 */
export interface AIState {
  connected: boolean;
  connecting: boolean;
  thinking: boolean;
  /**
   * Authoritative `degraded` indicator derived from `state === 'degraded'`.
   * Until #295 landed this was a heuristic on `!connected && !connecting
   * && error !== null` (see commit history); the reducer now reads it
   * straight off the unified state object.
   */
  degraded: boolean;
  /** True while a restart request is in-flight. */
  restarting: boolean;
  /** Inline error from the most recent restart attempt (cleared on retry). */
  restartError: string | null;
  conversationId: string | null;
  error: string | null;
  checkAvailability: () => Promise<AIStatus>;
  /**
   * Trigger an explicit user-driven restart of the upstream agent session.
   * Optimistically transitions local state to `connecting`; the server's
   * status broadcasts will reconcile the final state. Returns a
   * structured result so the caller can render an inline error on failure.
   */
  restart: () => Promise<RestartResult>;
}

/**
 * Reducer state: the wire's `AgentSessionStatus`. Per issue #295 the
 * reducer's state IS this shape — no extra fields, no remapping.
 */
type AIReducerState = AgentSessionStatusWire;

/**
 * Initial state used both at mount time and on `reset` (which fires when
 * the WS opens). `state: 'absent'` is the sentinel that means "no AI
 * session has bound yet" — it maps to `connected:false, connecting:false`
 * in the derived booleans.
 */
const initialState: AIReducerState = {
  sessionId: '',
  state: 'absent',
  conversationId: null,
  error: null,
  thinkingSince: null,
  startingSince: null,
};

/**
 * Reducer actions. The legacy fallback path is honored only while no
 * `session-state` has arrived on the current connection — that flag is
 * external to the reducer (kept in a ref) so the reducer stays a pure
 * data transform.
 */
type Action =
  | { type: 'session-state'; ai: AgentSessionStatusWire }
  | {
      type: 'legacy-status';
      sessionId: string;
      connected: boolean;
      connecting: boolean;
      conversationId: string | null;
      error: string | null;
    }
  | {
      type: 'legacy-thinking';
      sessionId: string;
      thinking: boolean;
      thinkingSince: string | null;
    }
  | { type: 'optimistic-restart'; sessionId: string }
  | { type: 'restart-failed'; sessionId: string; error: string }
  | { type: 'reset' };

/**
 * Derive an `AgentSessionState` from the legacy boolean tuple. Mirrors
 * the inverse of `statusToWireMessage` in `server/src/sessions/ai-router.ts`
 * so a server emitting legacy + new messages would resolve to the same
 * `state` regardless of which one the client consumed.
 */
function legacyStateOf(
  connected: boolean,
  connecting: boolean,
  thinking: boolean,
  error: string | null,
): AgentSessionStatusWire['state'] {
  if (connecting) return 'starting';
  if (thinking) return 'thinking';
  if (connected) return 'ready';
  if (error !== null) return 'degraded';
  return 'absent';
}

function reducer(s: AIReducerState, a: Action): AIReducerState {
  switch (a.type) {
    case 'session-state':
      return a.ai;
    case 'legacy-status': {
      const thinking = s.state === 'thinking';
      // The legacy `session-ai-status` message clears thinking when
      // `connected:false` arrives (matches the pre-#295 behaviour).
      const nextThinking = a.connected ? thinking : false;
      const next: AIReducerState = {
        ...s,
        sessionId: a.sessionId,
        state: legacyStateOf(a.connected, a.connecting, nextThinking, a.error),
        conversationId: a.conversationId,
        error: a.error,
        thinkingSince: nextThinking ? s.thinkingSince : null,
        // Preserve original startingSince across repeated `connecting` messages
        // (e.g., reconnect attempts) so UI timers don't reset mid-reconnect.
        startingSince: a.connecting ? (s.startingSince ?? new Date().toISOString()) : null,
      };
      return next;
    }
    case 'legacy-thinking': {
      const connected = s.state === 'ready' || s.state === 'thinking';
      const connecting = s.state === 'starting' || s.state === 'reconnecting';
      // Mirror the legacy server semantics: a `thinking:true` while we
      // are not connected stays in the underlying state (degraded etc.)
      // but flips the indicator so the kiosk sees the bubble. The next
      // legacy-status broadcast will reconcile.
      return {
        ...s,
        sessionId: a.sessionId,
        state: legacyStateOf(connected, connecting, a.thinking, s.error),
        thinkingSince: a.thinking ? a.thinkingSince : null,
      };
    }
    case 'optimistic-restart':
      return {
        ...s,
        sessionId: a.sessionId,
        state: 'starting',
        error: null,
        thinkingSince: null,
        startingSince: new Date().toISOString(),
      };
    case 'restart-failed':
      return {
        ...s,
        state: 'degraded',
        error: a.error,
        thinkingSince: null,
        startingSince: null,
      };
    case 'reset':
      return initialState;
  }
}

/**
 * Hook for managing session-centric AI connection state.
 *
 * Internally this is a `useReducer` over `AgentSessionStatus` (issue #295);
 * derived booleans (`connected`, `thinking`, etc.) are computed via
 * `useMemo` from the unified state so it is structurally impossible to
 * observe an incoherent combination like `thinking:true && connected:false`.
 *
 * Legacy `session-ai-status` and `ai-thinking` messages are still handled
 * (one release of back-compat); they are silently dropped once a
 * `session-state` has arrived on the current connection. A `reset` (fired
 * on WS open) clears that flag so reconnects start fresh.
 */
export function useAI({ sessionId }: UseAIOptions = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [restarting, setRestarting] = useReducerSimple<boolean>(false);
  const [restartError, setRestartError] = useReducerSimple<string | null>(null);
  /**
   * Tracks whether a `session-state` message has been observed on the
   * current connection. While true the legacy handlers are no-ops. Reset
   * is via the `reset` action below (consumers should dispatch it on WS
   * open). A ref (not state) keeps it from triggering re-renders.
   */
  const hasReceivedSessionStateRef = useRef(false);

  const checkAvailability = useCallback(async (): Promise<AIStatus> => {
    try {
      const response = await fetch('/api/ai/status');
      return await response.json();
    } catch {
      return { available: false, message: 'Failed to check AI status' };
    }
  }, []);

  // Handle unified `session-state` message (issue #295 — preferred shape).
  const handleSessionState = useCallback(
    (message: SessionStateMessage) => {
      // Only process messages for our session
      if (sessionId && message.sessionId !== sessionId) return;
      hasReceivedSessionStateRef.current = true;
      dispatch({ type: 'session-state', ai: message.ai });
    },
    [sessionId],
  );

  // Handle session-level AI status from WebSocket (legacy back-compat).
  const handleSessionAIStatus = useCallback(
    (message: SessionAIStatusMessage) => {
      if (sessionId && message.sessionId !== sessionId) return;
      if (hasReceivedSessionStateRef.current) return;
      dispatch({
        type: 'legacy-status',
        sessionId: message.sessionId,
        connected: message.connected,
        connecting: message.connecting ?? false,
        conversationId: message.conversationId ?? null,
        error: message.error ?? null,
      });
    },
    [sessionId],
  );

  // Handle thinking state from WebSocket (legacy back-compat).
  const handleAIThinking = useCallback(
    (message: AIThinkingMessage) => {
      if (sessionId && message.sessionId !== sessionId) return;
      if (hasReceivedSessionStateRef.current) return;
      dispatch({
        type: 'legacy-thinking',
        sessionId: message.sessionId,
        thinking: message.thinking,
        thinkingSince: message.thinkingSince ?? null,
      });
    },
    [sessionId],
  );

  // Reset reducer + the "session-state seen" flag. Consumers should call
  // this on WebSocket `open` so reconnects don't carry the previous
  // connection's preference forward.
  const reset = useCallback(() => {
    hasReceivedSessionStateRef.current = false;
    dispatch({ type: 'reset' });
  }, []);

  const restart = useCallback(async (): Promise<RestartResult> => {
    if (!sessionId) {
      const msg = 'No session selected';
      setRestartError(msg);
      return { ok: false, error: msg };
    }
    setRestarting(true);
    setRestartError(null);
    // Optimistic local transition: we expect a `session-state` (or legacy
    // `session-ai-status`) broadcast to confirm shortly. Clearing the
    // error and flipping state to `starting` hides the degraded indicator
    // immediately so the restart button doesn't reappear mid-restart.
    dispatch({ type: 'optimistic-restart', sessionId });
    try {
      const status = await restartAISession(sessionId);
      return { ok: true, status };
    } catch (err) {
      const message =
        err instanceof AISessionRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Restart failed';
      const status =
        err instanceof AISessionRequestError ? err.status : undefined;
      setRestartError(message);
      // Roll back the optimistic transition so the degraded indicator
      // reappears. Re-surface the prior error so the kiosk's inline
      // message matches the failure mode.
      dispatch({ type: 'restart-failed', sessionId, error: message });
      return status !== undefined
        ? { ok: false, error: message, status }
        : { ok: false, error: message };
    } finally {
      setRestarting(false);
    }
  }, [sessionId, setRestarting, setRestartError]);

  // Derived booleans. These are *not* stored in the reducer — they're
  // computed every render from the unified `state`. See the AIState
  // docstring for why we keep them around (legacy callers).
  const derived = useMemo(
    () => ({
      connected: state.state === 'ready' || state.state === 'thinking',
      connecting: state.state === 'starting' || state.state === 'reconnecting',
      thinking: state.state === 'thinking',
      degraded: state.state === 'degraded',
    }),
    [state.state],
  );

  return {
    connected: derived.connected,
    connecting: derived.connecting,
    thinking: derived.thinking,
    degraded: derived.degraded,
    restarting,
    restartError,
    conversationId: state.conversationId,
    error: state.error,
    /** Unified reducer state (issue #295). New code should prefer this. */
    aiStatus: state,
    checkAvailability,
    restart,
    handleSessionState,
    handleSessionAIStatus,
    handleAIThinking,
    reset,
  };
}

/**
 * Tiny `useState`-shaped wrapper around `useReducer` for primitive
 * scalars. We use this for `restarting` / `restartError` to avoid mixing
 * a `useState` import with the main reducer (which is the file's single
 * source-of-truth pattern). The return shape mirrors `useState`.
 */
function useReducerSimple<T>(initial: T): [T, (next: T) => void] {
  const [value, dispatch] = useReducer(
    (_prev: T, next: T) => next,
    initial,
  );
  return [value, dispatch];
}
