import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQrToken } from './useQrToken';

// Mock useAuth hook
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

describe('useQrToken hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null token when not enabled', () => {
    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: false })
    );

    expect(result.current.token).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.supported).toBe(true);
  });

  it('returns null token when missing workspaceId', () => {
    const { result } = renderHook(() => 
      useQrToken({ workspaceId: undefined, sessionId: 'sess1', enabled: true })
    );

    expect(result.current.token).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('returns null token when missing sessionId', () => {
    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: undefined, enabled: true })
    );

    expect(result.current.token).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches token when enabled with valid ids', async () => {
    const mockToken = {
      token: 'abc123def456abc123def456abc12345',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      url: 'http://localhost/workspace/ws1/session/sess1?qr=abc123',
      workspaceId: 'ws1',
      sessionId: 'sess1',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockToken,
    });

    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: true })
    );

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.token).toEqual(mockToken);
    expect(result.current.error).toBeNull();
    expect(result.current.supported).toBe(true);
  });

  it('handles 503 as unsupported (graceful degradation)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'QR token generation not available' }),
    });

    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // 503 should set supported=false but error=null (graceful degradation)
    expect(result.current.token).toBeNull();
    expect(result.current.supported).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.token).toBeNull();
    expect(result.current.error).toBe('Internal server error');
  });

  it('handles network errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.token).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('getQrUrl returns URL without token when token is null', () => {
    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: false })
    );

    const url = result.current.getQrUrl();
    expect(url).not.toContain('?qr=');
    expect(url).toContain('/workspace/ws1/session/sess1');
  });

  it('getQrUrl returns URL with token when token exists', async () => {
    const mockToken = {
      token: 'test-token-1234567890abcdef1234',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      url: 'http://localhost/workspace/ws1/session/sess1?qr=test-token-1234567890abcdef1234',
      workspaceId: 'ws1',
      sessionId: 'sess1',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockToken,
    });

    const { result } = renderHook(() => 
      useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.token).not.toBeNull();
    });

    const url = result.current.getQrUrl();
    expect(url).toContain(`?qr=${mockToken.token}`);
  });

  it('clears token when disabled after being enabled', async () => {
    const mockToken = {
      token: 'test-token-abcdef123456789012345',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      url: 'http://localhost/workspace/ws1/session/sess1?qr=test-token',
      workspaceId: 'ws1',
      sessionId: 'sess1',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockToken,
    });

    const { result, rerender } = renderHook(
      ({ enabled }) => useQrToken({ workspaceId: 'ws1', sessionId: 'sess1', enabled }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => {
      expect(result.current.token).not.toBeNull();
    });

    // Disable
    rerender({ enabled: false });

    await waitFor(() => {
      expect(result.current.token).toBeNull();
    });
  });

  describe('retry logic', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries on fetch failure with exponential backoff', async () => {
      const mockToken = {
        token: 'retry-success-token-123456789012',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        url: 'http://localhost/workspace/ws1/session/sess1?qr=retry-success',
        workspaceId: 'ws1',
        sessionId: 'sess1',
      };

      // First call fails, second succeeds
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network error');
        }
        return {
          ok: true,
          status: 200,
          json: async () => mockToken,
        };
      });

      const { result } = renderHook(() => 
        useQrToken({ 
          workspaceId: 'ws1', 
          sessionId: 'sess1', 
          enabled: true,
          baseRetryDelayMs: 100, // Short delay for testing
        })
      );

      // Wait for first fetch to fail
      await vi.waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });
      expect(callCount).toBe(1);

      // Advance timer to trigger retry (100ms * 2^0 = 100ms)
      await vi.advanceTimersByTimeAsync(100);

      // Wait for second fetch to succeed
      await vi.waitFor(() => {
        expect(result.current.token).not.toBeNull();
      });
      expect(callCount).toBe(2);
      expect(result.current.error).toBeNull();
    });

    it('schedules retry after fetch failure', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        throw new Error('Persistent error');
      });

      renderHook(() => 
        useQrToken({ 
          workspaceId: 'ws1', 
          sessionId: 'sess1', 
          enabled: true,
          maxRetries: 2,
          baseRetryDelayMs: 50,
        })
      );

      // Initial fetch is called
      await vi.waitFor(() => {
        expect(callCount).toBeGreaterThanOrEqual(1);
      });
      const initialCount = callCount;

      // Advance to first retry
      await vi.advanceTimersByTimeAsync(50);
      await vi.waitFor(() => {
        expect(callCount).toBe(initialCount + 1);
      });

      // Advance to second retry
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => {
        expect(callCount).toBe(initialCount + 2);
      });

      // No more retries after max exceeded
      const countAfterMaxRetries = callCount;
      await vi.advanceTimersByTimeAsync(10000);
      expect(callCount).toBe(countAfterMaxRetries);
    });

    it('does not retry on 503 (unsupported feature)', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'QR token generation not available' }),
        };
      });

      const { result } = renderHook(() => 
        useQrToken({ 
          workspaceId: 'ws1', 
          sessionId: 'sess1', 
          enabled: true,
          maxRetries: 3,
          baseRetryDelayMs: 50,
        })
      );

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 503 should not trigger retry
      expect(callCount).toBe(1);
      expect(result.current.supported).toBe(false);
      expect(result.current.error).toBeNull(); // Graceful degradation

      // Advance time - no retry should happen
      await vi.advanceTimersByTimeAsync(10000);
      expect(callCount).toBe(1); // Still 1, no retry
    });
  });
});
