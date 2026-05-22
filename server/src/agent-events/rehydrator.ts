import type { AgentEventRepository } from '../storage/agent-event-repository.js';
import {
  OpenHandsClient,
  OpenHandsApiError,
  type RawOpenHandsEvent,
} from '../openhands.js';

/**
 * Outcome of an `ensureHydrated()` call.
 */
export interface RehydrationResult {
  /** True iff this call actually fetched (or attempted to fetch) from OH. */
  rehydrated: boolean;
  /** True iff we walked OH's pagination to the end. */
  complete: boolean;
  /** Number of rows newly inserted by this call. */
  inserted: number;
  /** Total pages requested. */
  pagesFetched: number;
  /** Final error if rehydration gave up. */
  error?: string;
}

/**
 * Backoff schedule, in ms, for transient OH failures. Six attempts per page
 * matches the spec (1s → 2s → 4s → 8s → 16s → 32s).
 */
const DEFAULT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];

export interface AgentEventRehydratorOptions {
  repo: AgentEventRepository;
  /** Build an OpenHands client for the given workspace API key. */
  buildClient: (apiKey: string) => OpenHandsClient;
  /** Lookup the decrypted workspace API key for a workspace. */
  getWorkspaceApiKey: (workspaceId: string) => Promise<string | null>;
  /** Backoff schedule (ms). Useful for tests. */
  backoffMs?: number[];
  /** Page size for OH events/search calls. */
  pageLimit?: number;
  /** Override delay function (for tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface EnsureHydratedRequest {
  sessionId: string;
  workspaceId: string;
  conversationId: string;
  /** Force a fresh fetch even if rows already exist. */
  force?: boolean;
}

function realSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Convert a `Retry-After` header value to milliseconds. Accepts seconds or an
 * HTTP-date. Returns null if it can't be parsed.
 */
function parseRetryAfter(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

/**
 * REST-only, on-demand rehydration service. Holds an in-memory per-session
 * lock so concurrent reads share one in-flight rehydration; if the holder
 * gives up, the next read fires a fresh attempt.
 *
 * Persistence semantics:
 * - After each successful page, rows are written via `INSERT OR IGNORE`
 *   before requesting the next page → crash-safe / restart-safe (dedup by
 *   the partial unique index on `(conversation_id, event_id)`).
 * - On retry exhaustion for a page we return what we have with
 *   `complete: false`; the next call will retry the same starting page.
 */
export class AgentEventRehydrator {
  private readonly repo: AgentEventRepository;
  private readonly buildClient: (apiKey: string) => OpenHandsClient;
  private readonly getWorkspaceApiKey: (workspaceId: string) => Promise<string | null>;
  private readonly backoffMs: number[];
  private readonly pageLimit: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** sessionId → in-flight rehydration promise (single-flight). */
  private readonly inFlight = new Map<string, Promise<RehydrationResult>>();

  constructor(options: AgentEventRehydratorOptions) {
    this.repo = options.repo;
    this.buildClient = options.buildClient;
    this.getWorkspaceApiKey = options.getWorkspaceApiKey;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.pageLimit = options.pageLimit ?? 100;
    this.sleep = options.sleep ?? realSleep;
  }

  /**
   * Ensure events for a session are loaded from OH REST. Behaviour:
   *
   * - If rows already exist and `force` is false → returns immediately
   *   (`{rehydrated: false, complete: true}`).
   * - If a concurrent rehydration is already running for this session →
   *   waits for and returns its result.
   * - Otherwise → fetches pages with retry/backoff, persisting after each
   *   page. Returns `complete: false` if any page exhausts retries.
   */
  async ensureHydrated(req: EnsureHydratedRequest): Promise<RehydrationResult> {
    if (!req.force) {
      const existing = this.repo.countBySession(req.sessionId);
      if (existing > 0) {
        return { rehydrated: false, complete: true, inserted: 0, pagesFetched: 0 };
      }
    }

    const inflight = this.inFlight.get(req.sessionId);
    if (inflight) return inflight;

    const promise = this.runRehydration(req).finally(() => {
      this.inFlight.delete(req.sessionId);
    });
    this.inFlight.set(req.sessionId, promise);
    return promise;
  }

  /** Test helper — true if a rehydration is currently running for the session. */
  isRehydrating(sessionId: string): boolean {
    return this.inFlight.has(sessionId);
  }

  private async runRehydration(req: EnsureHydratedRequest): Promise<RehydrationResult> {
    const apiKey = await this.getWorkspaceApiKey(req.workspaceId);
    if (!apiKey) {
      return {
        rehydrated: true,
        complete: false,
        inserted: 0,
        pagesFetched: 0,
        error: 'No workspace API key available for rehydration',
      };
    }

    let client: OpenHandsClient;
    try {
      client = this.buildClient(apiKey);
    } catch (err) {
      return {
        rehydrated: true,
        complete: false,
        inserted: 0,
        pagesFetched: 0,
        error: `Failed to construct OH client: ${(err as Error).message}`,
      };
    }

    let pageId: string | undefined;
    let pagesFetched = 0;
    let inserted = 0;

    // Loop until OH stops handing us a `next_page_id`. If we exhaust retries
    // on any single page, return what we've persisted so far so the caller
    // can serve a partial response.
    while (true) {
      let page;
      try {
        page = await this.fetchPageWithRetry(client, req.conversationId, pageId);
      } catch (err) {
        return {
          rehydrated: true,
          complete: false,
          inserted,
          pagesFetched,
          error: (err as Error).message,
        };
      }
      pagesFetched++;

      if (page.items && page.items.length > 0) {
        const rows = page.items.map((evt: RawOpenHandsEvent) => ({
          conversationId: req.conversationId,
          sessionId: req.sessionId,
          workspaceId: req.workspaceId,
          rawEvent: evt,
        }));
        try {
          inserted += this.repo.insertMany(rows);
        } catch (insertErr) {
          return {
            rehydrated: true,
            complete: false,
            inserted,
            pagesFetched,
            error: `Failed to persist rehydrated events: ${(insertErr as Error).message}`,
          };
        }
      }

      if (!page.next_page_id) break;
      pageId = page.next_page_id;
    }

    return { rehydrated: true, complete: true, inserted, pagesFetched };
  }

  /**
   * Fetch a single page with retry/backoff on transient failures.
   * Honors `Retry-After` if present.
   */
  private async fetchPageWithRetry(
    client: OpenHandsClient,
    conversationId: string,
    pageId: string | undefined
  ) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.backoffMs.length; attempt++) {
      try {
        return await client.getEventsPage(conversationId, {
          pageId,
          limit: this.pageLimit,
        });
      } catch (err) {
        lastErr = err;
        const apiErr = err instanceof OpenHandsApiError ? err : null;
        if (apiErr && !apiErr.transient) {
          // Non-transient (4xx other than 429) → give up immediately.
          throw err;
        }
        if (attempt === this.backoffMs.length - 1) break;

        const retryAfter = apiErr ? parseRetryAfter(apiErr.retryAfter) : null;
        const delay = retryAfter !== null ? retryAfter : this.backoffMs[attempt];
        console.warn(
          `[AgentEvents] OH page fetch attempt ${attempt + 1}/${this.backoffMs.length} failed (status=${apiErr?.status ?? 'n/a'}); retrying in ${delay}ms`
        );
        await this.sleep(delay);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`OH page fetch failed: ${String(lastErr)}`);
  }
}
