import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaces, type Workspace } from './useWorkspaces';

// Mutable mock state for useAuth
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

const sampleWorkspace: Workspace = {
  id: 'ws-1',
  ownerId: 'user-1',
  name: 'Test Workspace',
  slug: 'test-workspace',
  joinCode: 'ABC123',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: null,
  isOwner: true,
};

describe('useWorkspaces hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthState = { isAuthenticated: true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch and clears workspaces when not authenticated', async () => {
    mockAuthState = { isAuthenticated: false };
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkspaces());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workspaces).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and exposes workspaces on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([sampleWorkspace]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkspaces());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workspaces).toEqual([sampleWorkspace]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('surfaces an error when the workspaces fetch fails (e.g. 401)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'unauthorized' }, false, 401)) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkspaces());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch workspaces');
    expect(result.current.workspaces).toEqual([]);
  });

  it('surfaces network errors and clears workspaces', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkspaces());

    await waitFor(() => expect(result.current.error).toBe('Network down'));
    expect(result.current.workspaces).toEqual([]);
  });

  it('refresh refetches and replaces stale data', async () => {
    const updated: Workspace = { ...sampleWorkspace, name: 'Renamed' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleWorkspace]))
      .mockResolvedValueOnce(jsonResponse([updated]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.workspaces).toEqual([sampleWorkspace]));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.workspaces).toEqual([updated]);
  });

  describe('createWorkspace', () => {
    it('POSTs and prepends the created workspace', async () => {
      const created: Workspace = { ...sampleWorkspace, id: 'ws-2', name: 'New' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([sampleWorkspace]))
        .mockResolvedValueOnce(jsonResponse(created));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.workspaces).toEqual([sampleWorkspace]));

      let returned: Workspace | undefined;
      await act(async () => {
        returned = await result.current.createWorkspace('New');
      });

      expect(returned).toEqual(created);
      expect(result.current.workspaces).toEqual([created, sampleWorkspace]);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ name: 'New' }),
        }),
      );
    });

    it('throws with API error message on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({ error: 'Name taken' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createWorkspace('dup');
        }),
      ).rejects.toThrow('Name taken');
    });

    it('throws default message when error body has no error field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({}, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createWorkspace('x');
        }),
      ).rejects.toThrow('Failed to create workspace');
    });
  });

  describe('deleteWorkspace', () => {
    it('DELETEs and removes the workspace from local state', async () => {
      const other: Workspace = { ...sampleWorkspace, id: 'ws-2' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([sampleWorkspace, other]))
        .mockResolvedValueOnce(jsonResponse({}, true));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.workspaces).toHaveLength(2));

      await act(async () => {
        await result.current.deleteWorkspace('ws-1');
      });

      expect(result.current.workspaces).toEqual([other]);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces/ws-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('throws and leaves state unchanged on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([sampleWorkspace]))
        .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.workspaces).toEqual([sampleWorkspace]));

      await expect(
        act(async () => {
          await result.current.deleteWorkspace('ws-1');
        }),
      ).rejects.toThrow('forbidden');

      expect(result.current.workspaces).toEqual([sampleWorkspace]);
    });
  });

  describe('joinWorkspace', () => {
    it('POSTs join code and prepends new workspace', async () => {
      const joined: Workspace = { ...sampleWorkspace, id: 'ws-3', name: 'Joined' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([sampleWorkspace]))
        .mockResolvedValueOnce(jsonResponse(joined));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.workspaces).toEqual([sampleWorkspace]));

      let returned: Workspace | undefined;
      await act(async () => {
        returned = await result.current.joinWorkspace('CODE42');
      });

      expect(returned).toEqual(joined);
      expect(result.current.workspaces).toEqual([joined, sampleWorkspace]);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces/join',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ code: 'CODE42' }),
        }),
      );
    });

    it('does not duplicate an already-joined workspace', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([sampleWorkspace]))
        .mockResolvedValueOnce(jsonResponse(sampleWorkspace));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.workspaces).toEqual([sampleWorkspace]));

      await act(async () => {
        await result.current.joinWorkspace('SAME');
      });

      expect(result.current.workspaces).toEqual([sampleWorkspace]);
    });

    it('throws with API error message on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({ error: 'invalid code' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.joinWorkspace('BAD');
        }),
      ).rejects.toThrow('invalid code');
    });

    it('throws default message when error body has no error field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({}, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useWorkspaces());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.joinWorkspace('X');
        }),
      ).rejects.toThrow('Failed to join workspace');
    });
  });

  it('throws default delete message when error body has no error field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleWorkspace]))
      .mockResolvedValueOnce(jsonResponse({}, false));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.workspaces).toEqual([sampleWorkspace]));

    await expect(
      act(async () => {
        await result.current.deleteWorkspace('ws-1');
      }),
    ).rejects.toThrow('Failed to delete workspace');
  });
});
