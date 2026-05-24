/**
 * AI session-state resync emitted when a device registers (or re-registers
 * after a reconnect).
 *
 * AI status is otherwise only broadcast on transitions (via the driver's
 * thinking/action callbacks). A device that joins mid-conversation observes
 * no transition until the next one occurs — which on a stable session that's
 * just been resumed may never happen until the user speaks again. The kiosk
 * then never shows the ✨ AI indicator after a refresh, even though the
 * agent is alive in the background.
 *
 * This helper queries the driver for the current `AgentSessionStatus` and
 * sends a unicast resync to the registering WebSocket. Other devices in the
 * session already have the latest state from prior transitions, so we do
 * NOT broadcast here.
 *
 * Wire shape: until issue #295 ships, the resync emits the existing legacy
 * pair (`session-ai-status` + optional `ai-thinking`). When #295 lands the
 * same calling site will emit a single unified `session-state` message.
 *
 * See: github.com/jpshackelford/voice-relay/issues/290
 */
import type { WebSocket } from 'ws';
import type { AgentDriver } from './agent-driver/index.js';
import { isAnonymousSession } from './constants.js';
import type { AIThinkingMessage, SessionAIStatusMessage } from './types.js';

/**
 * Send the current AI session state to a single registering WebSocket.
 *
 * The helper is fire-and-forget by contract: failures are logged and
 * swallowed so that a driver hiccup never breaks the device registration
 * flow. The caller should still `await` so that, on the happy path, the
 * resync is sent before any subsequent unicasts.
 *
 * Behavior:
 * - Anonymous sessions are a no-op (no AI binding by definition).
 * - `state === 'absent'` is a no-op (no session known to the driver).
 * - Otherwise emits `session-ai-status`, plus `ai-thinking` when the
 *   agent is currently processing.
 */
export async function resyncAISessionState(
  ws: Pick<WebSocket, 'send'>,
  sessionId: string,
  agentDriver: Pick<AgentDriver, 'getSessionStatus'>
): Promise<void> {
  if (isAnonymousSession(sessionId)) {
    return;
  }

  let status;
  try {
    status = await agentDriver.getSessionStatus(sessionId);
  } catch (err) {
    // Driver failures must not break registration. Log and continue.
    console.warn(
      `[AI Resync] getSessionStatus failed for session=${sessionId}:`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  if (status.state === 'absent') {
    // No AI session known to the driver — leave the client at its default
    // (no ✨ indicator). Sending `connected: false` on every register would
    // over-broadcast and steer the UI away from its real default.
    return;
  }

  const statusMsg: SessionAIStatusMessage = {
    type: 'session-ai-status',
    sessionId,
    connected: status.state === 'ready' || status.state === 'thinking',
    connecting: status.state === 'starting' || status.state === 'reconnecting',
    conversationId: status.conversationId ?? undefined,
    error: status.error ?? undefined,
  };
  ws.send(JSON.stringify(statusMsg));

  if (status.state === 'thinking') {
    const thinkingMsg: AIThinkingMessage = {
      type: 'ai-thinking',
      sessionId,
      thinking: true,
      thinkingSince: status.thinkingSince ?? undefined,
    };
    ws.send(JSON.stringify(thinkingMsg));
  }
}
