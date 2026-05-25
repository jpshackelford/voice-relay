/**
 * Resync helper for issue #290.
 *
 * When a device (re)registers on a WebSocket mid-session, the server's
 * register handler must catch the newcomer up on the current AI session
 * state. Live transitions are only broadcast as they happen, so a device
 * that joins after the agent has reached `ready` (or while it's still
 * `thinking`) would otherwise observe no AI indicator until the next user
 * utterance.
 *
 * This module isolates that catch-up logic into a single async function so
 * it can be unit-tested with a `FakeDriver` rather than via the WebSocket
 * server proper. The function is also the natural seat for the wire-format
 * adapter: until #295 ships the unified `session-state` message, we send
 * the legacy `session-ai-status` (+ optional `ai-thinking`) pair derived
 * from `AgentDriver.getSessionStatus`.
 */

import type { AgentDriver } from './agent-driver/types.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import type { AIThinkingMessage, SessionAIStatusMessage } from './types.js';
import { buildSessionStateMessage } from './session-state-broadcast.js';

/**
 * Minimal WebSocket-like shape used by this helper.
 *
 * We avoid pulling in the full `ws` package's `WebSocket` type so that
 * tests can pass a plain mock (`{ send: vi.fn() }`) without satisfying the
 * dozens of fields on the real class.
 */
export interface ResyncTarget {
  send(data: string): void;
}

/**
 * Send the current AI session status to the registering WebSocket.
 *
 * - No-op for the anonymous session (no AI binding by definition).
 * - No-op when the driver reports `state === 'absent'` — sending a
 *   `connected: false` status on every register would over-broadcast and
 *   defeat the point of the catch-up.
 * - Targets only the passed-in `ws`. Other devices in the session already
 *   observed the live transitions; rebroadcasting would emit duplicates.
 * - Wrapped in try/catch: a failure to read the status MUST NOT abort the
 *   register flow. We log and continue.
 *
 * Wire shape (legacy, pre-#295):
 *   - Always: `session-ai-status` with `connected`/`connecting` derived
 *     from `AgentSessionStatus.state` and optional `conversationId`/`error`.
 *   - If state === 'thinking', additionally `ai-thinking` with the
 *     `thinkingSince` timestamp so a rejoining client can mirror the
 *     existing in-flight UX.
 */
export async function resyncAgentSessionStatus(
  ws: ResyncTarget,
  sessionId: string,
  agentDriver: Pick<AgentDriver, 'getSessionStatus'>,
): Promise<void> {
  if (sessionId === ANONYMOUS_SESSION_ID) {
    return;
  }

  let status;
  try {
    status = await agentDriver.getSessionStatus(sessionId);
  } catch (err) {
    console.error(`[Resync] getSessionStatus failed for session ${sessionId}:`, err);
    return;
  }

  if (status.state === 'absent') {
    return;
  }

  const connected = status.state === 'ready' || status.state === 'thinking';
  const connecting = status.state === 'starting' || status.state === 'reconnecting';

  const aiStatus: SessionAIStatusMessage = {
    type: 'session-ai-status',
    sessionId,
    connected,
    connecting,
    ...(status.conversationId ? { conversationId: status.conversationId } : {}),
    ...(status.error ? { error: status.error } : {}),
  };
  ws.send(JSON.stringify(aiStatus));

  if (status.state === 'thinking') {
    const thinking: AIThinkingMessage = {
      type: 'ai-thinking',
      sessionId,
      thinking: true,
      ...(status.thinkingSince ? { thinkingSince: status.thinkingSince } : {}),
    };
    ws.send(JSON.stringify(thinking));
  }

  // Unified `session-state` (issue #295). Emit alongside the legacy pair so
  // a rejoining client that speaks the new shape gets a single authoritative
  // snapshot of the agent session.
  ws.send(JSON.stringify(buildSessionStateMessage(sessionId, status)));
}
