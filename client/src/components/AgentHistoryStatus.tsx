/**
 * Subtle inline status banner for the agent-event history hydration path
 * (issue #269). Renders one of:
 *
 *  - Spinner: "Loading agent activity…" while the fetch is in flight.
 *  - Error: "Couldn't load agent activity history. [Retry]" on fetch failure.
 *  - Partial: "Showing partial history — agent events may be missing. [Retry]"
 *    when `rehydration_complete=false`.
 *  - No-mapping: "No agent activity recorded for this session." when the
 *    session has no conversation_id and zero events. Distinguished from a
 *    spinner-forever empty state by being a terminal text label.
 *  - Otherwise: nothing (the events panel reflects whatever is in state).
 *
 * Kept as a small standalone component so KioskMode's render path stays
 * mostly untouched (minimizes conflict with in-flight PR #272 on the
 * timeline merge).
 */

interface AgentHistoryStatusProps {
  loading: boolean;
  error: string | null;
  rehydrationComplete: boolean;
  /**
   * OH conversation id mapped to this session, or `null` if unmapped.
   * `undefined` means the history fetch hasn't completed yet (so we shouldn't
   * yet conclude there's no mapping).
   */
  conversationId: string | null | undefined;
  /** Current number of agent actions in state (live + seeded). */
  actionCount: number;
  /** Optional retry handler; rendered as a "[Retry]" button when present. */
  onRetry?: () => void;
}

export function AgentHistoryStatus({
  loading,
  error,
  rehydrationComplete,
  conversationId,
  actionCount,
  onRetry,
}: AgentHistoryStatusProps) {
  if (loading) {
    return (
      <div
        className="agent-history-status agent-history-status--loading"
        role="status"
        aria-live="polite"
      >
        <span className="agent-history-status__spinner" aria-hidden="true">⏳</span>
        <span>Loading agent activity…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="agent-history-status agent-history-status--error"
        role="alert"
      >
        <span>Couldn't load agent activity history.</span>
        {onRetry && (
          <button
            type="button"
            className="agent-history-status__retry"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!rehydrationComplete) {
    return (
      <div
        className="agent-history-status agent-history-status--partial"
        role="status"
      >
        <span>Showing partial history — agent events may be missing.</span>
        {onRetry && (
          <button
            type="button"
            className="agent-history-status__retry"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // No-mapping / TTL-pruned-and-recovery-empty fallback: only show once we
  // know there's nothing to render. `conversationId === undefined` means the
  // initial fetch hasn't completed — keep quiet to avoid flicker.
  if (conversationId === null && actionCount === 0) {
    return (
      <div
        className="agent-history-status agent-history-status--empty"
        role="status"
      >
        <span>No agent activity recorded for this session.</span>
      </div>
    );
  }

  return null;
}
