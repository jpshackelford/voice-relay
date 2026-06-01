/**
 * Observability hatch for the `case 'text'` path in `index.ts` when a final
 * text message arrives but the agent driver has no live session for the
 * device's `sessionId` (issue #341 § D).
 *
 * Pre-fix behaviour: the message was silently dropped — no log, no client
 * signal. That left users believing their typing did nothing (which it
 * did) with nothing on the wire to debug.
 *
 * Post-fix behaviour: log a warning and, only when the driver itself reports
 * the session as `degraded`, broadcast that authoritative `session-state`
 * snapshot so the kiosk surfaces "AI not attached — try restarting the
 * session" and the #294 restart action becomes discoverable.
 *
 * Earlier versions of this helper *always* synthesised a `degraded`
 * snapshot, which clobbered legitimate `starting` / `reconnecting`
 * snapshots whenever a user spoke during the warm-up window
 * (see issue #373). The driver's `getSessionStatus` is the authoritative
 * source — we now defer to it instead of fabricating a state.
 *
 * Extracted as a tiny module so it can be unit-tested without spinning up
 * the WS server. The `index.ts` text handler calls it.
 */

import type { DeviceRegistry } from './registry.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import { broadcastSessionState } from './session-state-broadcast.js';
import type { AgentDriver } from './agent-driver/types.js';

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
  /**
   * Driver used to resolve the authoritative session status before
   * deciding whether to broadcast a `degraded` snapshot (#373).
   */
  agentDriver: AgentDriver;
}

/**
 * Report a dropped text message via warn log + (conditional) `degraded`
 * session-state broadcast.
 *
 * Returns `true` if the dropped-text path was taken (caller may use this
 * for metrics), `false` if the input didn't qualify (anonymous session,
 * partial frame, undefined session id).
 *
 * The warn log is unconditional once the input qualifies — it is the
 * observability hook for the silent-drop class of bugs (#341 § D) and
 * fires regardless of the driver's reported state.
 *
 * The `session-state` broadcast is gated on the driver returning
 * `state === 'degraded'`. For `absent`, `starting`, `reconnecting`,
 * `ready`, or `thinking` we deliberately stay silent so that the next
 * authoritative transition (from `auto-connect.ts`, `ai-router.ts`, or
 * the rebind path) is the snapshot the kiosk sees (#373).
 */
export async function reportDroppedText(args: DroppedTextArgs): Promise<boolean> {
  const { sessionId, utteranceId, partial, registry, agentDriver } = args;
  if (!sessionId || sessionId === ANONYMOUS_SESSION_ID || partial) {
    return false;
  }
  console.warn(
    `[AI] Dropped message: no AI session for ${sessionId}, utteranceId=${utteranceId}`,
  );

  // Defer to the driver for the authoritative session state. Only escalate
  // to a client-visible `degraded` broadcast when the driver agrees the
  // session is genuinely unhealthy. During `starting` / `reconnecting`
  // (and the no-driver-session-yet `absent` window), a legitimate
  // snapshot is either already in flight or about to be emitted by the
  // auto-connect / rebind path — clobbering it with `degraded` here just
  // flashes a spurious "try restarting the session" prompt (#373).
  let status;
  try {
    status = await agentDriver.getSessionStatus(sessionId);
  } catch (err) {
    // A failure to read status is itself anomalous; log and swallow rather
    // than throwing back to the WS handler. We intentionally do not
    // broadcast in this case — we have no trustworthy state to share.
    console.warn(
      `[AI] reportDroppedText: getSessionStatus(${sessionId}) failed:`,
      err,
    );
    return true;
  }

  if (status.state === 'degraded') {
    broadcastSessionState(registry, sessionId, status, 'text-handler:no-agent');
  }
  return true;
}
