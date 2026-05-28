/**
 * Post-restart agent-driver rehydration (issue #341).
 *
 * On every server boot, walk `sessions` rows where `status = 'active'` and
 * `metadata.aiConversationId IS NOT NULL` and re-attach the `AgentDriver`
 * to each one's existing upstream OpenHands conversation. Without this
 * pass, kiosks that were happily talking to an AI before a
 * `systemctl restart` go silent — the OH conversation is still alive,
 * but Voice Relay's in-memory binding to it died with the process and
 * the auto-connect path can't recover (the durable `session_devices`
 * rows make `isFirstDevice` false; `auto-connect.ts` is the second
 * half of the fix).
 *
 * Design notes:
 *
 * - **Best-effort.** A single session that fails to rehydrate (upstream
 *   conversation deleted, transient network blip, missing workspace API
 *   key) must not block the rest. Every per-session call is wrapped in a
 *   try/catch; the overall pass returns a tally of successes / failures
 *   for logging.
 * - **Idempotent.** `AgentDriver.openSession` is a no-op when the driver
 *   already has a binding. Running this pass twice in a row is safe.
 * - **Fire-and-forget at startup.** Calling code awaits the returned
 *   promise but the server's `start()` flow is happy to spawn this
 *   without holding the listen socket; per-session work is sequential
 *   inside the function so the upstream isn't hammered with a burst of
 *   `getConversation` calls during a deploy.
 * - **Upstream-ended handling.** `UpstreamConversationEndedError` from
 *   the driver / manager triggers a `degraded` `session-state`
 *   broadcast so any device that reconnects later sees the right state
 *   (and #294's restart affordance becomes available).
 */

import type { AgentDriver, AgentSessionStatus } from './agent-driver/index.js';
import { UpstreamConversationEndedError } from './agent-driver/index.js';
import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import { broadcastSessionState } from './session-state-broadcast.js';

/**
 * Dependencies for {@link rehydrateAgentSessions}. Mirrors the
 * `autoConnectAI` shape so both code paths read the same wiring.
 */
export interface RehydrateDependencies {
  registry: DeviceRegistry;
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository | null;
  agentDriver: AgentDriver;
  /** Resolves the workspace API key (handling encryption); see auto-connect.ts. */
  getWorkspaceApiKey: (workspaceId: string) => Promise<string | null>;
}

/** Summary returned by a rehydration pass. Useful for tests + ops logs. */
export interface RehydrateResult {
  /** Sessions matched by `SessionRepository.listActiveWithAiConversation()`. */
  candidates: number;
  /** Sessions where `openSession` returned ok and the driver now has a binding. */
  rehydrated: number;
  /** Sessions skipped because they already had a live binding (idempotency). */
  alreadyBound: number;
  /**
   * Sessions where the upstream conversation no longer exists. A
   * `degraded` `session-state` was broadcast so devices see the right
   * state when they reconnect.
   */
  upstreamEnded: number;
  /**
   * Sessions that failed for any other reason — transient network,
   * missing workspace API key, etc. Logged with the underlying error
   * but not surfaced to clients (a future device join will retry via
   * the restart-aware `shouldAutoConnect`).
   */
  failed: number;
}

/**
 * Reattach the agent driver to every active session whose
 * `metadata.aiConversationId` survived the last server lifecycle.
 *
 * Safe to call before the WS server starts accepting connections; the
 * `broadcastSessionState` calls land on a registry that has no peers
 * yet, which is the desired behaviour — devices that reconnect after
 * the listen socket opens will read the current state via the
 * `session-state` resync path in `index.ts`'s `register` handler
 * (`resyncAgentSessionStatus`).
 */
export async function rehydrateAgentSessions(
  deps: RehydrateDependencies,
): Promise<RehydrateResult> {
  const {
    registry,
    sessionRepository,
    workspaceRepository,
    agentDriver,
    getWorkspaceApiKey,
  } = deps;

  const result: RehydrateResult = {
    candidates: 0,
    rehydrated: 0,
    alreadyBound: 0,
    upstreamEnded: 0,
    failed: 0,
  };

  // Driver entirely unavailable (no OH credentials anywhere) — skip the
  // whole pass; future device joins will surface "OpenHands API not
  // configured" through the auto-connect path as they do today.
  if (!agentDriver.isAvailable()) {
    console.log('[AI] Rehydration skipped: agent driver not available');
    return result;
  }

  const candidates = sessionRepository.listActiveWithAiConversation();
  result.candidates = candidates.length;

  if (candidates.length === 0) {
    console.log('[AI] Rehydration: no active sessions with aiConversationId');
    return result;
  }

  console.log(`[AI] Rehydration: ${candidates.length} active session(s) to re-attach`);

  for (const session of candidates) {
    const sessionId = session.id;
    const conversationId = session.metadata?.aiConversationId;
    if (!conversationId) {
      // Defensive — listActiveWithAiConversation already filters this.
      continue;
    }

    // Skip if already bound (e.g. a concurrent device-join path won the
    // race). `agentDriver.openSession` would no-op, but we'd still pay
    // the workspace-key fetch — skip cheaply.
    if (agentDriver.hasSession(sessionId)) {
      result.alreadyBound += 1;
      continue;
    }

    try {
      const apiKey = workspaceRepository
        ? await getWorkspaceApiKey(session.workspaceId)
        : null;

      // Display secret is owned by the session; reuse the persisted one
      // if present so the OpenHands sandbox keeps the same DISPLAY_API
      // credentials it was using before the restart.
      const displayApiSecret = sessionRepository.getDisplaySecret(sessionId);

      const status = await agentDriver.openSession(sessionId, {
        workspaceId: session.workspaceId,
        displayLines: 0,
        existingConversationId: conversationId,
        ...(apiKey ? { apiKey } : {}),
        ...(displayApiSecret ? { displayApiSecret } : {}),
      });

      result.rehydrated += 1;
      console.log(
        `[AI] Rehydrated agent session ${sessionId} → conversation ${conversationId}` +
          ` (state=${status.state})`,
      );

      // Broadcast a snapshot so peers (real or to-be) see the new state
      // without waiting for the next transition. The session may have
      // started up in `starting` / `reconnecting` if the WS is still
      // handshaking — `synthesizeStatus` will catch up the next time a
      // device subscribes (#290 resync path).
      broadcastSessionState(registry, sessionId, status, 'rehydrate:bound');
    } catch (err) {
      if (err instanceof UpstreamConversationEndedError) {
        result.upstreamEnded += 1;
        console.warn(
          `[AI] Rehydration: upstream conversation ${conversationId} for session ${sessionId}` +
            ` no longer available — broadcasting degraded state`,
        );
        const degraded: AgentSessionStatus = {
          sessionId,
          state: 'degraded',
          conversationId: null,
          error: 'Upstream conversation no longer available — restart session',
          thinkingSince: null,
          startingSince: null,
        };
        broadcastSessionState(registry, sessionId, degraded, 'rehydrate:upstream-ended');
        continue;
      }
      result.failed += 1;
      console.error(`[AI] Rehydration failed for session ${sessionId}:`, err);
      // Intentionally do NOT broadcast degraded for generic failures —
      // a transient blip should not put the session into a state that
      // requires a manual restart. The next device join will retry via
      // the auto-connect path; if that also fails, the user sees the
      // existing degraded broadcast from `autoConnectAI`'s catch block.
    }
  }

  console.log(
    `[AI] Rehydration complete: candidates=${result.candidates}` +
      ` rehydrated=${result.rehydrated} alreadyBound=${result.alreadyBound}` +
      ` upstreamEnded=${result.upstreamEnded} failed=${result.failed}`,
  );
  return result;
}
