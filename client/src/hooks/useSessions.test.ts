import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessions, type SessionSummary } from './useSessions';

let mockAuthState = { isAuthenticated: false };

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const sampleSession: SessionSummary = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  name: 'My Session',
  status: 'active',
  startedAt: '2025-01-01T00:00:00Z',
  deviceCount: 1,
  lastActiveAt: '2025-01-01T01:00:00Z',
};

describe('useSessions hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthState = { isAuthenticated: true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch when workspaceId is undefined', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch when not authenticated', async () => {
    mockAuthState = { isAuthenticated: false };
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and exposes sessions on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessions: [sampleSession] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([sampleSession]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/sessions?status=active',
      expect.objectContaining({
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('defaults to empty array when response omits sessions field', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([]);
  });

  it('surfaces an error when the fetch fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'bad' }, false)) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions('ws-1'));

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch sessions'));
    expect(result.current.sessions).toEqual([]);
  });

  it('surfaces network errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions('ws-1'));

    await waitFor(() => expect(result.current.error).toBe('offline'));
  });

  it('refresh refetches the active sessions list', async () => {
    const newer: SessionSummary = { ...sampleSession, id: 'sess-2', name: 'Other' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [newer] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useSessions('ws-1'));
    await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.sessions).toEqual([newer]);
  });

  describe('createSession', () => {
    it('POSTs and prepends a new session with deviceCount=0', async () => {
      const created = { id: 'sess-2', workspaceId: 'ws-1', name: 'Fresh', status: 'active', startedAt: '2025-02-01T00:00:00Z' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
        .mockResolvedValueOnce(jsonResponse({ session: created }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

      let returned: SessionSummary | undefined;
      await act(async () => {
        returned = await result.current.createSession('Fresh');
      });

      expect(returned?.id).toBe('sess-2');
      expect(returned?.deviceCount).toBe(0);
      expect(returned?.lastActiveAt).toBe(created.startedAt);
      expect(result.current.sessions[0].id).toBe('sess-2');
      expect(result.current.sessions).toHaveLength(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces/ws-1/sessions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Fresh' }),
        }),
      );
    });

    it('rejects when no workspace is selected', async () => {
      const { result } = renderHook(() => useSessions(undefined));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createSession('x');
        }),
      ).rejects.toThrow('No workspace selected');
    });

    it('throws with API error message on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
        .mockResolvedValueOnce(jsonResponse({ error: 'limit reached' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createSession();
        }),
      ).rejects.toThrow('limit reached');
    });

    it('throws default message when error body has no error field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
        .mockResolvedValueOnce(jsonResponse({}, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createSession();
        }),
      ).rejects.toThrow('Failed to create session');
    });
  });

  describe('renameSession', () => {
    it('PATCHes and updates the session name locally', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
        .mockResolvedValueOnce(jsonResponse({}, true));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

      await act(async () => {
        await result.current.renameSession('sess-1', 'Renamed');
      });

      expect(result.current.sessions[0].name).toBe('Renamed');
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces/ws-1/sessions/sess-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );
    });

    it('rejects when no workspace selected', async () => {
      const { result } = renderHook(() => useSessions(undefined));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.renameSession('sess-1', 'x');
        }),
      ).rejects.toThrow('No workspace selected');
    });

    it('throws on API error', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
        .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

      await expect(
        act(async () => {
          await result.current.renameSession('sess-1', 'x');
        }),
      ).rejects.toThrow('nope');
    });

    it('throws default message when error body has no error field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
        .mockResolvedValueOnce(jsonResponse({}, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

      await expect(
        act(async () => {
          await result.current.renameSession('sess-1', 'x');
        }),
      ).rejects.toThrow('Failed to rename session');
    });
  });

  describe('archiveSession', () => {
    it('POSTs and removes the session from local state', async () => {
      const other: SessionSummary = { ...sampleSession, id: 'sess-2' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession, other] }))
        .mockResolvedValueOnce(jsonResponse({}, true));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toHaveLength(2));

      await act(async () => {
        await result.current.archiveSession('sess-1');
      });

      expect(result.current.sessions).toEqual([other]);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces/ws-1/sessions/sess-1/archive',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('rejects when no workspace selected', async () => {
      const { result } = renderHook(() => useSessions(undefined));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.archiveSession('sess-1');
        }),
      ).rejects.toThrow('No workspace selected');
    });

    it('throws and preserves state on API error', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
        .mockResolvedValueOnce(jsonResponse({ error: 'cannot archive' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

      await expect(
        act(async () => {
          await result.current.archiveSession('sess-1');
        }),
      ).rejects.toThrow('cannot archive');
      expect(result.current.sessions).toEqual([sampleSession]);
    });

    it('throws default message when error body has no error field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessions: [sampleSession] }))
        .mockResolvedValueOnce(jsonResponse({}, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useSessions('ws-1'));
      await waitFor(() => expect(result.current.sessions).toEqual([sampleSession]));

      await expect(
        act(async () => {
          await result.current.archiveSession('sess-1');
        }),
      ).rejects.toThrow('Failed to archive session');
    });
  });
});
