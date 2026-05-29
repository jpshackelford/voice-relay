/**
 * Structured-ish log helpers for upstream OpenHands HTTP failures (#364).
 *
 * Today every refresh / rebind / attach failure that flows through
 * `AISessionManager` ends up in `journalctl -u voice-relay` as just the
 * user-facing `session.degradedReason` string — e.g. "Not authorized to
 * recover the agent runtime — restart needed". That string is intentionally
 * the same for 401 / 403 / 409, so the operator cannot tell from the
 * journal what the platform actually said.
 *
 * This module exposes a single helper, {@link logUpstreamFailure}, that
 * emits one `console.error` line per failure with a stable schema:
 *
 *     [AI] <op> upstream error session=<sid> conv=<cid> sandbox=<sb> \
 *       status=<n> attempt=<i>/<max> endpoint=<METHOD /path> \
 *       body="<excerpt>"
 *
 * The line is emitted **in addition to** (not as a replacement for) the
 * existing user-facing `console.error` lines that report `degradedReason`,
 * so kiosk-visible messaging is unchanged.
 *
 * The body excerpt is run through {@link redactSecrets} before truncation
 * to avoid splattering `session_api_key` / `Bearer …` tokens into the
 * journal, and capped via {@link truncate} to keep log lines readable
 * when the platform returns an HTML 502 page.
 */

/** Single source of truth for the body-excerpt cap. */
export const BODY_EXCERPT_MAX_CHARS = 200;

/**
 * Strip OpenHands-shaped secrets from `body`.
 *
 * Targeted at three patterns the OpenHands platform is known to emit:
 *
 * - `"session_api_key": "sk_live_…"` — the rebound conversation key.
 * - `"api_key": "sk_live_…"` — generic key field used in some endpoints.
 * - `Bearer …` — Authorization header echoed back in error bodies.
 *
 * Runs BEFORE truncation so we never accidentally leak a partial token
 * by chopping the body mid-string. Keeps the surrounding JSON structure
 * intact so the redacted body is still useful for debugging.
 *
 * The Bearer token character class covers both base64url (`A-Za-z0-9._-`)
 * and standard base64 (RFC 4648 §4: `A-Za-z0-9+/=`) so JWT-style and
 * HTTP Basic / classic-base64 tokens are both redacted.
 */
export function redactSecrets(body: string): string {
  return body
    .replace(/("session_api_key"\s*:\s*)"[^"]*"/g, '$1"***"')
    .replace(/("api_key"\s*:\s*)"[^"]*"/g, '$1"***"')
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/g, 'Bearer ***');
}

/**
 * Truncate `body` to at most `max` characters, appending a
 * `…(+N more)` marker when truncation occurs so an operator can tell at
 * a glance that the journal line was clipped.
 *
 * The trailing marker is excluded from the `max` budget — the resulting
 * string can be up to `max + len("…(+N more)")` chars long. Callers
 * size journal lines accordingly (see {@link BODY_EXCERPT_MAX_CHARS}).
 */
export function truncate(body: string, max: number = BODY_EXCERPT_MAX_CHARS): string {
  if (body.length <= max) return body;
  const dropped = body.length - max;
  return `${body.slice(0, max)}…(+${dropped} more)`;
}

/**
 * Quote a one-line body for inclusion in a `body="…"` log field.
 * Backslashes, double-quotes, and newlines are escaped so the log line
 * stays on one physical line (cheap parsing for ad-hoc journal greps).
 */
function quoteForLog(body: string): string {
  return body
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/** Shape of the error variants `logUpstreamFailure` understands. */
export interface UpstreamFailureLike {
  readonly name?: string;
  readonly message?: string;
  /** HTTP status if the error originated from an OpenHands HTTP response. */
  readonly status?: number;
  /** Raw response body if the error originated from an OpenHands HTTP response. */
  readonly body?: string | null;
}

/** Logical operations the manager surfaces upstream failures for. */
export type UpstreamFailureOp = 'refresh' | 'rebind' | 'attach' | 'replay_suffix';

/**
 * Context fields the manager passes to {@link logUpstreamFailure}. All
 * are optional except `err`; missing fields are simply omitted from the
 * emitted line so the schema degrades gracefully as call sites add
 * context over time.
 */
export interface UpstreamFailureCtx {
  err: unknown;
  /** Full session id; logged as an 8-char prefix to keep lines one-line-friendly. */
  sessionId?: string | null;
  /** Full conversation id; logged as a 10-char prefix. */
  conversationId?: string | null;
  /** Sandbox id when known. */
  sandboxId?: string | null;
  /** Current attempt number for ops that loop (refresh, rebind). */
  attempt?: number;
  /** Maximum attempt count for ops that loop. */
  maxAttempts?: number;
  /** `METHOD /path` describing the upstream endpoint that failed. */
  endpoint?: string;
}

/** Short prefix of `value`; returns the original string when shorter than `n`. */
function shortId(value: string | null | undefined, n: number): string | null {
  if (!value) return null;
  return value.length <= n ? value : value.slice(0, n);
}

/**
 * Pull `status` and `body` off the error if it shape-matches
 * {@link UpstreamFailureLike}. Returns `null` for both when the error
 * is something other than an OpenHands HTTP error.
 */
function statusAndBody(err: unknown): { status: number | null; body: string | null } {
  if (err && typeof err === 'object') {
    const e = err as UpstreamFailureLike;
    const hasStatus = typeof e.status === 'number';
    const hasBody = typeof e.body === 'string' || e.body === null;
    if (hasStatus || hasBody) {
      return {
        status: hasStatus ? (e.status as number) : null,
        body: hasBody ? (e.body as string | null) : null,
      };
    }
  }
  return { status: null, body: null };
}

/**
 * Emit one `console.error` line describing an upstream HTTP failure.
 *
 * Always emits a line, even when the error is not an
 * `OpenHandsApiError` — the `error=` field carries the error class name
 * so an operator can grep for failures by category without needing to
 * remap error classes upstream.
 */
export function logUpstreamFailure(op: UpstreamFailureOp, ctx: UpstreamFailureCtx): void {
  const { err } = ctx;
  const { status, body } = statusAndBody(err);
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);

  const parts: string[] = [`[AI] ${op} upstream error`];
  parts.push(`error=${name}`);

  const sess = shortId(ctx.sessionId, 8);
  if (sess) parts.push(`session=${sess}`);
  const conv = shortId(ctx.conversationId, 10);
  if (conv) parts.push(`conv=${conv}`);
  if (ctx.sandboxId) parts.push(`sandbox=${ctx.sandboxId}`);

  if (status !== null) {
    parts.push(`status=${status}`);
  }
  if (ctx.attempt !== undefined) {
    parts.push(
      ctx.maxAttempts !== undefined
        ? `attempt=${ctx.attempt}/${ctx.maxAttempts}`
        : `attempt=${ctx.attempt}`,
    );
  }
  if (ctx.endpoint) parts.push(`endpoint=${ctx.endpoint}`);

  // Body excerpt: redact secrets, then truncate, then quote-escape for
  // single-line readability. Falls back to the error message for
  // non-OpenHandsApiError errors so the line is still useful (this is
  // where SandboxMissingError / UpstreamCredentialsLostError end up).
  let excerptSource: string | null = null;
  if (typeof body === 'string') {
    excerptSource = body;
  } else if (status === null && message) {
    excerptSource = message;
  }
  if (excerptSource !== null) {
    const excerpt = truncate(redactSecrets(excerptSource));
    parts.push(`body="${quoteForLog(excerpt)}"`);
  }

  console.error(parts.join(' '));
}
