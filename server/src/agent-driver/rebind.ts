/**
 * Rebind orchestration for the OpenHands AgentDriver (#296).
 *
 * When the upstream sandbox backing a conversation has been reaped — surfaced
 * either as a `sandbox_status: MISSING` on `GET /api/v1/app-conversations`
 * or as a non-resumable WebSocket close — the platform can resurrect the
 * conversation on a fresh sandbox by POSTing `/api/v1/app-conversations`
 * with the existing `{ conversation_id }` body. The same `conversation_id`
 * is preserved, the on-server event log is intact, but a new
 * `agent_server_url` and `session_api_key` are minted. The agent itself has
 * no memory of prior turns — memory replay is #297.
 *
 * See `docs/openhands-platform.md` § Rebind on a dead conversation.
 *
 * This module owns the *policy* around that primitive:
 *
 *   1. Retry/backoff for transient 5xx (1, 2, 4, 8, 16s — capped within a
 *      30 s total budget). Non-transient 4xx fail-fast.
 *   2. A per-conversation **rebind window**: at most `MAX_REBINDS_PER_WINDOW`
 *      successful rebinds in a 5-minute rolling window. Beyond that, the
 *      window tracker throws `RebindBudgetExhausted` to stop sandbox
 *      thrash from masquerading as recovery.
 *
 * Both layers throw typed error classes the driver/manager can pattern-match
 * on to decide between "retry on next event" and "transition to degraded".
 */

import {
  OpenHandsApiError,
  type ConversationInfo,
  type OpenHandsClient,
} from '../openhands.js';

// ---------------------------------------------------------------------------
// Tunables (exported so tests can assert exact values)
// ---------------------------------------------------------------------------

/**
 * Total time budget for all HTTP rebind attempts (including initial attempt
 * and all backoffs).
 *
 * Sized for the realistic async-rebind primitive (#361): each call to
 * `client.rebindConversation` now legitimately takes 10–60 s because the
 * platform's `POST /app-conversations` returns a start-task that we
 * poll-until-ready before re-fetching the conversation. Pre-#361 this
 * budget was 30 s on the assumption that the POST was synchronous; that
 * assumption was wrong and a single slow-but-successful sandbox boot
 * would blow past the budget mid-attempt.
 *
 * The user-facing trade-off: while rebind is in flight the session shows
 * `rebinding=true` (kiosk renders a spinner per #294). Bumping the budget
 * to 3 minutes means the worst case "still trying to recover" window
 * stretches from 30 s → 3 min, but the alternative is a permanent
 * `degraded` state from a recoverable failure. The per-conversation
 * 3-in-5-min window cap in {@link RebindWindowTracker} still caps cascade
 * risk.
 */
export const REBIND_BUDGET_MS = 180_000;

/**
 * Backoff sequence (in ms) between successive HTTP attempts on transient
 * 5xx. Cumulative time after the i-th delay is `sum(REBIND_BACKOFF_MS[0..i])`.
 * After all delays are exhausted, no further attempts are made.
 *
 * Calibrated so a rebind that recovers within ~7 s (one retry) feels
 * snappy, and a 30 s total caps the worst case before degraded.
 */
export const REBIND_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000];

/** Maximum rebinds allowed for one conversation in a single window. */
export const MAX_REBINDS_PER_WINDOW = 3;

/** Rolling-window length for the per-conversation rebind cap. */
export const REBIND_WINDOW_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * The retry budget was exhausted. Either the total elapsed time crossed
 * `REBIND_BUDGET_MS` while still receiving transient errors, OR the
 * per-conversation rebind window has been saturated (more than
 * `MAX_REBINDS_PER_WINDOW` successful rebinds in the last
 * `REBIND_WINDOW_MS`). The driver should transition the session to
 * `degraded`; auto-retry is over until the user explicitly restarts.
 */
export class RebindBudgetExhausted extends Error {
  readonly conversationId: string;
  readonly attempts: number;
  readonly lastStatus: number | null;
  constructor(conversationId: string, attempts: number, lastStatus: number | null) {
    super(
      `Rebind for conversation ${conversationId} failed after ${attempts} attempt(s)` +
        (lastStatus !== null ? ` (last status ${lastStatus})` : ''),
    );
    this.name = 'RebindBudgetExhausted';
    this.conversationId = conversationId;
    this.attempts = attempts;
    this.lastStatus = lastStatus;
  }
}

/**
 * The OpenHands app server rejected the rebind with a 4xx authn/authz
 * status (403). The cached `openhands_api_key` is invalid for this
 * conversation; auto-retry will never succeed. Non-recoverable.
 */
export class RebindForbidden extends Error {
  readonly conversationId: string;
  readonly status: number;
  constructor(conversationId: string, status: number, message: string) {
    super(message);
    this.name = 'RebindForbidden';
    this.conversationId = conversationId;
    this.status = status;
  }
}

/**
 * The conversation is truly gone — 404 from the rebind POST. This is
 * distinct from `SandboxMissingError` (which means only the sandbox is
 * gone, conversation is recoverable). Auto-retry is futile.
 */
export class RebindConversationGone extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} is gone — rebind returned 404`);
    this.name = 'RebindConversationGone';
    this.conversationId = conversationId;
  }
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * The freshly-minted binding returned by a successful rebind. `conversationId`
 * is unchanged from the dead conversation; `agentServerUrl` and
 * `sessionApiKey` are new.
 */
export interface RebindResult {
  conversationId: string;
  agentServerUrl: string;
  sessionApiKey: string;
  sandboxStatus: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Test seam for `setTimeout`. Defaults to the real one. */
export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Test seam for `Date.now`. */
export type Clock = () => number;
const defaultClock: Clock = () => Date.now();

/**
 * Narrow structural subset of `OpenHandsClient` actually consumed by the
 * rebind helper. Exposed for tests that want to inject a tiny mock without
 * constructing a full client.
 */
export interface OpenHandsRebindClient {
  /**
   * Rebind a conversation on a fresh sandbox.
   *
   * The optional `opts.systemMessageSuffix` (#297) is forwarded to the
   * platform as the `system_message_suffix` field on `POST
   * /app-conversations`, so the rebound agent's system prompt includes
   * memory-replay context summarising the prior turns. Empty / omitted
   * suffix means no memory replay (fresh-agent fallback).
   */
  rebindConversation(
    conversationId: string,
    opts?: { systemMessageSuffix?: string },
  ): Promise<ConversationInfo>;
}

/**
 * Normalize `OpenHands` `ConversationInfo` (the raw HTTP response) into the
 * adapter-side `RebindResult`. Validates that the required fields are
 * present and parses `conversation_url` down to the bare origin (drops
 * any trailing `/api/...` segment) — the WS layer wants the origin.
 *
 * Throws `OpenHandsApiError(0, ...)` when the response shape is malformed
 * (treated as a transient error so the outer loop retries — the platform
 * may be returning an incomplete record while the new sandbox is still
 * spinning up).
 */
function normalizeRebindResponse(
  conversationId: string,
  info: ConversationInfo,
): RebindResult {
  if (!info.session_api_key) {
    throw new OpenHandsApiError(
      0,
      `Rebind response for ${conversationId} missing session_api_key`,
      null,
    );
  }
  const rawUrl = info.conversation_url ?? '';
  const origin = rawUrl.replace(/\/api\/.*$/, '');
  if (!origin || !URL.canParse(origin)) {
    throw new OpenHandsApiError(
      0,
      `Rebind response for ${conversationId} missing or invalid agent_server_url`,
      null,
    );
  }
  return {
    conversationId,
    agentServerUrl: origin,
    sessionApiKey: info.session_api_key,
    sandboxStatus: info.sandbox_status ?? 'RUNNING',
  };
}

// ---------------------------------------------------------------------------
// HTTP retry orchestration
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link rebindConversation} for test injection.
 * Production callers pass nothing.
 */
export interface RebindOptions {
  sleep?: Sleep;
  clock?: Clock;
  /** Override the backoff sequence for tests. */
  backoff?: readonly number[];
  /** Override the total time budget for tests. */
  budgetMs?: number;
  /**
   * Memory-replay suffix forwarded as `system_message_suffix` on the
   * rebind POST (#297). Same value is reused across all retry attempts
   * within a single rebind call so the rebound agent doesn't see a
   * different prompt depending on which attempt succeeded.
   */
  systemMessageSuffix?: string;
}

/**
 * Drive an HTTP rebind to completion, applying the retry budget defined at
 * the top of this module.
 *
 * Behavior:
 * - Calls `client.rebindConversation(conversationId)` once initially.
 * - On `OpenHandsApiError` with `transient === true` (i.e. 0/429/5xx),
 *   sleeps for the next entry in {@link REBIND_BACKOFF_MS} and retries —
 *   but only if elapsed wall time is still inside `REBIND_BUDGET_MS`.
 * - On 4xx (403): throws `RebindForbidden` immediately, no retry.
 * - On 404: throws `RebindConversationGone` immediately, no retry.
 * - Total attempts capped at `REBIND_BACKOFF_MS.length + 1` (5 + 1 = 6 by
 *   default, but the time budget will typically cut the loop short at 5).
 * - When the budget is exhausted while still receiving transient errors,
 *   throws `RebindBudgetExhausted`.
 *
 * Returns the normalized {@link RebindResult} on success.
 */
export async function rebindConversation(
  client: OpenHandsRebindClient,
  conversationId: string,
  options: RebindOptions = {},
): Promise<RebindResult> {
  const sleep = options.sleep ?? defaultSleep;
  const clock = options.clock ?? defaultClock;
  const backoff = options.backoff ?? REBIND_BACKOFF_MS;
  const budgetMs = options.budgetMs ?? REBIND_BUDGET_MS;

  const startedAt = clock();
  let attempts = 0;
  let lastStatus: number | null = null;
  const clientOpts =
    options.systemMessageSuffix !== undefined
      ? { systemMessageSuffix: options.systemMessageSuffix }
      : undefined;

  // Cap attempts at backoff-length + 1: each backoff sits between two
  // consecutive attempts, so N backoffs allow N+1 attempts max.
  const maxAttempts = backoff.length + 1;
  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    try {
      const info = await client.rebindConversation(conversationId, clientOpts);
      return normalizeRebindResponse(conversationId, info);
    } catch (err) {
      if (err instanceof OpenHandsApiError) {
        lastStatus = err.status;
        // Non-transient 4xx: fail fast with typed errors.
        if (err.status === 403) {
          throw new RebindForbidden(conversationId, err.status, err.message);
        }
        if (err.status === 404) {
          throw new RebindConversationGone(conversationId);
        }
        if (!err.transient) {
          // Other 4xx (e.g. 400, 401, 409): treat as non-recoverable but
          // surface as RebindForbidden so the manager can degrade cleanly.
          throw new RebindForbidden(conversationId, err.status, err.message);
        }
        // Transient: fall through to backoff, unless budget is up or we're
        // already on the last allowed attempt.
        const delay = backoff[i];
        if (delay === undefined) break;
        const elapsed = clock() - startedAt;
        const remaining = budgetMs - elapsed;
        if (remaining <= 0) break;
        // Don't sleep past the budget — clip the delay so we exit promptly.
        await sleep(Math.min(delay, remaining));
        if (clock() - startedAt >= budgetMs) break;
        continue;
      }
      // Unknown error class: don't retry, surface as budget-exhausted so
      // the caller still degrades (a thrown non-OpenHandsApiError implies
      // something deeper than HTTP is broken).
      throw new RebindBudgetExhausted(conversationId, attempts, lastStatus);
    }
  }
  throw new RebindBudgetExhausted(conversationId, attempts, lastStatus);
}

// ---------------------------------------------------------------------------
// Per-conversation rebind-window tracker
// ---------------------------------------------------------------------------

/**
 * Tracks the per-conversation count of *successful* rebinds inside a rolling
 * `REBIND_WINDOW_MS` window. The manager consults the tracker *before*
 * attempting a rebind:
 *
 *   try { tracker.checkBudget(conversationId); }
 *   catch (e) { /* degraded *​/ }
 *   const result = await rebindConversation(client, conversationId);
 *   tracker.recordSuccess(conversationId);
 *
 * `checkBudget` throws `RebindBudgetExhausted` when the window is full so
 * the manager has a single error class to catch in both the HTTP-budget
 * and window-cap paths.
 */
export class RebindWindowTracker {
  private readonly history = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock = defaultClock,
    private readonly windowMs: number = REBIND_WINDOW_MS,
    private readonly maxPerWindow: number = MAX_REBINDS_PER_WINDOW,
  ) {}

  /** Drop entries older than the window for `conversationId` and return the survivors. */
  private prune(conversationId: string): number[] {
    const cutoff = this.clock() - this.windowMs;
    const entries = this.history.get(conversationId);
    if (!entries) return [];
    const survivors = entries.filter((ts) => ts > cutoff);
    if (survivors.length === 0) {
      this.history.delete(conversationId);
    } else if (survivors.length !== entries.length) {
      this.history.set(conversationId, survivors);
    }
    return survivors;
  }

  /**
   * Throw `RebindBudgetExhausted` if a new rebind would exceed the window
   * cap. Otherwise return silently.
   */
  checkBudget(conversationId: string): void {
    const survivors = this.prune(conversationId);
    if (survivors.length >= this.maxPerWindow) {
      throw new RebindBudgetExhausted(conversationId, survivors.length, null);
    }
  }

  /** Record a successful rebind so future `checkBudget` calls see it. */
  recordSuccess(conversationId: string): void {
    const survivors = this.prune(conversationId);
    survivors.push(this.clock());
    this.history.set(conversationId, survivors);
  }

  /** Number of successes currently counted toward the window cap (exposed for tests). */
  countInWindow(conversationId: string): number {
    return this.prune(conversationId).length;
  }
}

// ---------------------------------------------------------------------------
// Re-exports for convenience: callers usually only need this module.
// ---------------------------------------------------------------------------

export type { OpenHandsClient };
