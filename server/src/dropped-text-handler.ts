/**
 * Observability hatch for the `case 'text'` path in `index.ts` when a final
 * text message arrives but the agent driver has no live session for the
 * device's `sessionId` (issue #341 § D).
 *
 * Pre-fix behaviour: the message was silently dropped — no log, no client
 * signal. That left users believing their typing did nothing (which it
 * did) with nothing on the wire to debug.
 *
 * Post-fix behaviour: log a warning and broadcast a unified `session-state`
 * with `state: 'degraded'` so the kiosk surfaces "AI not attached — try
 * restarting the session" and the #294 restart action becomes discoverable.
 *
 * Extracted as a tiny module so it can be unit-tested without spinning up
 * the WS server. The `index.ts` text handler calls it.
 */

import type { DeviceRegistry } from './registry.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import { broadcastSessionState } from './session-state-broadcast.js';

export interface DroppedTextArgs {
  /** The session id from the registered device (may be empty / anonymous). */
  sessionId: string | undefined;
  /** Utterance id from the inbound `text` frame, used for log correlation. */
  utteranceId: string;
  /**
   * True for partial (interim ASR) frames. The dropped-text hatch is
   * only meaningful for final messages; partials are noise.
   */
  partial: boolean;
  /** Registry used to broadcast the `session-state` snapshot. */
  registry: DeviceRegistry;
}

/**
 * Report a dropped text message via warn log + `degraded` session-state
 * broadcast.
 *
 * Returns `true` if the dropped-text path was taken (caller may use this
 * for metrics), `false` if the input didn't qualify (anonymous session,
 * partial frame, undefined session id).
 */
export function reportDroppedText(args: DroppedTextArgs): boolean {
  const { sessionId, utteranceId, partial, registry } = args;
  if (!sessionId || sessionId === ANONYMOUS_SESSION_ID || partial) {
    return false;
  }
  console.warn(
    `[AI] Dropped message: no AI session for ${sessionId}, utteranceId=${utteranceId}`,
  );
  broadcastSessionState(
    registry,
    sessionId,
    {
      sessionId,
      state: 'degraded',
      conversationId: null,
      error: 'AI not attached — try restarting the session',
      thinkingSince: null,
      startingSince: null,
    },
    'text-handler:no-agent',
  );
  return true;
}
