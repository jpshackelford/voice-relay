import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAI } from './useAI';

describe('useAI hook', () => {
  const defaultOptions = {
    deviceId: 'test-device-123',
    mode: 'kiosk' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendMessage', () => {
    it('clears error on successful message send', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // Mock fetch for connect
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ conversationId: 'conv-123' }),
        });

      // Connect first
      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connected).toBe(true);

      // Mock fetch to fail first, then succeed
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'WebSocket not connected' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      // First message fails
      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(result.current.error).toBe('WebSocket not connected');

      // Second message succeeds and clears error
      await act(async () => {
        await result.current.sendMessage('Hello again');
      });

      expect(result.current.error).toBeNull();
    });

    it('sets error on failed message send', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // Mock fetch for connect
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ conversationId: 'conv-123' }),
        });

      // Connect first
      await act(async () => {
        await result.current.connect();
      });

      // Mock fetch to fail
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'Connection failed' }),
        });

      await act(async () => {
        await result.current.sendMessage('Test message');
      });

      expect(result.current.error).toBe('Connection failed');
    });

    it('does not send message when not connected', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

  });

  describe('connect', () => {
    it('sets connected to true on successful connection', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ conversationId: 'conv-123' }),
      });

      expect(result.current.connected).toBe(false);

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.conversationId).toBe('conv-123');
    });

    it('sets error on failed connection', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'API key not configured' }),
      });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.error).toBe('API key not configured');
    });

    it('clears error before attempting connection', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // First connection fails
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'First error' }),
      });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.error).toBe('First error');

      // Second connection attempt - error should be cleared during attempt
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ conversationId: 'conv-456' }),
      });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.connected).toBe(true);
    });

    it('does not connect if already connecting', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      let resolveFirst: (value: unknown) => void;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      global.fetch = vi.fn().mockImplementationOnce(() => firstPromise);

      // Start first connection
      act(() => {
        result.current.connect();
      });

      expect(result.current.connecting).toBe(true);

      // Try to connect again while connecting
      const secondFetch = vi.fn();
      global.fetch = secondFetch;

      await act(async () => {
        await result.current.connect();
      });

      // Second fetch should not be called
      expect(secondFetch).not.toHaveBeenCalled();

      // Resolve first connection
      await act(async () => {
        resolveFirst!({
          ok: true,
          json: () => Promise.resolve({ conversationId: 'conv-123' }),
        });
      });
    });

    it('does not connect if already connected', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ conversationId: 'conv-123' }),
      });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connected).toBe(true);

      // Try to connect again
      const secondFetch = vi.fn();
      global.fetch = secondFetch;

      await act(async () => {
        await result.current.connect();
      });

      // Second fetch should not be called
      expect(secondFetch).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('clears state on disconnect', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // Connect first
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ conversationId: 'conv-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.conversationId).toBe('conv-123');

      await act(async () => {
        await result.current.disconnect();
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.conversationId).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('toggle', () => {
    it('connects when disconnected', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ conversationId: 'conv-123' }),
      });

      expect(result.current.connected).toBe(false);

      await act(async () => {
        await result.current.toggle();
      });

      expect(result.current.connected).toBe(true);
    });

    it('disconnects when connected', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ conversationId: 'conv-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.connected).toBe(true);

      await act(async () => {
        await result.current.toggle();
      });

      expect(result.current.connected).toBe(false);
    });
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

  describe('handleAIStatus', () => {
    it('updates connected state from external status', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      expect(result.current.connected).toBe(false);

      await act(async () => {
        result.current.handleAIStatus({ connected: true, conversationId: 'ext-conv-123' });
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.conversationId).toBe('ext-conv-123');
    });

    it('resets connecting state when disconnected', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // Start connecting but then receive disconnected status
      global.fetch = vi.fn().mockImplementationOnce(
        () => new Promise(() => { /* never resolves */ })
      );

      act(() => {
        result.current.connect();
      });

      expect(result.current.connecting).toBe(true);

      // Receive disconnected status while connecting
      await act(async () => {
        result.current.handleAIStatus({ connected: false });
      });

      expect(result.current.connecting).toBe(false);
      expect(result.current.connected).toBe(false);
    });

    it('clears thinking state when disconnected', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      // Set up connected + thinking state
      await act(async () => {
        result.current.handleAIStatus({ connected: true, conversationId: 'conv-123' });
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'session-1', thinking: true });
      });

      expect(result.current.thinking).toBe(true);

      // Disconnect should clear thinking
      await act(async () => {
        result.current.handleAIStatus({ connected: false });
      });

      expect(result.current.thinking).toBe(false);
    });
  });

  describe('handleAIThinking', () => {
    it('updates thinking state from WebSocket message', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      expect(result.current.thinking).toBe(false);

      await act(async () => {
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'session-1', thinking: true });
      });

      expect(result.current.thinking).toBe(true);

      await act(async () => {
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'session-1', thinking: false });
      });

      expect(result.current.thinking).toBe(false);
    });

    it('filters messages for wrong session when sessionId is set', async () => {
      const optionsWithSession = { ...defaultOptions, sessionId: 'my-session' };
      const { result } = renderHook(() => useAI(optionsWithSession));

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
          sessionId: 'session-1',
          connected: true,
          connecting: false,
          conversationId: 'conv-session-123',
        });
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.conversationId).toBe('conv-session-123');
    });

    it('sets error from session status message', async () => {
      const { result } = renderHook(() => useAI(defaultOptions));

      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'session-1',
          connected: false,
          error: 'Sandbox startup failed',
        });
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.error).toBe('Sandbox startup failed');
    });

    it('filters messages for wrong session when sessionId is set', async () => {
      const optionsWithSession = { ...defaultOptions, sessionId: 'my-session' };
      const { result } = renderHook(() => useAI(optionsWithSession));

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
          sessionId: 'session-1',
          connected: true,
          conversationId: 'conv-123',
        });
        result.current.handleAIThinking({ type: 'ai-thinking', sessionId: 'session-1', thinking: true });
      });

      expect(result.current.thinking).toBe(true);

      // Session disconnect should clear thinking
      await act(async () => {
        result.current.handleSessionAIStatus({
          type: 'session-ai-status',
          sessionId: 'session-1',
          connected: false,
        });
      });

      expect(result.current.thinking).toBe(false);
      expect(result.current.connected).toBe(false);
    });
  });

  describe('thinking state', () => {
    it('returns thinking state', () => {
      const { result } = renderHook(() => useAI(defaultOptions));
      expect(result.current.thinking).toBe(false);
    });
  });
});
