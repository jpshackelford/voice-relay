import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useResourceFetch } from './useResourceFetch';

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * A stable identity extractor used in every test. Defining this outside the
 * render callback gives the hook a stable reference for its effect deps;
 * without it the default inline extractor would change identity on each
 * render and re-fire the effect indefinitely.
 */
const identity = <T,>(d: unknown): T => d as T;

describe('useResourceFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches data and exposes it once the request resolves', async () => {
    const payload = { id: 'abc', name: 'Workspace' };
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(payload));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<typeof payload>({
        url: '/api/workspaces/abc',
        extractData: identity,
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(result.current.errorInfo).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/abc',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('uses extractData to project the raw response into the desired shape', async () => {
    type Wrapper = { workspace: { id: string; slug: string } };
    const raw: Wrapper = { workspace: { id: 'w1', slug: 'team' } };
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(raw)) as unknown as typeof fetch;

    const extract = (d: unknown) => (d as Wrapper).workspace;

    const { result } = renderHook(() =>
      useResourceFetch<Wrapper['workspace']>({
        url: '/api/workspaces/team',
        extractData: extract,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ id: 'w1', slug: 'team' });
  });

  it('skips fetching and turns off loading when url is null', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({ url: null, extractData: identity })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('skips fetching when enabled is false', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({
        url: '/api/x',
        enabled: false,
        extractData: identity,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invokes ensureAuth before fetching to refresh the session', async () => {
    const order: string[] = [];
    const ensureAuth = vi.fn().mockImplementation(async () => {
      order.push('auth');
    });

    const fetchMock = vi.fn().mockImplementation(async () => {
      order.push('fetch');
      return mockJsonResponse({ ok: true });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<{ ok: boolean }>({
        url: '/api/x',
        ensureAuth,
        extractData: identity,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(ensureAuth).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['auth', 'fetch']);
  });

  it('surfaces a NOT_FOUND error and uses the custom notFound message on a 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse({}, 404)) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({
        url: '/api/missing',
        notFoundMessage: 'Workspace not found',
        extractData: identity,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Workspace not found');
    expect(result.current.errorInfo).toEqual({
      type: 'NOT_FOUND',
      message: 'Workspace not found',
      status: 404,
    });
  });

  it('surfaces an ACCESS_DENIED error on a 403', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse({}, 403)) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({
        url: '/api/forbidden',
        forbiddenMessage: 'No access here',
        extractData: identity,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('No access here');
    expect(result.current.errorInfo).toEqual({
      type: 'ACCESS_DENIED',
      message: 'No access here',
      status: 403,
    });
  });

  it('surfaces an UNAUTHORIZED error with a session-expired message on a 401', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse({}, 401)) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({
        url: '/api/protected',
        extractData: identity,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Session expired. Please log in again.');
    expect(result.current.errorInfo).toEqual({
      type: 'UNAUTHORIZED',
      message: 'Session expired. Please log in again.',
      status: 401,
    });
  });

  it('surfaces an UNKNOWN error with the server-provided message on other non-OK responses', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ error: 'Workspace not found' }, 500)) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({ url: '/api/boom', extractData: identity })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // getUserFriendlyMessage maps the known "Workspace not found" string to
    // its user-friendly version verbatim from the errors module.
    expect(result.current.error).toBe("This workspace doesn't exist or has been deleted.");
    expect(result.current.errorInfo?.type).toBe('UNKNOWN');
    expect(result.current.errorInfo?.status).toBe(500);
  });

  it('falls back to the failurePrefix when the error response body is not JSON', async () => {
    // Simulate a non-JSON body that throws when parsed.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not JSON')),
    } as unknown as Response) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({
        url: '/api/x',
        failurePrefix: 'Failed to load workspace',
        extractData: identity,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Without a parsed body the hook falls back to the failurePrefix string.
    expect(result.current.error).toBe('Failed to load workspace');
    expect(result.current.errorInfo?.type).toBe('UNKNOWN');
    expect(result.current.errorInfo?.status).toBe(502);
  });

  it('surfaces a NETWORK error when fetch rejects (error path)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<unknown>({ url: '/api/network', extractData: identity })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.errorInfo?.type).toBe('NETWORK');
    expect(result.current.error).toContain('Unable to connect to the server');
  });

  it('refetch re-runs the effect and updates the data', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      return mockJsonResponse({ count: call });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useResourceFetch<{ count: number }>({ url: '/api/counter', extractData: identity })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ count: 1 });

    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      result.current.refetch();
    });

    // Wait for refetch to complete.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(result.current.data).toEqual({ count: 2 }));
  });

  it('does not update state for in-flight requests after the component unmounts', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = vi.fn().mockReturnValue(pending) as unknown as typeof fetch;

    const { result, unmount } = renderHook(() =>
      useResourceFetch<unknown>({ url: '/api/slow', extractData: identity })
    );

    expect(result.current.loading).toBe(true);

    // Unmount before the request resolves.
    unmount();

    // Resolve after unmount; this should be a no-op due to the cancellation guard.
    await act(async () => {
      resolveFetch?.(mockJsonResponse({ done: true }));
      // Give microtasks a chance to flush.
      await Promise.resolve();
    });

    // Snapshot captured before unmount should still reflect loading state.
    expect(result.current.data).toBeNull();
  });
});
