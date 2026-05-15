import { useState, useCallback } from 'react';
import type { AIThinkingMessage, SessionAIStatusMessage } from '../types';

interface UseAIOptions {
  sessionId?: string;  // VR session ID for session-centric AI
}

interface AIStatus {
  available: boolean;
  message: string;
}

/**
 * Hook for managing session-centric AI connection state.
 * 
 * AI sessions are now automatically managed:
 * - Auto-connect when first device joins a session
 * - Messages are forwarded to AI via WebSocket (server-side)
 * - Connection state is pushed from server via WebSocket
 * 
 * This hook provides read-only status and handlers for WebSocket events.
 */
export function useAI({ sessionId }: UseAIOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkAvailability = useCallback(async (): Promise<AIStatus> => {
    try {
      const response = await fetch('/api/ai/status');
      return await response.json();
    } catch {
      return { available: false, message: 'Failed to check AI status' };
    }
  }, []);

  // Handle session-level AI status from WebSocket (session-centric)
  const handleSessionAIStatus = useCallback((message: SessionAIStatusMessage) => {
    // Only process messages for our session
    if (sessionId && message.sessionId !== sessionId) return;

    setConnecting(message.connecting ?? false);
    setConnected(message.connected);
    setConversationId(message.conversationId ?? null);
    if (message.error) setError(message.error);
    
    // Clear thinking state when disconnected
    if (!message.connected) {
      setThinking(false);
    }
  }, [sessionId]);

  // Handle thinking state from WebSocket
  const handleAIThinking = useCallback((message: AIThinkingMessage) => {
    // Only process messages for our session
    if (sessionId && message.sessionId !== sessionId) return;
    setThinking(message.thinking);
  }, [sessionId]);

  return {
    connected,
    connecting,
    thinking,
    conversationId,
    error,
    checkAvailability,
    handleSessionAIStatus,
    handleAIThinking,
  };
}
