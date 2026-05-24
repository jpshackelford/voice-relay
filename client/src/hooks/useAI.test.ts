import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAI } from './useAI';

describe('useAI hook', () => {
  const defaultOptions = {
    sessionId: 'test-session-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkAvailability', () => {
    it('returns availability status from API', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ available: true, message: 'AI is ready' }),
      });

      let status;
      await act(async () => {
        status = await result.current.checkAvailability();
      });

      expect(status).toEqual({ available: true, message: 'AI is ready' });
    });

    it('returns not available on fetch error', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      let status;
      await act(async () => {
        status = await result.current.checkAvailability();
      });

      expect(status).toEqual({ available: false, message: 'Failed to check AI status' });
    });
  });

  describe('handleAIThinking', () => {
    it('updates thinking state from WebSocket message', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      expect(result.current.thinking).toBe(false);

      await act(async () => {
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'test-session-123', thinking: true });
      });

      expect(result.current.thinking).toBe(true);

      await act(async () => {
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'test-session-123', thinking: false });
      });

      expect(result.current.thinking).toBe(false);
    });

    it('filters messages for wrong session when sessionId is set', async () => {
      const { result } = renderHook(() => useAI({ sessionId: 'my-session' }));

      expect(result.current.thinking).toBe(false);

      // Message for different session should be ignored
      await act(async () => {
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'other-session', thinking: true });
      });

      expect(result.current.thinking).toBe(false);

      // Message for correct session should be processed
      await act(async () => {
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'my-session', thinking: true });
      });

      expect(result.current.thinking).toBe(true);
    });
  });

  describe('handleSessionAIStatus', () => {
    it('updates connection state from session status message', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      expect(result.current.connected).toBe(false);
      expect(result.current.connecting).toBe(false);

      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: true,
          connecting: false,
          conversationId: 'conv-session-123',
        });
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.conversationId).toBe('conv-session-123');
    });

    it('updates connecting state', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      expect(result.current.connecting).toBe(false);

      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          connecting: true,
        });
      });

      expect(result.current.connecting).toBe(true);
      expect(result.current.connected).toBe(false);
    });

    it('sets error from session status message', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          error: 'Sandbox startup failed',
        });
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.error).toBe('Sandbox startup failed');
    });

    it('filters messages for wrong session when sessionId is set', async () => {
      const { result } = renderHook(() => useAI({ sessionId: 'my-session' }));

      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'other-session',
          connected: true,
          conversationId: 'wrong-conv',
        });
      });

      // Should be ignored - not our session
      expect(result.current.connected).toBe(false);
      expect(result.current.conversationId).toBeNull();
    });

    it('clears thinking state when session disconnects', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // Set up connected + thinking
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: true,
          conversationId: 'conv-123',
        });
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'test-session-123', thinking: true });
      });

      expect(result.current.thinking).toBe(true);

      // Session disconnect should clear thinking
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
        });
      });

      expect(result.current.thinking).toBe(false);
      expect(result.current.connected).toBe(false);
    });
  });

  describe('initial state', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      expect(result.current.connected).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(result.current.thinking).toBe(false);
      expect(result.current.conversationId).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.degraded).toBe(false);
      expect(result.current.restarting).toBe(false);
      expect(result.current.restartError).toBeNull();
    });
  });

  // Issue #294 — degraded indicator + restart action
  describe('degraded indicator', () => {
    it('is false for absent (no connection ever)', () => {
      const { result } = renderHook(() => useAI(defaultOptions));
      expect(result.current.degraded).toBe(false);
    });

    it('is false while connected (ready / thinking)', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: true,
        });
      });
      expect(result.current.degraded).toBe(false);
    });

    it('is false while connecting', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          connecting: true,
        });
      });
      expect(result.current.degraded).toBe(false);
    });

    it('is true when error is set and the session is neither connected nor connecting', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          connecting: false,
          error: 'Agent appears stuck',
        });
      });
      expect(result.current.degraded).toBe(true);
      expect(result.current.error).toBe('Agent appears stuck');
    });

    it('clears the degraded flag when a healthy status arrives', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          error: 'stuck',
        });
      });
      expect(result.current.degraded).toBe(true);

      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: true,
        });
      });
      expect(result.current.degraded).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('restart', () => {
    function mockOkResponse(body: object) {
      return {
        ok: true,
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }

    function mockErrResponse(status: number, body: object) {
      return {
        ok: false,
        status,
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }

    it('POSTs to the restart endpoint and returns ok with the new status', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(mockOkResponse({
        sessionId: 'test-session-123',
        state: 'starting',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: '2026-05-24T00:00:00.000Z',
      }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useAI(defaultOptions));
      // seed degraded state so we can verify the optimistic flip
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          error: 'stuck',
        });
      });
      expect(result.current.degraded).toBe(true);

      let outcome: Awaited<ReturnType<typeof result.current.restart>> | undefined;
      await act(async () => {
        outcome = await result.current.restart();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sessions/test-session-123/ai/restart');
      expect((init as RequestInit).method).toBe('POST');
      expect(outcome?.ok).toBe(true);
      if (outcome && outcome.ok) {
        expect(outcome.status.state).toBe('starting');
      }
      // Optimistic transition: connecting=true, error cleared, degraded false
      expect(result.current.connecting).toBe(true);
      expect(result.current.degraded).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.restartError).toBeNull();
      expect(result.current.restarting).toBe(false);
    });

    it('returns an error result and rolls back optimistic state on a 5xx', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        mockErrResponse(503, { error: 'driver boom' })
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useAI(defaultOptions));
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'test-session-123',
          connected: false,
          error: 'stuck',
        });
      });

      let outcome: Awaited<ReturnType<typeof result.current.restart>> | undefined;
      await act(async () => {
        outcome = await result.current.restart();
      });

      expect(outcome).toEqual({
        ok: false,
        error: 'driver boom',
        status: 503,
      });
      expect(result.current.restartError).toBe('driver boom');
      expect(result.current.connecting).toBe(false);
      // Rolled-back error keeps the degraded indicator visible.
      expect(result.current.degraded).toBe(true);
      expect(result.current.error).toBe('driver boom');
    });

    it('returns an error result on network failure', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useAI(defaultOptions));
      let outcome: Awaited<ReturnType<typeof result.current.restart>> | undefined;
      await act(async () => {
        outcome = await result.current.restart();
      });

      expect(outcome).toEqual({ ok: false, error: 'offline' });
      expect(result.current.restartError).toBe('offline');
    });

    it('refuses to POST when no sessionId is configured', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const { result } = renderHook(() => useAI({}));

      let outcome: Awaited<ReturnType<typeof result.current.restart>> | undefined;
      await act(async () => {
        outcome = await result.current.restart();
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(outcome).toEqual({ ok: false, error: 'No session selected' });
      expect(result.current.restartError).toBe('No session selected');
    });
  });
});
