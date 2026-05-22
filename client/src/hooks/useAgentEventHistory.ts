/**
 * Fetch the persisted agent-event history for a session
 * (`GET /api/sessions/:sessionId/agent-events`) on mount and on `sessionId`
 * change.
 *
 * The hook owns the network state only — it does *not* merge into
 * `useAgentActions` directly. Callers (e.g. `SessionView`) are expected to
 * watch the `events` return value with an effect and forward it to
 * `agentActions.seedActions(...)`. This split keeps the live-WS path and the
 * REST hydration path independently testable.
 *
 * Reference: issue #269.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentEventFetchError,
  fetchAgentEventHistory,
  type AgentEventHistory,
} from '../api/agentEvents';

/** Default page size — matches the server's documented default in PR #266. */
const DEFAULT_LIMIT = 500;

export interface UseAgentEventHistoryOptions {
  /** Session to fetch history for. When `undefined`, no fetch is performed. */
  sessionId?: string;
  /** Whether the hook is enabled — gates the initial fetch. */
  enabled?: boolean;
  /** Override the default limit. */
  limit?: number;
}

export interface UseAgentEventHistoryResult {
  /** Normalized history events (empty until the first fetch resolves). */
  history: AgentEventHistory['events'];
  /** Whether the initial / current fetch is in flight. */
  loading: boolean;
  /** Whether the most recent rehydration completed successfully on the server. */
  rehydrationComplete: boolean;
  /** OH conversation id mapped to this session, or `null` if unmapped. */
  conversationId: string | null;
  /** User-friendly error message, or `null` on success / before first fetch. */
  error: string | null;
  /** HTTP status of the last error (`undefined` for network errors). */
  errorStatus: number | undefined;
  /** Refetch with `rehydrate=force` — used by the "Retry" affordance. */
  retry: () => void;
}

/**
 * Hook implementation. See module-level docs.
 */
export function useAgentEventHistory({
  sessionId,
  enabled = true,
  limit = DEFAULT_LIMIT,
}: UseAgentEventHistoryOptions): UseAgentEventHistoryResult {
  const [history, setHistory] = useState<AgentEventHistory['events']>([]);
  const [loading, setLoading] = useState(false);
  const [rehydrationComplete, setRehydrationComplete] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  // Distinct from a refetch counter — also encodes the rehydrate mode so the
  // retry button can request a fresh server-side rehydration.
  const [fetchTrigger, setFetchTrigger] = useState<{ n: number; force: boolean }>({
    n: 0,
    force: false,
  });

  // Keep the latest sessionId in a ref so the retry callback doesn't re-create
  // (and re-mount its consumer) every time sessionId changes.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const retry = useCallback(() => {
    setFetchTrigger((prev) => ({ n: prev.n + 1, force: true }));
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) {
      // Reset any prior state if we lose the sessionId / get disabled. Doing
      // this in the effect (rather than imperatively) keeps `loading=false`
      // observable to the caller before the first real fetch lands.
      setHistory([]);
      setLoading(false);
      setRehydrationComplete(true);
      setConversationId(null);
      setError(null);
      setErrorStatus(undefined);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setErrorStatus(undefined);

      try {
        const result = await fetchAgentEventHistory({
          sessionId: sessionId!,
          limit,
          rehydrate: fetchTrigger.force ? 'force' : 'auto',
          signal: controller.signal,
        });
        if (cancelled) return;
        setHistory(result.events);
        setRehydrationComplete(result.rehydrationComplete);
        setConversationId(result.conversationId);
        if (result.rehydrationError && !result.rehydrationComplete) {
          // Surface the rehydration error to the console; the UI surfaces a
          // separate "partial history" banner driven by `rehydrationComplete`
          // — we deliberately do not block live WS rendering on this.
          console.warn(
            '[agentEventHistory] Partial rehydration:',
            result.rehydrationError,
          );
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const fetchErr = err instanceof AgentEventFetchError ? err : null;
        const msg = fetchErr
          ? fetchErr.message
          : err instanceof Error
            ? err.message
            : 'Failed to load agent activity history.';
        setError(msg);
        setErrorStatus(fetchErr?.status);
        // Don't clear the existing history — keep whatever we previously
        // rendered visible, just surface the error inline.
        console.warn('[agentEventHistory] Fetch failed:', msg);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId, enabled, limit, fetchTrigger]);

  return {
    history,
    loading,
    rehydrationComplete,
    conversationId,
    error,
    errorStatus,
    retry,
  };
}
