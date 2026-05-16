/**
 * Tests for auto-connect AI logic
 * 
 * Verifies that AI is properly connected when first device joins a session,
 * handles error cases gracefully, and broadcasts correct status messages.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { autoConnectAI, shouldAutoConnect, type AutoConnectDependencies } from './auto-connect.js';
import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { MessageStore } from './storage/index.js';
import type { AISessionManager, AISession } from './openhands.js';
import type { SessionAIStatusMessage } from './types.js';

// Mock factories for test dependencies
function createMockRegistry(): DeviceRegistry {
  return {
    broadcastMessageToSession: vi.fn(),
    broadcastToSession: vi.fn(),
    getMinKioskDisplayLines: vi.fn().mockReturnValue(12),
  } as unknown as DeviceRegistry;
}

function createMockSessionRepository(
  devicesInSession: { id: string }[] = [],
  displaySecret: string | null = null
): SessionRepository {
  return {
    getDevices: vi.fn().mockReturnValue(devicesInSession),
    getDisplaySecret: vi.fn().mockReturnValue(displaySecret),
    setDisplaySecret: vi.fn().mockReturnValue('generated-secret-123'),
  } as unknown as SessionRepository;
}

function createMockWorkspaceRepository(): WorkspaceRepository {
  return {
    getSettings: vi.fn().mockReturnValue(null),
  } as unknown as WorkspaceRepository;
}

function createMockAISessionManager(options: {
  isAvailable?: boolean;
  hasSessionAI?: boolean;
  shouldThrow?: boolean;
  throwMessage?: string;
} = {}): AISessionManager {
  const { 
    isAvailable = true, 
    hasSessionAI = false, 
    shouldThrow = false,
    throwMessage = 'API error' 
  } = options;
  
  const mockSession: AISession = {
    conversationId: 'conv-123',
    taskId: 'task-456',
    sessionId: 'test-session',
    mode: 'kiosk',
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    isThinking: false,
  };

  return {
    isAvailable: vi.fn().mockReturnValue(isAvailable),
    hasSessionAI: vi.fn().mockReturnValue(hasSessionAI),
    getOrCreateForSession: shouldThrow 
      ? vi.fn().mockRejectedValue(new Error(throwMessage))
      : vi.fn().mockResolvedValue(mockSession),
  } as unknown as AISessionManager;
}

function createMockStore(): MessageStore {
  return {
    append: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageStore;
}

function createDependencies(overrides: Partial<AutoConnectDependencies> = {}): AutoConnectDependencies {
  return {
    registry: createMockRegistry(),
    sessionRepository: createMockSessionRepository(),
    workspaceRepository: createMockWorkspaceRepository(),
    aiSessionManager: createMockAISessionManager(),
    store: createMockStore(),
    getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('autoConnectAI', () => {
  describe('successful connection flow', () => {
    test('broadcasts connecting status, then connected status on success', async () => {
      const deps = createDependencies();
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should broadcast connecting status first
      expect(deps.registry.broadcastMessageToSession).toHaveBeenNthCalledWith(1, 'session-123', {
        type: 'session-ai-status',
        sessionId: 'session-123',
        connecting: true,
        connected: false,
      });
      
      // Should broadcast connected status after success
      expect(deps.registry.broadcastMessageToSession).toHaveBeenNthCalledWith(2, 'session-123', {
        type: 'session-ai-status',
        sessionId: 'session-123',
        connecting: false,
        connected: true,
        conversationId: 'conv-123',
      });
    });

    test('creates AI session with correct parameters', async () => {
      const deps = createDependencies({
        sessionRepository: createMockSessionRepository([], 'existing-secret'),
      });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      expect(deps.aiSessionManager.getOrCreateForSession).toHaveBeenCalledWith(
        'session-123',
        'workspace-456',
        expect.any(Function),
        expect.objectContaining({
          displayLines: 12,
          displayApiSecret: 'existing-secret',
        })
      );
    });

    test('creates new display secret if none exists', async () => {
      const sessionRepo = createMockSessionRepository([], null);
      const deps = createDependencies({ sessionRepository: sessionRepo });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      expect(sessionRepo.getDisplaySecret).toHaveBeenCalledWith('session-123');
      expect(sessionRepo.setDisplaySecret).toHaveBeenCalledWith('session-123');
      
      // Should pass the generated secret
      expect(deps.aiSessionManager.getOrCreateForSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          displayApiSecret: 'generated-secret-123',
        })
      );
    });

    test('uses existing display secret if available', async () => {
      const sessionRepo = createMockSessionRepository([], 'existing-secret');
      const deps = createDependencies({ sessionRepository: sessionRepo });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      expect(sessionRepo.setDisplaySecret).not.toHaveBeenCalled();
      expect(deps.aiSessionManager.getOrCreateForSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          displayApiSecret: 'existing-secret',
        })
      );
    });

    test('passes workspace API key when available', async () => {
      const deps = createDependencies({
        getWorkspaceApiKey: vi.fn().mockResolvedValue('workspace-api-key'),
      });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      expect(deps.aiSessionManager.getOrCreateForSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          apiKey: 'workspace-api-key',
        })
      );
    });

    test('relays AI messages to session devices', async () => {
      const deps = createDependencies();
      let capturedOnMessage: ((text: string) => void) | undefined;
      
      (deps.aiSessionManager.getOrCreateForSession as ReturnType<typeof vi.fn>).mockImplementation(
        async (sessionId, workspaceId, onMessage) => {
          capturedOnMessage = onMessage;
          return {
            conversationId: 'conv-123',
            taskId: 'task-456',
            sessionId,
            mode: 'kiosk',
            reconnectAttempts: 0,
            maxReconnectAttempts: 5,
            isThinking: false,
          };
        }
      );
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Simulate AI sending a message
      expect(capturedOnMessage).toBeDefined();
      capturedOnMessage!('Hello from AI');
      
      // Should store the message
      expect(deps.store.append).toHaveBeenCalledWith(expect.objectContaining({
        type: 'text',
        sessionId: 'session-123',
        workspaceId: 'workspace-456',
        senderId: 'ai',
        senderName: '✨ AI',
        text: 'Hello from AI',
        partial: false,
      }));
      
      // Should broadcast to session
      expect(deps.registry.broadcastToSession).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          text: 'Hello from AI',
        }),
        'session-123'
      );
    });
  });

  describe('API key unavailable', () => {
    test('skips when no workspace or env API key available', async () => {
      const aiManager = createMockAISessionManager({ isAvailable: false });
      const deps = createDependencies({
        aiSessionManager: aiManager,
        getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
      });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should broadcast connecting then unavailable status
      expect(deps.registry.broadcastMessageToSession).toHaveBeenCalledTimes(2);
      expect(deps.registry.broadcastMessageToSession).toHaveBeenNthCalledWith(2, 'session-123', {
        type: 'session-ai-status',
        sessionId: 'session-123',
        connecting: false,
        connected: false,
        error: 'OpenHands API not configured',
      });
      
      // Should NOT try to create session
      expect(aiManager.getOrCreateForSession).not.toHaveBeenCalled();
    });

    test('proceeds with workspace API key even when env key unavailable', async () => {
      const aiManager = createMockAISessionManager({ isAvailable: false });
      const deps = createDependencies({
        aiSessionManager: aiManager,
        getWorkspaceApiKey: vi.fn().mockResolvedValue('workspace-key'),
      });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should create session with workspace key
      expect(aiManager.getOrCreateForSession).toHaveBeenCalled();
    });

    test('proceeds with env API key even when workspace key unavailable', async () => {
      const aiManager = createMockAISessionManager({ isAvailable: true });
      const deps = createDependencies({
        aiSessionManager: aiManager,
        getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
      });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should create session using env key (no apiKey in options)
      expect(aiManager.getOrCreateForSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Function),
        expect.not.objectContaining({ apiKey: expect.anything() })
      );
    });

    test('skips workspace key lookup when workspaceRepository is null', async () => {
      const aiManager = createMockAISessionManager({ isAvailable: true });
      const getWorkspaceApiKey = vi.fn();
      const deps = createDependencies({
        aiSessionManager: aiManager,
        workspaceRepository: null,
        getWorkspaceApiKey,
      });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should not call getWorkspaceApiKey
      expect(getWorkspaceApiKey).not.toHaveBeenCalled();
      // Should still proceed with env key
      expect(aiManager.getOrCreateForSession).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('broadcasts sanitized error on API failure', async () => {
      const aiManager = createMockAISessionManager({ 
        shouldThrow: true, 
        throwMessage: 'Internal server error with sensitive path /var/secrets/api.key' 
      });
      const deps = createDependencies({ aiSessionManager: aiManager });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should broadcast error status with sanitized message
      const lastCall = (deps.registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0];
      expect(lastCall[1]).toEqual({
        type: 'session-ai-status',
        sessionId: 'session-123',
        connecting: false,
        connected: false,
        error: 'Failed to connect AI assistant',
      });
      
      // Should NOT leak the internal error message
      expect(lastCall[1].error).not.toContain('Internal server error');
      expect(lastCall[1].error).not.toContain('/var/secrets');
    });

    test('logs full error server-side', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const aiManager = createMockAISessionManager({ 
        shouldThrow: true, 
        throwMessage: 'Detailed error for debugging' 
      });
      const deps = createDependencies({ aiSessionManager: aiManager });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      // Should log full error server-side
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AI] Auto-connect failed for session session-123:'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    test('does not throw - handles errors gracefully', async () => {
      const aiManager = createMockAISessionManager({ shouldThrow: true });
      const deps = createDependencies({ aiSessionManager: aiManager });
      
      // Should not throw
      await expect(autoConnectAI('session-123', 'workspace-456', deps)).resolves.toBeUndefined();
    });
  });

  describe('display lines calculation', () => {
    test('gets min display lines from registry', async () => {
      const registry = createMockRegistry();
      (registry.getMinKioskDisplayLines as ReturnType<typeof vi.fn>).mockReturnValue(20);
      const deps = createDependencies({ registry });
      
      await autoConnectAI('session-123', 'workspace-456', deps);
      
      expect(registry.getMinKioskDisplayLines).toHaveBeenCalledWith('workspace-456');
      expect(deps.aiSessionManager.getOrCreateForSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({ displayLines: 20 })
      );
    });
  });
});

describe('shouldAutoConnect', () => {
  test('returns true when first device and no AI session exists', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const aiManager = createMockAISessionManager({ hasSessionAI: false });
    
    const result = shouldAutoConnect('session-123', sessionRepo, aiManager);
    
    expect(result).toBe(true);
    expect(sessionRepo.getDevices).toHaveBeenCalledWith('session-123');
    expect(aiManager.hasSessionAI).toHaveBeenCalledWith('session-123');
  });

  test('returns false when second device joins', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }, { id: 'device-2' }]);
    const aiManager = createMockAISessionManager({ hasSessionAI: false });
    
    const result = shouldAutoConnect('session-123', sessionRepo, aiManager);
    
    expect(result).toBe(false);
  });

  test('returns false when AI session already exists', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const aiManager = createMockAISessionManager({ hasSessionAI: true });
    
    const result = shouldAutoConnect('session-123', sessionRepo, aiManager);
    
    expect(result).toBe(false);
  });

  test('returns false for empty session ID', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const aiManager = createMockAISessionManager({ hasSessionAI: false });
    
    const result = shouldAutoConnect('', sessionRepo, aiManager);
    
    expect(result).toBe(false);
  });

  test('returns false for default session', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const aiManager = createMockAISessionManager({ hasSessionAI: false });
    
    const result = shouldAutoConnect('default', sessionRepo, aiManager);
    
    expect(result).toBe(false);
  });

  test('returns false when no devices in session', () => {
    const sessionRepo = createMockSessionRepository([]);
    const aiManager = createMockAISessionManager({ hasSessionAI: false });
    
    const result = shouldAutoConnect('session-123', sessionRepo, aiManager);
    
    expect(result).toBe(false);
  });
});
