import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAgentEventHistory } from './useAgentEventHistory';

const originalFetch = globalThis.fetch;

interface FakeServerResponse {
  events?: unknown[];
  total?: number;
  rehydrated?: boolean;
  rehydration_complete?: boolean;
  rehydration_error?: string;
  conversation_id?: string | null;
  hydrated_at_oldest?: string | null;
  hydrated_at_newest?: string | null;
}

function makeFetchMock(
  responder: (url: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    body: unknown;
  }>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const { ok, status, body } = await responder(url, init);
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function ok(body: FakeServerResponse) {
  return Promise.resolve({ ok: true, status: 200, body });
}

function err(status: number, body: unknown = null) {
  return Promise.resolve({ ok: false, status, body });
}

describe('useAgentEventHistory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches on mount with valid sessionId and populates history', async () => {
    const fetchMock = makeFetchMock(() =>
      ok({
        events: [
          {
            id: 'h-1',
            kind: 'ActionEvent',
            source: 'agent',
            timestamp: '2026-05-21T10:00:00Z',
            action: { kind: 'ExecuteBashAction', command: 'ls' },
          },
        ],
        total: 1,
        rehydrated: false,
        rehydration_complete: true,
        conversation_id: 'conv-1',
        hydrated_at_oldest: '2026-05-21T10:00:00Z',
        hydrated_at_newest: '2026-05-21T10:00:00Z',
      }),
    );

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].id).toBe('h-1');
    expect(result.current.history[0].kind).toBe('ExecuteBashAction');
    expect(result.current.conversationId).toBe('conv-1');
    expect(result.current.rehydrationComplete).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when sessionId is undefined', async () => {
    const fetchMock = makeFetchMock(() =>
      ok({
        events: [],
        total: 0,
        rehydrated: false,
        rehydration_complete: true,
        conversation_id: null,
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      }),
    );

    const { result } = renderHook(() => useAgentEventHistory({}));

    // Wait a tick to make sure no async fetch fires.
    await new Promise(r => setTimeout(r, 5));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.history).toEqual([]);
  });

  it('does not fetch when enabled is false', async () => {
    const fetchMock = makeFetchMock(() =>
      ok({
        events: [],
        total: 0,
        rehydrated: false,
        rehydration_complete: true,
        conversation_id: null,
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      }),
    );

    renderHook(() => useAgentEventHistory({ sessionId: 's-1', enabled: false }));

    await new Promise(r => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches when sessionId changes', async () => {
    const fetchMock = makeFetchMock((url) => {
      const id = url.match(/sessions\/([^/]+)\//)?.[1] ?? '';
      return ok({
        events: [
          {
            id: `evt-${id}`,
            kind: 'TerminalAction',
            timestamp: '2026-05-21T10:00:00Z',
          },
        ],
        total: 1,
        rehydrated: false,
        rehydration_complete: true,
        conversation_id: `conv-${id}`,
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      });
    });

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useAgentEventHistory({ sessionId }),
      { initialProps: { sessionId: 's-1' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.history[0].id).toBe('evt-s-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ sessionId: 's-2' });

    await waitFor(() => expect(result.current.history[0]?.id).toBe('evt-s-2'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.conversationId).toBe('conv-s-2');
  });

  it('surfaces rehydration_complete=false to callers', async () => {
    makeFetchMock(() =>
      ok({
        events: [],
        total: 0,
        rehydrated: true,
        rehydration_complete: false,
        rehydration_error: 'OH timeout',
        conversation_id: 'conv-1',
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      }),
    );

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rehydrationComplete).toBe(false);
    expect(result.current.error).toBeNull(); // partial rehydration is not a hard error
  });

  it('retry() re-fetches with rehydrate=force', async () => {
    const calls: string[] = [];
    const fetchMock = makeFetchMock((url) => {
      calls.push(url);
      return ok({
        events: [],
        total: 0,
        rehydrated: true,
        rehydration_complete: true,
        conversation_id: 'conv-1',
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      });
    });

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls[0]).toContain('rehydrate=auto');

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(calls[1]).toContain('rehydrate=force');
  });

  it('sets error message on 5xx responses but does not clear history', async () => {
    let call = 0;
    makeFetchMock(() => {
      call++;
      if (call === 1) {
        return ok({
          events: [
            { id: 'h-1', kind: 'TerminalAction', timestamp: '2026-05-21T10:00:00Z' },
          ],
          total: 1,
          rehydrated: false,
          rehydration_complete: true,
          conversation_id: 'conv-1',
          hydrated_at_oldest: null,
          hydrated_at_newest: null,
        });
      }
      return err(500, { error: 'Internal Server Error' });
    });

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.history).toHaveLength(1);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.history).toHaveLength(1); // preserved
    expect(result.current.errorStatus).toBe(500);
  });

  it('handles 404 (session not found) without retrying', async () => {
    const fetchMock = makeFetchMock(() => err(404, { error: 'Session not found' }));

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Session not found');
    expect(result.current.errorStatus).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles 403 (access denied)', async () => {
    makeFetchMock(() => err(403, { error: 'Access denied to session' }));

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Access denied to session');
    expect(result.current.errorStatus).toBe(403);
  });

  it('handles network errors with no status', async () => {
    makeFetchMock(() => Promise.reject(new TypeError('Failed to fetch')));

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.errorStatus).toBeUndefined();
    expect(result.current.error).toContain('Failed to fetch');
  });

  it('treats empty events + conversation_id=null as success (no-mapping case)', async () => {
    makeFetchMock(() =>
      ok({
        events: [],
        total: 0,
        rehydrated: false,
        rehydration_complete: true,
        conversation_id: null,
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      }),
    );

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.conversationId).toBeNull();
  });

  it('treats TTL-pruned response (rehydrated:true, complete:true, events:[]) as success', async () => {
    makeFetchMock(() =>
      ok({
        events: [],
        total: 0,
        rehydrated: true,
        rehydration_complete: true,
        conversation_id: 'conv-1',
        hydrated_at_oldest: null,
        hydrated_at_newest: null,
      }),
    );

    const { result } = renderHook(() =>
      useAgentEventHistory({ sessionId: 's-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rehydrationComplete).toBe(true);
    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
