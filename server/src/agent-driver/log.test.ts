/**
 * Unit tests for `log.ts` — the structured upstream-failure log helper
 * introduced for issue #364.
 *
 * Coverage targets:
 * - `redactSecrets`: session_api_key, api_key, Bearer tokens; idempotent on
 *   bodies without secrets; handles multiple tokens per body.
 * - `truncate`: exact-size, oversize, undersize; trailing marker shape.
 * - `logUpstreamFailure`: shape of the emitted `console.error` line for
 *   OpenHandsApiError, RebindForbidden, RebindConversationGone, plain
 *   Error, and non-Error throwables; ID prefixing; attempt formatting.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { redactSecrets, truncate, logUpstreamFailure, BODY_EXCERPT_MAX_CHARS } from './log.js';
import { OpenHandsApiError } from '../openhands.js';
import { RebindForbidden, RebindConversationGone } from './rebind.js';

describe('redactSecrets', () => {
  test.each([
    [
      'session_api_key inside JSON',
      '{"session_api_key":"sk_live_abc123","other":1}',
      '{"session_api_key":"***","other":1}',
    ],
    [
      'session_api_key with extra whitespace',
      '{ "session_api_key" : "sk_live_xyz" }',
      '{ "session_api_key" : "***" }',
    ],
    [
      'api_key inside JSON',
      '{"api_key":"k_abc","ok":true}',
      '{"api_key":"***","ok":true}',
    ],
    [
      'Bearer token in plain text',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
      'Authorization: Bearer ***',
    ],
    [
      'Bearer token mixed with structured key',
      '{"msg":"Bearer abc.def-ghi_jkl is bad","api_key":"k"}',
      '{"msg":"Bearer *** is bad","api_key":"***"}',
    ],
    [
      'multiple Bearer tokens',
      'first Bearer token123 then Bearer token456',
      'first Bearer *** then Bearer ***',
    ],
    [
      'no secrets is unchanged',
      '{"error":"Forbidden","detail":"bad request"}',
      '{"error":"Forbidden","detail":"bad request"}',
    ],
    [
      'malformed JSON without secrets is unchanged',
      'not json at all',
      'not json at all',
    ],
    [
      'empty string',
      '',
      '',
    ],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  test('redaction is idempotent', () => {
    const once = redactSecrets('{"session_api_key":"sk_xx","api_key":"k"}');
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('truncate', () => {
  test('returns input unchanged when within budget', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  test('returns input unchanged at exact budget', () => {
    expect(truncate('exact', 5)).toBe('exact');
  });

  test('truncates and appends the dropped-count marker', () => {
    const out = truncate('abcdefghij', 4);
    expect(out).toBe('abcd…(+6 more)');
  });

  test('uses BODY_EXCERPT_MAX_CHARS as the default cap', () => {
    const body = 'x'.repeat(BODY_EXCERPT_MAX_CHARS + 50);
    const out = truncate(body);
    expect(out.startsWith('x'.repeat(BODY_EXCERPT_MAX_CHARS))).toBe(true);
    expect(out).toContain('…(+50 more)');
  });

  test('handles empty string without producing a marker', () => {
    expect(truncate('', 200)).toBe('');
  });
});

describe('logUpstreamFailure', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /** Pull the single line emitted by `console.error`. */
  function emittedLine(): string {
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const args = consoleErrorSpy.mock.calls[0] as unknown[];
    return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  }

  test('formats an OpenHandsApiError with the full schema', () => {
    const err = new OpenHandsApiError(
      409,
      'OpenHands API error 409: conflict',
      null,
      '{"error":"ConflictError","message":"stale rebind"}',
    );
    logUpstreamFailure('rebind', {
      err,
      sessionId: 'sess-abcdefghij',
      conversationId: 'conv-0123456789xx',
      attempt: 2,
      maxAttempts: 6,
      endpoint: 'POST /api/v1/app-conversations',
    });
    const line = emittedLine();
    expect(line).toMatch(/^\[AI\] rebind upstream error/);
    expect(line).toContain('error=OpenHandsApiError');
    expect(line).toContain('session=sess-abc'); // 8-char prefix
    expect(line).toContain('conv=conv-01234'); // 10-char prefix
    expect(line).toContain('status=409');
    expect(line).toContain('attempt=2/6');
    expect(line).toContain('endpoint=POST /api/v1/app-conversations');
    expect(line).toMatch(/body=".*ConflictError.*"/);
  });

  test('uses the body field from RebindForbidden', () => {
    const err = new RebindForbidden(
      'conv1',
      403,
      'forbidden',
      '{"error":"Forbidden","detail":"bad token"}',
    );
    logUpstreamFailure('rebind', { err, conversationId: 'conv1' });
    const line = emittedLine();
    expect(line).toContain('status=403');
    expect(line).toMatch(/body=".*Forbidden.*bad token.*"/);
  });

  test('uses the body field from RebindConversationGone', () => {
    const err = new RebindConversationGone(
      'conv1',
      'conversation not found in tenant XYZ',
    );
    logUpstreamFailure('rebind', { err, conversationId: 'conv1' });
    const line = emittedLine();
    expect(line).toContain('status=404');
    expect(line).toMatch(/body=".*tenant XYZ.*"/);
  });

  test('redacts session_api_key in body before truncation', () => {
    const body = '{"session_api_key":"sk_live_secret123","x":1}';
    const err = new OpenHandsApiError(200, 'm', null, body);
    logUpstreamFailure('refresh', { err, conversationId: 'c' });
    const line = emittedLine();
    // Quotes inside `body="…"` are backslash-escaped for single-line readability.
    expect(line).toContain('\\"session_api_key\\":\\"***\\"');
    expect(line).not.toContain('sk_live_secret123');
  });

  test('redacts Bearer tokens in body', () => {
    const body = 'Authorization rejected: Bearer secret_token_xyz.abc-def';
    const err = new OpenHandsApiError(401, 'm', null, body);
    logUpstreamFailure('attach', { err, conversationId: 'c' });
    const line = emittedLine();
    expect(line).toContain('Bearer ***');
    expect(line).not.toContain('secret_token_xyz');
  });

  test('truncates an oversize body to ~BODY_EXCERPT_MAX_CHARS + marker', () => {
    // Plausible HTML 502 page (3000 chars). Pure ASCII so length === chars.
    const huge = '<html>' + 'A'.repeat(3000) + '</html>';
    const err = new OpenHandsApiError(502, 'bad gateway', null, huge);
    logUpstreamFailure('rebind', { err, conversationId: 'c' });
    const line = emittedLine();
    const m = line.match(/body="(.+)"$/);
    expect(m).not.toBeNull();
    // Excerpt is BODY_EXCERPT_MAX_CHARS chars plus the "…(+N more)" suffix.
    expect(m![1].length).toBeLessThanOrEqual(BODY_EXCERPT_MAX_CHARS + 20);
    expect(m![1]).toContain('…(+');
  });

  test('falls back to err.message when error has no structured body', () => {
    // Non-OpenHandsApiError errors should still appear in the log line —
    // SandboxMissingError / unknown errors land here.
    class SyntheticErr extends Error {
      constructor() {
        super('sandbox really gone');
        this.name = 'SandboxMissingError';
      }
    }
    logUpstreamFailure('refresh', { err: new SyntheticErr(), conversationId: 'c' });
    const line = emittedLine();
    expect(line).toContain('error=SandboxMissingError');
    expect(line).not.toContain('status=');
    expect(line).toMatch(/body=".*sandbox really gone.*"/);
  });

  test('formats a non-Error throwable without crashing', () => {
    logUpstreamFailure('refresh', { err: 'plain string thrown', conversationId: 'c' });
    const line = emittedLine();
    expect(line).toContain('error=string');
    expect(line).toMatch(/body=".*plain string thrown.*"/);
  });

  test('omits optional fields when context is sparse', () => {
    const err = new OpenHandsApiError(500, 'oops', null, 'down');
    logUpstreamFailure('refresh', { err });
    const line = emittedLine();
    expect(line).not.toContain('session=');
    expect(line).not.toContain('conv=');
    expect(line).not.toContain('sandbox=');
    expect(line).not.toContain('attempt=');
    expect(line).not.toContain('endpoint=');
    expect(line).toContain('status=500');
  });

  test('formats attempt without max as a bare number', () => {
    const err = new OpenHandsApiError(503, 'unavail', null, 'x');
    logUpstreamFailure('refresh', { err, attempt: 1 });
    const line = emittedLine();
    expect(line).toContain('attempt=1 ');
    expect(line).not.toMatch(/attempt=1\/\d+/);
  });

  test('escapes embedded quotes and newlines so the line stays single-line', () => {
    const body = 'first line\nsecond "quoted" line';
    const err = new OpenHandsApiError(400, 'm', null, body);
    logUpstreamFailure('refresh', { err });
    const line = emittedLine();
    // No raw newlines in the emitted line.
    expect(line).not.toMatch(/\n/);
    expect(line).toContain('\\n');
    expect(line).toContain('\\"quoted\\"');
  });

  test('emits exactly one console.error call per failure', () => {
    const err = new OpenHandsApiError(403, 'm', null, 'b');
    logUpstreamFailure('attach', { err });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
