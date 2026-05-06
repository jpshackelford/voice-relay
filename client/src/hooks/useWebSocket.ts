import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, ServerMessage, DeviceMode, DeviceInfo, SessionInfo } from '../types';
import { storeDeviceToken } from '../utils/deviceToken';

interface UseWebSocketOptions {
  deviceId: string;
  displayName: string;
  mode: DeviceMode;
  workspaceId?: string;
  sessionId?: string;  // Optional: if omitted, server auto-assigns to active session
  onTextMessage?: (message: ServerMessage & { type: 'text' }) => void;
  onHistoryMessage?: (message: ServerMessage & { type: 'history' }) => void;
  onDisplayMessage?: (message: ServerMessage & { type: 'display' }) => void;
  onAIStatusMessage?: (message: ServerMessage & { type: 'ai-status' }) => void;
}

export function useWebSocket({ deviceId, displayName, mode, workspaceId, sessionId, onTextMessage, onHistoryMessage, onDisplayMessage, onAIStatusMessage }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const registeredRef = useRef(false);
  const currentModeRef = useRef(mode);
  const onTextMessageRef = useRef(onTextMessage);
  const onHistoryMessageRef = useRef(onHistoryMessage);
  const onDisplayMessageRef = useRef(onDisplayMessage);
  const onAIStatusMessageRef = useRef(onAIStatusMessage);

  // Keep refs up to date
  onTextMessageRef.current = onTextMessage;
  onHistoryMessageRef.current = onHistoryMessage;
  onDisplayMessageRef.current = onDisplayMessage;
  onAIStatusMessageRef.current = onAIStatusMessage;

  // Connect WebSocket (only depends on deviceId)
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log('[WS] Connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    registeredRef.current = false;

    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
      
      // Register this device with current mode, workspace, session, and screen dimensions
      const registerMsg: ClientMessage = {
        type: 'register',
        deviceId,
        displayName,
        mode: currentModeRef.current,
        workspaceId,
        sessionId,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      };
      ws.send(JSON.stringify(registerMsg));
      registeredRef.current = true;
    };

    ws.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'registered':
            console.log('[WS] Registered as', message.deviceId, 'in session', message.session);
            setCurrentSession(message.session);
            
            // Store device token if provided (first-time registration)
            if (message.deviceToken && workspaceId) {
              console.log('[WS] Storing device token for reconnection');
              storeDeviceToken({
                deviceId: message.deviceId,
                deviceToken: message.deviceToken,
                workspaceId,
                name: displayName,
                mode,
              });
            }
            break;
          case 'device-list':
            setDevices(message.devices);
            break;
          case 'text':
            onTextMessageRef.current?.(message);
            break;
          case 'history':
            onHistoryMessageRef.current?.(message);
            break;
          case 'display':
            onDisplayMessageRef.current?.(message);
            break;
          case 'ai-status':
            onAIStatusMessageRef.current?.(message);
            break;
        }
      } catch (err) {
        console.error('[WS] Error parsing message:', err);
      }
    };

    ws.onclose = (event) => {
      console.log('[WS] Disconnected', event.code, event.reason);
      setConnected(false);
      registeredRef.current = false;
      setCurrentSession(null);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };

    return () => {
      ws.close();
    };
  }, [deviceId, displayName, workspaceId, sessionId]);

  // Update mode on server when it changes (without reconnecting)
  useEffect(() => {
    currentModeRef.current = mode;
    
    if (wsRef.current?.readyState === WebSocket.OPEN && registeredRef.current) {
      const message: ClientMessage = {
        type: 'update-device',
        mode,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, [mode]);

  const sendText = useCallback((utteranceId: string, text: string, partial: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: ClientMessage = {
        type: 'text',
        utteranceId,
        text,
        partial,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const updateDevice = useCallback((updates: { displayName?: string; mode?: DeviceMode; ttsEnabled?: boolean }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: ClientMessage = {
        type: 'update-device',
        ...updates,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, devices, currentSession, sendText, updateDevice };
}
