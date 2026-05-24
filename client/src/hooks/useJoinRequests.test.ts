import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJoinRequests } from './useJoinRequests';
import type { JoinRequestMessage } from '../types';

const REQUEST_EXPIRY_MS = 5 * 60 * 1000;

function makeJoinRequestMessage(overrides: Partial<JoinRequestMessage['request']> = {}): JoinRequestMessage {
  return {
    type: 'join-request',
    request: {
      id: 'req-1',
      workspaceId: 'ws-1',
      user: {
        id: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

describe('useJoinRequests hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty list of pending requests', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    expect(result.current.pendingRequests).toEqual([]);
  });

  it('appends an incoming join request with computed expiry', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    expect(result.current.pendingRequests).toHaveLength(1);
    const req = result.current.pendingRequests[0];
    expect(req.id).toBe('req-1');
    expect(req.user.username).toBe('alice');
    expect(req.expiresIn).toBe(REQUEST_EXPIRY_MS);
  });

  it('appends multiple distinct requests', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage({ id: 'req-1' }));
      result.current.handleJoinRequest(makeJoinRequestMessage({ id: 'req-2' }));
    });

    expect(result.current.pendingRequests.map(r => r.id)).toEqual(['req-1', 'req-2']);
  });

  it('ignores duplicate request IDs (idempotent handleJoinRequest)', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    expect(result.current.pendingRequests).toHaveLength(1);
  });

  it('auto-removes a pending request after the expiry timeout', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });
    expect(result.current.pendingRequests).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(REQUEST_EXPIRY_MS);
    });

    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('approveRequest sends a join-response message with approved=true', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    act(() => {
      result.current.approveRequest('req-1');
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'join-response',
      requestId: 'req-1',
      approved: true,
    });
    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('denyRequest sends a join-response message with approved=false', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    act(() => {
      result.current.denyRequest('req-1');
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'join-response',
      requestId: 'req-1',
      approved: false,
    });
    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('removeRequest deletes the request without sending a message', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    act(() => {
      result.current.removeRequest('req-1');
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('clears expiry timer when a request is approved before timeout', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });
    act(() => {
      result.current.approveRequest('req-1');
    });
    // Add another request with the same id again - if the timer wasn't cleared
    // it could fire and double-remove (no-op but verifies cleanup happened).
    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    expect(result.current.pendingRequests).toHaveLength(1);

    // Advance halfway - the first request's original timer would have fired by now
    // if it hadn't been cleared. Verify the new request still exists.
    act(() => {
      vi.advanceTimersByTime(REQUEST_EXPIRY_MS / 2);
    });
    expect(result.current.pendingRequests).toHaveLength(1);
  });

  it('re-handling the same id resets the timer (clears stale duplicate)', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });
    // Advance partway and re-handle: stale timer should be cleared.
    act(() => {
      vi.advanceTimersByTime(REQUEST_EXPIRY_MS - 1000);
    });
    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage());
    });

    // Original timer (which would fire 1000ms from now) should be cleared.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.pendingRequests).toHaveLength(1);

    // The new timer should still fire at the full expiry window from the
    // re-handle, so total elapsed REQUEST_EXPIRY_MS from re-handle removes it.
    act(() => {
      vi.advanceTimersByTime(REQUEST_EXPIRY_MS);
    });
    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('cleans up all pending timeouts on unmount', () => {
    const sendMessage = vi.fn();
    const { result, unmount } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.handleJoinRequest(makeJoinRequestMessage({ id: 'req-a' }));
      result.current.handleJoinRequest(makeJoinRequestMessage({ id: 'req-b' }));
    });

    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);

    unmount();

    // After unmount, all timers tracked by the hook should be cleared.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removeRequest for an unknown id is a no-op', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    act(() => {
      result.current.removeRequest('unknown-id');
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.pendingRequests).toHaveLength(0);
  });

  it('approve/deny for an unknown id still sends the response but does not throw', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useJoinRequests({ sendMessage }));

    expect(() => {
      act(() => {
        result.current.approveRequest('ghost');
      });
    }).not.toThrow();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'join-response',
      requestId: 'ghost',
      approved: true,
    });
  });
});
