/**
 * "Restart agent" affordance for the kiosk (issue #294).
 *
 * Visible only when the upstream agent session looks degraded — i.e. the
 * server has broadcast a `session-ai-status` with an error and the
 * indicator is neither connecting nor connected. On click, POSTs to
 * `POST /api/sessions/:sessionId/ai/restart` (via the `restart()` action
 * exposed by `useAI`) and shows a transient inline error if the request
 * fails.
 *
 * Kept as a small standalone component so the kiosk's render paths
 * (mobile + desktop) stay readable.
 */
import { useEffect, useState } from 'react';
import type { AIState } from '../hooks/useAI';

interface AIRestartButtonProps {
  ai?: AIState;
  /**
   * Optional className applied to the wrapper for layout tweaks at the
   * call site. The button itself has its own class for styling.
   */
  className?: string;
}

/** How long the inline error message lingers after a failed restart. */
const ERROR_VISIBLE_MS = 5_000;

export function AIRestartButton({ ai, className }: AIRestartButtonProps) {
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Auto-clear the inline error after a few seconds so it doesn't linger
  // forever. The user can click again to retry; clearing on next click is
  // also handled by the optimistic transition in `useAI.restart`.
  useEffect(() => {
    if (!inlineError) return;
    const t = setTimeout(() => setInlineError(null), ERROR_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [inlineError]);

  if (!ai) return null;
  // Only render when the agent is degraded. Per the spec we intentionally
  // do not surface a restart in the `absent` state — that's a fresh-start
  // path, not a recovery path.
  if (!ai.degraded) return null;

  const handleClick = async () => {
    setInlineError(null);
    const result = await ai.restart();
    if (!result.ok) setInlineError(result.error);
  };

  return (
    <div className={`ai-restart${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="ai-restart__button"
        onClick={handleClick}
        disabled={ai.restarting}
        aria-busy={ai.restarting}
      >
        {ai.restarting ? 'Restarting…' : 'Restart agent'}
      </button>
      {inlineError && (
        <span
          className="ai-restart__error"
          role="status"
          aria-live="polite"
        >
          Restart failed — try again
        </span>
      )}
    </div>
  );
}
