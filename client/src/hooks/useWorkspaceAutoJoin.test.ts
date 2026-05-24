import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceAutoJoin } from './useWorkspaceAutoJoin';
import type { ResourceError } from './useResourceFetch';
import type { JoinResolvedMessage } from '../types';

const ACCESS_DENIED: ResourceError = {
  type: 'ACCESS_DENIED',
  status: 403,
  message: 'forbidden',
};

interface FetchMock {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function mockFetchSequence(responses: Array<FetchMock | Error>) {
  let index = 0;
  const fn = vi.fn().mockImplementation(() => {
    if (index >= responses.length) {
      throw new Error(`Unexpected fetch call ${index + 1}`);
    }
    const r = responses[index++];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('useWorkspaceAutoJoin hook', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('does not attempt auto-join when not authenticated', () => {
    const ensureValidToken = vi.fn();
    const onJoinSuccess = vi.fn();
    global.fetch = vi.fn() as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: false,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken,
        onJoinSuccess,
      })
    );

    expect(result.current.attempted).toBe(false);
    expect(result.current.inProgress).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not attempt auto-join when workspaceId missing', () => {
    const ensureValidToken = vi.fn();
    const onJoinSuccess = vi.fn();
    global.fetch = vi.fn() as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: undefined,
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken,
        onJoinSuccess,
      })
    );

    expect(result.current.attempted).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not attempt auto-join when error is not ACCESS_DENIED', () => {
    const ensureValidToken = vi.fn();
    const onJoinSuccess = vi.fn();
    global.fetch = vi.fn() as unknown as typeof fetch;

    renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: { type: 'NOT_FOUND', status: 404, message: 'no' },
        ensureValidToken,
        onJoinSuccess,
      })
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('joins successfully and calls onJoinSuccess with newly-joined flag', async () => {
    const workspace = {
      id: 'ws-1',
      name: 'My Workspace',
      slug: 'my-ws',
      isOwner: false,
      joined: true,
    };
    mockFetchSequence([
      { ok: true, status: 200, json: async () => workspace },
    ]);
    const ensureValidToken = vi.fn().mockResolvedValue(undefined);
    const onJoinSuccess = vi.fn();

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken,
        onJoinSuccess,
      })
    );

    await waitFor(() => {
      expect(result.current.result.success).toBe(true);
    });
    expect(result.current.result.workspace).toEqual(workspace);
    expect(result.current.result.error).toBeNull();
    expect(onJoinSuccess).toHaveBeenCalledWith(true);
    expect(ensureValidToken).toHaveBeenCalled();
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/auto-join',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });

  it('reports a 404 as Workspace not found', async () => {
    mockFetchSequence([
      { ok: false, status: 404, json: async () => ({}) },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-x',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.success).toBe(false);
    });
    expect(result.current.result.error).toBe('Workspace not found');
  });

  it('reports generic 500 error with server message', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.success).toBe(false);
    });
    expect(result.current.result.error).toBe('Internal server error');
  });

  it('falls back to default message when error JSON is invalid', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json');
        },
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.error).toBe('Failed to join workspace');
    });
  });

  it('handles 403 with non-"disabled" message as access error', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'You are banned from this workspace' }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.error).toBe('You are banned from this workspace');
    });
  });

  it('creates a pending join request when auto-join disabled', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'Locked WS', slug: 'locked' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest).not.toBeNull();
    });
    expect(result.current.pendingRequest).toEqual({
      requestId: 'req-99',
      workspaceId: 'ws-1',
      workspaceName: 'Locked WS',
      createdAt: '2026-01-01T00:00:00Z',
    });
    // Still null because waiting for approval
    expect(result.current.result.success).toBeNull();
  });

  it('reports server error during request-join creation', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: false,
        status: 500,
        json: async () => ({ error: 'request creation failed' }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.error).toBe('Failed to create join request');
    });
  });

  it('handles 400 alreadyMember by invoking onJoinSuccess(false)', async () => {
    const onJoinSuccess = vi.fn();
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: false,
        status: 400,
        json: async () => ({ alreadyMember: true }),
      },
    ]);

    renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess,
      })
    );

    await waitFor(() => {
      expect(onJoinSuccess).toHaveBeenCalledWith(false);
    });
  });

  it('handles 400 with custom error from server', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid request body' }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.error).toBe('Invalid request body');
    });
  });

  it('handles network error gracefully', async () => {
    mockFetchSequence([new Error('Network down')]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.result.error).toBe('Failed to join workspace');
    });
  });

  it('handleJoinResolved resolves a pending request as success', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
    ]);
    const onJoinSuccess = vi.fn();

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess,
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.requestId).toBe('req-99');
    });

    const resolved: JoinResolvedMessage = {
      type: 'join-resolved',
      requestId: 'req-99',
      approved: true,
      workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
    };
    act(() => {
      result.current.handleJoinResolved(resolved);
    });

    expect(result.current.result.success).toBe(true);
    expect(result.current.result.workspace).toEqual({
      id: 'ws-1',
      name: 'WS',
      slug: 'ws',
      isOwner: false,
      joined: true,
    });
    expect(result.current.pendingRequest).toBeNull();
    expect(onJoinSuccess).toHaveBeenCalledWith(true);
  });

  it('handleJoinResolved with denial sets failure result', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.requestId).toBe('req-99');
    });

    act(() => {
      result.current.handleJoinResolved({
        type: 'join-resolved',
        requestId: 'req-99',
        approved: false,
        error: 'Owner denied',
      });
    });

    expect(result.current.result.success).toBe(false);
    expect(result.current.result.error).toBe('Owner denied');
    expect(result.current.pendingRequest).toBeNull();
  });

  it('handleJoinResolved ignores unrelated requestIds', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.requestId).toBe('req-99');
    });

    act(() => {
      result.current.handleJoinResolved({
        type: 'join-resolved',
        requestId: 'some-other-id',
        approved: true,
        workspace: { id: 'other', name: 'O', slug: 'o' },
      });
    });

    // Pending request should remain since the resolved id didn't match.
    expect(result.current.pendingRequest?.requestId).toBe('req-99');
  });

  it('handleJoinResolved with denial without error uses default message', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.requestId).toBe('req-99');
    });

    act(() => {
      result.current.handleJoinResolved({
        type: 'join-resolved',
        requestId: 'req-99',
        approved: false,
      });
    });

    expect(result.current.result.error).toBe('Join request denied');
  });

  it('cancelRequest is a no-op when no pending request exists', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const ensureValidToken = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: null,
        ensureValidToken,
        onJoinSuccess: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.cancelRequest();
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(ensureValidToken).not.toHaveBeenCalled();
  });

  it('cancelRequest clears pending state on 204', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
      {
        ok: false,
        status: 204,
        json: async () => ({}),
      },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.requestId).toBe('req-99');
    });

    await act(async () => {
      await result.current.cancelRequest();
    });

    expect(result.current.pendingRequest).toBeNull();
    expect(result.current.result.error).toBe('Join request cancelled');
  });

  it('cancelRequest still clears state on network failure', async () => {
    mockFetchSequence([
      {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auto-join is disabled' }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'req-99',
          workspace: { id: 'ws-1', name: 'WS', slug: 'ws' },
          createdAt: '2026-01-01T00:00:00Z',
        }),
      },
      new Error('Network down'),
    ]);

    const { result } = renderHook(() =>
      useWorkspaceAutoJoin({
        workspaceId: 'ws-1',
        isAuthenticated: true,
        workspaceErrorInfo: ACCESS_DENIED,
        ensureValidToken: vi.fn().mockResolvedValue(undefined),
        onJoinSuccess: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.requestId).toBe('req-99');
    });

    await act(async () => {
      await result.current.cancelRequest();
    });

    expect(result.current.pendingRequest).toBeNull();
    expect(result.current.result.error).toContain('cancelled');
  });

  it('only attempts auto-join once even if effect re-runs', async () => {
    const fetchMock = mockFetchSequence([
      {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'ws-1', name: 'WS', slug: 'ws', isOwner: false, joined: true,
        }),
      },
    ]);

    const { result, rerender } = renderHook(
      ({ token }: { token: () => Promise<unknown> }) =>
        useWorkspaceAutoJoin({
          workspaceId: 'ws-1',
          isAuthenticated: true,
          workspaceErrorInfo: ACCESS_DENIED,
          ensureValidToken: token,
          onJoinSuccess: vi.fn(),
        }),
      { initialProps: { token: vi.fn().mockResolvedValue(undefined) } }
    );

    await waitFor(() => {
      expect(result.current.result.success).toBe(true);
    });

    // Rerender with a new token function (which changes deps); still only one POST.
    rerender({ token: vi.fn().mockResolvedValue(undefined) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
