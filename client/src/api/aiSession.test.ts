/**
 * Tests for the client-side AI session helper (issue #294).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  restartAISession,
  AISessionRequestError,
} from './aiSession';

describe('restartAISession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the correct URL and parses the response', async () => {
    const body = {
      sessionId: 's1',
      state: 'starting',
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: '2026-05-24T00:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await restartAISession('s1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sessions/s1/ai/restart');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
    expect(result).toEqual(body);
  });

  it('encodes the session id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 'with/slash',
        state: 'starting',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await restartAISession('with/slash');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/with%2Fslash/ai/restart');
  });

  it('throws AISessionRequestError with parsed error message on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'driver boom' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartAISession('s1')).rejects.toMatchObject({
      name: 'AISessionRequestError',
      message: 'driver boom',
      status: 503,
    });
  });

  it('falls back to a default error message when body has no error key', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartAISession('s1')).rejects.toThrow(/Restart failed \(HTTP 500\)/);
  });

  it('uses a default error message when the body is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartAISession('s1')).rejects.toMatchObject({
      message: 'Restart failed (HTTP 502)',
      status: 502,
    });
  });

  it('throws on network failure with the underlying message', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartAISession('s1')).rejects.toMatchObject({
      name: 'AISessionRequestError',
      message: 'offline',
    });
  });

  it('re-throws AbortError unchanged', async () => {
    const abortErr = new DOMException('aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValueOnce(abortErr);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartAISession('s1')).rejects.toBe(abortErr);
  });

  it('forwards an AbortSignal through fetch', async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 's1',
        state: 'starting',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await restartAISession('s1', { signal: ac.signal });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(ac.signal);
  });

  it('throws on invalid response body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartAISession('s1')).rejects.toThrow(/Invalid restart response body/);
  });

  it('falls back to sane defaults when server returns partial body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      // intentionally missing several fields — narrowing should fill in.
      json: () => Promise.resolve({ state: 'degraded' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await restartAISession('s1');
    expect(result.sessionId).toBe('s1');
    expect(result.state).toBe('degraded');
    expect(result.conversationId).toBeNull();
    expect(result.error).toBeNull();
    expect(result.thinkingSince).toBeNull();
    expect(result.startingSince).toBeNull();
  });

  it('preserves startupPhase when present', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 's1',
        state: 'starting',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
        startupPhase: 'WAITING_FOR_SANDBOX',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await restartAISession('s1');
    expect(result.startupPhase).toBe('WAITING_FOR_SANDBOX');
  });
});

describe('AISessionRequestError', () => {
  it('stores the optional status code', () => {
    const err = new AISessionRequestError('boom', 503);
    expect(err.message).toBe('boom');
    expect(err.status).toBe(503);
    expect(err.name).toBe('AISessionRequestError');
  });

  it('omits status when not provided', () => {
    const err = new AISessionRequestError('boom');
    expect(err.status).toBeUndefined();
  });
});
