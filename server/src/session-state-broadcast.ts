/**
 * Helper for emitting the unified `session-state` wire message (issue #295)
 * alongside the legacy `session-ai-status` + `ai-thinking` pair.
 *
 * The legacy emitters elsewhere in the server already broadcast their own
 * messages; this helper just adds the new shape so the client reducer in
 * `useAI` can converge on a single, internally-consistent state.
 *
 * Keep this thin: any future fields added to `AgentSessionStatus` (e.g.
 * `startupPhase` for #301) flow through automatically — we transport the
 * driver type 1:1 without translation.
 */

import type { AgentSessionStatus } from './agent-driver/types.js';
import type { DeviceRegistry } from './registry.js';
import type { SessionStateMessage } from './types.js';

/**
 * Minimal subset of `DeviceRegistry` used by the helper. Loosened so
 * tests can pass a `{ broadcastMessageToSession: vi.fn() }` mock without
 * needing a full registry.
 */
export interface SessionStateBroadcastTarget {
  broadcastMessageToSession(sessionId: string, message: unknown): void;
}

/**
 * Build a unified `session-state` message from an `AgentSessionStatus`.
 * Exported separately so the WS resync path (which writes to a single
 * `ws.send`, not the registry) can reuse the same translation.
 */
export function buildSessionStateMessage(
  sessionId: string,
  status: AgentSessionStatus,
): SessionStateMessage {
  return {
    type: 'session-state',
    sessionId,
    ai: status,
  };
}

/**
 * Broadcast a `session-state` message to all peers in the session.
 *
 * Wraps `registry.broadcastMessageToSession` in a try/catch because the
 * caller is invariably inside a control-flow path (auto-connect, restart,
 * thinking transition) that MUST NOT abort on a broadcast error. We log
 * and continue — the legacy pair already broadcast (or will broadcast)
 * also carries the state for clients that don't speak the new shape.
 *
 * `context` identifies the call-site in logs (e.g. `'announce'`,
 * `'auto-connect:final'`).
 */
export function broadcastSessionState(
  registry: SessionStateBroadcastTarget | DeviceRegistry | undefined,
  sessionId: string,
  status: AgentSessionStatus,
  context: string,
): void {
  if (!registry) return;
  const message = buildSessionStateMessage(sessionId, status);
  try {
    registry.broadcastMessageToSession(sessionId, message);
  } catch (err) {
    console.error(
      `[SessionState] Broadcast (${context}) failed for session ${sessionId}:`,
      err,
    );
  }
}
