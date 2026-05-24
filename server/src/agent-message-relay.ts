/**
 * Helpers for forwarding text into the agent and relaying the agent's
 * response back to session devices.
 *
 * Replaces the legacy manager-level `sendSessionMessage` +
 * session-level `onMessage` callback model. The platform now iterates
 * `agentDriver.sendMessage`'s `AsyncIterable<AgentEvent>` and broadcasts
 * `message` events to all devices in the session, persists them in the
 * message store, and (optionally) drives TTS.
 *
 * Extracted from `index.ts` so the relay loop is unit-testable against a
 * `FakeDriver` rather than a live OpenHands integration.
 */

import type { AgentDriver, AgentEvent } from './agent-driver/index.js';
import type { DeviceRegistry } from './registry.js';
import type { MessageStore } from './storage/index.js';
import type { SessionRepository } from './sessions/index.js';
import type { TtsService } from './tts/index.js';
import type { RelayedTextMessage } from './types.js';

export interface AgentMessageRelayDeps {
  agentDriver: AgentDriver;
  registry: DeviceRegistry;
  store: MessageStore;
  sessionRepository: SessionRepository | null;
  ttsService?: TtsService | undefined;
}

/**
 * Send `text` to the agent for `sessionId` and relay every `message`
 * event back to session devices (broadcast + persist + optional TTS).
 *
 * Async-but-fire-and-forget by design: callers in the WS handler invoke
 * this without `await`-ing the response stream so they can keep
 * processing incoming frames. Errors are logged and swallowed; they
 * never escape to the caller.
 */
export async function relayAgentResponse(
  sessionId: string,
  workspaceId: string,
  utteranceId: string,
  text: string,
  deps: AgentMessageRelayDeps
): Promise<void> {
  try {
    for await (const event of deps.agentDriver.sendMessage(sessionId, utteranceId, text)) {
      if (event.kind === 'message') {
        broadcastAgentMessage(sessionId, workspaceId, event, deps);
      } else if (event.kind === 'error') {
        console.error(
          `[AI] Agent error for session ${sessionId}, utterance ${utteranceId}: ${event.message}`
        );
      }
    }
  } catch (err) {
    console.error(`[AI] Failed to relay agent response for session ${sessionId}:`, err);
  }
}

function broadcastAgentMessage(
  sessionId: string,
  workspaceId: string,
  event: Extract<AgentEvent, { kind: 'message' }>,
  deps: AgentMessageRelayDeps
): void {
  // Fabricate an utteranceId for the AI's own message — distinct from the
  // user utteranceId that triggered it. Matches the legacy
  // `autoConnectAI` onMessage path's id shape.
  const aiUtteranceId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const aiMessage: RelayedTextMessage = {
    type: 'text',
    utteranceId: aiUtteranceId,
    workspaceId,
    sessionId,
    senderId: 'ai',
    senderName: '✨ AI',
    text: event.text,
    partial: false,
    ...(event.serverTimestamp ? { serverTimestamp: event.serverTimestamp } : {}),
  };

  deps.store.append(aiMessage).catch((err) => {
    console.error(`[AI] Failed to persist AI message for session ${sessionId}:`, err);
  });
  deps.registry.broadcastToSession(aiMessage, sessionId);

  if (deps.ttsService && deps.ttsService.isEnabled(workspaceId)) {
    const session = deps.sessionRepository?.findById(sessionId);
    const sessionTtsSettings = session?.metadata?.ttsSettings;
    deps.ttsService
      .synthesizeForSession(event.text, workspaceId, sessionId, aiUtteranceId, sessionTtsSettings)
      .catch((err) => {
        console.error(`[TTS] Failed to synthesize for session ${sessionId}:`, err);
      });
  }
}
