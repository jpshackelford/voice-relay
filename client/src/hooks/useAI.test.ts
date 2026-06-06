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

  // `checkAvailability` removed in #404 — the `/api/ai/status` endpoint
  // was deleted server-side once per-workspace OpenHands API keys
  // became mandatory. Components branch on the session-state-driven
  // reducer (`connected` / `connecting` / `state`) instead.

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

  // Issue #295 — unified `session-state` wire message + reducer.
  //
  // These tests exercise the test matrix declared in the issue
  // (T-3.6.1..12). The reducer's state IS `AgentSessionStatusWire`; the
  // hook's returned booleans are derived at render time.
  describe('session-state reducer (issue #295)', () => {
    const sid = 'test-session-123';

    // Build a wire-shape `AgentSessionStatus` quickly for tests.
    function status(
      partial: Partial<{
        state: 'absent' | 'starting' | 'ready' | 'thinking' | 'reconnecting' | 'degraded';
        conversationId: string | null;
        error: string | null;
        thinkingSince: string | null;
        startingSince: string | null;
        sessionId: string;
      }> = {},
    ) {
      return {
        sessionId: partial.sessionId ?? sid,
        state: partial.state ?? 'absent',
        conversationId: partial.conversationId ?? null,
        error: partial.error ?? null,
        thinkingSince: partial.thinkingSince ?? null,
        startingSince: partial.startingSince ?? null,
      };
    }

    // T-3.6.1
    it('starts in the absent state with all derived booleans false', () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      expect(result.current.aiStatus.state).toBe('absent');
      expect(result.current.connected).toBe(false);
      expect(result.current.thinking).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(result.current.degraded).toBe(false);
    });

    // T-3.6.2
    it('session-state with state=ready flips connected', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'ready', conversationId: 'c1' }),
        });
      });
      expect(result.current.aiStatus.state).toBe('ready');
      expect(result.current.connected).toBe(true);
      expect(result.current.thinking).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(result.current.conversationId).toBe('c1');
    });

    // T-3.6.3
    it('session-state with state=thinking flips thinking + connected', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'thinking', thinkingSince: '2026-05-24T00:00:00Z' }),
        });
      });
      expect(result.current.thinking).toBe(true);
      expect(result.current.connected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.aiStatus.thinkingSince).toBe('2026-05-24T00:00:00Z');
    });

    // T-3.6.4
    it('session-state with state=starting flips connecting', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'starting' }),
        });
      });
      expect(result.current.connecting).toBe(true);
      expect(result.current.connected).toBe(false);
    });

    // T-3.6.5
    it('session-state with state=reconnecting flips connecting only', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'reconnecting' }),
        });
      });
      expect(result.current.connecting).toBe(true);
      expect(result.current.connected).toBe(false);
      expect(result.current.thinking).toBe(false);
    });

    // T-3.6.6
    it('session-state with state=degraded surfaces degraded + error', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'degraded', error: 'stuck' }),
        });
      });
      expect(result.current.degraded).toBe(true);
      expect(result.current.error).toBe('stuck');
      expect(result.current.connected).toBe(false);
      expect(result.current.connecting).toBe(false);
    });

    // T-3.6.7
    it('legacy-status applies before any session-state arrives', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: sid,
          connected: true,
          connecting: false,
          conversationId: 'c1',
        });
      });
      expect(result.current.connected).toBe(true);
      expect(result.current.aiStatus.state).toBe('ready');
      expect(result.current.aiStatus.conversationId).toBe('c1');
    });

    // T-3.6.8
    it('legacy-status is ignored after session-state has been seen', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'ready', conversationId: 'authoritative' }),
        });
      });
      expect(result.current.aiStatus.state).toBe('ready');

      // Now send a legacy message with conflicting values — must be a no-op.
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: sid,
          connected: false,
          connecting: true,
          conversationId: 'stale',
          error: 'spurious',
        });
      });
      expect(result.current.aiStatus.state).toBe('ready');
      expect(result.current.aiStatus.conversationId).toBe('authoritative');
      expect(result.current.error).toBeNull();
    });

    // T-3.6.9
    it('legacy-thinking applies before any session-state arrives', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      // Seed connected so the legacy thinking transition has a defined
      // base state to combine with.
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: sid,
          connected: true,
        });
        result.current.handleAIThinking({
          type: 'ai-thinking',
          sessionId: sid,
          thinking: true,
          thinkingSince: '2026-05-24T00:00:00Z',
        });
      });
      expect(result.current.thinking).toBe(true);
      expect(result.current.aiStatus.thinkingSince).toBe('2026-05-24T00:00:00Z');
    });

    // T-3.6.10
    it('legacy-thinking is ignored after session-state has been seen', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'ready' }),
        });
      });
      const before = result.current.aiStatus;

      await act(async () => {
        result.current.handleAIThinking({
          type: 'ai-thinking',
          sessionId: sid,
          thinking: true,
        });
      });
      expect(result.current.aiStatus).toEqual(before);
      expect(result.current.thinking).toBe(false);
    });

    // T-3.6.11
    it('session-state for a mismatched sessionId is ignored', async () => {
      const { result } = renderHook(() => useAI({ sessionId: 's1' }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: 's2',
          ai: status({ sessionId: 's2', state: 'ready' }),
        });
      });
      // No-op because the message wasn't ours.
      expect(result.current.aiStatus.state).toBe('absent');
      expect(result.current.connected).toBe(false);
    });

    // T-3.6.12
    it('reset clears state and re-enables the legacy fallback', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'ready', conversationId: 'c1' }),
        });
      });
      expect(result.current.aiStatus.state).toBe('ready');

      await act(async () => {
        result.current.reset();
      });
      expect(result.current.aiStatus.state).toBe('absent');
      expect(result.current.aiStatus.conversationId).toBeNull();

      // Legacy is honored again.
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: sid,
          connected: true,
          conversationId: 'c2',
        });
      });
      expect(result.current.connected).toBe(true);
      expect(result.current.aiStatus.conversationId).toBe('c2');
    });

    // Extra: derived `degraded` strictly reflects the unified state, not
    // the old heuristic. After #295 the reducer no longer needs
    // `!connected && !connecting && error` — a healthy `ready` status with
    // an incidental error string never shows `degraded`.
    it('derived degraded reflects state directly (not the legacy heuristic)', async () => {
      const { result } = renderHook(() => useAI({ sessionId: sid }));
      await act(async () => {
        result.current.handleSessionState({
          type: 'session-state',
          sessionId: sid,
          ai: status({ state: 'ready', error: 'lingering' }),
        });
      });
      // The legacy heuristic would have classified this as degraded
      // (connected=true would have negated it, so this case is
      // illustrative rather than asserting the negative behaviour).
      expect(result.current.degraded).toBe(false);
      expect(result.current.connected).toBe(true);
    });
  });
});
