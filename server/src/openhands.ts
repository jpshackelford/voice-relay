/**
 * OpenHands Cloud API client for Voice Relay
 * 
 * Handles creating conversations and sending/receiving messages
 * via the OpenHands V1 API and WebSocket.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { normalizeOhTimestamp } from './utils/timestamp.js';
import {
  rebindConversation as rebindHttp,
  RebindWindowTracker,
  RebindBudgetExhausted,
  RebindForbidden,
  RebindConversationGone,
  type RebindResult,
  type RebindOptions,
} from './agent-driver/rebind.js';
import {
  buildReplaySuffix,
  noopCondense,
  type CondenseFn,
} from './agent-driver/replay.js';
import { logUpstreamFailure } from './agent-driver/log.js';
import type { AgentSenderMeta } from './agent-driver/types.js';
// Type-only import to avoid a runtime circular dep with sessions/index.ts
// (which imports `resolveSessionSystemPrompt` from this file).
import type {
  SessionAIStateRepository,
  SessionAIStateName,
} from './sessions/session-ai-state-repository.js';
import {
  buildVoiceRelayHeader,
  makeVoiceRelayHeaderState,
  type VoiceRelayHeaderState,
} from './agent-driver/voice-relay-header.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENHANDS_BASE_URL = 'https://app.all-hands.dev';
const START_TASK_TERMINAL_STATUSES = new Set(['READY', 'ERROR', 'FAILED', 'CANCELLED', 'DONE', 'COMPLETED']);

interface ContentPart {
  type: 'text';
  text: string;
}

interface InitialMessage {
  role: 'user';
  content: ContentPart[];
  run: boolean;
}

interface StartConversationRequest {
  initial_message: InitialMessage;
  title?: string;
  /** Environment variable secrets to inject into the conversation sandbox */
  secrets?: Record<string, string>;
}

interface StartTaskResponse {
  id: string;
  status: string;
  app_conversation_id?: string | null;
  error?: string;
}

export interface ConversationInfo {
  id: string;
  status: string;
  execution_status?: string;
  sandbox_status?: string;
  sandbox_id?: string;
  session_api_key?: string;
  conversation_url?: string;
}

interface MessageEvent {
  id: string;
  kind: string;
  source: string;
  timestamp: string;
  // API returns llm_message, not message
  llm_message?: {
    role: string;
    content: ContentPart[];
  };
}

interface EventsSearchResponse {
  items: MessageEvent[];
  next_page_id?: string;
}

/**
 * Raw OH event as it appears on the REST event-search response. We index a
 * couple of fields for storage but otherwise treat the payload as opaque so
 * it can be replayed through new client code as-is.
 */
export interface RawOpenHandsEvent {
  id?: string;
  kind?: string;
  source?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface EventsSearchPage {
  items: RawOpenHandsEvent[];
  next_page_id?: string;
}

/**
 * Error class used for OH REST failures that include HTTP status and the raw
 * `Retry-After` header (if any) so retry logic can react appropriately.
 */
export class OpenHandsApiError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly transient: boolean;
  /**
   * Raw upstream response body, if one was read. `null` for
   * network/abort errors where no HTTP response was received. Exposed
   * as a structured field (in addition to being embedded in
   * `message`) so call sites in {@link AISessionManager} can log it
   * without regex-parsing the message string — see issue #364.
   */
  readonly body: string | null;

  constructor(
    status: number,
    message: string,
    retryAfter: string | null,
    body: string | null = null,
  ) {
    super(message);
    this.name = 'OpenHandsApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.transient = status === 0 || status === 429 || status >= 500;
    this.body = body;
  }
}

/**
 * Raised when an attempt to refresh the upstream conversation credentials
 * discovers that the OpenHands sandbox backing the conversation is gone —
 * either the GET returned no record at all, or `sandbox_status === 'MISSING'`.
 *
 * The driver layer treats this as a non-recoverable signal: the session
 * transitions to `degraded` rather than spinning forever in the reconnect
 * loop. The MISSING-recovery rebind path lives in #296.
 */
export class SandboxMissingError extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(`Sandbox MISSING for conversation ${conversationId}`);
    this.name = 'SandboxMissingError';
    this.conversationId = conversationId;
  }
}

/**
 * Raised by {@link AISessionManager.attachExistingForSession} when the
 * upstream OpenHands conversation referenced by a session's persisted
 * `metadata.aiConversationId` no longer exists or can't be attached to
 * (e.g. `GET /app-conversations?ids=…` returns no record, or the WS
 * handshake fails).
 *
 * The caller (the startup rehydration path and the post-restart
 * auto-connect path) catches this and surfaces a `degraded` session-state
 * broadcast so the kiosk shows "AI not attached — restart the session"
 * rather than going silent. Reviving an ended OH conversation is
 * explicitly out of scope (issue #341 § Out of scope).
 */
export class UpstreamConversationEndedError extends Error {
  readonly conversationId: string;
  /**
   * Typed reason for the failure, when the error originates from a
   * "missing WS handshake materials" condition (issue #405). Allows
   * downstream callers (`auto-connect.ts`, `agent-rehydrate.ts`) to
   * surface a self-describing message in the `degraded` `session-state`
   * broadcast without grepping the error string. Absent for other
   * upstream-ended conditions (404 on attach, generic lookup failure).
   */
  readonly reason?: MissingWsHandshakeReason;
  constructor(
    conversationId: string,
    message?: string,
    reason?: MissingWsHandshakeReason,
  ) {
    super(message ?? `Upstream conversation ${conversationId} no longer available`);
    this.name = 'UpstreamConversationEndedError';
    this.conversationId = conversationId;
    this.reason = reason;
  }
}

/**
 * Reason a WS handshake failed. The classifier checks in priority order:
 * auth-rejected (401 NoCredentialsError), then sandbox_status (STOPPED >
 * MISSING > PAUSED-without-sandbox_id), falling back to unknown.
 */
export type MissingWsHandshakeReason =
  | 'auth-rejected'
  | 'sandbox-stopped'
  | 'sandbox-missing'
  | 'paused-no-sandbox-id'
  | 'unknown';

/**
 * Derive a {@link MissingWsHandshakeReason} from the upstream
 * `ConversationInfo` plus, optionally, the most recent
 * {@link OpenHandsApiError} observed while polling. Pure and
 * side-effect-free — called at the two WS-handshake throw sites in
 * {@link AISessionManager.getOrCreateForSession} (create path) and
 * {@link AISessionManager.attachExistingForSession} (attach path).
 *
 * Branch priority — first match wins:
 *   1. `lastError?.status === 401` with a `NoCredentialsError` body →
 *      `auth-rejected`. Tried first so a known auth failure is never
 *      masked by a stale `sandbox_status` field on the conversation
 *      record.
 *   2. `sandbox_status === 'STOPPED'` → `sandbox-stopped`.
 *   3. `sandbox_status === 'MISSING'` → `sandbox-missing`.
 *   4. `sandbox_status === 'PAUSED'` with no `sandbox_id` →
 *      `paused-no-sandbox-id`.
 *   5. Fallback → `unknown`.
 */
export function explainMissingHandshake(
  convInfo: ConversationInfo,
  lastError?: OpenHandsApiError,
): MissingWsHandshakeReason {
  if (lastError?.status === 401 && /NoCredentialsError/.test(lastError.body ?? '')) {
    return 'auth-rejected';
  }
  if (convInfo.sandbox_status === 'STOPPED') return 'sandbox-stopped';
  if (convInfo.sandbox_status === 'MISSING') return 'sandbox-missing';
  if (convInfo.sandbox_status === 'PAUSED' && !convInfo.sandbox_id) {
    return 'paused-no-sandbox-id';
  }
  return 'unknown';
}

/**
 * Render a self-describing error message for a missing-WS-handshake
 * failure (issue #405). Shape:
 *
 *   "Conversation <id> cannot open a WS session: <reason-specific tail>."
 *
 * Used at both throw sites and in the `degraded` `session-state`
 * broadcast's `error` field so the journal carries a human-readable
 * cause without consumers having to map the typed `reason`.
 */
export function formatMissingHandshakeMessage(
  conversationId: string,
  reason: MissingWsHandshakeReason,
): string {
  const prefix = `Conversation ${conversationId} cannot open a WS session`;
  switch (reason) {
    case 'auth-rejected':
      return `${prefix}: upstream credentials rejected (HTTP 401 NoCredentialsError).`;
    case 'sandbox-stopped':
      return `${prefix}: sandbox is STOPPED.`;
    case 'sandbox-missing':
      return `${prefix}: sandbox MISSING after resume.`;
    case 'paused-no-sandbox-id':
      return `${prefix}: PAUSED with no sandbox_id (upstream contract violation).`;
    case 'unknown':
    default:
      return `${prefix}: no conversation_url / session_api_key returned (cause unknown).`;
  }
}

/**
 * Raised when {@link AISessionManager.refreshSessionCredentials} observes
 * a `401 {error: "NoCredentialsError"}` response from the upstream
 * conversation lookup. The platform has rotated or forgotten the
 * `session_api_key` we hold — functionally equivalent to a MISSING
 * sandbox from the kiosk's point of view. The reconnect path treats this
 * as a recoverable signal and routes through {@link rebindSession}
 * (same as {@link SandboxMissingError}). The existing rebind window
 * guard (max 3 in 5 min, #296) caps the blast radius. See #350.
 */
export class UpstreamCredentialsLostError extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(`Upstream credentials lost for conversation ${conversationId}`);
    this.name = 'UpstreamCredentialsLostError';
    this.conversationId = conversationId;
  }
}

/**
 * Raised when {@link AISessionManager.doRefreshSessionCredentials} issues a
 * sandbox resume against a PAUSED conversation but the sandbox does not
 * reach `RUNNING` (with a fresh `session_api_key`) within the polling
 * budget. The reconnect path treats this as `degraded` rather than
 * retrying via rebind — the sandbox is not missing, just slow, and a
 * rebind would discard the conversation's in-memory agent state for no
 * benefit. See #360.
 */
export class SandboxResumeTimeoutError extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(`Sandbox resume timed out for conversation ${conversationId}`);
    this.name = 'SandboxResumeTimeoutError';
    this.conversationId = conversationId;
  }
}

/**
 * Raised by the resume window-tracker when a conversation has already been
 * resumed `MAX_REBINDS_PER_WINDOW` times in the last `REBIND_WINDOW_MS`.
 * Distinct from {@link RebindBudgetExhausted} (which guards rebind thrash)
 * so the reconnect path can degrade with a clear reason rather than
 * falling through to rebind. See #360.
 */
export class SandboxResumeBudgetExhausted extends Error {
  readonly conversationId: string;
  readonly attempts: number;
  constructor(conversationId: string, attempts: number) {
    super(
      `Sandbox resume for conversation ${conversationId} exceeded window cap ` +
        `(${attempts} resume(s) in the last 5 min)`,
    );
    this.name = 'SandboxResumeBudgetExhausted';
    this.conversationId = conversationId;
    this.attempts = attempts;
  }
}

export class OpenHandsClient {
  private apiKey: string;
  private baseUrl: string;

  /**
   * @param apiKey - Per-workspace OpenHands API key. Required; the
   *   process-scoped `OPENHANDS_CLOUD_API_KEY` / `OPENHANDS_API_KEY` env
   *   fallback was removed in #404 once every runtime caller flowed
   *   through `clientForSession(session)` (issue #403).
   * @param baseUrl - OpenHands SaaS base URL; defaults to
   *   `OPENHANDS_BASE_URL`.
   */
  constructor(apiKey: string, baseUrl: string = OPENHANDS_BASE_URL) {
    // #404 (pr-review): treat whitespace-only keys as missing too. A
    // bare empty string was already rejected; an all-spaces value would
    // have slipped through the `!apiKey` check and surfaced as a
    // confusing upstream 401. Single source of truth — the manager's
    // `getOrCreateForSession` also short-circuits whitespace before
    // calling here, but defending here keeps every call site honest.
    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        'Missing OpenHands API key. Configure a per-workspace key in workspace settings.',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private get apiV1Url(): string {
    return `${this.baseUrl}/api/v1`;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: object,
    timeoutMs: number = 30000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.apiV1Url}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new OpenHandsApiError(
          response.status,
          `OpenHands API error ${response.status}: ${text}`,
          response.headers.get('retry-after'),
          text,
        );
      }

      return await response.json() as T;
    } catch (err) {
      if (err instanceof OpenHandsApiError) throw err;
      // AbortError, network errors → transient (status 0)
      const message = err instanceof Error ? err.message : String(err);
      throw new OpenHandsApiError(0, `OpenHands network error: ${message}`, null);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Start a new OpenHands conversation
   * @param initialMessage - The initial message to send to the AI
   * @param title - Optional title for the conversation
   * @param secrets - Optional map of environment variable secrets to inject
   */
  async startConversation(
    initialMessage: string,
    title?: string,
    secrets?: Record<string, string>
  ): Promise<StartTaskResponse> {
    const payload: StartConversationRequest = {
      initial_message: {
        role: 'user',
        content: [{ type: 'text', text: initialMessage }],
        run: true,
      },
    };
    if (title) {
      payload.title = title;
    }
    if (secrets && Object.keys(secrets).length > 0) {
      payload.secrets = secrets;
    }

    return this.request<StartTaskResponse>('POST', '/app-conversations', payload, 120000);
  }

  /**
   * Get a start task by ID to check status
   */
  async getStartTask(taskId: string): Promise<StartTaskResponse | null> {
    const response = await this.request<(StartTaskResponse | null)[]>(
      'GET',
      `/app-conversations/start-tasks?ids=${encodeURIComponent(taskId)}`
    );
    return response[0] || null;
  }

  /**
   * Poll until the conversation is ready
   */
  async pollUntilReady(
    taskId: string,
    timeoutMs: number = 10 * 60 * 1000,
    pollIntervalMs: number = 2000
  ): Promise<StartTaskResponse> {
    const deadline = Date.now() + timeoutMs;
    let interval = pollIntervalMs;
    let lastTask: StartTaskResponse | null = null;

    while (Date.now() < deadline) {
      lastTask = await this.getStartTask(taskId);
      const status = (lastTask?.status || '').toUpperCase();

      if (START_TASK_TERMINAL_STATUSES.has(status)) {
        if (status === 'ERROR' || status === 'FAILED') {
          throw new Error(`Conversation failed to start: ${lastTask?.error || status}`);
        }
        return lastTask!;
      }

      await new Promise(resolve => setTimeout(resolve, Math.min(interval, deadline - Date.now())));
      interval = Math.min(interval * 1.5, 10000);
    }

    throw new Error(`Conversation start timed out after ${timeoutMs}ms`);
  }

  /**
   * Get conversation info
   */
  async getConversation(conversationId: string): Promise<ConversationInfo | null> {
    const response = await this.request<(ConversationInfo | null)[]>(
      'GET',
      `/app-conversations?ids=${encodeURIComponent(conversationId)}`
    );
    return response[0] || null;
  }

  /**
   * Rebind a conversation whose sandbox has been reaped onto a fresh sandbox.
   *
   * The platform `POST /app-conversations` endpoint is **asynchronous**: it
   * returns an `AppConversationStartTask` (just `{ id, status, ... }`), not a
   * fully-populated `AppConversation`. The post-rebind `session_api_key` and
   * `conversation_url` only appear on the conversation record itself, which
   * doesn't exist until the new sandbox finishes booting. So this method
   * runs the same three-phase dance that {@link startConversation} +
   * {@link pollUntilReady} + {@link getConversation} performs for the
   * fresh-create path (#361):
   *
   *   1. POST `/app-conversations` with `{ conversation_id, … }` (and *no*
   *      `parent_conversation_id` — that path is the fork primitive, which
   *      errors on a dead conversation; see docs/openhands-platform.md
   *      § Rebind on a dead conversation). The response is a
   *      {@link StartTaskResponse}.
   *   2. {@link pollUntilReady} on the start-task id until the new sandbox
   *      reports a terminal `READY` status (typical 10–60 s).
   *   3. {@link getConversation} on the (preserved) `conversation_id` to
   *      pick up the freshly-minted `session_api_key`, `conversation_url`,
   *      and `sandbox_status`.
   *
   * The same `conversation_id` is preserved; the on-server event log is
   * intact; the agent's in-context memory is not (memory replay via the
   * `system_message_suffix` field is #297).
   *
   * Returns the rebound conversation info. Throws `OpenHandsApiError` with
   * the upstream HTTP status on failure of any phase; callers in the driver
   * layer narrow that into typed errors with retry semantics
   * (`server/src/agent-driver/rebind.ts`).
   */
  async rebindConversation(
    conversationId: string,
    opts: { systemMessageSuffix?: string } = {},
    pollOpts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<ConversationInfo> {
    // `system_message_suffix` is the platform field that drives memory
    // replay (#297). The agent on the freshly-provisioned sandbox sees it
    // appended to the base system prompt at conversation start, so the
    // post-rebind agent can answer "what did we just discuss?" with
    // continuity from the prior turns.
    const body: Record<string, unknown> = { conversation_id: conversationId };
    const suffix = opts.systemMessageSuffix;
    if (typeof suffix === 'string' && suffix.length > 0) {
      body.system_message_suffix = suffix;
    }

    // Phase 1 — async start task (the actual platform response shape).
    // Until #361 this method assumed POST /app-conversations returned a
    // fully-populated AppConversation; in reality it returns an
    // AppConversationStartTask with no session_api_key, which caused every
    // rebind to fail normalization downstream.
    const startTask = await this.request<StartTaskResponse>(
      'POST', '/app-conversations', body, 60_000,
    );

    // Phase 2 — wait for the new sandbox to be ready. Reuse the same
    // poll loop as fresh-create. The 120 s default sits comfortably inside
    // the 180 s `REBIND_BUDGET_MS` (server/src/agent-driver/rebind.ts),
    // which is the total wall-clock budget the driver layer enforces
    // across *all* HTTP attempts. Keeping the inner poll timeout below the
    // outer budget means a single slow boot doesn't immediately exhaust
    // the retry envelope while still leaving room for one short retry.
    const readyTask = await this.pollUntilReady(
      startTask.id,
      pollOpts.timeoutMs ?? 120_000,
      pollOpts.pollIntervalMs ?? 2_000,
    );

    // The platform preserves the existing conversation_id on rebind, so
    // app_conversation_id (when present) should match the input. We prefer
    // the task-reported id if any, falling back to the input for defence.
    // Use `??` so a server-side `null` or `undefined` (but not, say, an
    // empty string) triggers the fallback.
    const reboundId = readyTask.app_conversation_id ?? conversationId;

    // Phase 3 — re-fetch the conversation to read session_api_key and
    // conversation_url. These are populated on the conversation record,
    // not on the start-task record.
    const info = await this.getConversation(reboundId);
    if (!info) {
      throw new OpenHandsApiError(
        0,
        `Rebind: getConversation returned no record for ${reboundId}`,
        null,
      );
    }
    return info;
  }

  /**
   * Resume a paused sandbox. Triggers the upstream
   * `PAUSED → STARTING → RUNNING` transition. The conversation's
   * `session_api_key` rotates and `conversation_url` becomes non-null again;
   * the caller is responsible for re-reading those fields via
   * {@link getConversation} once the sandbox reports `RUNNING`. See
   * `docs/openhands-platform.md` § Verified timings (~19 s typical, most of
   * it in STARTING) and #360 for the production rationale.
   *
   * Idempotency: POSTing against an already-RUNNING sandbox returns
   * `200 {success:true}`. The PAUSED branch in
   * {@link AISessionManager.doRefreshSessionCredentials} guards against
   * spamming this on a healthy sandbox.
   *
   * Errors:
   * - `404` → `OpenHandsApiError(404, …)`; the caller converts this to
   *   `SandboxMissingError` because a sandbox that resume can't find is
   *   genuinely gone, not paused.
   * - `5xx` / network → `OpenHandsApiError` with `transient=true`; the
   *   refresh-loop retry covers these.
   */
  async resumeSandbox(sandboxId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      'POST',
      `/sandboxes/${encodeURIComponent(sandboxId)}/resume`,
      {},
      30_000,
    );
  }

  /**
   * Send a message to an existing conversation via pending messages endpoint
   * Uses SendMessageRequest format: { role, content: [{type, text}], run }
   */
  async sendMessage(conversationId: string, message: string): Promise<{ id: string; queued: boolean; position: number }> {
    return this.request<{ id: string; queued: boolean; position: number }>(
      'POST',
      `/conversations/${conversationId}/pending-messages`,
      {
        role: 'user',
        content: [{ type: 'text', text: message }],
        run: true  // Auto-run the agent loop to process the message
      }
    );
  }

  /**
   * Get recent events from a conversation
   */
  async getEvents(conversationId: string, limit: number = 50): Promise<EventsSearchResponse> {
    return this.request<EventsSearchResponse>(
      'GET',
      `/conversation/${conversationId}/events/search?limit=${limit}`
    );
  }

  /**
   * Get a single page of raw events for rehydration. Returns events untouched
   * so callers can persist them verbatim. Uses a 60s per-call timeout per the
   * rehydration retry model.
   */
  async getEventsPage(
    conversationId: string,
    options: { pageId?: string; limit?: number } = {}
  ): Promise<EventsSearchPage> {
    const params = new URLSearchParams();
    params.set('limit', String(options.limit ?? 100));
    if (options.pageId) params.set('page_id', options.pageId);
    return this.request<EventsSearchPage>(
      'GET',
      `/conversation/${conversationId}/events/search?${params.toString()}`,
      undefined,
      60_000
    );
  }

  /**
   * Get message events (filter for MessageEvent kind)
   */
  async getMessageEvents(conversationId: string, limit: number = 50): Promise<MessageEvent[]> {
    const response = await this.getEvents(conversationId, limit);
    return response.items.filter(e => e.kind === 'MessageEvent');
  }
}

/**
 * Get the server URL for API calls in prompts
 * Uses BASE_URL env var if set, otherwise falls back to localhost in dev/test.
 * Throws in production if BASE_URL is not set to prevent silent failures.
 */
export function getServerUrl(): string {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  // Only use localhost fallback in dev/test environments
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BASE_URL environment variable is required in production for display API');
  }
  
  return `http://localhost:${process.env.PORT || 3001}`;
}

/**
 * Apply the standard prompt-body substitutions: display lines, server URL,
 * workspace ID, session ID. Extracted from {@link loadPrompt} so the
 * per-session / workspace-default override paths
 * ({@link resolveSessionSystemPrompt}) reuse the same logic without
 * re-implementing it.
 *
 * Mutating the input is fine since the caller always owns a fresh copy
 * loaded from disk or DB.
 */
export function applyPromptSubstitutions(
  prompt: string,
  displayLines?: number,
  workspaceId?: string,
  sessionId?: string
): string {
  let out = prompt;

  if (displayLines !== undefined) {
    out = out.replace(
      /Maximum 10-12 lines of body text/g,
      `Maximum ${displayLines} lines of body text`
    );
    out = out.replace(
      /content beyond ~10 lines will be invisible/g,
      `content beyond ${displayLines} lines will be invisible`
    );
  }

  // Server URL — required for display API curl examples in the prompt.
  out = out.replace(/{{SERVER_URL}}/g, getServerUrl());

  // Workspace + session IDs are escaped so a future opaque ID containing
  // JSON-breaking chars doesn't corrupt curl examples.
  if (workspaceId) {
    const escapedId = workspaceId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    out = out.replace(/{{WORKSPACE_ID}}/g, escapedId);
  }
  if (sessionId) {
    const escapedId = sessionId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    out = out.replace(/{{SESSION_ID}}/g, escapedId);
  }

  return out;
}

/**
 * Read the built-in prompt file from disk. Throws if the file is missing.
 * Separated from {@link loadPrompt} so {@link resolveSessionSystemPrompt}
 * can read it without re-running the substitution pass (which is applied
 * by the resolver after deciding which body to use).
 */
export function readBuiltinPrompt(promptName: string): string {
  const promptsDir = path.join(__dirname, '..', 'prompts');
  const promptPath = path.join(promptsDir, `${promptName}.md`);

  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt not found: ${promptName}`);
  }
  return fs.readFileSync(promptPath, 'utf-8');
}

/**
 * Load a prompt from the prompts directory
 * @param promptName - Name of the prompt file (without .md extension)
 * @param displayLines - Optional number of display lines to inject into the prompt
 * @param workspaceId - Optional workspace ID to inject into the prompt for display API calls
 * @param sessionId - Optional session ID to inject into the prompt for display API calls
 */
export function loadPrompt(
  promptName: string,
  displayLines?: number,
  workspaceId?: string,
  sessionId?: string
): string {
  return applyPromptSubstitutions(
    readBuiltinPrompt(promptName),
    displayLines,
    workspaceId,
    sessionId
  );
}

/**
 * Resolve the effective system prompt for a session.
 *
 * Precedence (issue #378):
 *   1. `session.metadata.agentPrompt` — per-session override.
 *   2. `workspaceSettings.defaultAgentPrompt` — workspace-wide default.
 *   3. Built-in `server/prompts/system-prompt.md` — fallback.
 *
 * The same `{{SERVER_URL}}`, `{{WORKSPACE_ID}}`, `{{SESSION_ID}}` and
 * display-line substitutions used by {@link loadPrompt} are applied to
 * whichever body wins, so operator-authored prompts can reference the
 * same placeholders as the built-in one.
 */
export interface ResolveSessionPromptInput {
  /** Per-session metadata; only `agentPrompt` is read. */
  sessionMetadata: { agentPrompt?: string | null } | null | undefined;
  /** Workspace settings row; only `defaultAgentPrompt` is read. */
  workspaceSettings: { defaultAgentPrompt: string | null } | null | undefined;
  sessionId: string;
  workspaceId: string;
  displayLines?: number;
}

export interface ResolvedSessionPrompt {
  /** The final, substitution-applied prompt body. */
  effective: string;
  /** Where the body came from. */
  source: 'session' | 'workspace-default' | 'builtin';
}

/**
 * Function-shape used by {@link AISessionManager.setSystemPromptResolver}.
 * Production wiring (in `index.ts`) plugs in a closure that pulls the
 * session metadata + workspace settings from their repositories and
 * delegates to {@link resolveSessionSystemPrompt}. Returns just the
 * prompt string for the call site — the source label is consumed by
 * `GET /api/sessions/:id/settings`, not by the bind path.
 */
export type SystemPromptResolver = (input: {
  sessionId: string;
  workspaceId: string;
  displayLines?: number;
}) => string;

export function resolveSessionSystemPrompt(
  input: ResolveSessionPromptInput
): ResolvedSessionPrompt {
  const { sessionMetadata, workspaceSettings, sessionId, workspaceId, displayLines } = input;

  // 1. Per-session override wins. Treat empty string as "no override".
  const sessionPrompt = sessionMetadata?.agentPrompt;
  if (typeof sessionPrompt === 'string' && sessionPrompt.length > 0) {
    return {
      effective: applyPromptSubstitutions(sessionPrompt, displayLines, workspaceId, sessionId),
      source: 'session',
    };
  }

  // 2. Workspace default.
  const wsPrompt = workspaceSettings?.defaultAgentPrompt ?? null;
  if (typeof wsPrompt === 'string' && wsPrompt.length > 0) {
    return {
      effective: applyPromptSubstitutions(wsPrompt, displayLines, workspaceId, sessionId),
      source: 'workspace-default',
    };
  }

  // 3. Built-in.
  return {
    effective: applyPromptSubstitutions(
      readBuiltinPrompt('system-prompt'),
      displayLines,
      workspaceId,
      sessionId
    ),
    source: 'builtin',
  };
}

/**
 * Active AI session linked to a VR session
 */
/** Agent action event from OpenHands event stream */
export interface AgentAction {
  id: string;
  timestamp: string;
  kind: string;
  source: string;
  summary: string;
}

export interface AISession {
  conversationId: string;
  taskId: string;
  /** VR session ID - the session this AI is connected to */
  sessionId?: string;
  /** Workspace ID; used to resolve the per-workspace API key for refresh/rebind (#403). */
  workspaceId?: string;
  /** Per-workspace OpenHands API key snapshot for refresh/rebind (#403). When undefined, falls back to env singleton. */
  apiKey?: string;
  mode: 'chat' | 'kiosk';
  ws?: WebSocket;
  agentServerUrl?: string;
  sessionApiKey?: string;
  lastEventId?: string;
  /**
   * Callback for agent messages (AI responses).
   *
   * `serverTimestamp` is the OH-server-emitted event timestamp (normalized
   * to ISO Zulu by {@link normalizeOhTimestamp}), if present. Callers should
   * prefer this over the local receipt time so utterances and agent actions
   * share a single clock — see issue #264.
   */
  onMessage?: (message: string, serverTimestamp?: string) => void;
  /** Callback for agent action events */
  onAction?: (action: AgentAction) => void;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  /** Whether AI is currently processing a response */
  isThinking: boolean;
  /** ID of the pending message being processed */
  pendingMessageId?: string;
  /** Timestamp when the last message was sent */
  lastMessageSentAt?: number;
  /**
   * True when the reconnect loop has discovered the upstream sandbox is gone
   * (or unrecoverable) and given up. The driver maps this to the `degraded`
   * AgentSessionState. See `SandboxMissingError` and #291.
   */
  degraded?: boolean;
  /** Human-readable reason for the degraded transition (when `degraded` is true). */
  degradedReason?: string | null;
  /**
   * True when the reconnect loop has detected `sandbox_status: MISSING`
   * and is mid-flight attempting a rebind onto a fresh sandbox (#296).
   * The driver maps this to the `reconnecting` AgentSessionState so the
   * kiosk shows a reconnecting indicator instead of the more alarming
   * `degraded` one. Cleared when the rebind either succeeds (a new WS is
   * opened) or fails (the session transitions to `degraded`).
   */
  rebinding?: boolean;

  // ---- Voice Relay header state (issue #375) -------------------------------
  //
  // Per-conversation token-efficient sender + timing header. The state
  // is implicitly reset whenever a new `AISession` is constructed (which
  // is what happens on `endSessionAI` + re-bind, `restartSession`, or
  // attach onto a different `conversationId`). Rebind onto the same
  // `conversationId` preserves the state — the agent's notion of
  // "speaker A" survives a sandbox swap.
  //
  // Optional only so existing tests that construct hand-rolled `AISession`
  // objects don't have to be updated en masse; the production paths
  // (`getOrCreateForSession`, `attachExistingForSession`) always
  // initialize it, and `sendSessionMessage` lazy-initialises when
  // missing.
  headerState?: VoiceRelayHeaderState;
}

// V1 Event type interfaces
interface V1MessageEvent {
  id: string;
  timestamp: string;
  source: 'agent' | 'user' | 'environment' | 'hook';
  llm_message: {
    role: string;
    content: ContentPart[];
  };
}

interface V1ConversationStateUpdateEvent {
  kind: 'ConversationStateUpdateEvent';
  key: string;
  value: Record<string, unknown>;
}

/**
 * Content part in OpenHands events (text or image).
 * Uses OpenHands field naming conventions for client portability.
 */
interface V1ContentPart {
  type: 'text' | 'image';
  text?: string;
  image_urls?: string[];  // snake_case per OpenHands convention
}

/**
 * Task item in task tracker events.
 */
interface V1TaskItem {
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  notes?: string;
}

/**
 * Generic OpenHands event shape for action forwarding.
 * Extended to capture all fields needed for rich content rendering.
 * 
 * IMPORTANT: Field names use snake_case to match OpenHands conventions exactly.
 * This is intentional for client portability - see issue #252.
 */
interface V1Event {
  id?: string;
  timestamp?: string;
  kind?: string;
  source?: string;
  
  // === Direct event fields ===
  command?: string;
  path?: string;
  thought?: string;
  args?: Record<string, unknown>;
  
  // === V1 wrapped event format - nested action/observation objects ===
  action?: Record<string, unknown> | string;
  observation?: Record<string, unknown>;
  
  // === Terminal action/observation fields ===
  content?: V1ContentPart[] | string;
  exit_code?: number;
  timeout?: boolean;
  
  // === File action/observation fields ===
  file_text?: string;
  old_str?: string;
  new_str?: string;
  error?: string;
  
  // === MCP action/observation fields ===
  tool_name?: string;
  data?: Record<string, unknown>;
  is_error?: boolean;
  
  // === Browser action fields ===
  url?: string;
  index?: number;
  text?: string;
  direction?: string;
  tab_id?: string;
  new_tab?: boolean;
  include_screenshot?: boolean;
  extract_links?: boolean;
  start_from_char?: number;
  
  // === Search action/observation fields ===
  pattern?: string;
  include?: string;
  search_path?: string;
  files?: string[];
  matches?: string[];
  
  // === Think/Finish action fields ===
  message?: string;
  
  // === Task tracker fields ===
  task_list?: V1TaskItem[];
  
  // === Observation linkage ===
  action_id?: string;
  
  // For nested structures and unknown fields
  [key: string]: unknown;
}

/** Helper to truncate strings for display summaries */
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

/** Format ActionEvent with nested action object */
function formatActionEvent(event: V1Event): string {
  const action = event.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object') {
    return 'Action';
  }

  const actionType = action.action;
  
  switch (actionType) {
    case 'run':
      if (action.command) {
        return truncate(String(action.command), 60);
      }
      return 'Running command';
      
    case 'read':
      if (action.path) {
        return `Read ${action.path}`;
      }
      return 'Reading file';
      
    case 'write':
      if (action.path) {
        return `Write ${action.path}`;
      }
      return 'Writing file';
      
    case 'edit':
      if (action.path) {
        return `Edit ${action.path}`;
      }
      return 'Editing file';
      
    case 'browse':
    case 'browse_url':
      if (action.url) {
        return `Navigate to ${truncate(String(action.url), 40)}`;
      }
      return 'Navigating browser';
      
    case 'browse_interactive':
      if (action.browser_actions) {
        return `Browser: ${truncate(String(action.browser_actions), 50)}`;
      }
      return 'Browser interaction';
      
    case 'think':
      if (action.thought) {
        return truncate(String(action.thought), 60);
      }
      return 'Thinking...';
      
    case 'finish':
      return 'Task completed';
      
    case 'delegate':
      return 'Delegating to sub-agent';
      
    case 'message':
      if (action.content) {
        return truncate(String(action.content), 60);
      }
      return 'Message';
      
    default:
      // Return cleaned action type name
      if (typeof actionType === 'string') {
        return actionType.charAt(0).toUpperCase() + actionType.slice(1);
      }
      return 'Action';
  }
}

/** Format ObservationEvent with nested observation object */
function formatObservationEvent(event: V1Event): string {
  const observation = event.observation as Record<string, unknown> | undefined;
  if (!observation || typeof observation !== 'object') {
    return 'Observation';
  }

  const obsType = observation.observation;
  
  switch (obsType) {
    case 'run':
    case 'cmd_output':
      if (observation.content) {
        return `Output: ${truncate(String(observation.content), 55)}`;
      }
      return 'Command output';
      
    case 'read':
      if (observation.path) {
        return `Read ${observation.path}`;
      }
      return 'File content';
      
    case 'write':
      if (observation.path) {
        return `Wrote ${observation.path}`;
      }
      return 'File written';
      
    case 'edit':
      if (observation.path) {
        return `Edited ${observation.path}`;
      }
      return 'File edited';
      
    case 'browse':
    case 'browser':
      if (observation.url) {
        return `Browsed ${truncate(String(observation.url), 40)}`;
      }
      return 'Browser result';
      
    case 'error':
      if (observation.content) {
        return `Error: ${truncate(String(observation.content), 55)}`;
      }
      return 'Error occurred';
      
    case 'agent':
      return 'Agent observation';
      
    default:
      if (typeof obsType === 'string') {
        return obsType.charAt(0).toUpperCase() + obsType.slice(1) + ' result';
      }
      return 'Observation';
  }
}

/**
 * Decide whether to drop an OpenHands event before forwarding it as an agent
 * action card to the kiosk inline timeline (issues #265, #280).
 *
 * The kiosk timeline shows the agent's tool invocations alongside utterances.
 * Several event classes are persisted to `agent_events` for forensics /
 * rehydration but should never become timeline cards:
 *
 *   - `SystemPromptEvent`: the agent's system prompt is internal infrastructure.
 *     Surfacing it as a card just confuses the user.
 *   - `MessageEvent` (ANY source, including `agent`): user/environment messages
 *     are already rendered as utterance bubbles by the conversation feed, and
 *     agent replies are rendered as `✨ AI` utterance bubbles via the separate
 *     `messages` table. Showing them again as event cards duplicates the chat
 *     bubble. On the LIVE path, agent `MessageEvent`s are intercepted by the
 *     `isV1MessageEvent && source === 'agent'` branch upstream of this filter
 *     and never reach it — so including `source === 'agent'` here only affects
 *     the REFRESH path, which is what we want.
 *   - `ConversationStateUpdateEvent`, `ConversationErrorEvent`,
 *     `ServerErrorEvent`: status / error scaffolding. The live path logs them
 *     only and never creates a timeline card; the refresh path must do the
 *     same.
 *
 * Default-show: any unknown future kind passes through. The filter is an
 * allow-by-default safety net so new OH event kinds remain visible until a
 * developer makes an explicit decision.
 */
export function shouldSkipForKioskTimeline(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || !('kind' in event)) {
    return false;
  }
  const obj = event as { kind?: unknown };
  const kind = typeof obj.kind === 'string' ? obj.kind : undefined;
  if (!kind) return false;
  switch (kind) {
    case 'SystemPromptEvent':
    case 'MessageEvent':
    case 'ConversationStateUpdateEvent':
    case 'ConversationErrorEvent':
    case 'ServerErrorEvent':
      return true;
    default:
      return false;
  }
}

/**
 * Format an OpenHands event into a human-readable summary.
 * Used to create concise descriptions of agent actions.
 * Handles both V1 wrapped events (ActionEvent, ObservationEvent) and direct action types.
 */
export function formatEventSummary(event: V1Event): string {
  const kind = event.kind || 'Unknown';

  // Real OpenHands ActionEvents carry a top-level descriptive `summary` field
  // (e.g. "Display greeting on kiosk to confirm AI connection"). Prefer it over
  // the generic "Action" fallback we would otherwise derive from the nested
  // action object. See PR #258 follow-up for validation details.
  if ((kind === 'ActionEvent' || kind === 'ObservationEvent') &&
      typeof event.summary === 'string' && event.summary.trim()) {
    return truncate(event.summary, 80);
  }

  // Handle V1 wrapped event formats first
  switch (kind) {
    case 'ActionEvent':
      return formatActionEvent(event);
      
    case 'ObservationEvent':
      return formatObservationEvent(event);
      
    case 'SystemPromptEvent':
      return 'System prompt loaded';
      
    case 'MessageEvent':
      // OpenHands LLM messages contain nested content arrays with typed parts (e.g., [{type: 'text', text: '...'}])
      if (event.llm_message && typeof event.llm_message === 'object') {
        const msg = event.llm_message as { content?: Array<{ type: string; text?: string }> };
        if (msg.content && Array.isArray(msg.content)) {
          const textPart = msg.content.find(p => p.type === 'text' && p.text);
          if (textPart?.text) {
            return truncate(textPart.text, 60);
          }
        }
      }
      return 'Message';
  }
  
  // Handle direct action types (backward compatibility)
  switch (kind) {
    case 'CmdRunAction':
      if (event.command) {
        return truncate(String(event.command), 60);
      }
      return 'Running command';
      
    case 'CmdOutputObservation':
      return 'Command output received';
      
    case 'FileReadAction':
      if (event.path) {
        return `Read ${event.path}`;
      }
      return 'Reading file';
      
    case 'FileWriteAction':
      if (event.path) {
        return `Write ${event.path}`;
      }
      return 'Writing file';
      
    case 'FileEditAction':
      if (event.path) {
        return `Edit ${event.path}`;
      }
      return 'Editing file';
      
    case 'BrowseURLAction':
      if (event.args && typeof event.args === 'object' && 'url' in event.args) {
        const url = String(event.args.url);
        return `Navigate to ${truncate(url, 40)}`;
      }
      return 'Navigating browser';
      
    case 'BrowseInteractiveAction':
      if (typeof event.action === 'string') {
        return `Browser: ${event.action}`;
      }
      return 'Browser interaction';
      
    case 'AgentThinkAction':
      if (event.thought) {
        return truncate(String(event.thought), 60);
      }
      return 'Thinking...';
      
    case 'AgentStateChangeEvent':
      if (event.args && typeof event.args === 'object' && 'agent_state' in event.args) {
        return `State: ${event.args.agent_state}`;
      }
      return 'State change';
      
    case 'AgentFinishAction':
      return 'Task completed';
      
    case 'AgentDelegateAction':
      return 'Delegating to sub-agent';
      
    case 'ConversationStateUpdateEvent':
      return 'Status update';
      
    default:
      // For unknown types, use the kind as the summary with cleaned name
      return kind.replace(/Action$|Observation$|Event$/i, '');
  }
}

/**
 * Extracted fields from a V1Event for rich content rendering.
 * Uses snake_case field names to match OpenHands conventions for client portability.
 * See issue #252 for context on why we adopted OpenHands naming conventions.
 */
export interface ExtractedEventFields {
  // Terminal actions/observations
  command?: string;
  content?: V1ContentPart[] | string;
  exit_code?: number;
  timeout?: boolean;
  
  // File actions/observations
  path?: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  error?: string;
  
  // MCP actions/observations
  tool_name?: string;
  data?: Record<string, unknown>;
  is_error?: boolean;
  
  // Browser actions
  url?: string;
  index?: number;
  text?: string;
  direction?: string;
  tab_id?: string;
  new_tab?: boolean;
  include_screenshot?: boolean;
  extract_links?: boolean;
  start_from_char?: number;
  
  // Search actions/observations
  pattern?: string;
  include?: string;
  search_path?: string;
  files?: string[];
  matches?: string[];
  
  // Think/Finish actions
  thought?: string;
  message?: string;

  // Invoke skill actions/observations
  skill_name?: string;

  // Task tracker
  task_list?: V1TaskItem[];
  
  // Observation linkage
  action_id?: string;
}

/**
 * Helper to safely extract a string field from an object.
 */
function extractString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Helper to safely extract a number field from an object.
 */
function extractNumber(obj: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Helper to safely extract a boolean field from an object.
 */
function extractBoolean(obj: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Helper to safely extract a data object field from an object.
 * Returns undefined if value is not a plain object (rejects null, arrays, primitives).
 */
function extractData(obj: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Helper to safely extract a string array field from an object.
 */
function extractStringArray(obj: Record<string, unknown> | undefined, key: string): string[] | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value as string[];
  }
  return undefined;
}

/**
 * Helper to safely extract content which can be an array of content parts or a string.
 * Validates that content parts have the correct structure including field types.
 */
function extractContent(obj: Record<string, unknown> | undefined, key: string): V1ContentPart[] | string | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    // Check if it's an array of content parts with strict type validation
    const isContentParts = value.every(item => {
      if (typeof item !== 'object' || item === null || !('type' in item)) return false;
      const partItem = item as Record<string, unknown>;
      if (partItem.type === 'text') {
        // text field must be string if present
        return !('text' in partItem) || typeof partItem.text === 'string';
      }
      if (partItem.type === 'image') {
        // image_urls must be array of strings if present
        return !('image_urls' in partItem) || 
          (Array.isArray(partItem.image_urls) && partItem.image_urls.every(u => typeof u === 'string'));
      }
      return false;
    });
    if (isContentParts) {
      return value as V1ContentPart[];
    }
  }
  return undefined;
}

/**
 * Helper to safely extract task list from an object.
 * Validates that task items have the correct structure including optional notes field.
 * Returns empty array for empty input arrays (to distinguish "no tasks yet" from "field absent").
 */
function extractTaskList(obj: Record<string, unknown> | undefined, key: string): V1TaskItem[] | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  if (Array.isArray(value)) {
    const validTasks = value.filter(item => {
      if (typeof item !== 'object' || item === null) return false;
      const taskItem = item as Record<string, unknown>;
      // Required: title must be string
      if (!('title' in taskItem) || typeof taskItem.title !== 'string') return false;
      // Required: status must be valid enum value
      if (!('status' in taskItem) || !['todo', 'in_progress', 'done'].includes(taskItem.status as string)) return false;
      // Optional: notes must be string if present
      if ('notes' in taskItem && typeof taskItem.notes !== 'string') return false;
      return true;
    });
    // Return array if we have valid tasks OR if input was an empty array
    // This preserves the semantic distinction: [] means "no tasks yet", undefined means "field absent"
    if (validTasks.length > 0 || value.length === 0) {
      return validTasks as V1TaskItem[];
    }
  }
  return undefined;
}

// Sets of known event kinds for exact matching - more maintainable than string.includes()
// and prevents false matches (e.g., 'Terminal' matching hypothetical 'TerminalEmulator')
//
// MAINTENANCE NOTE: These event kinds must be kept in sync with OpenHands upstream.
// When OpenHands adds new action/observation types, update the relevant Set below.
// Reference: https://github.com/All-Hands-AI/OpenHands/tree/main/openhands/events
// See also: openhands/events/action/ and openhands/events/observation/ directories
// for the canonical list of event types in the OpenHands codebase.
const TERMINAL_KINDS = new Set([
  'TerminalAction', 'TerminalObservation',
  'ExecuteBashAction', 'ExecuteBashObservation',
  'CmdRunAction', 'CmdOutputObservation'
]);
const FILE_KINDS = new Set([
  'FileReadAction', 'FileReadObservation',
  'FileWriteAction', 'FileWriteObservation',
  'FileEditAction', 'FileEditObservation',
  'EditorAction', 'EditorObservation',
  'FileEditorAction', 'FileEditorObservation',
  'StrReplaceAction', 'StrReplaceObservation',
  'StrReplaceEditorAction', 'StrReplaceEditorObservation'
]);
const MCP_KINDS = new Set([
  'MCPAction', 'MCPObservation',
  'MCPToolAction', 'MCPToolObservation',
  'ToolAction', 'ToolObservation'
]);
const BROWSER_KINDS = new Set([
  'BrowserAction', 'BrowserObservation',
  'BrowseAction', 'BrowseObservation',
  'BrowserNavigateAction', 'BrowserClickAction', 'BrowserTypeAction',
  'BrowserScrollAction', 'BrowserGetStateAction', 'BrowserGetContentAction',
  'BrowserSwitchTabAction', 'BrowserCloseTabAction', 'BrowserListTabsAction',
  'BrowserGoBackAction', 'BrowserGetStorageAction', 'BrowserSetStorageAction',
  'BrowserStartRecordingAction', 'BrowserStopRecordingAction'
]);
const SEARCH_KINDS = new Set([
  'GrepAction', 'GrepObservation',
  'GlobAction', 'GlobObservation',
  'SearchAction', 'SearchObservation'
]);
const THINK_KINDS = new Set(['ThinkAction', 'AgentThinkAction']);
const THINK_OBSERVATION_KINDS = new Set(['ThinkObservation']);
const FINISH_KINDS = new Set(['FinishAction', 'AgentFinishAction']);
const TASK_TRACKER_KINDS = new Set(['TaskTrackerAction', 'TaskTrackerObservation']);
const INVOKE_SKILL_KINDS = new Set(['InvokeSkillAction', 'InvokeSkillObservation']);
const OBSERVATION_KINDS = new Set([
  'ObservationEvent', 'TerminalObservation', 'ExecuteBashObservation',
  'CmdOutputObservation', 'FileReadObservation', 'FileWriteObservation',
  'FileEditObservation', 'EditorObservation', 'FileEditorObservation',
  'StrReplaceObservation', 'StrReplaceEditorObservation',
  'MCPObservation', 'MCPToolObservation', 'ToolObservation',
  'BrowserObservation', 'BrowseObservation',
  'GrepObservation', 'GlobObservation', 'SearchObservation', 'TaskTrackerObservation',
  'ThinkObservation', 'InvokeSkillObservation'
]);

/**
 * Extract the effective kind from a V1Event.
 * 
 * For wrapped events (ActionEvent, ObservationEvent), returns the nested kind
 * (e.g., TerminalAction, TerminalObservation) which the client uses for content formatting.
 * For direct events, returns the original kind.
 * 
 * This is critical for client-side rich content rendering - the client's
 * getEventContent() dispatches based on kinds like "TerminalAction", not "ActionEvent".
 * 
 * @param event - The V1Event to extract effective kind from
 * @returns The effective kind for client-side content formatting
 */
export function extractEffectiveKind(event: V1Event): string {
  const kind = event.kind || 'Unknown';
  
  // For ActionEvent, use the nested action.kind
  if (kind === 'ActionEvent') {
    const actionObj = typeof event.action === 'object' ? event.action as Record<string, unknown> : undefined;
    const nestedKind = extractString(actionObj, 'kind');
    if (nestedKind) return nestedKind;
  }
  
  // For ObservationEvent, use the nested observation.kind
  if (kind === 'ObservationEvent') {
    const obsObj = typeof event.observation === 'object' ? event.observation as Record<string, unknown> : undefined;
    const nestedKind = extractString(obsObj, 'kind');
    if (nestedKind) return nestedKind;
  }
  
  // For direct events (TerminalAction, etc.), return as-is
  return kind;
}

/**
 * Extract relevant fields from a V1Event based on its kind.
 * 
 * This function examines the event kind and extracts the appropriate fields
 * from either the top-level event object or nested action/observation objects.
 * 
 * IMPORTANT: Field names use snake_case to match OpenHands conventions exactly.
 * This is intentional for client portability - see issue #252.
 * 
 * @param event - The V1Event to extract fields from
 * @returns Object containing only the relevant extracted fields
 */
export function extractEventFields(event: V1Event): ExtractedEventFields {
  const kind = event.kind || '';
  const result: ExtractedEventFields = {};
  
  // Cast event to Record for extraction helpers (V1Event has index signature)
  const eventObj = event as Record<string, unknown>;
  
  // Get nested action/observation objects if present
  const actionObj = typeof event.action === 'object' ? event.action as Record<string, unknown> : undefined;
  const obsObj = typeof event.observation === 'object' ? event.observation as Record<string, unknown> : undefined;
  
  // For wrapped events (ActionEvent, ObservationEvent), prefer nested object fields
  // For direct events (TerminalAction, etc.), use top-level fields
  const isActionEvent = kind === 'ActionEvent';
  const isObservationEvent = kind === 'ObservationEvent';
  
  // Determine the actual action/observation type for wrapped events
  // Real events have action.kind = "TerminalAction" and observation.kind = "TerminalObservation"
  const actionKind = isActionEvent ? extractString(actionObj, 'kind') : undefined;
  const obsKind = isObservationEvent ? extractString(obsObj, 'kind') : undefined;
  
  // === Terminal actions/observations ===
  // Matches: TerminalAction, ExecuteBashAction, CmdRunAction, and their observations
  const isTerminalEvent = TERMINAL_KINDS.has(kind) || 
      (actionKind && TERMINAL_KINDS.has(actionKind)) || 
      (obsKind && TERMINAL_KINDS.has(obsKind));
  if (isTerminalEvent) {
    result.command = extractString(eventObj, 'command') ?? extractString(actionObj, 'command') ?? extractString(obsObj, 'command');
    result.content = extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.exit_code = extractNumber(eventObj, 'exit_code') ?? extractNumber(obsObj, 'exit_code');
    result.timeout = extractBoolean(eventObj, 'timeout') ?? extractBoolean(obsObj, 'timeout');
  }
  
  // === File actions/observations ===
  // Matches: FileReadAction, FileWriteAction, FileEditAction, EditorAction, StrReplaceAction
  const isFileEvent = FILE_KINDS.has(kind) ||
      (actionKind && FILE_KINDS.has(actionKind)) ||
      (obsKind && FILE_KINDS.has(obsKind));
  if (isFileEvent) {
    result.path = extractString(eventObj, 'path') ?? extractString(actionObj, 'path') ?? extractString(obsObj, 'path');
    result.file_text = extractString(eventObj, 'file_text') ?? extractString(actionObj, 'file_text') ?? extractString(obsObj, 'file_text');
    result.old_str = extractString(eventObj, 'old_str') ?? extractString(actionObj, 'old_str');
    result.new_str = extractString(eventObj, 'new_str') ?? extractString(actionObj, 'new_str');
    // FileEditor actions use `command` to indicate the operation
    // (view | create | str_replace | insert). Distinct from the terminal
    // shell command - the client routes by `kind`.
    result.command = result.command ?? extractString(eventObj, 'command') ?? extractString(actionObj, 'command');
    // Priority: terminal content > file content (preserves earlier extraction)
    result.content = result.content ?? extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.error = extractString(eventObj, 'error') ?? extractString(obsObj, 'error');
  }
  
  // === MCP actions/observations ===
  // Matches: MCPAction, MCPObservation, ToolAction, ToolObservation
  const isMCPEvent = MCP_KINDS.has(kind) ||
      (actionKind && MCP_KINDS.has(actionKind)) ||
      (obsKind && MCP_KINDS.has(obsKind));
  if (isMCPEvent) {
    result.tool_name = extractString(eventObj, 'tool_name') ?? extractString(actionObj, 'tool_name') ?? extractString(obsObj, 'tool_name');
    result.data = extractData(eventObj, 'data') ?? extractData(actionObj, 'data');
    // Priority: terminal/file content > MCP content (preserves earlier extraction)
    result.content = result.content ?? extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.is_error = extractBoolean(eventObj, 'is_error') ?? extractBoolean(obsObj, 'is_error');
  }
  
  // === Browser actions ===
  // Matches: BrowserAction, BrowseAction, and specific browser action types
  const isBrowserEvent = BROWSER_KINDS.has(kind) ||
      (actionKind && BROWSER_KINDS.has(actionKind)) ||
      (obsKind && BROWSER_KINDS.has(obsKind));
  if (isBrowserEvent) {
    result.url = extractString(eventObj, 'url') ?? extractString(actionObj, 'url') ?? extractString(obsObj, 'url');
    result.index = extractNumber(eventObj, 'index') ?? extractNumber(actionObj, 'index');
    result.text = extractString(eventObj, 'text') ?? extractString(actionObj, 'text');
    result.direction = extractString(eventObj, 'direction') ?? extractString(actionObj, 'direction');
    result.tab_id = extractString(eventObj, 'tab_id') ?? extractString(actionObj, 'tab_id');
    result.new_tab = extractBoolean(eventObj, 'new_tab') ?? extractBoolean(actionObj, 'new_tab');
    result.include_screenshot = extractBoolean(eventObj, 'include_screenshot') ?? extractBoolean(actionObj, 'include_screenshot');
    result.extract_links = extractBoolean(eventObj, 'extract_links') ?? extractBoolean(actionObj, 'extract_links');
    result.start_from_char = extractNumber(eventObj, 'start_from_char') ?? extractNumber(actionObj, 'start_from_char');
  }
  
  // === Search actions/observations (Grep, Glob) ===
  // Matches: GrepAction, GlobAction, SearchAction and their observations
  const isSearchEvent = SEARCH_KINDS.has(kind) ||
      (actionKind && SEARCH_KINDS.has(actionKind)) ||
      (obsKind && SEARCH_KINDS.has(obsKind));
  if (isSearchEvent) {
    result.pattern = extractString(eventObj, 'pattern') ?? extractString(actionObj, 'pattern') ?? extractString(obsObj, 'pattern');
    result.include = extractString(eventObj, 'include') ?? extractString(actionObj, 'include');
    result.search_path = extractString(eventObj, 'search_path') ?? extractString(obsObj, 'search_path');
    // Priority: file path > search path (preserves earlier extraction)
    result.path = result.path ?? extractString(eventObj, 'path') ?? extractString(actionObj, 'path');
    result.files = extractStringArray(eventObj, 'files') ?? extractStringArray(obsObj, 'files');
    result.matches = extractStringArray(eventObj, 'matches') ?? extractStringArray(obsObj, 'matches');
    // Priority: MCP is_error > search is_error (preserves earlier extraction)
    result.is_error = result.is_error ?? extractBoolean(eventObj, 'is_error') ?? extractBoolean(obsObj, 'is_error');
  }
  
  // === Think actions ===
  // Matches: ThinkAction
  const isThinkEvent = THINK_KINDS.has(kind) ||
      (actionKind && THINK_KINDS.has(actionKind));
  if (isThinkEvent) {
    result.thought = extractString(eventObj, 'thought') ?? extractString(actionObj, 'thought');
  }

  // === Think observations ===
  // Matches: ThinkObservation - just needs content forwarded for rendering
  const isThinkObservation = THINK_OBSERVATION_KINDS.has(kind) ||
      (obsKind && THINK_OBSERVATION_KINDS.has(obsKind));
  if (isThinkObservation) {
    result.content = result.content ?? extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
  }

  // === Invoke skill actions/observations ===
  // Matches: InvokeSkillAction, InvokeSkillObservation
  // Real events have `name` on the action and `skill_name` on the observation.
  const isInvokeSkillEvent = INVOKE_SKILL_KINDS.has(kind) ||
      (actionKind && INVOKE_SKILL_KINDS.has(actionKind)) ||
      (obsKind && INVOKE_SKILL_KINDS.has(obsKind));
  if (isInvokeSkillEvent) {
    result.skill_name = extractString(eventObj, 'name')
      ?? extractString(actionObj, 'name')
      ?? extractString(eventObj, 'skill_name')
      ?? extractString(obsObj, 'skill_name');
    result.content = result.content ?? extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.is_error = result.is_error ?? extractBoolean(eventObj, 'is_error') ?? extractBoolean(obsObj, 'is_error');
  }
  
  // === Finish actions ===
  // Matches: FinishAction
  const isFinishEvent = FINISH_KINDS.has(kind) ||
      (actionKind && FINISH_KINDS.has(actionKind));
  if (isFinishEvent) {
    result.message = extractString(eventObj, 'message') ?? extractString(actionObj, 'message') ?? extractString(actionObj, 'content');
  }
  
  // === Task tracker ===
  // Matches: TaskTrackerAction, TaskTrackerObservation
  const isTaskTrackerEvent = TASK_TRACKER_KINDS.has(kind) ||
      (actionKind && TASK_TRACKER_KINDS.has(actionKind)) ||
      (obsKind && TASK_TRACKER_KINDS.has(obsKind));
  if (isTaskTrackerEvent) {
    // Priority: terminal command > task tracker command (preserves earlier extraction)
    result.command = result.command ?? extractString(eventObj, 'command') ?? extractString(actionObj, 'command') ?? extractString(obsObj, 'command');
    result.task_list = extractTaskList(eventObj, 'task_list') ?? extractTaskList(actionObj, 'task_list') ?? extractTaskList(obsObj, 'task_list');
  }
  
  // === Observation linkage ===
  // Matches: ObservationEvent and all *Observation kinds
  const isObservation = isObservationEvent || OBSERVATION_KINDS.has(kind) ||
      (obsKind && OBSERVATION_KINDS.has(obsKind));
  if (isObservation) {
    result.action_id = extractString(eventObj, 'action_id') ?? extractString(obsObj, 'action_id');
  }
  
  // === Error handling for any observation with is_error flag ===
  if (extractBoolean(obsObj, 'is_error')) {
    result.error = result.error ?? extractString(obsObj, 'content');
    result.content = result.content ?? extractContent(obsObj, 'content');
  }
  
  return result;
}

/** Callback type for thinking state changes */
export type ThinkingChangeCallback = (sessionId: string, isThinking: boolean) => void;

/** Callback type for agent action events */
export type ActionCallback = (sessionId: string, action: AgentAction) => void;

/**
 * Callback type for upstream WebSocket reaching the `OPEN` state (#458).
 *
 * Fires synchronously inside `ws.on('open')` for every successful (re)open
 * of the per-session upstream WS. Lets platform code re-broadcast the
 * unified `session-state` so kiosk indicators flip from `'starting'` to
 * `'ready'` without waiting for the first user message to drive the
 * existing `onThinkingChange` fan-out.
 *
 * Skipped when `AISession.sessionId` is not set (chat-mode bindings keyed
 * only by `conversationId` have no VR session to broadcast to).
 */
export type SessionReadyCallback = (sessionId: string) => void;

/**
 * Callback type for raw agent events arriving on the upstream WebSocket.
 * Fired at the *top* of the WS message handler, before any kind-specific
 * branch, so persistence captures everything that could be broadcast.
 *
 * Errors thrown by the callback are swallowed by the WS handler so they
 * cannot block downstream broadcast logic.
 */
export type EventCallback = (
  sessionId: string,
  conversationId: string,
  rawEvent: RawOpenHandsEvent
) => void;

/**
 * Manager for AI sessions using WebSocket
 */
export class AISessionManager {
  /** Session-centric: VR sessionId → AISession */
  private sessionAI: Map<string, AISession> = new Map();
  private client: OpenHandsClient | null = null;
  /** Callback invoked when AI thinking state changes */
  private onThinkingChange?: ThinkingChangeCallback;
  /** Callback invoked when agent performs an action */
  private onAction?: ActionCallback;
  /** Callback invoked for every raw event on the upstream WS */
  private onEvent?: EventCallback;
  /**
   * Callback invoked when the upstream WebSocket reaches `OPEN` for a
   * VR-keyed session (#458). Fires from `ws.on('open')` in
   * {@link connectWebSocket} so the platform can re-broadcast
   * `session-state` once the binding is actually usable instead of
   * leaving kiosks stuck on the `'starting'` snapshot that `openSession`
   * returned.
   */
  private onSessionReady?: SessionReadyCallback;
  /**
   * Running count of detected `session_api_key` rotations across all sessions,
   * incremented each time {@link refreshSessionCredentials} observes a
   * different key from the cached one. Used as a lightweight metric to
   * confirm whether the #291 fix is actually firing in production.
   */
  private keyRotationCount = 0;
  /**
   * In-flight credential-refresh promises keyed by `conversationId` so two
   * concurrent reconnect attempts for the same session single-flight the
   * GET. The promise self-deletes from the map on settle (success OR error).
   */
  private inFlightRefresh = new Map<string, Promise<void>>();

  /**
   * In-flight rebind promises keyed by `conversationId` so two concurrent
   * `rebindSession` calls for the same conversation (e.g. from rapid WS
   * close events) share a single upstream POST and a single credential
   * update — they don't both pass `checkBudget`, double-count window
   * usage, or race on writes to `session.agentServerUrl` /
   * `session.sessionApiKey`. Same self-delete-on-settle shape as
   * {@link inFlightRefresh}.
   */
  private inFlightRebind = new Map<string, Promise<void>>();

  /**
   * Per-conversation rolling-window tracker for rebind attempts (#296).
   * Prevents thrash when the platform repeatedly hands us short-lived
   * sandboxes — after `MAX_REBINDS_PER_WINDOW` rebinds in a 5-minute
   * window, the next attempt is short-circuited to `degraded` instead.
   *
   * The tracker itself is storage-agnostic. When an
   * {@link aiStateRepository} is wired up (#363) the manager persists
   * the history through {@link recordRebindSuccess} so the budget
   * survives a process restart — without it, the auto-deploy hook
   * resets the 5-min/3-rebind cap on every push.
   */
  private rebindTracker = new RebindWindowTracker();

  /**
   * Durable home for the operational state of every AI session (#363).
   * Optional so test code (and a defensive prod fallback) can omit it
   * — when undefined, the manager silently degrades to in-memory-only,
   * which is the legacy behaviour. Production wires this in
   * `server/src/index.ts` after the SQLite-backed repos are ready.
   */
  private aiStateRepository?: SessionAIStateRepository;

  /**
   * Running total of successful rebinds across all sessions, incremented
   * each time {@link rebindSession} completes a rebind. Exposed for
   * production metrics + #296 acceptance — mirrors `keyRotationCount`.
   */
  private rebindCount = 0;

  /**
   * Per-conversation rolling-window tracker for sandbox-resume attempts
   * (#360). Reuses {@link RebindWindowTracker} (3-in-5-min cap) — a
   * sandbox that pauses + fails-to-resume three times in five minutes is
   * wedged at the platform level, and degrading is the right answer.
   */
  private resumeTracker = new RebindWindowTracker();

  /**
   * Running total of successful sandbox resumes across all sessions,
   * incremented each time the PAUSED branch in
   * {@link doRefreshSessionCredentials} observes a sandbox transition
   * back to RUNNING. Mirrors `keyRotationCount` / `rebindCount` so prod
   * logs can confirm the #360 fix is firing.
   */
  private sandboxResumeCount = 0;

  /**
   * Polling configuration for the PAUSED → RUNNING transition in
   * {@link pollSandboxRunning}. Defaults: 30 s budget, 2 s interval
   * (matches the platform's observed ~19 s STARTING duration documented
   * in `docs/openhands-platform.md` § Verified timings). Tests override
   * via {@link setResumePollOptionsForTesting} to keep the suite fast.
   */
  private resumePollBudgetMs = 30_000;
  private resumePollIntervalMs = 2_000;

  /**
   * Test seam: optional override of the rebind HTTP-orchestration options
   * (sleep/clock/backoff/budget). Production callers leave this `undefined`;
   * the integration tests in `openhands.test.ts` set it to drive backoff
   * deterministically.
   */
  private rebindOptionsForTesting: RebindOptions | undefined;

  /**
   * Memory-replay condense seam (#297). Production currently has no
   * wired condense path — the OH agent-server condense endpoint requires
   * a live sandbox, and the rebind path runs precisely when the sandbox
   * is gone — so this defaults to {@link noopCondense} (always throws,
   * forcing the event-log-derived fallback suffix). Tests inject a real
   * impl to verify the condense-driven prompt is forwarded correctly.
   */
  private condenseImpl: CondenseFn = noopCondense;

  /**
   * Resolver for the agent system prompt at lazy-bind / restart time
   * (issue #378). Default returns the substituted built-in
   * `system-prompt.md`. `index.ts` overrides this with a real resolver
   * (per-session > workspace-default > built-in) once the session and
   * workspace repositories are wired up.
   */
  private systemPromptResolver: SystemPromptResolver = (input) =>
    loadPrompt('system-prompt', input.displayLines, input.workspaceId, input.sessionId);

  /**
   * @param client - Optional pre-built client (test seam only). Production
   * starts client-less; per-workspace clients are derived per session via
   * {@link clientForSession} (issue #403). The env-keyed singleton path
   * was removed in #404 — `setClientForTesting` is the only sanctioned
   * way to install a manager-wide client, and only for tests.
   */
  constructor(client?: OpenHandsClient) {
    if (client !== undefined) {
      this.client = client;
    }
    // No default client. Per-session callers must supply
    // `options.apiKey` (or `options.client` for tests); the manager has
    // no global key after #404.
  }

  /**
   * Inject a per-session system-prompt resolver. Production code wires
   * this in `index.ts` so each agent bind picks up the effective prompt
   * (per-session override > workspace default > built-in) per issue #378.
   *
   * Tests that don't exercise the prompt path can leave this alone — the
   * default resolver returns the built-in prompt with the standard
   * substitutions.
   */
  setSystemPromptResolver(resolver: SystemPromptResolver): void {
    this.systemPromptResolver = resolver;
  }

  /**
   * Inject the durable AI-state repository (issue #363). Once installed,
   * every {@link transitionTo} call writes through to
   * `session_ai_state`, and the manager seeds the in-memory
   * {@link rebindTracker} from any rows that already exist so the
   * per-conversation rebind window survives a restart.
   *
   * Re-callable — last writer wins. The seed pass is idempotent (rows
   * with empty histories are silently dropped from the tracker). Safe
   * to call before any session is opened.
   */
  setAIStateRepository(repo: SessionAIStateRepository | undefined): void {
    this.aiStateRepository = repo;
    if (!repo) return;
    // Seed the rebind tracker from every persisted row. The tracker
    // itself prunes timestamps older than the window, so a row with
    // only-stale entries is a no-op.
    try {
      for (const row of repo.listAll()) {
        if (row.rebindAttempts.length > 0) {
          this.rebindTracker.seedFromHistory(row.conversationId, row.rebindAttempts);
        }
      }
    } catch (err) {
      console.error('[AI] Failed to seed rebind tracker from durable store:', err);
    }
  }

  /**
   * Single chokepoint for AISession state transitions (issue #363).
   *
   * Replaces the dozen-plus scattered `session.degraded = true` /
   * `session.rebinding = true` writes that used to live alongside the
   * reconnect, refresh, and rebind paths in this file. Centralising
   * them means:
   *
   *   1. The in-memory cache and the durable store can never disagree
   *      about a session's lifecycle state.
   *   2. Production logs grep cleanly to a single emitter.
   *   3. The state machine has a single boundary to instrument.
   *
   * Persistence is best-effort: if the repo write throws (DB locked,
   * column drift, etc.) the in-memory cache is still updated and a
   * single error line is logged. The caller's control flow proceeds
   * unchanged — falling over to a permanent "degraded" state because
   * SQLite hiccupped would be worse than re-rehydrating after restart.
   */
  private transitionTo(
    session: AISession,
    state: SessionAIStateName,
    reason: string | null,
  ): void {
    // 1. Update the in-memory cache so live callers (driver, broadcast
    // chain) see the new state immediately.
    session.degraded = state === 'degraded';
    session.degradedReason = state === 'degraded' ? reason : null;
    session.rebinding = state === 'rebinding';

    // 2. Write through to the durable store. Missing repo (test mode
    // or pre-#363 production fallback) → silently in-memory only.
    if (!this.aiStateRepository || !session.sessionId) return;
    try {
      this.aiStateRepository.transitionTo(session.sessionId, state, reason);
    } catch (err) {
      console.error(
        `[AI] state persistence failed for ${session.sessionId} → ${state}:`,
        err,
      );
    }
  }

  /**
   * Initial-row write for a freshly-created (or re-attached)
   * `AISession`. Distinct from {@link transitionTo} because the row
   * may not yet exist — `transitionTo` is an UPDATE; this is the
   * INSERT-or-replace chokepoint.
   */
  private persistInitialState(session: AISession): void {
    if (!this.aiStateRepository || !session.sessionId) return;
    try {
      this.aiStateRepository.upsert({
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        state: 'running',
        stateReason: null,
      });
    } catch (err) {
      console.error(
        `[AI] initial state persistence failed for ${session.sessionId}:`,
        err,
      );
    }
  }

  /**
   * Persist the {@link rebindTracker}'s pruned history for a
   * conversation. Called after every {@link rebindTracker.recordSuccess}
   * so the rolling-window budget survives a restart (issue #363).
   *
   * Best-effort: a DB write failure logs and continues. The in-memory
   * tracker already counts the success, so the budget is at worst
   * reset on the next restart.
   */
  private persistRebindAttempts(session: AISession): void {
    if (!this.aiStateRepository || !session.sessionId) return;
    try {
      const attempts = this.rebindTracker.getHistory(session.conversationId);
      this.aiStateRepository.setRebindAttempts(session.sessionId, attempts);
    } catch (err) {
      console.error(
        `[AI] rebind-attempts persistence failed for ${session.sessionId}:`,
        err,
      );
    }
  }

  /**
   * Test seam: replace the underlying OH HTTP client. Production code paths
   * inject via the constructor; this method exists so existing tests that
   * construct the manager with no args can still install a fake afterwards.
   */
  setClientForTesting(client: OpenHandsClient | null): void {
    this.client = client;
  }

  /**
   * Returns a workspace-scoped OpenHandsClient for the session's API key.
   * Falls back to a test-installed client if the session has no cached key
   * (only possible in tests that use `setClientForTesting`). Re-derived
   * per call; key rotation is honored at the next attach (#403). The env
   * fallback was removed in #404 — production sessions must carry an
   * `apiKey` (plumbed in #406).
   */
  private clientForSession(session: AISession): OpenHandsClient | null {
    if (session.apiKey) {
      return new OpenHandsClient(session.apiKey);
    }
    // Test seam only: when `setClientForTesting` installed a manager-wide
    // client, sessions without an apiKey reuse it. Production never hits
    // this branch because per-session apiKeys are required (#404).
    return this.client;
  }

  /**
   * Number of times the reconnect refresh has observed a rotated
   * `session_api_key` (i.e. fresh != cached). Exposed so platform metrics
   * and tests can assert on the counter. See #291.
   */
  getKeyRotationCount(): number {
    return this.keyRotationCount;
  }

  /**
   * Number of successful rebinds performed for any session across the
   * lifetime of this manager. Exposed for #296 metrics + tests so we can
   * confirm rebind actually fires in production logs.
   */
  getRebindCount(): number {
    return this.rebindCount;
  }

  /**
   * Number of successful PAUSED → RUNNING sandbox resumes performed for
   * any session across the lifetime of this manager. Exposed for #360
   * metrics + tests so prod logs can confirm the fix is firing.
   */
  getSandboxResumeCount(): number {
    return this.sandboxResumeCount;
  }

  /**
   * Test seam: install rebind-time injection options (fake sleep/clock/etc.)
   * The rebind window tracker is left in place — production semantics —
   * but the HTTP backoff timing becomes deterministic.
   */
  setRebindOptionsForTesting(opts: RebindOptions | undefined): void {
    this.rebindOptionsForTesting = opts;
  }

  /**
   * Test seam: override the PAUSED → RUNNING polling budget/interval so
   * unit tests can drive {@link pollSandboxRunning} without waiting on
   * real-time delays. Pass `undefined` (or omit the field) to restore the
   * production defaults (30 s budget, 2 s interval).
   */
  setResumePollOptionsForTesting(
    opts: { budgetMs?: number; intervalMs?: number } | undefined,
  ): void {
    this.resumePollBudgetMs = opts?.budgetMs ?? 30_000;
    this.resumePollIntervalMs = opts?.intervalMs ?? 2_000;
  }

  /**
   * Test seam: replace the per-conversation resume window tracker so
   * tests can pre-seed it (e.g. with three successes in the last 5 min)
   * to exercise the {@link SandboxResumeBudgetExhausted} branch without
   * having to actually drive three full PAUSED → RUNNING transitions.
   */
  setResumeTrackerForTesting(tracker: RebindWindowTracker): void {
    this.resumeTracker = tracker;
  }

  /**
   * Test seam: install a memory-replay condense impl (#297). Pass
   * `undefined` to restore the production no-op default.
   */
  setCondenseImplForTesting(impl: CondenseFn | undefined): void {
    this.condenseImpl = impl ?? noopCondense;
  }

  /**
   * Refresh the cached `session_api_key` and `agent_server_url` for `session`
   * by re-reading the conversation from the OpenHands app server. Used by
   * the reconnect loop so a paused-then-resumed sandbox (which rotates the
   * key, per docs/openhands-platform.md § Identity and keys) reconnects with
   * fresh credentials rather than the stale ones we cached at session start.
   *
   * Behavior:
   * - Returns when the cache has been updated (rotated or not).
   * - Throws {@link SandboxMissingError} if the conversation is gone or
   *   `sandbox_status === 'MISSING'` — the driver should transition to
   *   `degraded` rather than retry forever (#296 will handle rebind).
   * - Retries transient (`OpenHandsApiError.transient`) HTTP errors with
   *   exponential backoff up to `maxRetries` times before propagating.
   * - Concurrent calls for the same `conversationId` share a single
   *   in-flight promise (single-flight).
   */
  async refreshSessionCredentials(
    session: AISession,
    maxRetries: number = 3,
  ): Promise<void> {
    const key = session.conversationId;
    const existing = this.inFlightRefresh.get(key);
    if (existing) return existing;

    const work = this.doRefreshSessionCredentials(session, maxRetries).finally(() => {
      this.inFlightRefresh.delete(key);
    });
    this.inFlightRefresh.set(key, work);
    return work;
  }

  private async doRefreshSessionCredentials(
    session: AISession,
    maxRetries: number,
  ): Promise<void> {
    const client = this.clientForSession(session); // #403: honor workspace key
    if (!client) {
      // No client means we can't refresh; surface as MISSING so the
      // reconnect loop stops rather than tight-looping with stale creds.
      throw new SandboxMissingError(session.conversationId);
    }

    let lastTransientError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const fresh = await client.getConversation(session.conversationId);
        if (!fresh || fresh.sandbox_status === 'MISSING') {
          throw new SandboxMissingError(session.conversationId);
        }
        // PAUSED branch (#360): the upstream platform pauses idle sandboxes
        // after a short window. PAUSED conversations come back with
        // `session_api_key: null` and `conversation_url: null`. We must
        // explicitly resume them — falling through to the `!session_api_key`
        // check below would surface SandboxMissingError, route into
        // rebindSession, and lose the in-memory agent state. Resume is
        // dramatically cheaper than rebind and preserves agent memory.
        if (fresh.sandbox_status === 'PAUSED') {
          if (!fresh.sandbox_id) {
            // PAUSED with no sandbox_id is a contract violation; treat as
            // MISSING and let the rebind path try.
            throw new SandboxMissingError(session.conversationId);
          }
          // Cap resume thrash to 3-in-5-min per conversation. Beyond that
          // the sandbox is wedged at the platform layer; degrade rather
          // than spinning. Distinct error class so reconnectWithRefresh
          // can degrade with a clear reason instead of falling through to
          // rebind (which wouldn't help — sandbox is paused, not missing).
          try {
            this.resumeTracker.checkBudget(session.conversationId);
          } catch (e) {
            if (e instanceof RebindBudgetExhausted) {
              throw new SandboxResumeBudgetExhausted(
                session.conversationId,
                e.attempts,
              );
            }
            throw e;
          }
          try {
            await client.resumeSandbox(fresh.sandbox_id);
          } catch (e) {
            // 404 → sandbox is genuinely gone, not paused. Hand off to the
            // rebind path via SandboxMissingError.
            if (e instanceof OpenHandsApiError && e.status === 404) {
              throw new SandboxMissingError(session.conversationId);
            }
            throw e;
          }
          const resumed = await this.pollSandboxRunning(session.conversationId, client);
          this.resumeTracker.recordSuccess(session.conversationId);
          this.sandboxResumeCount++;
          console.log(
            `[AI] sandbox resumed for conversation ${session.conversationId} ` +
              `(resume count: ${this.sandboxResumeCount})`,
          );
          this.applyFreshCreds(session, resumed);
          return;
        }
        if (!fresh.session_api_key) {
          // Treat absence of a fresh key the same as MISSING — we cannot
          // construct a valid WS URL without it.
          throw new SandboxMissingError(session.conversationId);
        }
        this.applyFreshCreds(session, fresh);
        return;
      } catch (err) {
        // Issue #364: log every upstream failure with structured fields
        // BEFORE remapping into the manager-internal error classes
        // (SandboxMissingError / UpstreamCredentialsLostError /…) below.
        // Doing this here means the original status + body excerpt make
        // it into the journal even when the wrapper class drops them.
        // Skip purely-transient retries so 5xx flapping doesn't spam the
        // journal — only log on the last retry.
        if (
          err instanceof SandboxMissingError ||
          err instanceof SandboxResumeTimeoutError ||
          err instanceof SandboxResumeBudgetExhausted ||
          !(err instanceof OpenHandsApiError) ||
          !err.transient ||
          attempt === maxRetries
        ) {
          logUpstreamFailure('refresh', {
            err,
            sessionId: session.sessionId,
            conversationId: session.conversationId,
            attempt,
            maxAttempts: maxRetries,
            endpoint: 'GET /api/v1/app-conversations',
          });
        }
        if (
          err instanceof SandboxMissingError ||
          err instanceof SandboxResumeTimeoutError ||
          err instanceof SandboxResumeBudgetExhausted
        ) {
          throw err;
        }
        // 401 NoCredentialsError → upstream has rotated/forgotten our
        // session_api_key. Surface a distinct error class so the reconnect
        // path can route this through rebindSession (same as MISSING). The
        // discriminator is strict (status + body substring) so generic 401s
        // (InvalidApiKeyError, plain Unauthorized) still fall through to
        // the degrade branch. See #350.
        if (
          err instanceof OpenHandsApiError &&
          err.status === 401 &&
          err.message.includes('NoCredentialsError')
        ) {
          throw new UpstreamCredentialsLostError(session.conversationId);
        }
        const transient = err instanceof OpenHandsApiError && err.transient;
        if (!transient || attempt === maxRetries) {
          throw err;
        }
        lastTransientError = err;
        const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    // Unreachable: loop body either returns or throws. Kept for type completeness.
    throw lastTransientError ?? new Error('refresh failed without recorded error');
  }

  /**
   * Apply the credentials from a fresh `ConversationInfo` to `session`,
   * validating the conversation URL shape and bumping
   * {@link keyRotationCount} on rotation. Throws
   * {@link SandboxMissingError} if the URL is missing/invalid (callers
   * may also throw SandboxMissingError up-stack on `!session_api_key`).
   *
   * Extracted from the body of {@link doRefreshSessionCredentials} so the
   * PAUSED-resume branch (#360) and the normal branch share the same
   * URL-shape validation and rotation-count bookkeeping.
   */
  private applyFreshCreds(session: AISession, fresh: ConversationInfo): void {
    if (!fresh.session_api_key) {
      throw new SandboxMissingError(session.conversationId);
    }
    // Strip any trailing /api/... path to recover the bare agent-server
    // origin. Using replace() with an anchored regex is more defensive than
    // split('/api/')[0] for unexpected URL shapes; URL.canParse rejects a
    // malformed result before we hand it to the WS layer.
    const freshUrl = fresh.conversation_url?.replace(/\/api\/.*$/, '') || '';
    if (!freshUrl || !URL.canParse(freshUrl)) {
      throw new SandboxMissingError(session.conversationId);
    }

    const previousKey = session.sessionApiKey;
    const rotated = previousKey !== undefined && previousKey !== fresh.session_api_key;
    session.sessionApiKey = fresh.session_api_key;
    session.agentServerUrl = freshUrl;

    if (rotated) {
      this.keyRotationCount++;
      console.log(
        `[AI] session_api_key rotation detected for conversation ${session.conversationId} ` +
          `(rotation count: ${this.keyRotationCount})`,
      );
    }
  }

  /**
   * Poll `getConversation` until the sandbox reports `RUNNING` with a
   * truthy `session_api_key`, or until the budget expires. Used by the
   * PAUSED branch in {@link doRefreshSessionCredentials} to detect when
   * the upstream resume has completed.
   *
   * Throws:
   * - {@link SandboxMissingError} if the conversation disappears mid-poll
   *   (returns null or `sandbox_status === 'MISSING'`).
   * - {@link SandboxResumeTimeoutError} if the budget expires before the
   *   sandbox reaches RUNNING with a fresh key.
   *
   * Polling cadence matches the platform's observed PAUSED → RUNNING
   * timing (~19 s typical, most of it in STARTING; see
   * `docs/openhands-platform.md` § Verified timings).
   */
  private async pollSandboxRunning(
    conversationId: string,
    client?: OpenHandsClient | null,
    options: {
      /**
       * Invoked with each transient {@link OpenHandsApiError} swallowed
       * by the poll loop. Used by the attach path (#405) to remember
       * the most recent upstream error so a downstream
       * "missing WS handshake materials" classification can name the
       * cause (e.g. an intervening `401 NoCredentialsError`).
       */
      onTransientError?: (err: OpenHandsApiError) => void;
    } = {},
  ): Promise<ConversationInfo> {
    const effectiveClient = client ?? this.client; // #403: use workspace client when provided
    if (!effectiveClient) throw new SandboxMissingError(conversationId);
    const deadline = Date.now() + this.resumePollBudgetMs;
    while (Date.now() < deadline) {
      // Check first, then sleep — avoids an unnecessary `resumePollIntervalMs`
      // delay on the happy path where the sandbox has already reached RUNNING
      // (e.g. resume was synchronous or the poll caught it on the first hit).
      let info: ConversationInfo | null;
      let transient = false;
      try {
        info = await effectiveClient.getConversation(conversationId);
      } catch (e) {
        // Transient HTTP failures during the poll are treated as "not ready
        // yet" — wait then keep polling until the budget expires.
        // Non-transient errors propagate.
        if (e instanceof OpenHandsApiError && e.transient) {
          info = null;
          transient = true;
          options.onTransientError?.(e);
        } else {
          throw e;
        }
      }
      if (!transient) {
        if (!info) throw new SandboxMissingError(conversationId);
        if (info.sandbox_status === 'MISSING') {
          throw new SandboxMissingError(conversationId);
        }
        if (info.sandbox_status === 'RUNNING' && info.session_api_key) {
          return info;
        }
        // STARTING / PAUSED / undefined → wait then keep polling.
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const waitMs = Math.min(this.resumePollIntervalMs, remaining);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    throw new SandboxResumeTimeoutError(conversationId);
  }

  /**
   * Set callback for thinking state changes
   * Used by the server to broadcast ai-thinking messages
   */
  setThinkingChangeCallback(callback: ThinkingChangeCallback | undefined): void {
    this.onThinkingChange = callback;
  }

  /**
   * Set callback for agent action events
   * Used by the server to broadcast agent-action messages
   */
  setActionCallback(callback: ActionCallback | undefined): void {
    this.onAction = callback;
  }

  /**
   * Set callback for upstream WebSocket reaching `OPEN` (#458).
   *
   * The {@link OpenHandsAgentDriver} adapter installs the sole subscriber
   * here and fan-outs to platform listeners; platform code subscribes
   * via `onAgentSessionReady` rather than calling this directly. Setter
   * pattern mirrors {@link setThinkingChangeCallback}.
   */
  setSessionReadyCallback(callback: SessionReadyCallback | undefined): void {
    this.onSessionReady = callback;
  }

  /**
   * Set callback fired for *every* raw event arriving on the upstream WS,
   * before any kind-specific dispatch. Callers are expected to handle their
   * own errors — see {@link EventCallback}.
   */
  setEventCallback(callback: EventCallback | undefined): void {
    this.onEvent = callback;
  }

  /** Expose current event callback (for tests). */
  getEventCallback(): EventCallback | undefined {
    return this.onEvent;
  }

  // ==================== Session-Centric Methods (NEW) ====================

  /**
   * Check if a VR session has an active AI session
   */
  hasSessionAI(sessionId: string): boolean {
    return this.sessionAI.has(sessionId);
  }

  /**
   * Get the AI session for a VR session
   */
  getSessionAI(sessionId: string): AISession | undefined {
    return this.sessionAI.get(sessionId);
  }

  /**
   * Get or create an AI session for a VR session
   * @param sessionId - VR session ID
   * @param workspaceId - Workspace ID for context
   * @param onMessage - Callback for agent responses
   * @param options - Optional configuration
   */
  async getOrCreateForSession(
    sessionId: string,
    workspaceId: string,
    onMessage: (message: string, serverTimestamp?: string) => void,
    options: {
      displayLines?: number;
      apiKey?: string;
      displayApiSecret?: string;
      /**
       * If set, attach to this existing OpenHands conversation instead of
       * creating a new one. Used by the startup rehydration / post-restart
       * auto-connect paths (issue #341). Throws
       * {@link UpstreamConversationEndedError} if the conversation can no
       * longer be looked up or its WS handshake materials are missing.
       */
      existingConversationId?: string;
    } = {}
  ): Promise<AISession> {
    // Return existing if available
    const existing = this.sessionAI.get(sessionId);
    if (existing) {
      console.log(`[AI] Returning existing session AI for session ${sessionId}`);
      return existing;
    }

    // Create new AI session. After #404 the workspace-scoped `apiKey` is
    // required; the env-keyed singleton fallback is gone. Tests that
    // installed a manager-wide client via `setClientForTesting` may still
    // omit `options.apiKey`. Whitespace-only keys are treated as missing
    // (pr-review on #404) so they hit the typed `#404` error below
    // instead of constructing a doomed client.
    const client = options.apiKey?.trim() ? new OpenHandsClient(options.apiKey) : this.client;
    if (!client) {
      throw new Error(
        'OpenHands API not configured: workspace API key required (#404).',
      );
    }

    // Attach-to-existing path (issue #341). Skip `startConversation` and go
    // straight to fetching the existing conversation's WS handshake
    // materials. A missing conversation, or a record without
    // `conversation_url` / `session_api_key`, is treated as
    // "upstream-ended" — the caller surfaces a `degraded` session-state
    // to the kiosk so the user knows to restart.
    if (options.existingConversationId) {
      return this.attachExistingForSession(
        sessionId,
        workspaceId,
        options.existingConversationId,
        onMessage,
        { client, apiKey: options.apiKey },
      );
    }

    console.log(`[AI] Creating new session AI for session ${sessionId}${options.displayLines ? ` (${options.displayLines} display lines)` : ''}`);

    // Resolve the effective system prompt (issue #378). The injected
    // resolver layers per-session > workspace-default > built-in; the
    // default factory uses the built-in prompt directly so tests that
    // don't wire a resolver still work.
    const systemPrompt = this.systemPromptResolver({
      sessionId,
      workspaceId,
      displayLines: options.displayLines,
    });
    console.log(`[AI] Loaded system prompt (${systemPrompt.length} chars)`);

    // Build secrets map
    const secrets: Record<string, string> = {};
    if (options.displayApiSecret) {
      secrets['DISPLAY_API_SECRET'] = options.displayApiSecret;
    }

    // Start conversation
    console.log(`[AI] Creating OpenHands conversation for session ${sessionId}...`);
    const startResponse = await client.startConversation(
      systemPrompt,
      `Voice Relay session: ${sessionId}`,
      Object.keys(secrets).length > 0 ? secrets : undefined
    );
    console.log(`[AI] Conversation started, task id: ${startResponse.id}`);

    // Wait for conversation to be ready
    console.log(`[AI] Waiting for conversation to be ready...`);
    const readyTask = await client.pollUntilReady(
      startResponse.id,
      120000,
      2000
    );
    console.log(`[AI] Conversation ready:`, readyTask);

    const conversationId = readyTask.app_conversation_id || startResponse.id;
    console.log(`[AI] Using conversation ID: ${conversationId}`);

    // Get conversation details for WebSocket connection
    const convInfo = await client.getConversation(conversationId);
    if (!convInfo) {
      throw new Error('Failed to get conversation info');
    }

    const agentServerUrl = convInfo.conversation_url?.split('/api/')[0];
    if (!agentServerUrl || !convInfo.session_api_key) {
      // Classify and throw with typed reason so callers can propagate to degraded broadcast.
      const reason = explainMissingHandshake(convInfo);
      throw new UpstreamConversationEndedError(
        conversationId,
        formatMissingHandshakeMessage(conversationId, reason),
        reason,
      );
    }

    console.log(`[AI] Agent server: ${agentServerUrl}`);

    const session: AISession = {
      conversationId,
      taskId: startResponse.id,
      sessionId,  // Key by session, not device
      // Capture workspace context for refresh/rebind client resolution (#403)
      workspaceId,
      apiKey: options.apiKey,
      mode: 'kiosk',
      agentServerUrl,
      sessionApiKey: convInfo.session_api_key,
      onMessage,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      // Issue #375: fresh per-conversation speaker / time anchor state.
      headerState: makeVoiceRelayHeaderState(),
    };

    this.sessionAI.set(sessionId, session);
    // Initial durable row at lifecycle state `running` (#363). After
    // this point every state change flows through {@link transitionTo}.
    this.persistInitialState(session);

    // Connect WebSocket
    this.connectWebSocket(session);

    console.log(`[AI] Session AI started successfully for session ${sessionId}`);
    return session;
  }

  /**
   * Attach a VR session to a *pre-existing* OpenHands conversation, skipping
   * the `POST /app-conversations` create step.
   *
   * Used by the startup rehydration pass (issue #341) and the post-restart
   * `shouldAutoConnect` safety net to recover the live binding for a
   * conversation whose id has been persisted to
   * `session.metadata.aiConversationId`. The on-server event log is
   * preserved, so this restores typing / replies seamlessly when the OH
   * conversation is still alive.
   *
   * Throws {@link UpstreamConversationEndedError} if the lookup returns no
   * record or the record is missing the WS handshake materials. The caller
   * is expected to catch this and broadcast a `degraded` `session-state`.
   *
   * Idempotent: a second call for the same `sessionId` returns the existing
   * binding.
   */
  async attachExistingForSession(
    sessionId: string,
    workspaceId: string,
    conversationId: string,
    onMessage: (message: string, serverTimestamp?: string) => void,
    options: {
      /** Workspace-scoped OpenHandsClient; see clientForSession (#403). */
      client?: OpenHandsClient;
      /** Per-workspace API key to cache on the AISession (#403). */
      apiKey?: string;
    } = {},
  ): Promise<AISession> {
    const existing = this.sessionAI.get(sessionId);
    if (existing) {
      console.log(`[AI] Returning existing session AI for session ${sessionId} (attach)`);
      return existing;
    }

    // After #404, the caller is expected to supply a workspace-scoped
    // client (`options.client`). The `this.client` fallback only fires
    // when a test installed one via `setClientForTesting`.
    const client = options.client ?? this.client;
    if (!client) {
      throw new Error(
        'OpenHands API not configured: workspace API key required (#404).',
      );
    }

    console.log(
      `[AI] Attaching session ${sessionId} (workspace ${workspaceId}) to existing conversation ${conversationId}`,
    );

    // Look up the conversation. A 404/null means the upstream conversation
    // is no longer reachable; surface as `UpstreamConversationEndedError`
    // so the caller can drive the degraded `session-state` broadcast.
    let convInfo;
    try {
      convInfo = await client.getConversation(conversationId);
    } catch (err) {
      // Issue #364: emit a structured failure log before the error is
      // remapped to `UpstreamConversationEndedError` (which drops the
      // raw upstream status/body). Operators need the original
      // status/body to triage 401 vs 404 vs network errors here.
      logUpstreamFailure('attach', {
        err,
        sessionId,
        conversationId,
        endpoint: 'GET /api/v1/app-conversations',
      });
      const message = err instanceof Error ? err.message : String(err);
      throw new UpstreamConversationEndedError(
        conversationId,
        `Failed to look up conversation ${conversationId}: ${message}`,
      );
    }
    if (!convInfo) {
      throw new UpstreamConversationEndedError(conversationId);
    }

    // PAUSED branch (#370): mirror the recovery added to
    // {@link doRefreshSessionCredentials} (#360) so the startup
    // rehydration path and the device-register auto-attach path also
    // self-heal when the upstream sandbox has paused. Without this, a
    // server restart (or kiosk reload) after a sandbox pause-window
    // permanently degrades the session even though resume is trivial.
    //
    // We reuse the existing helpers — `resumeSandbox`, the
    // `resumeTracker` budget guard, `pollSandboxRunning`, and the
    // `sandboxResumeCount` metric — to keep both branches in lockstep.
    // Unlike the refresh path we re-assign `convInfo` to the polled
    // `ConversationInfo` and let the agent-server / session-key derivation
    // below pick up the fresh values (attach *constructs* an `AISession`;
    // it doesn't mutate one, so `applyFreshCreds` isn't the right tool).
    //
    // `lastPollError` (issue #405) captures the most recent transient
    // upstream error observed during `pollSandboxRunning` (if any), so
    // the post-poll WS-handshake check below can classify an
    // intervening `401 NoCredentialsError` as `auth-rejected` rather
    // than `unknown`.
    let lastPollError: OpenHandsApiError | undefined;
    if (convInfo.sandbox_status === 'PAUSED') {
      if (!convInfo.sandbox_id) {
        // PAUSED with no sandbox_id is a platform contract violation;
        // we can't resume without an id. Surface as ended so the caller
        // drives the `degraded` broadcast.
        throw new UpstreamConversationEndedError(
          conversationId,
          `Conversation ${conversationId} is PAUSED with no sandbox_id`,
        );
      }
      try {
        this.resumeTracker.checkBudget(conversationId);
      } catch (e) {
        if (e instanceof RebindBudgetExhausted) {
          throw new SandboxResumeBudgetExhausted(conversationId, e.attempts);
        }
        throw e;
      }
      try {
        await client.resumeSandbox(convInfo.sandbox_id);
      } catch (e) {
        // 404 → sandbox is genuinely gone, not paused. The attach path
        // has no rebind fallback (it's keyed on a specific upstream
        // conversation id), so surface as ended.
        if (e instanceof OpenHandsApiError && e.status === 404) {
          throw new UpstreamConversationEndedError(
            conversationId,
            `Conversation ${conversationId}: sandbox not found on resume`,
          );
        }
        throw e;
      }
      try {
        convInfo = await this.pollSandboxRunning(conversationId, client, {
          onTransientError: (err) => {
            // Capture for post-poll handshake classification.
            lastPollError = err;
          },
        });
      } catch (e) {
        // A mid-poll MISSING (the sandbox vanished while we were
        // polling) is surfaced as ended so the caller drives degraded.
        // SandboxResumeTimeoutError is left as-is so operators can
        // distinguish a wedged platform from a missing sandbox in logs;
        // both `agent-rehydrate.ts` and `auto-connect.ts` catch
        // generically and surface `degraded`.
        if (e instanceof SandboxMissingError) {
          throw new UpstreamConversationEndedError(
            conversationId,
            `Conversation ${conversationId}: sandbox MISSING after resume`,
          );
        }
        throw e;
      }
      this.resumeTracker.recordSuccess(conversationId);
      this.sandboxResumeCount++;
      console.log(
        `[AI] sandbox resumed for conversation ${conversationId} ` +
          `(attach) (resume count: ${this.sandboxResumeCount})`,
      );
    }

    const agentServerUrl = convInfo.conversation_url?.split('/api/')[0];
    if (!agentServerUrl || !convInfo.session_api_key) {
      // Classify so the journal and `degraded` broadcast name the cause.
      const reason = explainMissingHandshake(convInfo, lastPollError);
      throw new UpstreamConversationEndedError(
        conversationId,
        formatMissingHandshakeMessage(conversationId, reason),
        reason,
      );
    }

    console.log(`[AI] (attach) Agent server: ${agentServerUrl}`);

    const session: AISession = {
      conversationId,
      // We don't have the original task id post-restart; the conversation
      // id is the durable identifier upstream cares about for the WS
      // handshake. `taskId` is only used as a debugging breadcrumb in the
      // create path; reuse the conversation id for the attach case.
      taskId: conversationId,
      sessionId,
      // Cache workspace context for refresh/rebind (#403)
      workspaceId,
      apiKey: options.apiKey,
      mode: 'kiosk',
      agentServerUrl,
      sessionApiKey: convInfo.session_api_key,
      onMessage,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      // Issue #375: attach onto an existing conversation also starts with
      // empty alias / time state. The upstream agent has its own context
      // (system message suffix etc.); we re-emit announcements as the
      // first turn from each device after the attach completes.
      headerState: makeVoiceRelayHeaderState(),
    };

    this.sessionAI.set(sessionId, session);
    // Initial durable row at lifecycle state `running` (#363). The
    // attach path may overwrite an existing row carrying a stale
    // `degraded` reason — that's intentional: a fresh attach has
    // succeeded, so the new running row reflects current reality.
    this.persistInitialState(session);

    // Open the WS against the existing conversation. The existing reconnect
    // loop will handle transient handshake failures; an unrecoverable
    // handshake failure surfaces through the normal `degraded` path.
    this.connectWebSocket(session);

    console.log(`[AI] Session AI re-attached for session ${sessionId} → conversation ${conversationId}`);
    return session;
  }

  /**
   * Send a message to the AI for a VR session.
   *
   * When `sender` is supplied, a token-efficient `[vr ...]` / `[t=...]`
   * header is prepended to the message so the agent can attribute the
   * speaker and reason about timing (issue #375). The header may be
   * empty for typical chatty single-device runs.
   */
  async sendSessionMessage(
    sessionId: string,
    message: string,
    sender?: AgentSenderMeta,
  ): Promise<void> {
    const session = this.sessionAI.get(sessionId);
    if (!session) {
      throw new Error('No active AI session for this VR session');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Track thinking state
    session.isThinking = true;
    session.lastMessageSentAt = Date.now();

    // Notify via callback
    if (this.onThinkingChange && session.sessionId) {
      this.onThinkingChange(session.sessionId, true);
    }

    // Compose the per-turn metadata header (issue #375). Side-effects on
    // `session.headerState` advance the speaker / time anchor. The state
    // is lazy-initialised so tests that hand-roll an `AISession` without
    // it still send messages.
    let header = '';
    if (sender) {
      if (!session.headerState) session.headerState = makeVoiceRelayHeaderState();
      header = buildVoiceRelayHeader(session.headerState, sender);
    }
    const wireMessage = header ? `${header}\n${message}` : message;

    console.log(`[AI] Sending session message via WebSocket: "${wireMessage.substring(0, 50)}..."`);

    session.ws.send(JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text: wireMessage }],
      run: true,
    }));
  }

  /**
   * End the AI session for a VR session
   */
  async endSessionAI(sessionId: string): Promise<void> {
    const session = this.sessionAI.get(sessionId);
    if (!session) return;

    console.log(`[AI] Ending session AI for session ${sessionId}`);

    if (session.ws) {
      session.ws.close();
      session.ws = undefined;
    }

    this.sessionAI.delete(sessionId);
    // Drop the durable row too (#363). A subsequent rehydrate pass
    // must not pick this session back up — endSessionAI is invoked
    // both on user-initiated restart and process shutdown, and in
    // either case the session has no live binding to recover.
    if (this.aiStateRepository) {
      try {
        this.aiStateRepository.deleteBySessionId(sessionId);
      } catch (err) {
        console.error(`[AI] state row delete failed for ${sessionId}:`, err);
      }
    }
  }

  /**
   * V1 type guard for MessageEvent
   */
  private isV1MessageEvent(event: unknown): event is V1MessageEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'llm_message' in event &&
      typeof (event as V1MessageEvent).llm_message === 'object' &&
      (event as V1MessageEvent).llm_message !== null &&
      'role' in (event as V1MessageEvent).llm_message &&
      'content' in (event as V1MessageEvent).llm_message
    );
  }

  /**
   * V1 type guard for ConversationStateUpdateEvent
   */
  private isV1ConversationStateUpdateEvent(event: unknown): event is V1ConversationStateUpdateEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'kind' in event &&
      (event as V1ConversationStateUpdateEvent).kind === 'ConversationStateUpdateEvent'
    );
  }

  /**
   * Connect WebSocket to agent server (V1 API)
   * Authentication is done via query parameters, not a separate auth message
   * @param session - The AI session to connect
   */
  private connectWebSocket(session: AISession): void {
    if (!session.agentServerUrl || !session.sessionApiKey) {
      console.error('[AI] Missing agent server URL or session API key');
      return;
    }

    const wsUrl = session.agentServerUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    // V1 WebSocket authentication via query parameters
    const queryParams = new URLSearchParams({
      session_api_key: session.sessionApiKey,
      resend_all: 'true',  // Request all events on connect
    });
    const fullUrl = `${wsUrl}/sockets/events/${session.conversationId}?${queryParams.toString()}`;
    console.log(`[AI] Connecting V1 WebSocket to ${fullUrl.replace(session.sessionApiKey, '***')}`);

    const ws = new WebSocket(fullUrl);
    session.ws = ws;

    ws.on('open', () => {
      console.log('[AI] V1 WebSocket connected (auth via query params)');
      session.reconnectAttempts = 0;
      // #458: notify platform listeners that this VR-keyed session's
      // upstream WS is now usable so they can re-broadcast
      // `session-state` (which flips kiosks from 'starting' → 'ready').
      // Chat-mode bindings keyed only by `conversationId` (no VR
      // sessionId) are skipped — there is no VR session to broadcast
      // to. Fires on every successful (re)open; reconnects re-emit the
      // same `'ready'` snapshot which the client reducer treats as a
      // no-op for unchanged status.
      if (this.onSessionReady && session.sessionId) {
        try {
          this.onSessionReady(session.sessionId);
        } catch (err) {
          console.error('[AI] onSessionReady callback threw:', err);
        }
      }
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());

        // Persist EVERY raw event before any kind-specific dispatch so live
        // ingest captures the full stream. Errors are swallowed here so
        // persistence failures (e.g. DB locked) never block broadcast.
        if (this.onEvent && session.sessionId) {
          try {
            this.onEvent(
              session.sessionId,
              session.conversationId,
              event as RawOpenHandsEvent
            );
          } catch (persistErr) {
            console.error('[AI] Event persistence callback threw:', persistErr);
          }
        }

        // V1 MessageEvent - agent messages have llm_message with role/content
        if (this.isV1MessageEvent(event) && event.source === 'agent') {
          // Update thinking state when agent responds
          if (session.isThinking) {
            session.isThinking = false;
            session.pendingMessageId = undefined;
            
            // Notify via callback for session-centric sessions
            if (this.onThinkingChange && session.sessionId) {
              this.onThinkingChange(session.sessionId, false);
            }
          }

          const text = event.llm_message?.content
            ?.filter((p: ContentPart) => p.type === 'text')
            ?.map((p: ContentPart) => p.text)
            ?.join('\n');

          if (text && session.onMessage) {
            console.log(`[AI] Got agent response: "${text.substring(0, 100)}..."`);
            // Normalize OH's naive UTC timestamp before forwarding (issue #264).
            // Without this, downstream consumers parsing the string with
            // `new Date()` interpret it as local time in non-UTC browsers.
            const serverTimestamp = normalizeOhTimestamp(event.timestamp);
            session.onMessage(text, serverTimestamp);
          }
        } 
        // V1 ConversationStateUpdateEvent - status updates
        else if (this.isV1ConversationStateUpdateEvent(event)) {
          if (event.key === 'execution_status' && event.value?.execution_status) {
            console.log(`[AI] Execution status: ${event.value.execution_status}`);
          } else if (event.key === 'full_state') {
            console.log(`[AI] Full state update received`);
          }
        }
        // V1 ConversationErrorEvent or ServerErrorEvent
        else if (event.kind === 'ConversationErrorEvent' || event.kind === 'ServerErrorEvent') {
          console.error(`[AI] Error event: ${event.message || event.error || 'Unknown error'}`);
        }
        // Forward other events as agent actions for visibility
        else if (event.kind) {
          // Drop event classes that should never appear in the kiosk inline
          // timeline (issues #265, #280). The same predicate is mirrored on
          // the refresh path (`server/src/agent-events/router.ts` +
          // `client/src/utils/normalizeAgentEvent.ts::shouldShowInKioskTimeline`)
          // so live and refresh produce element-wise-equal timelines. See the
          // `shouldSkipForKioskTimeline` JSDoc for the full skip list. Agent
          // `MessageEvent`s never reach this point — they're handled above by
          // the `isV1MessageEvent` branch and routed to the utterance bubble
          // stream.
          if (shouldSkipForKioskTimeline(event)) {
            return;
          }

          console.log(`[AI] Event: ${event.kind} (source: ${event.source || 'unknown'})`);

          // Forward action events to the session via callback
          if (this.onAction && session.sessionId) {
            // Extract relevant fields based on event kind for rich content rendering
            const extractedFields = extractEventFields(event as V1Event);
            
            // Use effective kind (nested kind for wrapped events) for client-side rendering
            // This is critical: client's getEventContent() dispatches on kinds like
            // "TerminalAction", not "ActionEvent" - see issue #257
            const effectiveKind = extractEffectiveKind(event as V1Event);
            
            const action: AgentAction = {
              id: event.id || crypto.randomUUID(),
              // Normalize OH's naive UTC timestamps before forwarding (issue #264).
              // OH's events endpoint and WS event stream emit timestamps without
              // a `Z` or offset; the client parses these as local time, which
              // pushes every agent event forward by the local UTC offset and
              // breaks kiosk timeline interleaving in non-UTC browsers.
              timestamp: normalizeOhTimestamp(event.timestamp) || new Date().toISOString(),
              kind: effectiveKind,
              source: event.source || 'unknown',
              summary: formatEventSummary(event as V1Event),
              // Spread extracted fields (only non-undefined values will be present)
              ...extractedFields,
            };
            this.onAction(session.sessionId, action);
          }
        }
      } catch (e) {
        console.error('[AI] Error parsing WebSocket message:', e);
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[AI] WebSocket error:', err.message);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[AI] WebSocket closed: ${code} - ${reason.toString()}`);
      session.ws = undefined;

      // Check if session still exists for reconnection
      const sessionExists = session.sessionId && this.sessionAI.has(session.sessionId);

      // Attempt reconnect if session still exists and not max attempts.
      // If the session has already been transitioned to `degraded` by a
      // previous SandboxMissingError, do NOT retry — let it stay degraded
      // (cf. #291 — repeated MISSING must not retry indefinitely).
      if (sessionExists && !session.degraded && session.reconnectAttempts < session.maxReconnectAttempts) {
        session.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts), 30000);
        console.log(`[AI] Reconnecting in ${delay}ms (attempt ${session.reconnectAttempts}/${session.maxReconnectAttempts})`);
        setTimeout(() => {
          void this.reconnectWithRefresh(session);
        }, delay);
      }
    });
  }

  /**
   * Reconnect entry point used by the WS close handler. Refreshes the
   * upstream credentials (so a paused-then-resumed sandbox doesn't get
   * dialled with a stale `session_api_key`, #291) and then re-opens the WS.
   *
   * On {@link SandboxMissingError} the session is rebound onto a fresh
   * sandbox via {@link rebindSession} (#296). The same recovery path is
   * taken on {@link UpstreamCredentialsLostError} (refresh returned
   * `401 NoCredentialsError`), which is functionally equivalent to a
   * MISSING sandbox from the kiosk's POV (#350). If rebind succeeds the
   * reconnect loop continues against the new sandbox; if it fails (budget
   * exhausted, conversation gone, forbidden) the session is marked
   * `degraded`. On any other refresh error we also degrade, so a
   * hard-down OpenHands app server cannot keep the loop alive forever.
   */
  private async reconnectWithRefresh(session: AISession): Promise<void> {
    if (!session.sessionId || !this.sessionAI.has(session.sessionId)) return;
    try {
      await this.refreshSessionCredentials(session);
    } catch (err) {
      // Resume-path failures (#360): sandbox was PAUSED, we tried to resume
      // it, but either the poll timed out or the resume window is
      // saturated. Degrade with a clear reason rather than falling through
      // to rebind — the sandbox is not missing (just slow / wedged), and
      // rebind would discard agent state for no benefit.
      if (
        err instanceof SandboxResumeTimeoutError ||
        err instanceof SandboxResumeBudgetExhausted
      ) {
        console.warn(
          `[AI] Sandbox resume failed for conversation ${session.conversationId} ` +
            `(${err.name}) — degrading session ${session.sessionId}`,
        );
        this.transitionTo(session, 'degraded', `Sandbox resume failed: ${err.name}`);
        return;
      }
      if (err instanceof SandboxMissingError || err instanceof UpstreamCredentialsLostError) {
        console.warn(
          `[AI] Refresh recoverable error for conversation ${session.conversationId} ` +
            `(${err.name}) — attempting rebind (session ${session.sessionId})`,
        );
        // Attempt the rebind in-place. `rebindSession` re-opens the WS on
        // success or marks the session degraded on failure — either way
        // the reconnect loop is done. The RebindWindowTracker (max 3 in
        // 5 min, #296) caps repeated rebinds for the same conversation.
        await this.rebindSession(session);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AI] Reconnect refresh failed for session ${session.sessionId}: ${message}`);
      this.transitionTo(session, 'degraded', `Reconnect failed: ${message}`);
      return;
    }
    // Session may have been ended while we were awaiting the refresh.
    if (!session.sessionId || !this.sessionAI.has(session.sessionId)) return;
    this.connectWebSocket(session);
  }

  /**
   * Attempt to rebind `session` onto a fresh sandbox, preserving its
   * `conversationId` (#296). On success the in-memory `agentServerUrl`
   * and `sessionApiKey` are replaced, the WebSocket is re-dialled against
   * the new agent server, and the `degraded` / `rebinding` flags are
   * cleared. On failure the session transitions to `degraded` and the
   * reconnect loop stops.
   *
   * Behavior:
   * - The per-conversation rebind window (max 3 in 5 min) is consulted
   *   first. If full, the call short-circuits to `degraded`.
   * - The HTTP rebind helper applies its own ~30 s budget; on
   *   `RebindBudgetExhausted` we degrade.
   * - On `RebindForbidden` / `RebindConversationGone` we degrade with a
   *   targeted reason — there's no point retrying.
   * - During the attempt `session.rebinding` is `true` so the driver
   *   layer reports `reconnecting` to UI consumers.
   *
   * Concurrent calls for the same `conversationId` (e.g. two rapid-fire
   * WS-close events on the same session) single-flight onto one in-flight
   * promise via {@link inFlightRebind}, so the upstream POST fires once
   * and the window tracker / credential writes only happen once.
   *
   * Returns nothing — caller observes outcome via `session.degraded` /
   * `session.ws.readyState` / `getRebindCount()`.
   */
  async rebindSession(session: AISession): Promise<void> {
    const key = session.conversationId;
    const existing = this.inFlightRebind.get(key);
    if (existing) return existing;

    const work = this.doRebindSession(session).finally(() => {
      this.inFlightRebind.delete(key);
    });
    this.inFlightRebind.set(key, work);
    return work;
  }

  /**
   * Memory-replay prep (#297). Fetches the platform-side event log for
   * `conversationId` and turns it into a `system_message_suffix` for the
   * upcoming rebind POST. Returns `''` (no suffix) on any error or empty
   * log — replay is strictly best-effort and never blocks the rebind.
   *
   * Always feeds the **raw** event log into the condense / fallback
   * builders, never a previously-generated suffix, so successive rebinds
   * don't condense an already-condensed summary (lossy iteration).
   */
  private async buildRebindReplaySuffix(
    conversationId: string,
    client: OpenHandsClient,
  ): Promise<string> {
    try {
      const page = await client.getEventsPage(conversationId, { limit: 100 });
      return await buildReplaySuffix(page.items, this.condenseImpl);
    } catch (err) {
      // Issue #364: also emit the structured upstream-failure line so the
      // operator can see what status/body the events-page call returned.
      // The user-facing `console.warn` is preserved for backward
      // compatibility with existing log greps.
      logUpstreamFailure('replay_suffix', {
        err,
        conversationId,
        endpoint: 'GET /api/v1/conversations/:id/events',
      });
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[AI] memory replay prep failed for ${conversationId}, ` +
          `proceeding without suffix: ${message}`,
      );
      return '';
    }
  }

  private async doRebindSession(session: AISession): Promise<void> {
    const client = this.clientForSession(session); // #403: honor workspace key
    if (!client) {
      this.transitionTo(session, 'degraded', 'OpenHands client not configured — cannot rebind');
      return;
    }

    // Window cap: if recent rebinds are already at the cap, don't even
    // try the HTTP call. The user must explicitly restart.
    try {
      this.rebindTracker.checkBudget(session.conversationId);
    } catch (err) {
      if (err instanceof RebindBudgetExhausted) {
        console.error(
          `[AI] Rebind window exhausted for ${session.conversationId} ` +
            `(${err.attempts} rebinds in the last 5min) — degrading`,
        );
        this.transitionTo(
          session,
          'degraded',
          'Could not recover the agent runtime. Try restarting.',
        );
        return;
      }
      throw err;
    }

    this.transitionTo(session, 'rebinding', null);
    // Tear down any lingering ws reference so the driver doesn't synthesize
    // a stale ready state while we're mid-rebind.
    if (session.ws) {
      try {
        session.ws.removeAllListeners();
        session.ws.close();
      } catch {
        // ignore — best-effort cleanup of a presumed-dead WS
      }
      session.ws = undefined;
    }

    // Memory replay (#297): fetch the platform-side event log for the
    // dying conversation and build a `system_message_suffix` so the
    // rebound agent's context starts populated with the prior turns.
    // The event-log endpoint on the *app* server (not the dead agent
    // server) survives sandbox death — see
    // `docs/openhands-platform.md` § Death and recovery. On any failure
    // we proceed without a suffix; the rebind itself is still useful.
    const systemMessageSuffix = await this.buildRebindReplaySuffix(
      session.conversationId,
      client,
    );

    let result: RebindResult;
    try {
      const httpOptions: RebindOptions = {
        ...(this.rebindOptionsForTesting ?? {}),
        // Always pass through (possibly '') so tests can assert exact
        // forwarding behaviour. The HTTP client drops empty strings.
        systemMessageSuffix,
      };
      result = await rebindHttp(client, session.conversationId, httpOptions);
    } catch (err) {
      let reason: string;
      if (err instanceof RebindConversationGone) {
        reason = 'Conversation no longer exists — restart needed';
      } else if (err instanceof RebindForbidden) {
        reason = 'Not authorized to recover the agent runtime — restart needed';
      } else if (err instanceof RebindBudgetExhausted) {
        reason = 'Could not recover the agent runtime. Try restarting.';
      } else {
        const message = err instanceof Error ? err.message : String(err);
        reason = `Rebind failed: ${message}`;
      }
      this.transitionTo(session, 'degraded', reason);
      // Issue #364: emit a structured upstream-failure line in addition
      // to (not instead of) the user-facing `degradedReason` log below.
      // The structured line carries the raw HTTP status + body excerpt
      // operators need to triage 401 vs 403 vs 409 — the `degradedReason`
      // string deliberately collapses those into one kiosk-facing reason.
      logUpstreamFailure('rebind', {
        err,
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        endpoint: 'POST /api/v1/app-conversations',
      });
      console.error(
        `[AI] Rebind failed for conversation ${session.conversationId}: ${reason}`,
      );
      return;
    }

    // Success: update in-memory binding, record in window, dial WS.
    session.agentServerUrl = result.agentServerUrl;
    session.sessionApiKey = result.sessionApiKey;
    session.reconnectAttempts = 0;
    this.transitionTo(session, 'running', null);
    this.rebindTracker.recordSuccess(session.conversationId);
    // Persist the now-larger window history so the budget survives a
    // restart (#363). Best-effort — see {@link persistRebindAttempts}.
    this.persistRebindAttempts(session);
    this.rebindCount++;
    console.log(
      `[AI] Rebind succeeded for conversation ${session.conversationId} ` +
        `(rebind count: ${this.rebindCount}); reconnecting WS`,
    );

    // Session may have been ended while the rebind was in flight.
    if (!session.sessionId || !this.sessionAI.has(session.sessionId)) return;
    this.connectWebSocket(session);
  }

  /**
   * End all AI sessions on process shutdown.
   *
   * Closes every live `WebSocket` and clears the in-memory cache so the
   * Node event loop can drain. Importantly does **not** call
   * {@link endSessionAI} on each row — that path deletes the durable
   * `session_ai_state` row, which would defeat the whole point of
   * issue #363. The state rows must survive a restart so the next boot
   * can rehydrate them.
   *
   * User-initiated session ends (driver `restartSession` /
   * `closeSession`) still go through {@link endSessionAI} and delete
   * the durable row, which is the desired semantics for those paths.
   */
  async shutdown(): Promise<void> {
    for (const session of this.sessionAI.values()) {
      if (session.ws) {
        try {
          session.ws.close();
        } catch {
          // best-effort cleanup on shutdown
        }
        session.ws = undefined;
      }
    }
    this.sessionAI.clear();
  }
}

// Export singleton instance
// Note: the process-lifetime `AISessionManager` singleton is owned by
// `server/src/agent-driver/index.ts` (see #289). Platform code must consume
// the `AgentDriver` seam there instead of constructing or importing the
// manager directly.

/**
 * Helper function to get workspace API key from settings
 * Returns null if not configured or if decryption fails
 */
export async function getWorkspaceApiKey(
  workspaceId: string,
  getSettings: (id: string) => { 
    openhandsApiKeyEncrypted: string | null;
    openhandsApiKeyIv: string | null;
    openhandsApiKeyTag: string | null;
  } | null,
  decryptFn: (encrypted: { encrypted: string; iv: string; tag: string }) => string
): Promise<string | null> {
  const settings = getSettings(workspaceId);
  if (!settings?.openhandsApiKeyEncrypted || !settings?.openhandsApiKeyIv || !settings?.openhandsApiKeyTag) {
    return null;
  }

  try {
    return decryptFn({
      encrypted: settings.openhandsApiKeyEncrypted,
      iv: settings.openhandsApiKeyIv,
      tag: settings.openhandsApiKeyTag,
    });
  } catch (err) {
    console.error('[AI] Failed to decrypt workspace API key:', err);
    return null;
  }
}
