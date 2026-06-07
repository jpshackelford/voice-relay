/**
 * Issue #455: server-side capture of client-side error events.
 *
 * Exposes `POST /api/client-errors` so a browser running our React app
 * can fire-and-forget diagnostic events (e.g. STT `recognition.onerror`
 * codes that we don't have a friendly mapping for) at the server, which
 * logs a single structured `[ClientError] …` line. That line lands in
 * `journalctl -u voice-relay.service` next to the existing `[AI] /
 * [WS] / [Registry]` chatter, so an operator with shell access to the
 * box can diagnose mobile-only failures without remote DevTools.
 *
 * Logs-only. No DB write, no broadcast, no migration. See the
 * "Client diagnostic events" subsection in `docs/architecture.md` for
 * the wire contract.
 *
 * Auth: device-token bearer (`Authorization: Bearer <deviceToken>`),
 * matching `POST /api/devices/:deviceId/sessions/:sessionId/active-speaker`
 * (#433). We explicitly do NOT reuse `authenticateDisplayRequest` here
 * — the display secret is server-side-only and exposing it to the
 * browser would be a security regression (see the technical-approach
 * comment on the issue).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import type { DeviceRepository } from '../devices/device-repository.js';
import type { SessionRepository } from '../sessions/session-repository.js';

/** Hard cap on request body size for this router (Express returns 413 above). */
const BODY_LIMIT = '4kb';

/** Per-field caps applied to the structured log line. */
const MAX_SOURCE_LEN = 100;
const MAX_ERROR_CODE_LEN = 100;
const MAX_MESSAGE_LEN = 500;
const MAX_USER_AGENT_LEN = 300;
/** Cap on the serialized `context` blob in the log line (bytes-ish). */
const MAX_CONTEXT_LEN = 2_000;

/** Default rate-limit: 10 requests / 60s per sessionId. */
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface ClientErrorRouterOptions {
  deviceRepository: DeviceRepository;
  sessionRepository: SessionRepository;
  /**
   * Override the rate-limit for tests. Production callers should not
   * set this — the defaults match the values called out in #455.
   */
  rateLimit?: { maxRequests?: number; windowMs?: number };
}

/**
 * Per-sessionId in-memory rate limiter. Modelled after the existing
 * `RateLimiter` class in `server/src/devices/router.ts`, but keyed on
 * `sessionId` (the issue's failure mode is "this one tab is melting
 * down", which is naturally bounded by session, not IP — corporate
 * NATs make per-IP coarse).
 */
class SessionRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  isLimited(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    bucket.count++;
    return bucket.count > this.maxRequests;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * Sanitize a single string field for the log line: trim, cap length,
 * and replace control characters that would break a single-line log
 * record. We do NOT strip Unicode — emojis, accented characters etc.
 * are fine in journald.
 */
function sanitizeField(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  // Replace any C0/C1 control char (incl. CR/LF/TAB) with a single
  // space so a logfile parser splitting on \n stays sane.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * JSON.stringify a context object, capped to `MAX_CONTEXT_LEN` bytes
 * after stringification. Returns an empty string if the value can't be
 * serialized (e.g. a cycle) — caller treats absent context as the
 * normal case.
 */
function serializeContext(context: unknown): string {
  if (context === undefined || context === null) return '';
  try {
    const serialized = JSON.stringify(context);
    if (!serialized) return '';
    return serialized.length > MAX_CONTEXT_LEN
      ? `${serialized.slice(0, MAX_CONTEXT_LEN)}…(truncated)`
      : serialized;
  } catch {
    return '';
  }
}

interface ParsedBody {
  sessionId: string;
  workspaceId: string;
  deviceId: string;
  source: string;
  message: string;
  errorCode?: string;
  userAgent?: string;
  context?: unknown;
}

/**
 * Validate the request body shape. Returns either a parsed payload or
 * an error string suitable for a 400 response.
 */
function parseBody(
  body: unknown,
): { ok: true; value: ParsedBody } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  for (const required of [
    'sessionId',
    'workspaceId',
    'deviceId',
    'source',
    'message',
  ] as const) {
    if (typeof b[required] !== 'string' || (b[required] as string).trim() === '') {
      return { ok: false, error: `${required} required` };
    }
  }
  if (b.errorCode !== undefined && typeof b.errorCode !== 'string') {
    return { ok: false, error: 'errorCode must be a string' };
  }
  if (b.userAgent !== undefined && typeof b.userAgent !== 'string') {
    return { ok: false, error: 'userAgent must be a string' };
  }
  return {
    ok: true,
    value: {
      sessionId: (b.sessionId as string).trim(),
      workspaceId: (b.workspaceId as string).trim(),
      deviceId: (b.deviceId as string).trim(),
      source: b.source as string,
      message: b.message as string,
      errorCode: b.errorCode as string | undefined,
      userAgent: b.userAgent as string | undefined,
      context: b.context,
    },
  };
}

export function createClientErrorsRouter({
  deviceRepository,
  sessionRepository,
  rateLimit,
}: ClientErrorRouterOptions): Router {
  const router = Router();

  const limiter = new SessionRateLimiter(
    rateLimit?.maxRequests ?? DEFAULT_RATE_LIMIT_MAX,
    rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  // Periodic cleanup so the bucket map can't grow without bound under
  // a load test. 5-min cadence matches the existing limiters in
  // `devices/router.ts`. `.unref()` so this never blocks process exit.
  const cleanupTimer = setInterval(() => limiter.cleanup(), 5 * 60_000);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

  // Body parser is scoped to this router so we don't widen the global
  // 100kb default. A 4kb cap is plenty for an error report.
  // The error handler below converts entity.too.large into a 413.
  router.use(express.json({ limit: BODY_LIMIT }));

  router.post('/', (req: Request, res: Response) => {
    // 1. Auth: Authorization: Bearer <deviceToken>
    const authHeader = req.headers.authorization;
    const match = authHeader?.match(/^Bearer\s+(.+)$/);
    if (!match) {
      res.status(401).json({ error: 'Device token required' });
      return;
    }
    const deviceToken = match[1].trim();
    const tokenDevice = deviceRepository.validateToken(deviceToken);
    if (!tokenDevice) {
      res.status(401).json({ error: 'Invalid device token' });
      return;
    }

    // 2. Parse + validate body shape.
    const parsed = parseBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { sessionId, workspaceId, deviceId } = parsed.value;

    // 3. Cross-check device. Body deviceId must match the token's
    //    device (any mismatch is treated as an auth failure, not a
    //    validation failure).
    if (tokenDevice.id !== deviceId) {
      res.status(401).json({ error: 'Device token does not match deviceId' });
      return;
    }

    // 4. Cross-check workspace. The token's workspace is the
    //    source of truth; the body's workspaceId must match.
    if (workspaceId !== tokenDevice.workspaceId) {
      res.status(403).json({ error: 'workspaceId does not match device' });
      return;
    }

    // 5. Cross-check session. Must exist and belong to the same
    //    workspace as the device.
    const session = sessionRepository.findById(sessionId);
    if (!session || session.workspaceId !== tokenDevice.workspaceId) {
      res.status(403).json({ error: 'sessionId does not belong to workspace' });
      return;
    }

    // 6. Rate-limit per sessionId. A stuck client tab is the
    //    abuse profile; IP-keying would be too coarse for shared
    //    NATs.
    if (limiter.isLimited(sessionId)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({
        error: 'Too many client-error reports for this session',
        retryAfter: 60,
      });
      return;
    }

    // 7. Emit the structured log line. We use `JSON.stringify` on the
    //    user-controlled fields (msg, ua, source, code) so any quote
    //    / backslash / control character inside them survives
    //    log-line splitting.
    const safeSource = sanitizeField(parsed.value.source, MAX_SOURCE_LEN);
    const safeErrorCode = sanitizeField(parsed.value.errorCode, MAX_ERROR_CODE_LEN);
    const safeMessage = sanitizeField(parsed.value.message, MAX_MESSAGE_LEN);
    const safeUserAgent = sanitizeField(parsed.value.userAgent, MAX_USER_AGENT_LEN);
    const safeContext = serializeContext(parsed.value.context);

    // eslint-disable-next-line no-console
    console.log(
      `[ClientError] session=${sessionId} workspace=${workspaceId} ` +
        `device=${deviceId} source=${JSON.stringify(safeSource)} ` +
        `code=${JSON.stringify(safeErrorCode)} ` +
        `msg=${JSON.stringify(safeMessage)} ` +
        `ua=${JSON.stringify(safeUserAgent)}` +
        (safeContext ? ` context=${safeContext}` : ''),
    );

    res.status(204).end();
  });

  // Express error handler: 4-arg signature is REQUIRED so Express
  // recognises this as an error-handling middleware. We convert the
  // body-parser's `entity.too.large` into a 413 (acceptance criterion
  // "caps body size") and surface other JSON-parse failures as 400.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number; message?: string } | null;
    if (e && e.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    if (e && (e.status === 400 || e.type === 'entity.parse.failed')) {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    res.status(500).json({ error: 'Internal error' });
  });

  return router;
}
