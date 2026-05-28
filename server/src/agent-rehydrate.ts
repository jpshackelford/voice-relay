/**
 * Startup rehydration of agent-driver bindings (issue #341).
 *
 * Background: when the Voice Relay server restarts (deploy, crash,
 * `systemctl restart`), the in-memory `AISessionManager.sessionAI` map
 * is lost. Any session that had an active AI binding goes silent — the
 * kiosk's ✨ icon disappears, typed messages drop in `index.ts`'s text
 * handler (which gates on `agentDriver.hasSession`), and no client
 * action recovers the binding. The `aiConversationId` *is* persisted to
 * `session.metadata` by the auto-connect path, but nothing reads it
 * back on boot.
 *
 * This module's `rehydrateAgentSessions` walks `status='active'`
 * sessions with a non-null `metadata.aiConversationId` and re-attaches
 * the driver to each, using the new `OpenSessionOpts.existingConversationId`
 * branch (see `agent-driver/types.ts` and the `attachExistingForSession`
 * path in `openhands.ts`). It runs once, eagerly, before the WS server
 * starts accepting connections.
 *
 * Failure model: best-effort. A single bad session must not block the
 * rest of the pass — we log per-session and continue. The unified
 * `session-state` broadcast (issue #295) is emitted per outcome so any
 * device that reconnects later sees `connected` (success) or `degraded`
 * (upstream conversation no longer reachable) without having to wait
 * for the next user utterance.
 */

import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { AgentDriver, AgentSessionStatus } from './agent-driver/index.js';
import type { DeviceRegistry } from './registry.js';
import { broadcastSessionState } from './session-state-broadcast.js';

/**
 * Dependencies required by `rehydrateAgentSessions`. Mirrors the dependency
 * shape used by `auto-connect.ts` so tests can pass mocks once and reuse
 * them across both call sites.
 */
export interface RehydrateAgentSessionsDependencies {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository | null;
  agentDriver: AgentDriver;
  /**
   * Optional registry for broadcasting `session-state` snapshots. Passed
   * by production; tests may omit when they only care about driver-level
   * effects.
   */
  registry?: DeviceRegistry;
  /**
   * Resolves the workspace's encrypted OpenHands API key (already decrypted).
   * Same shape as `autoConnectAI`'s dependency so the call sites converge.
   */
  getWorkspaceApiKey: (workspaceId: string) => Promise<string | null>;
}

/**
 * Result of attempting to rehydrate a single session. Exposed for tests
 * so they can assert per-session outcomes without parsing log output.
 */
export interface RehydrationOutcome {
  sessionId: string;
  workspaceId: string;
  conversationId: string;
  status: 'rehydrated' | 'failed' | 'skipped';
  error?: string;
}

/**
 * Walk `status='active'` sessions with a persisted `aiConversationId` and
 * re-attach the agent driver to each.
 *
 * Returns the per-session outcomes for visibility/testing. Caller may
 * ignore the return value — production wires the result only to logs.
 *
 * Behaviour:
 * - Sessions with no driver availability are skipped (no workspace key
 *   and the env driver isn't configured). The next auto-connect will
 *   try again when a device joins.
 * - `openSession` exceptions are caught per-session, logged, and surfaced
 *   as a `degraded` `session-state` broadcast so a later device join
 *   can show the correct UI.
 * - This pass is invoked exactly once at startup, before the WS server
 *   begins accepting connections, so there are no races with concurrent
 *   auto-connect calls. Even if there were, `agentDriver.openSession`
 *   is idempotent on `sessionId`.
 */
export async function rehydrateAgentSessions(
  deps: RehydrateAgentSessionsDependencies,
): Promise<RehydrationOutcome[]> {
  const { sessionRepository, workspaceRepository, agentDriver, registry, getWorkspaceApiKey } = deps;

  const sessions = sessionRepository.listActiveWithAiConversation();
  if (sessions.length === 0) {
    console.log('[AI] Rehydration: no active sessions with persisted aiConversationId');
    return [];
  }

  console.log(`[AI] Rehydration: ${sessions.length} active session(s) with persisted aiConversationId`);

  const outcomes: RehydrationOutcome[] = [];

  for (const session of sessions) {
    const conversationId = session.metadata?.aiConversationId;
    if (!conversationId) {
      // Defensive: the SQL filter should never let a row through, but the
      // type system can't prove it.
      continue;
    }

    const sessionId = session.id;
    const workspaceId = session.workspaceId;

    try {
      // Resolve workspace API key (may be null when the workspace relies
      // on the env-configured driver).
      const apiKey = workspaceRepository ? await getWorkspaceApiKey(workspaceId) : null;

      if (!apiKey && !agentDriver.isAvailable()) {
        console.warn(
          `[AI] Rehydration skipped for session ${sessionId}: no API key available (workspace ${workspaceId}, conversation ${conversationId})`,
        );
        outcomes.push({
          sessionId,
          workspaceId,
          conversationId,
          status: 'skipped',
          error: 'no API key available',
        });
        continue;
      }

      // The display secret was persisted at first auto-connect; reuse it
      // (no need to regenerate). If the row is missing one for any reason
      // we simply omit the option — the agent will still work; only the
      // display-API auth path would degrade, which #341 is not trying to
      // fix.
      const displayApiSecret = sessionRepository.getDisplaySecret(sessionId);

      const status = await agentDriver.openSession(sessionId, {
        workspaceId,
        // displayLines: we don't know the connected kiosks' viewport at
        // boot. Pass 0 / omit; the system prompt will use its default.
        // A subsequent device join updates this through the normal
        // resync path.
        ...(apiKey ? { apiKey } : {}),
        ...(displayApiSecret ? { displayApiSecret } : {}),
        existingConversationId: conversationId,
      });

      console.log(
        `[AI] Rehydrated agent session ${sessionId} → conversation ${conversationId}`,
      );
      outcomes.push({
        sessionId,
        workspaceId,
        conversationId,
        status: 'rehydrated',
      });

      // Broadcast the rehydrated state. Devices that reconnect later see
      // the live status without waiting for the next utterance.
      broadcastSessionState(registry, sessionId, status, 'rehydrate:success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AI] Rehydration failed for ${sessionId}: ${message}`);
      outcomes.push({
        sessionId,
        workspaceId,
        conversationId,
        status: 'failed',
        error: message,
      });

      // Surface as `degraded` so a later device join shows the right UX.
      // The kiosk-side recovery action (POST /api/sessions/:id/ai/restart,
      // wired in #294) lets the user start a fresh conversation.
      const degradedStatus: AgentSessionStatus = {
        sessionId,
        state: 'degraded',
        conversationId,
        error: 'Upstream conversation no longer available — restart session',
        thinkingSince: null,
        startingSince: null,
      };
      broadcastSessionState(registry, sessionId, degradedStatus, 'rehydrate:failed');
    }
  }

  return outcomes;
}
