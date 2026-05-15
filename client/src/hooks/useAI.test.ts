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
    });
  });
});
