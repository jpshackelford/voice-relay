/**
 * Unit tests for server/scripts/provision-aws-secrets.ts (voice-relay #298).
 *
 * Mocks the OpenHands HTTP client so the suite is hermetic. Test IDs match
 * the acceptance plan in the issue.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AWS_SECRET_NAMES,
  parseArgs,
  provisionAwsSecrets,
  runCli,
  type HttpClient,
  type HttpResponseLike,
  type ProvisionOptions,
} from './provision-aws-secrets.js';

type Call = {
  method: string;
  url: string;
  body?: unknown;
};

/** Build a minimal fake response that matches the small `HttpResponseLike`
 * surface the script depends on. */
function response(
  status: number,
  body: unknown = {}
): HttpResponseLike {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => bodyStr,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

interface MockHttpOptions {
  /** Names returned by `GET /api/v1/secrets/search`. */
  existingNames?: string[];
  /** Sequence of responses each POST should return. If shorter than the
   * number of POST calls, the last response is reused. */
  postResponses?: HttpResponseLike[];
  /** Sequence of responses each DELETE should return. */
  deleteResponses?: HttpResponseLike[];
  /** Custom response for the search call (e.g. 401). */
  searchResponse?: HttpResponseLike;
}

function mockHttp(opts: MockHttpOptions = {}): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  let postIdx = 0;
  let deleteIdx = 0;
  const http: HttpClient = {
    async fetch(url, init) {
      const method = String(init.method ?? 'GET').toUpperCase();
      const body = init.body !== undefined ? safeJson(init.body) : undefined;
      calls.push({ method, url, body });
      if (method === 'GET' && url.includes('/api/v1/secrets/search')) {
        if (opts.searchResponse) return opts.searchResponse;
        return response(200, {
          items: (opts.existingNames ?? []).map((name) => ({ name })),
          next_page_id: null,
        });
      }
      if (method === 'POST' && url.endsWith('/api/v1/secrets')) {
        const responses = opts.postResponses ?? [response(201, { message: 'ok' })];
        const r = responses[Math.min(postIdx, responses.length - 1)];
        postIdx += 1;
        return r;
      }
      if (method === 'DELETE' && url.includes('/api/v1/secrets/')) {
        const responses = opts.deleteResponses ?? [response(200, { message: 'ok' })];
        const r = responses[Math.min(deleteIdx, responses.length - 1)];
        deleteIdx += 1;
        return r;
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  };
  return { http, calls };
}

function safeJson(b: BodyInit | null | undefined): unknown {
  try {
    return typeof b === 'string' ? JSON.parse(b) : b;
  } catch {
    return b;
  }
}

const baseOpts = (): ProvisionOptions => ({
  voiceRelayUserId: 'vr-user-123',
  openhandsApiKey: 'oh-key-abc',
  awsAccessKeyId: 'AKIAEXAMPLE',
  awsSecretAccessKey: 'secret-value-shhh',
  awsDefaultRegion: 'us-west-2',
  baseUrl: 'https://oh.example.test',
  // Keep retries tight so failure tests don't spin.
  maxRetries: 2,
  retryBackoffMs: 0,
});

describe('provisionAwsSecrets', () => {
  it('T-5.1.U.1: first run creates 3 secrets', async () => {
    const { http, calls } = mockHttp({ existingNames: [] });
    const result = await provisionAwsSecrets(http, baseOpts());

    expect(result.ok).toBe(true);
    expect(result.results.map((r) => [r.name, r.action])).toEqual([
      ['AWS_ACCESS_KEY_ID', 'created'],
      ['AWS_SECRET_ACCESS_KEY', 'created'],
      ['AWS_DEFAULT_REGION', 'created'],
    ]);

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(posts.map((c) => (c.body as { name: string }).name)).toEqual([
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_DEFAULT_REGION',
    ]);
    // Sanity: no DELETE calls because nothing pre-existed.
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('T-5.1.U.2: re-run rotates the 3 existing secrets (DELETE + POST each)', async () => {
    const { http, calls } = mockHttp({
      existingNames: [...AWS_SECRET_NAMES],
    });
    const result = await provisionAwsSecrets(http, baseOpts());

    expect(result.ok).toBe(true);
    expect(result.results.every((r) => r.action === 'rotated')).toBe(true);

    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(3);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3);
    // Each DELETE precedes its matching POST.
    const order = calls
      .filter((c) => c.method === 'DELETE' || c.method === 'POST')
      .map((c) => c.method);
    expect(order).toEqual(['DELETE', 'POST', 'DELETE', 'POST', 'DELETE', 'POST']);
  });

  it('T-5.1.U.3: partial existing secrets are completed and rotated', async () => {
    const { http, calls } = mockHttp({ existingNames: ['AWS_DEFAULT_REGION'] });
    const result = await provisionAwsSecrets(http, baseOpts());

    expect(result.ok).toBe(true);
    const actions = Object.fromEntries(
      result.results.map((r) => [r.name, r.action])
    );
    expect(actions.AWS_ACCESS_KEY_ID).toBe('created');
    expect(actions.AWS_SECRET_ACCESS_KEY).toBe('created');
    expect(actions.AWS_DEFAULT_REGION).toBe('rotated');

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(
      calls
        .find((c) => c.method === 'DELETE')!
        .url.endsWith('/api/v1/secrets/AWS_DEFAULT_REGION')
    ).toBe(true);
  });

  it('T-5.1.U.4: HTTP 5xx on POST is retried and eventually succeeds', async () => {
    const { http, calls } = mockHttp({
      existingNames: [],
      // First POST gets 503, second 201. Subsequent POSTs (for the other 2
      // secrets) all return 201 (last entry is reused).
      postResponses: [
        response(503, 'Service Unavailable'),
        response(201, { message: 'ok' }),
      ],
    });
    const result = await provisionAwsSecrets(http, baseOpts());

    expect(result.ok).toBe(true);
    expect(result.results.every((r) => r.action === 'created')).toBe(true);
    // 4 POST calls total: 1 (503) + 1 retry success + 2 more secrets.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(4);
  });

  it('T-5.1.U.5: HTTP 401 from search fails fast with a clear error', async () => {
    const { http, calls } = mockHttp({
      searchResponse: response(401, { detail: 'unauthorized' }),
    });

    await expect(provisionAwsSecrets(http, baseOpts())).rejects.toThrow(
      /HTTP 401/
    );
    // We should not have attempted any mutations.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('T-5.1.U.6: secret values never appear in stdout or stderr', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdout = { write: (s: string) => stdoutChunks.push(s) };
    const stderr = { write: (s: string) => stderrChunks.push(s) };

    const accessKey = 'AKIA-VALUE-NEVER-LOGGED';
    const secret = 'super-secret-never-logged';
    const region = 'eu-secret-region-never-logged';

    const { http } = mockHttp({ existingNames: [] });

    const code = await runCli({
      http,
      argv: [
        '--user-id',
        'vr-user-1',
        '--openhands-api-key',
        'oh-key',
        '--aws-access-key-id',
        accessKey,
        '--aws-secret-access-key',
        secret,
        '--aws-default-region',
        region,
        '--base-url',
        'https://oh.example.test',
        '--retry-backoff-ms',
        '0',
      ],
      env: {},
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const combined = stdoutChunks.concat(stderrChunks).join('');
    expect(combined).not.toContain(accessKey);
    expect(combined).not.toContain(secret);
    expect(combined).not.toContain(region);
    // But the secret NAMES are fine to surface.
    expect(combined).toContain('AWS_ACCESS_KEY_ID');
    expect(combined).toContain('AWS_SECRET_ACCESS_KEY');
    expect(combined).toContain('AWS_DEFAULT_REGION');
  });

  it('T-5.1.U.7: missing required arg fails fast', async () => {
    const opts = baseOpts();
    delete opts.awsAccessKeyId;
    await expect(provisionAwsSecrets({} as HttpClient, opts)).rejects.toThrow(
      /--aws-access-key-id/
    );
  });

  it('returns ok=false (does not throw) when a single POST fails permanently', async () => {
    const { http } = mockHttp({
      existingNames: [],
      // First POST returns 400 (non-retryable); other POSTs succeed.
      postResponses: [
        response(400, { detail: 'bad request' }),
        response(201, { message: 'ok' }),
      ],
    });
    const result = await provisionAwsSecrets(http, baseOpts());
    expect(result.ok).toBe(false);
    const failed = result.results.find((r) => r.action === 'failed');
    expect(failed?.name).toBe('AWS_ACCESS_KEY_ID');
    expect(failed?.status).toBe(400);
  });

  it('dry-run skips all mutations', async () => {
    const { http, calls } = mockHttp({ existingNames: ['AWS_ACCESS_KEY_ID'] });
    const result = await provisionAwsSecrets(http, {
      ...baseOpts(),
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(result.results.every((r) => r.action === 'unchanged')).toBe(true);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('paginates the search call until next_page_id is null', async () => {
    let firstCall = true;
    const http: HttpClient = {
      async fetch(url, init) {
        const method = String(init.method ?? 'GET').toUpperCase();
        if (method === 'GET' && url.includes('/api/v1/secrets/search')) {
          if (firstCall) {
            firstCall = false;
            return response(200, {
              items: [{ name: 'AWS_ACCESS_KEY_ID' }],
              next_page_id: 'page-2',
            });
          }
          return response(200, {
            items: [{ name: 'AWS_SECRET_ACCESS_KEY' }],
            next_page_id: null,
          });
        }
        if (method === 'POST' && url.endsWith('/api/v1/secrets')) {
          return response(201, { message: 'ok' });
        }
        if (method === 'DELETE') {
          return response(200, { message: 'ok' });
        }
        throw new Error(`Unexpected ${method} ${url}`);
      },
    };
    const result = await provisionAwsSecrets(http, baseOpts());
    expect(result.ok).toBe(true);
    const actions = Object.fromEntries(
      result.results.map((r) => [r.name, r.action])
    );
    expect(actions.AWS_ACCESS_KEY_ID).toBe('rotated');
    expect(actions.AWS_SECRET_ACCESS_KEY).toBe('rotated');
    expect(actions.AWS_DEFAULT_REGION).toBe('created');
  });

  it('exhausts retries on persistent 5xx and reports failure', async () => {
    const { http } = mockHttp({
      existingNames: [],
      postResponses: [response(503), response(503), response(503), response(201)],
    });
    const result = await provisionAwsSecrets(http, { ...baseOpts(), maxRetries: 2 });
    // maxRetries=2 means 2 attempts total per POST. First two are 503 → fail.
    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      name: 'AWS_ACCESS_KEY_ID',
      action: 'failed',
      status: 503,
    });
  });
});

describe('parseArgs', () => {
  it('reads CLI flags', () => {
    const { options } = parseArgs(
      [
        '--user-id',
        'u1',
        '--openhands-api-key',
        'k1',
        '--aws-access-key-id',
        'AKIA',
        '--aws-secret-access-key',
        'sk',
        '--aws-default-region',
        'us-west-2',
        '--dry-run',
      ],
      {}
    );
    expect(options).toMatchObject({
      voiceRelayUserId: 'u1',
      openhandsApiKey: 'k1',
      awsAccessKeyId: 'AKIA',
      awsSecretAccessKey: 'sk',
      awsDefaultRegion: 'us-west-2',
      dryRun: true,
    });
  });

  it('falls back to env vars when flags are absent', () => {
    const { options } = parseArgs([], {
      VOICE_RELAY_USER_ID: 'u2',
      OPENHANDS_API_KEY: 'k2',
      AWS_ACCESS_KEY_ID: 'AKIA2',
      AWS_SECRET_ACCESS_KEY: 'sk2',
      AWS_DEFAULT_REGION: 'eu-west-1',
    });
    expect(options).toMatchObject({
      voiceRelayUserId: 'u2',
      openhandsApiKey: 'k2',
      awsAccessKeyId: 'AKIA2',
      awsSecretAccessKey: 'sk2',
      awsDefaultRegion: 'eu-west-1',
    });
  });

  it('CLI flag wins over env var', () => {
    const { options } = parseArgs(
      ['--aws-default-region', 'us-east-1'],
      { AWS_DEFAULT_REGION: 'eu-west-1' }
    );
    expect(options.awsDefaultRegion).toBe('us-east-1');
  });

  it('rejects unknown args', () => {
    expect(() => parseArgs(['--nope'], {})).toThrow(/Unknown argument/);
  });

  it('rejects flag without value', () => {
    expect(() => parseArgs(['--user-id'], {})).toThrow(/requires a value/);
  });

  it('--help short-circuits with help=true', () => {
    const { help } = parseArgs(['--help'], {});
    expect(help).toBe(true);
  });
});

describe('runCli', () => {
  it('prints help and exits 0 with --help', async () => {
    const out: string[] = [];
    const stdout = { write: (s: string) => out.push(s) };
    const stderr = { write: vi.fn() };
    const code = await runCli({
      http: { fetch: async () => response(200, {}) },
      argv: ['--help'],
      env: {},
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join('')).toContain('Provision (or rotate) AWS credentials');
  });

  it('exits 2 on argparse error', async () => {
    const stderr: string[] = [];
    const code = await runCli({
      http: { fetch: async () => response(200, {}) },
      argv: ['--bogus'],
      env: {},
      stdout: { write: vi.fn() },
      stderr: { write: (s: string) => stderr.push(s) },
    });
    expect(code).toBe(2);
    expect(stderr.join('')).toMatch(/Unknown argument/);
  });

  it('exits 2 on missing-arg error from provisionAwsSecrets', async () => {
    const stderr: string[] = [];
    const code = await runCli({
      http: { fetch: async () => response(200, {}) },
      argv: ['--user-id', 'u'], // missing other required flags
      env: {},
      stdout: { write: vi.fn() },
      stderr: { write: (s: string) => stderr.push(s) },
    });
    expect(code).toBe(2);
    expect(stderr.join('')).toMatch(/Missing required argument/);
  });

  it('exits 1 when at least one secret fails', async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    const { http } = mockHttp({
      existingNames: [],
      postResponses: [response(400, { detail: 'bad' }), response(201, {})],
    });
    const code = await runCli({
      http,
      argv: [
        '--user-id',
        'u',
        '--openhands-api-key',
        'k',
        '--aws-access-key-id',
        'a',
        '--aws-secret-access-key',
        's',
        '--aws-default-region',
        'r',
        '--retry-backoff-ms',
        '0',
      ],
      env: {},
      stdout: { write: (s: string) => stdout.push(s) },
      stderr: { write: (s: string) => stderr.push(s) },
    });
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/failed/);
  });
});
