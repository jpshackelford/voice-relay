/**
 * Shared helper that persists `status.conversationId` into
 * `session.metadata.aiConversationId` after a successful agent-driver
 * bind/restart.
 *
 * Why this exists
 * ---------------
 * Two call sites need to write the new upstream OpenHands conversation id
 * back to the DB after `AgentDriver.openSession` or
 * `AgentDriver.restartSession` resolves:
 *
 *   - `server/src/auto-connect.ts` — first kiosk join for a session.
 *   - `server/src/sessions/ai-router.ts` — user-driven `POST /ai/restart`.
 *
 * Before issue #347 only auto-connect was persisting; the restart path
 * leaked every new conversation id and left the DB pinned to the original
 * (long-dead) conversation, which broke startup rehydration. Sibling issues
 * #348 (no fresh-create fallback on attach failure) and #349 (rehydration
 * persistence) will both import this helper as well, so keeping the write
 * in one place avoids three subtly different copies drifting apart.
 *
 * Contract
 * --------
 * - If `status.conversationId` is null/empty, this is a no-op (a `degraded`
 *   restart returns no conversation id and we must not stomp the existing
 *   row with `null`).
 * - On a `updateMetadata` throw, the error is logged with the session id
 *   for grep-ability and swallowed. Persistence is non-fatal: the broadcast
 *   chain and HTTP response must keep progressing so peer devices see the
 *   new state even if the DB write fails. This matches the original
 *   auto-connect behaviour.
 *
 * Stability
 * ---------
 * Issues #348 and #349 read from this module. Keep the signature stable:
 * `(sessionRepository, sessionId, status)` taking the public
 * `AgentSessionStatus` shape from `agent-driver/types.ts`.
 */

import type { AgentSessionStatus } from '../agent-driver/index.js';
import type { SessionRepository } from './session-repository.js';

export function persistAiConversationId(
  sessionRepository: SessionRepository,
  sessionId: string,
  status: Pick<AgentSessionStatus, 'conversationId'>,
): void {
  if (!status.conversationId) return;
  try {
    sessionRepository.updateMetadata(sessionId, {
      aiConversationId: status.conversationId,
    });
  } catch (err) {
    // Non-fatal: rehydration just won't be possible for this session,
    // which is the same behaviour we had before this code existed.
    console.error(
      `[AI] Failed to persist aiConversationId for session ${sessionId}:`,
      err,
    );
  }
}
