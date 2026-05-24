import { useState, useCallback } from 'react';
import type { AIThinkingMessage, SessionAIStatusMessage } from '../types';
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
 */
export interface AIState {
  connected: boolean;
  connecting: boolean;
  thinking: boolean;
  /**
   * Heuristic: the upstream AI session looks unhealthy and the user should
   * be offered a restart. True when the server reported a session-level
   * error and the indicator is neither connecting nor connected. Will be
   * replaced by an authoritative `state === 'degraded'` flag once #295
   * lands the unified `session-state` wire message.
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
 * Hook for managing session-centric AI connection state.
 *
 * AI sessions are now automatically managed:
 * - Auto-connect when first device joins a session
 * - Messages are forwarded to AI via WebSocket (server-side)
 * - Connection state is pushed from server via WebSocket
 *
 * This hook provides read-only status and handlers for WebSocket events.
 */
export function useAI({ sessionId }: UseAIOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  // Derived degraded indicator. The wire shape currently in use
  // (`session-ai-status`) does not carry an explicit `state: degraded`
  // field — it surfaces as `connected=false, connecting=false, error≠null`
  // (see server/src/resync-agent-status.ts mapping). We rebuild that
  // signal here so the kiosk can show the restart affordance without
  // waiting for #295's unified state surface.
  const degraded = !connected && !connecting && error !== null;

  const checkAvailability = useCallback(async (): Promise<AIStatus> => {
    try {
      const response = await fetch('/api/ai/status');
      return await response.json();
    } catch {
      return { available: false, message: 'Failed to check AI status' };
    }
  }, []);

  // Handle session-level AI status from WebSocket (session-centric)
  const handleSessionAIStatus = useCallback((message: SessionAIStatusMessage) => {
    // Only process messages for our session
    if (sessionId && message.sessionId !== sessionId) return;

    setConnecting(message.connecting ?? false);
    setConnected(message.connected);
    setConversationId(message.conversationId ?? null);
    // Update error state from each broadcast — when the session recovers
    // we want the prior error cleared so the restart button hides again.
    setError(message.error ?? null);

    // Clear thinking state when disconnected
    if (!message.connected) {
      setThinking(false);
    }
  }, [sessionId]);

  // Handle thinking state from WebSocket
  const handleAIThinking = useCallback((message: AIThinkingMessage) => {
    // Only process messages for our session
    if (sessionId && message.sessionId !== sessionId) return;
    setThinking(message.thinking);
  }, [sessionId]);

  const restart = useCallback(async (): Promise<RestartResult> => {
    if (!sessionId) {
      const msg = 'No session selected';
      setRestartError(msg);
      return { ok: false, error: msg };
    }
    setRestarting(true);
    setRestartError(null);
    // Optimistic local transition: we expect the server's `session-ai-status`
    // broadcast to confirm shortly. Clearing `error` hides the degraded
    // indicator immediately so the button doesn't reappear mid-restart.
    setConnecting(true);
    setConnected(false);
    setThinking(false);
    setError(null);
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
      // reappears (the server failed to restart, so the agent is still
      // sad). Re-surface the prior session error to keep parity with the
      // last server broadcast.
      setConnecting(false);
      setError(message);
      return status !== undefined
        ? { ok: false, error: message, status }
        : { ok: false, error: message };
    } finally {
      setRestarting(false);
    }
  }, [sessionId]);

  return {
    connected,
    connecting,
    thinking,
    degraded,
    restarting,
    restartError,
    conversationId,
    error,
    checkAvailability,
    restart,
    handleSessionAIStatus,
    handleAIThinking,
  };
}
