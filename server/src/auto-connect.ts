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
import type { AgentSessionStatus } from './agent-driver/types.js';
import type { TtsService } from './tts/index.js';
import type { SessionAIStatusMessage } from './types.js';
import { isAnonymousSession } from './constants.js';
import { broadcastSessionState } from './session-state-broadcast.js';
import { persistAiConversationId } from './sessions/persist-ai-conversation-id.js';

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
  // Unified `session-state` (issue #295). Synthesise an `AgentSessionStatus`
  // with `state: 'starting'` for clients that consume the new shape; the
  // driver doesn't have an upstream session yet, so we can't read it.
  const startingStatus: AgentSessionStatus = {
    sessionId,
    state: 'starting',
    conversationId: null,
    error: null,
    thinkingSince: null,
    startingSince: new Date().toISOString(),
  };
  broadcastSessionState(registry, sessionId, startingStatus, 'auto-connect:connecting');

  try {
    // Resolve workspace API key. After #404 the env-keyed driver fallback
    // is gone — `getWorkspaceApiKey` is the sole source. When the
    // workspace repository isn't wired (older code paths / tests),
    // there's no key and auto-connect skips. The legacy
    // `agentDriver.isAvailable()` probe was removed alongside.
    const apiKey = workspaceRepository
      ? await getWorkspaceApiKey(workspaceId)
      : null;

    if (!apiKey) {
      console.log(`[AI] Auto-connect skipped for session ${sessionId}: No API key available`);
      const unavailableStatus: SessionAIStatusMessage = {
        type: 'session-ai-status',
        sessionId,
        connecting: false,
        connected: false,
        error: 'OpenHands API not configured',
      };
      registry.broadcastMessageToSession(sessionId, unavailableStatus);
      broadcastSessionState(
        registry,
        sessionId,
        {
          sessionId,
          state: 'degraded',
          conversationId: null,
          error: 'OpenHands API not configured',
          thinkingSince: null,
          startingSince: null,
        },
        'auto-connect:unavailable',
      );
      return;
    }

    // Get or create display secret for the session
    let displayApiSecret = sessionRepository.getDisplaySecret(sessionId);
    if (!displayApiSecret) {
      displayApiSecret = sessionRepository.setDisplaySecret(sessionId);
    }

    // Get min display lines from connected kiosks
    const displayLines = registry.getMinKioskDisplayLines(workspaceId);

    // Restart-aware attach path (#341 § C). When the session already has a
    // persisted `aiConversationId` — typically because we're recovering
    // after a server restart and the startup `rehydrateAgentSessions` pass
    // missed this session (no devices connected at boot, or transient
    // failure) — we attach to the existing upstream conversation rather
    // than spawning a fresh one. The OpenHands adapter routes this through
    // `attachExistingForSession` and preserves the on-server event log.
    const existingConversationId = sessionRepository.findById(sessionId)?.metadata?.aiConversationId;

    // Open (and eagerly provision, for the OpenHands adapter) the agent session.
    const status = await agentDriver.openSession(sessionId, {
      workspaceId,
      displayLines,
      ...(apiKey ? { apiKey } : {}),
      ...(displayApiSecret ? { displayApiSecret } : {}),
      ...(existingConversationId ? { existingConversationId } : {}),
    });

    // Persist the OH conversation ID to session metadata so we can rehydrate
    // events from OH REST after the live WS has died and our cached rows
    // have been pruned. The in-memory map in AISessionManager is lost on
    // server restart; the DB is the only durable home. Shared with the
    // user-driven restart path (`server/src/sessions/ai-router.ts`) — see
    // issue #347 and `persist-ai-conversation-id.ts` for the contract.
    persistAiConversationId(sessionRepository, sessionId, status);

    // Broadcast connected status
    const connectedStatus: SessionAIStatusMessage = {
      type: 'session-ai-status',
      sessionId,
      connecting: false,
      connected: true,
      ...(status.conversationId ? { conversationId: status.conversationId } : {}),
    };
    registry.broadcastMessageToSession(sessionId, connectedStatus);
    // Unified `session-state` (issue #295). The driver's `status` already
    // carries the full snapshot; transport it 1:1.
    broadcastSessionState(registry, sessionId, status, 'auto-connect:connected');
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
    broadcastSessionState(
      registry,
      sessionId,
      {
        sessionId,
        state: 'degraded',
        conversationId: null,
        error: 'Failed to connect AI assistant',
        thinkingSince: null,
        startingSince: null,
      },
      'auto-connect:error',
    );
  }
}

/**
 * Check if auto-connect should be triggered for a session.
 *
 * Original ("first device wins") heuristic was `devicesInSession.length === 1`,
 * which broke after a server restart: the durable `session_devices` table
 * still contains the kiosk + mobile rows (`addDevice` is INSERT OR REPLACE),
 * so the count stays at 2, `isFirstDevice` is false, and auto-connect never
 * fires for a re-registering device — even though the in-memory
 * `agentDriver.hasSession(sessionId)` is correctly `false` and a persisted
 * `metadata.aiConversationId` is sitting in the DB waiting to be re-attached
 * to (#341).
 *
 * Restart-aware predicate: trigger whenever the session has *any* connected
 * device and the driver has no live binding. The startup
 * `rehydrateAgentSessions` pass should normally have already attached, but
 * this is the safety net for sessions that:
 *
 *   - Had no `aiConversationId` at boot (no rehydration target).
 *   - Failed rehydration transiently (the next device join retries).
 *   - Became active after the boot pass ran.
 *
 * Race safety / dispatcher pre-bind contract:
 *
 * `agentDriver.openSession` is the only call that creates the
 * `sessionId → AISession` binding inside `AISessionManager.sessionAI`.
 * The driver delegates to `AISessionManager.getOrCreateForSession`, which
 * single-flights on `sessionId`: it checks `sessionAI.has(sessionId)`
 * first and returns the existing binding when one is present (see
 * `agent-driver/openhands.ts` near `getOrCreateForSession`).
 *
 * That makes the `>= 1` device check race-safe against two distinct
 * scenarios:
 *
 *   1. Restart re-bind (the motivating bug for #341): both kiosk and
 *      mobile reconnect after a deploy; either WS handshake calling
 *      `shouldAutoConnect` correctly returns `true` because the
 *      in-memory binding is gone, so the first caller wins and
 *      establishes the binding; the second caller's `getOrCreateForSession`
 *      observes the now-present binding and returns it.
 *
 *   2. Concurrent first join: two devices simultaneously join a brand-new
 *      session before either side's auto-connect has completed. Both
 *      observe `hasSession === false`, both call `openSession`, but
 *      `getOrCreateForSession`'s single-flight in `AISessionManager`
 *      prevents a duplicate upstream conversation — exactly one OH
 *      conversation is created, both callers receive the same binding.
 *
 * Anything stricter (e.g. the old `=== 1` heuristic, or a lock around the
 * predicate) is wrong because the persisted `session_devices` table
 * survives restarts but the in-memory `sessionAI` map does not.
 *
 * The caller (`autoConnectAI`) reads `session.metadata.aiConversationId`
 * and threads it through `existingConversationId` so the post-restart
 * path attaches to the persisted upstream conversation rather than
 * spawning a duplicate (#341 § C).
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
  // Auto-connect whenever the session has ANY connected device and the
  // driver has no live binding. Race-safe via `getOrCreateForSession`'s
  // single-flight check inside `AISessionManager` — see the comment block
  // above for the full dispatcher pre-bind contract.
  const hasConnectedDevice = devicesInSession.length >= 1;

  return hasConnectedDevice && !agentDriver.hasSession(sessionId);
}
