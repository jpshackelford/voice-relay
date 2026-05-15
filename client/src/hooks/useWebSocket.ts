import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, ServerMessage, DeviceMode, DeviceInfo, SessionInfo, JoinResponseMessage } from '../types';
import { storeDeviceToken, clearDeviceToken } from '../utils/deviceToken';

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
  onAIThinkingMessage?: (message: ServerMessage & { type: 'ai-thinking' }) => void;
  onSessionAIStatusMessage?: (message: ServerMessage & { type: 'session-ai-status' }) => void;
  onJoinRequestMessage?: (message: ServerMessage & { type: 'join-request' }) => void;
  onJoinResolvedMessage?: (message: ServerMessage & { type: 'join-resolved' }) => void;
  onDeviceRemovedMessage?: (message: ServerMessage & { type: 'device-removed' }) => void;
  onWorkspaceDeletedMessage?: (message: ServerMessage & { type: 'workspace-deleted' }) => void;
}

export function useWebSocket({ deviceId, displayName, mode, workspaceId, sessionId, onTextMessage, onHistoryMessage, onDisplayMessage, onAIStatusMessage, onAIThinkingMessage, onSessionAIStatusMessage, onJoinRequestMessage, onJoinResolvedMessage, onDeviceRemovedMessage, onWorkspaceDeletedMessage }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const [wasRemoved, setWasRemoved] = useState(false);
  const registeredRef = useRef(false);
  const currentModeRef = useRef(mode);
  const onTextMessageRef = useRef(onTextMessage);
  const onHistoryMessageRef = useRef(onHistoryMessage);
  const onDisplayMessageRef = useRef(onDisplayMessage);
  const onAIStatusMessageRef = useRef(onAIStatusMessage);
  const onAIThinkingMessageRef = useRef(onAIThinkingMessage);
  const onSessionAIStatusMessageRef = useRef(onSessionAIStatusMessage);
  const onJoinRequestMessageRef = useRef(onJoinRequestMessage);
  const onJoinResolvedMessageRef = useRef(onJoinResolvedMessage);
  const onDeviceRemovedMessageRef = useRef(onDeviceRemovedMessage);
  const onWorkspaceDeletedMessageRef = useRef(onWorkspaceDeletedMessage);
  
  // Track last known device state to preserve during reconnection
  // This prevents UI flicker when WebSocket reconnects (e.g., during QR token refresh)
  const lastKnownDevicesRef = useRef<DeviceInfo[]>([]);

  // Keep refs up to date
  onTextMessageRef.current = onTextMessage;
  onHistoryMessageRef.current = onHistoryMessage;
  onDisplayMessageRef.current = onDisplayMessage;
  onAIStatusMessageRef.current = onAIStatusMessage;
  onAIThinkingMessageRef.current = onAIThinkingMessage;
  onSessionAIStatusMessageRef.current = onSessionAIStatusMessage;
  onJoinRequestMessageRef.current = onJoinRequestMessage;
  onJoinResolvedMessageRef.current = onJoinResolvedMessage;
  onDeviceRemovedMessageRef.current = onDeviceRemovedMessage;
  onWorkspaceDeletedMessageRef.current = onWorkspaceDeletedMessage;

  // Connect WebSocket (only depends on deviceId)
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log('[WS] Connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    registeredRef.current = false;
    
    // Preserve last known devices during reconnection to prevent UI flicker.
    // This is critical for kiosk mode where mobileDevices.length > 0 controls
    // the display state between mini QR and full-screen QR.
    // We restore devices immediately and let the server update them once connected.
    if (lastKnownDevicesRef.current.length > 0) {
      console.log('[WS] Preserving', lastKnownDevicesRef.current.length, 'devices during reconnection');
      setDevices(lastKnownDevicesRef.current);
    }

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
            // Update both state and ref to preserve across reconnections
            setDevices(message.devices);
            lastKnownDevicesRef.current = message.devices;
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
          case 'ai-thinking':
            onAIThinkingMessageRef.current?.(message);
            break;
          case 'session-ai-status':
            onSessionAIStatusMessageRef.current?.(message);
            break;
          case 'join-request':
            onJoinRequestMessageRef.current?.(message);
            break;
          case 'join-resolved':
            onJoinResolvedMessageRef.current?.(message);
            break;
          case 'device-removed':
            console.log('[WS] Device removed from workspace:', message.deviceId);
            // Clear stored token since it's now invalid
            clearDeviceToken();
            // Update state to indicate removal
            setWasRemoved(true);
            setConnected(false);
            // Notify callback if provided
            onDeviceRemovedMessageRef.current?.(message);
            break;
          case 'workspace-deleted':
            console.log('[WS] Workspace was deleted:', message.reason);
            // Clear stored token since it's now invalid
            clearDeviceToken();
            setConnected(false);
            // Clear devices since workspace no longer exists
            setDevices([]);
            lastKnownDevicesRef.current = [];
            // Notify callback if provided
            onWorkspaceDeletedMessageRef.current?.(message);
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

  const sendJoinResponse = useCallback((response: JoinResponseMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(response));
    }
  }, []);

  return { connected, devices, currentSession, wasRemoved, sendText, updateDevice, sendJoinResponse };
}
