/**
 * Shared attach-or-create helper (issue #348).
 *
 * Both the startup rehydration pass (`agent-rehydrate.ts`) and the
 * kiosk-register auto-connect path (`auto-connect.ts`) used to call
 * `agentDriver.openSession({ ..., existingConversationId })` directly and
 * give up — broadcasting `degraded` — whenever the upstream OpenHands
 * conversation had ended (sandbox expired, 404, missing WS handshake
 * materials, …). That left the session permanently silent until the user
 * noticed and hit "restart."
 *
 * This helper folds the "attach failed → spawn fresh" recovery into a
 * single function so both call sites recover identically:
 *
 *   1. Call `agentDriver.openSession` with the caller’s opts (which may
 *      include `existingConversationId`).
 *   2. If it throws `UpstreamConversationEndedError`:
 *      - Stash the dead id in `session.metadata.previousAiConversationId`
 *        so #349’s `buildReplaySuffix` can carry forward context.
 *      - Clear `session.metadata.aiConversationId`.
 *      - Retry exactly once with `existingConversationId` stripped from
 *        the opts (i.e. a fresh OH conversation).
 *      - On success, persist the new id via the shared
 *        `persistAiConversationId` helper (#347) so the
 *        persist-before-broadcast invariant survives.
 *   3. Any other error from the first call is propagated unchanged — we
 *      only auto-recover from the well-defined "upstream is dead" signal.
 *      Transient REST blips would otherwise nuke the persisted id.
 *   4. If the fresh-create itself fails, propagate. No infinite loop, no
 *      second retry; the caller drives the `degraded` broadcast.
 *
 * Reusable by sibling #349 (wire `buildReplaySuffix` into the fresh-create
 * branch). To keep that integration trivial, the signature accepts the
 * full `OpenSessionOpts` so the fresh-create call can be enriched with
 * extra fields (e.g. a replay-suffix prompt addendum) without re-plumbing
 * either call site.
 *
 * What this helper does NOT do:
 * - Broadcast `degraded` / `ready` state. Callers own that, because the
 *   broadcast envelope (registry, reason tag) differs between the rehydrate
 *   and auto-connect paths.
 * - Update workspace API keys / display secrets. The caller’s opts are
 *   threaded through verbatim.
 * - Retry transient errors. By design — see issue #348’s "Discriminating
 *   dead from transient" risk note.
 */

import type { AgentDriver, AgentSessionStatus, OpenSessionOpts } from './agent-driver/index.js';
import type { SessionRepository } from './sessions/index.js';
import { UpstreamConversationEndedError } from './openhands.js';
import { persistAiConversationId } from './sessions/persist-ai-conversation-id.js';

/**
 * Outcome of `attachOrCreateAgentSession`.
 *
 * `freshCreated` is `true` only when the initial attach attempt threw
 * `UpstreamConversationEndedError` and the helper recovered by spawning a
 * brand-new upstream conversation. Callers (notably the rehydration pass)
 * use this to distinguish "attached to the persisted conversation" from
 * "fresh-created after upstream-ended" in their per-session outcomes /
 * boot summary log without inspecting conversation ids.
 *
 * Stable: sibling #349 will key its `buildReplaySuffix` carry-forward on
 * `freshCreated === true` so it only injects replay context when we know
 * a new conversation was spawned.
 */
export interface AttachOrCreateResult {
  status: AgentSessionStatus;
  freshCreated: boolean;
}

/**
 * Dependencies required by `attachOrCreateAgentSession`. Narrow on
 * purpose: callers can pass their existing dep bags through without
 * rebuilding them.
 */
export interface AttachOrCreateAgentSessionDeps {
  agentDriver: AgentDriver;
  sessionRepository: SessionRepository;
}

/**
 * Idempotently attach to an existing upstream conversation, falling back
 * to a fresh-create when the upstream conversation is gone.
 *
 * @param sessionId Voice Relay session id.
 * @param opts Pass-through `OpenSessionOpts`. If `existingConversationId`
 *   is present and the attach fails with `UpstreamConversationEndedError`,
 *   this helper will retry once with that field stripped (i.e. fresh-create).
 *   Other fields are forwarded verbatim to both the attach attempt and the
 *   retry — siblings like #349 can extend the retry by enriching `opts`
 *   here without re-plumbing call sites.
 * @param deps `agentDriver` and `sessionRepository` (used to mutate
 *   `session.metadata` before retry and persist the new conversation id on
 *   success).
 *
 * @returns The successful `AgentSessionStatus` (from either the attach or
 *   the fresh-create retry).
 *
 * @throws The original error from the first `openSession` call when it is
 *   not an `UpstreamConversationEndedError`; the error from the fresh-create
 *   retry when the retry itself fails.
 */
export async function attachOrCreateAgentSession(
  sessionId: string,
  opts: OpenSessionOpts,
  deps: AttachOrCreateAgentSessionDeps,
): Promise<AttachOrCreateResult> {
  const { agentDriver, sessionRepository } = deps;

  try {
    const status = await agentDriver.openSession(sessionId, opts);
    // Persist before we let the caller broadcast (#347 invariant).
    // Cheap no-op if status.conversationId is unchanged; the auto-connect
    // call site already calls this directly today, but rehydrate did not
    // — since the attach path returns the same id we passed in, persisting
    // is effectively idempotent on the happy path.
    persistAiConversationId(sessionRepository, sessionId, status);
    return { status, freshCreated: false };
  } catch (err) {
    // Only the well-defined "upstream conversation is gone" signal triggers
    // recovery. Anything else (transient REST blip, missing API key, …)
    // would risk silently nuking a still-valid persisted id, so we
    // propagate unchanged. See the risk note in #348.
    if (!(err instanceof UpstreamConversationEndedError)) {
      throw err;
    }
    // No attach to retry, no recovery to attempt — propagate.
    // (Defensive: production call sites always pass `existingConversationId`
    // before reaching this branch, but if a future caller hits this with no
    // attach hint, there’s nothing to fall back from.)
    if (!opts.existingConversationId) {
      throw err;
    }
    const status = await retryAsFreshCreate(sessionId, opts, deps, err);
    return { status, freshCreated: true };
  }
}

async function retryAsFreshCreate(
  sessionId: string,
  opts: OpenSessionOpts,
  deps: AttachOrCreateAgentSessionDeps,
  cause: UpstreamConversationEndedError,
): Promise<AgentSessionStatus> {
  const { agentDriver, sessionRepository } = deps;

  const deadId = cause.conversationId || opts.existingConversationId;
  console.warn(
    `[AI] Attach to ${deadId} for session ${sessionId} failed (${cause.message}); falling back to fresh-create.`,
  );

  // Stash the dead id and clear the live pointer BEFORE we attempt the
  // fresh-create. If the process dies between this write and the persist
  // call below, the next auto-connect just observes a fresh-create
  // candidate — no worse than the current "permanently degraded" state.
  //
  // The metadata mutation uses `updateMetadata`’s spread-merge semantics:
  // `aiConversationId: undefined` is omitted by `JSON.stringify`, so the
  // persisted row has no `aiConversationId` after this write. The
  // `previousAiConversationId` is read by #349’s carry-forward feature.
  try {
    sessionRepository.updateMetadata(sessionId, {
      aiConversationId: undefined,
      previousAiConversationId: deadId,
    });
  } catch (metaErr) {
    // Non-fatal: matches `persistAiConversationId`’s contract. Worst case
    // the next attach attempt retries against the now-dead id and lands
    // here again.
    console.error(
      `[AI] Failed to stash previousAiConversationId for session ${sessionId}:`,
      metaErr,
    );
  }

  // Build the fresh-create opts by dropping `existingConversationId` so
  // the OH adapter goes through `POST /app-conversations` instead of
  // `attachExistingForSession`. Carry the dead id forward as
  // `previousConversationId` so the OH adapter can fetch its event log
  // and seed the new conversation's context via `buildReplaySuffix`
  // (#349). The driver / manager treat this as a hint: any failure to
  // fetch or build the suffix is logged and the conversation starts
  // amnesiac (best-effort, matches #297's contract).
  const { existingConversationId: _drop, ...rest } = opts;
  const freshOpts: OpenSessionOpts = {
    ...rest,
    previousConversationId: deadId,
  };

  // Any error here propagates: no second retry. The caller drives the
  // `degraded` broadcast.
  const status = await agentDriver.openSession(sessionId, freshOpts);
  // Persist BEFORE the caller broadcasts (#347 invariant). The new id
  // must be durable so a subsequent restart can find it.
  persistAiConversationId(sessionRepository, sessionId, status);
  console.log(
    `[AI] Fresh-create succeeded for session ${sessionId}; new conversation ${status.conversationId} (was ${deadId})`,
  );
  return status;
}
