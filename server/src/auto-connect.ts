/**
 * Auto-connect AI logic - creates AI conversation when first device joins a session
 *
 * Extracted to a separate module for testability.
 *
 * Talks to the AI integration through the provider-neutral `AgentDriver`
 * seam (see `server/src/agent-driver/`). The OpenHands binding is the
 * production driver; tests can substitute a `FakeDriver` to exercise the
 * platform's auto-connect path without any OpenHands coupling.
 */

import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { MessageStore } from './storage/index.js';
import type { AgentDriver } from './agent-driver/index.js';
import type { TtsService } from './tts/index.js';
import type { SessionAIStatusMessage } from './types.js';
import { isAnonymousSession } from './constants.js';

/**
 * Dependencies required by autoConnectAI function.
 * Allows injection of real or mock implementations for testing.
 */
export interface AutoConnectDependencies {
  registry: DeviceRegistry;
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository | null;
  agentDriver: AgentDriver;
  store: MessageStore;
  /** Function to get workspace API key (handles decryption) */
  getWorkspaceApiKey: (workspaceId: string) => Promise<string | null>;
  /** Optional TTS service for generating speech from AI responses */
  ttsService?: TtsService;
}

/**
 * Auto-connect AI when first device joins a session.
 * Creates an AI conversation for the session and broadcasts status to all devices.
 *
 * AI message broadcast (the `text` relay loop with TTS) is wired by the
 * platform's WS text handler against `agentDriver.sendMessage`'s
 * `AsyncIterable`, not here — `openSession` is purely about provisioning
 * the upstream session and announcing it to devices.
 *
 * @param sessionId - The session ID to connect AI to
 * @param workspaceId - The workspace ID containing the session
 * @param deps - Dependencies for the operation
 */
export async function autoConnectAI(
  sessionId: string,
  workspaceId: string,
  deps: AutoConnectDependencies
): Promise<void> {
  const { registry, sessionRepository, workspaceRepository, agentDriver, getWorkspaceApiKey } = deps;

  console.log(`[AI] Auto-connecting AI for session ${sessionId}`);

  // Broadcast connecting status to all devices in session
  const connectingStatus: SessionAIStatusMessage = {
    type: 'session-ai-status',
    sessionId,
    connecting: true,
    connected: false,
  };
  registry.broadcastMessageToSession(sessionId, connectingStatus);

  try {
    // Get workspace API key (if configured)
    const apiKey = workspaceRepository
      ? await getWorkspaceApiKey(workspaceId)
      : null;

    // Check if AI is available (workspace key or env key)
    if (!apiKey && !agentDriver.isAvailable()) {
      console.log(`[AI] Auto-connect skipped for session ${sessionId}: No API key available`);
      const unavailableStatus: SessionAIStatusMessage = {
        type: 'session-ai-status',
        sessionId,
        connecting: false,
        connected: false,
        error: 'OpenHands API not configured',
      };
      registry.broadcastMessageToSession(sessionId, unavailableStatus);
      return;
    }

    // Get or create display secret for the session
    let displayApiSecret = sessionRepository.getDisplaySecret(sessionId);
    if (!displayApiSecret) {
      displayApiSecret = sessionRepository.setDisplaySecret(sessionId);
    }

    // Get min display lines from connected kiosks
    const displayLines = registry.getMinKioskDisplayLines(workspaceId);

    // Open (and eagerly provision, for the OpenHands adapter) the agent session.
    const status = await agentDriver.openSession(sessionId, {
      workspaceId,
      displayLines,
      ...(apiKey ? { apiKey } : {}),
      ...(displayApiSecret ? { displayApiSecret } : {}),
    });

    // Persist the OH conversation ID to session metadata so we can rehydrate
    // events from OH REST after the live WS has died and our cached rows
    // have been pruned. The in-memory map in AISessionManager is lost on
    // server restart; the DB is the only durable home.
    if (status.conversationId) {
      try {
        sessionRepository.updateMetadata(sessionId, {
          aiConversationId: status.conversationId,
        });
      } catch (metaErr) {
        // Non-fatal: rehydration just won't be possible for this session,
        // which is the same behaviour we had before this code existed.
        console.error(`[AI] Failed to persist aiConversationId for session ${sessionId}:`, metaErr);
      }
    }

    // Broadcast connected status
    const connectedStatus: SessionAIStatusMessage = {
      type: 'session-ai-status',
      sessionId,
      connecting: false,
      connected: true,
      ...(status.conversationId ? { conversationId: status.conversationId } : {}),
    };
    registry.broadcastMessageToSession(sessionId, connectedStatus);
    console.log(`[AI] Auto-connected AI for session ${sessionId}, conversation: ${status.conversationId}`);
  } catch (err) {
    // Log full error server-side for debugging
    console.error(`[AI] Auto-connect failed for session ${sessionId}:`, err);
    // Sanitize error message for clients to avoid leaking internal details
    const errorStatus: SessionAIStatusMessage = {
      type: 'session-ai-status',
      sessionId,
      connecting: false,
      connected: false,
      error: 'Failed to connect AI assistant',
    };
    registry.broadcastMessageToSession(sessionId, errorStatus);
  }
}

/**
 * Check if auto-connect should be triggered for a session.
 * Returns true if this is the first device and no AI session exists.
 *
 * @param sessionId - The session ID to check
 * @param sessionRepository - Repository to get devices in session
 * @param agentDriver - Agent driver to check for existing sessions
 */
export function shouldAutoConnect(
  sessionId: string,
  sessionRepository: SessionRepository,
  agentDriver: AgentDriver
): boolean {
  if (isAnonymousSession(sessionId)) {
    return false;
  }

  const devicesInSession = sessionRepository.getDevices(sessionId);
  const isFirstDevice = devicesInSession.length === 1;
  // Note: Race condition possible if two devices join simultaneously.
  // Both might trigger auto-connect, but `openSession` is idempotent.

  return isFirstDevice && !agentDriver.hasSession(sessionId);
}
