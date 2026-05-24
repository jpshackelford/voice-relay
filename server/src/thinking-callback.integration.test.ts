/**
 * Integration test for the underlying AISessionManager thinking callback mechanism.
 * 
 * Verifies the end-to-end flow: AI thinking state changes → callback invoked
 * → ai-thinking message broadcast to session devices.
 * 
 * NOTE: as of issue #289 the platform's actual wiring in index.ts no
 * longer touches AISessionManager directly — it subscribes via the
 * AgentDriver fan-out (onAgentThinkingChange). This test still covers
 * the manager's callback machinery, which the driver depends on
 * internally.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DeviceRegistry } from './registry.js';
import { AISessionManager, type ThinkingChangeCallback } from './openhands.js';
import type { AIThinkingMessage } from './types.js';

// Mock WebSocket for testing
function createMockWebSocket() {
  return {
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
    OPEN: 1,
    CLOSED: 3,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    terminate: vi.fn(),
  };
}

describe('AI Thinking State Callback Wiring', () => {
  let registry: DeviceRegistry;
  let manager: AISessionManager;

  beforeEach(() => {
    registry = new DeviceRegistry();
    manager = new AISessionManager();
  });

  test('wiring callback broadcasts ai-thinking message to session devices', () => {
    // Wire the callback (mimics index.ts wiring)
    manager.setThinkingChangeCallback((sessionId: string, thinking: boolean) => {
      const message: AIThinkingMessage = {
        type: 'ai-thinking',
        sessionId,
        thinking,
      };
      registry.broadcastMessageToSession(sessionId, message);
    });

    // Register devices in a session
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    const ws3 = createMockWebSocket();
    
    registry.register('device-1', 'workspace-1', ws1 as any, 'Device 1', 'kiosk', undefined, undefined, 'session-abc');
    registry.register('device-2', 'workspace-1', ws2 as any, 'Device 2', 'mobile', undefined, undefined, 'session-abc');
    registry.register('device-3', 'workspace-1', ws3 as any, 'Device 3', 'mobile', undefined, undefined, 'session-xyz');

    // Simulate thinking state change by invoking the callback directly
    // (In production, this is triggered by AISessionManager when processing messages)
    const callback = (manager as any).onThinkingChange as ThinkingChangeCallback;
    expect(callback).toBeDefined();
    
    // Trigger thinking=true
    callback('session-abc', true);

    // Verify devices in session-abc received the message
    const expectedThinkingMessage = JSON.stringify({
      type: 'ai-thinking',
      sessionId: 'session-abc',
      thinking: true,
    });
    
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws1.send).toHaveBeenCalledWith(expectedThinkingMessage);
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledWith(expectedThinkingMessage);
    
    // Device in different session should NOT receive
    expect(ws3.send).not.toHaveBeenCalled();
  });

  test('callback handles thinking=false state change', () => {
    manager.setThinkingChangeCallback((sessionId: string, thinking: boolean) => {
      const message: AIThinkingMessage = {
        type: 'ai-thinking',
        sessionId,
        thinking,
      };
      registry.broadcastMessageToSession(sessionId, message);
    });

    const ws = createMockWebSocket();
    registry.register('device-1', 'workspace-1', ws as any, 'Device 1', 'kiosk', undefined, undefined, 'session-abc');

    const callback = (manager as any).onThinkingChange as ThinkingChangeCallback;
    
    // Trigger thinking=false
    callback('session-abc', false);

    const expectedMessage = JSON.stringify({
      type: 'ai-thinking',
      sessionId: 'session-abc',
      thinking: false,
    });
    
    expect(ws.send).toHaveBeenCalledWith(expectedMessage);
  });

  test('callback does not fail when no devices in session', () => {
    manager.setThinkingChangeCallback((sessionId: string, thinking: boolean) => {
      const message: AIThinkingMessage = {
        type: 'ai-thinking',
        sessionId,
        thinking,
      };
      registry.broadcastMessageToSession(sessionId, message);
    });

    const callback = (manager as any).onThinkingChange as ThinkingChangeCallback;
    
    // Should not throw when broadcasting to empty session
    expect(() => callback('nonexistent-session', true)).not.toThrow();
  });

  test('message has correct structure for client handling', () => {
    manager.setThinkingChangeCallback((sessionId: string, thinking: boolean) => {
      const message: AIThinkingMessage = {
        type: 'ai-thinking',
        sessionId,
        thinking,
      };
      registry.broadcastMessageToSession(sessionId, message);
    });

    const ws = createMockWebSocket();
    registry.register('device-1', 'workspace-1', ws as any, 'Device 1', 'kiosk', undefined, undefined, 'session-abc');

    const callback = (manager as any).onThinkingChange as ThinkingChangeCallback;
    callback('session-abc', true);

    // Parse the sent message to verify structure
    const sentMessage = JSON.parse(ws.send.mock.calls[0][0]) as AIThinkingMessage;
    
    expect(sentMessage.type).toBe('ai-thinking');
    expect(sentMessage.sessionId).toBe('session-abc');
    expect(sentMessage.thinking).toBe(true);
    expect(Object.keys(sentMessage)).toHaveLength(3);
  });
});
