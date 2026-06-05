import { describe, it, expect, vi } from 'vitest';
import {
  fetchProjectId,
  mintEphemeralKey,
  DeepgramApiError,
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
} from './deepgram-token.js';

/**
 * Unit tests for the Deepgram broker (#386).
 *
 * No network: every test injects a stub `fetch` so CI never makes a
 * real Deepgram request.
 */

function makeFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('fetchProjectId', () => {
  it('returns the first project_id when Deepgram responds 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({ projects: [{ project_id: 'proj-123' }] }),
    );
    const id = await fetchProjectId('key-xyz', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(id).toBe('proj-123');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/projects',
      expect.objectContaining({
        headers: { Authorization: 'Token key-xyz' },
      }),
    );
  });

  it('throws DeepgramApiError with status when Deepgram returns 4xx', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ error: 'unauthorised' }, 401));
    await expect(
      fetchProjectId('bad-key', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ name: 'DeepgramApiError', status: 401 });
  });

  it('throws when the response has no projects array', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ projects: [] }));
    await expect(
      fetchProjectId('k', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(DeepgramApiError);
  });

  it('honours a custom baseUrl (e.g. staging endpoints)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({ projects: [{ project_id: 'p' }] }),
    );
    await fetchProjectId('k', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://staging.api.deepgram.com',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://staging.api.deepgram.com/v1/projects',
      expect.any(Object),
    );
  });
});

describe('mintEphemeralKey', () => {
  const project = { projectId: 'proj-123' };

  it('returns the short-lived key + computed expiresAt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ key: 'short-lived-abc' }));
    const before = Date.now();
    const out = await mintEphemeralKey(
      { apiKey: 'k', ttlSeconds: 30, fetchImpl: fetchImpl as unknown as typeof fetch },
      project,
    );
    const after = Date.now();
    expect(out.token).toBe('short-lived-abc');
    const expiry = Date.parse(out.expiresAt);
    expect(expiry).toBeGreaterThanOrEqual(before + 30_000 - 50);
    expect(expiry).toBeLessThanOrEqual(after + 30_000 + 50);
  });

  it('caps TTL to MAX_TTL_SECONDS regardless of caller input', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ key: 'k' }));
    await mintEphemeralKey(
      { apiKey: 'k', ttlSeconds: 9999, fetchImpl: fetchImpl as unknown as typeof fetch },
      project,
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.time_to_live_in_seconds).toBe(MAX_TTL_SECONDS);
  });

  it('defaults TTL to DEFAULT_TTL_SECONDS when caller omits it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ key: 'k' }));
    await mintEphemeralKey(
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
      project,
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.time_to_live_in_seconds).toBe(DEFAULT_TTL_SECONDS);
  });

  it('uses default usage:write scope', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ key: 'k' }));
    await mintEphemeralKey(
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
      project,
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.scopes).toEqual(['usage:write']);
  });

  it('sends Authorization: Token <apiKey> header (Deepgram convention)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ key: 'k' }));
    await mintEphemeralKey(
      { apiKey: 'long-lived', fetchImpl: fetchImpl as unknown as typeof fetch },
      project,
    );
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe('Token long-lived');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('URL-encodes the project id in the path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ key: 'k' }));
    await mintEphemeralKey(
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
      { projectId: 'proj/with/slash' },
    );
    expect(fetchImpl.mock.calls[0]![0]).toContain('proj%2Fwith%2Fslash');
  });

  it('translates Deepgram non-2xx into DeepgramApiError with status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ error: 'rate-limited' }, 429));
    await expect(
      mintEphemeralKey(
        { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
        project,
      ),
    ).rejects.toMatchObject({ name: 'DeepgramApiError', status: 429 });
  });

  it('throws when Deepgram returns 200 but no key field', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeFetchResponse({ comment: 'oops' }));
    await expect(
      mintEphemeralKey(
        { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
        project,
      ),
    ).rejects.toBeInstanceOf(DeepgramApiError);
  });
});
