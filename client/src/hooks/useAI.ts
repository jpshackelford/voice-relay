import { useState, useCallback } from 'react';
import type { DeviceMode } from '../types';

interface UseAIOptions {
  deviceId: string;
  mode: DeviceMode;
}

interface AIStatus {
  available: boolean;
  message: string;
}

export function useAI({ deviceId, mode }: UseAIOptions) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
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

  const connect = useCallback(async () => {
    console.log('[AI] connect() called', { connecting, connected, deviceId, mode });
    if (connecting) {
      console.log('[AI] Already connecting, skipping');
      return;
    }
    if (connected) {
      console.log('[AI] Already connected, skipping');
      return;
    }
    
    console.log('[AI] Connecting...', { deviceId, mode });
    setConnecting(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, mode }),
      });

      const data = await response.json();
      console.log('[AI] Connect response:', response.status, data);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to connect AI');
      }

      setConversationId(data.conversationId);
      setConnected(true);
      console.log('[AI] Connected, conversationId:', data.conversationId);
    } catch (err) {
      console.error('[AI] Connect error:', err);
      setError((err as Error).message);
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }, [deviceId, mode, connecting, connected]);

  const disconnect = useCallback(async () => {
    console.log('[AI] disconnect() called', { connected });
    if (!connected) {
      console.log('[AI] Not connected, skipping disconnect');
      return;
    }

    try {
      console.log('[AI] Disconnecting...');
      await fetch('/api/ai/disconnect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      console.log('[AI] Disconnected');
    } catch (err) {
      console.error('[AI] Failed to disconnect:', err);
    } finally {
      setConnected(false);
      setConversationId(null);
      setError(null);
    }
  }, [deviceId, connected]);

  const sendMessage = useCallback(async (message: string) => {
    if (!connected) return;

    try {
      const response = await fetch('/api/ai/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, message }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send message');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [deviceId, connected]);

  const toggle = useCallback(async () => {
    console.log('[AI] toggle() called', { connected, connecting });
    if (connected) {
      await disconnect();
    } else if (!connecting) {
      await connect();
    }
  }, [connected, connecting, connect, disconnect]);

  // Handle AI status updates from WebSocket
  const handleAIStatus = useCallback((status: { connected: boolean; conversationId?: string }) => {
    setConnected(status.connected);
    setConversationId(status.conversationId || null);
    if (!status.connected) {
      setConnecting(false);
    }
  }, []);

  return {
    connected,
    connecting,
    conversationId,
    error,
    checkAvailability,
    connect,
    disconnect,
    sendMessage,
    toggle,
    handleAIStatus,
  };
}
