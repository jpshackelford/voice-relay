/**
 * Tests for auto-connect AI logic, routed through the `AgentDriver` seam.
 *
 * Verifies that the platform's auto-connect path opens a session on the
 * driver (broadcasting connecting → connected status messages), handles
 * error and unavailable paths, and respects the driver's
 * `isAvailable` / `hasSession` interface.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { autoConnectAI, shouldAutoConnect, type AutoConnectDependencies } from './auto-connect.js';
import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { MessageStore } from './storage/index.js';
import type { AgentDriver, AgentSessionStatus } from './agent-driver/index.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';

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
    updateMetadata: vi.fn().mockReturnValue(null),
    findById: vi.fn().mockReturnValue(null),
  } as unknown as SessionRepository;
}

function createMockWorkspaceRepository(): WorkspaceRepository {
  return {
    getSettings: vi.fn().mockReturnValue(null),
  } as unknown as WorkspaceRepository;
}

function readyStatus(sessionId: string, conversationId: string | null = 'conv-123'): AgentSessionStatus {
  return {
    sessionId,
    state: 'ready',
    conversationId,
    error: null,
    thinkingSince: null,
    startingSince: null,
  };
}

function createMockAgentDriver(options: {
  isAvailable?: boolean;
  hasSession?: boolean;
  shouldThrow?: boolean;
  throwMessage?: string;
  openStatus?: AgentSessionStatus;
} = {}): AgentDriver {
  const {
    isAvailable = true,
    hasSession = false,
    shouldThrow = false,
    throwMessage = 'API error',
    openStatus = readyStatus('test-session'),
  } = options;

  return {
    isAvailable: vi.fn().mockReturnValue(isAvailable),
    hasSession: vi.fn().mockReturnValue(hasSession),
    openSession: shouldThrow
      ? vi.fn().mockRejectedValue(new Error(throwMessage))
      : vi.fn().mockResolvedValue(openStatus),
    sendMessage: vi.fn(),
    restartSession: vi.fn(),
    getSessionStatus: vi.fn().mockResolvedValue(openStatus),
    closeSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentDriver;
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
    agentDriver: createMockAgentDriver(),
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

    test('calls openSession on the driver with correct opts', async () => {
      const deps = createDependencies({
        sessionRepository: createMockSessionRepository([], 'existing-secret'),
      });

      await autoConnectAI('session-123', 'workspace-456', deps);

      expect(deps.agentDriver.openSession).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          workspaceId: 'workspace-456',
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

      expect(deps.agentDriver.openSession).toHaveBeenCalledWith(
        expect.any(String),
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
      expect(deps.agentDriver.openSession).toHaveBeenCalledWith(
        expect.any(String),
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

      expect(deps.agentDriver.openSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          apiKey: 'workspace-api-key',
        })
      );
    });

    test('persists conversationId to session metadata', async () => {
      const sessionRepo = createMockSessionRepository();
      const deps = createDependencies({
        sessionRepository: sessionRepo,
        agentDriver: createMockAgentDriver({
          openStatus: readyStatus('session-123', 'conv-xyz'),
        }),
      });

      await autoConnectAI('session-123', 'workspace-456', deps);

      expect(sessionRepo.updateMetadata).toHaveBeenCalledWith('session-123', {
        aiConversationId: 'conv-xyz',
      });
    });

    test('skips metadata write when conversationId is null', async () => {
      const sessionRepo = createMockSessionRepository();
      const deps = createDependencies({
        sessionRepository: sessionRepo,
        agentDriver: createMockAgentDriver({
          openStatus: readyStatus('session-123', null),
        }),
      });

      await autoConnectAI('session-123', 'workspace-456', deps);

      expect(sessionRepo.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe('API key unavailable', () => {
    test('skips when no workspace or env API key available', async () => {
      const driver = createMockAgentDriver({ isAvailable: false });
      const deps = createDependencies({
        agentDriver: driver,
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

      // Should NOT try to open the session
      expect(driver.openSession).not.toHaveBeenCalled();
    });

    test('proceeds with workspace API key even when env key unavailable', async () => {
      const driver = createMockAgentDriver({ isAvailable: false });
      const deps = createDependencies({
        agentDriver: driver,
        getWorkspaceApiKey: vi.fn().mockResolvedValue('workspace-key'),
      });

      await autoConnectAI('session-123', 'workspace-456', deps);

      expect(driver.openSession).toHaveBeenCalled();
    });

    test('proceeds with env API key even when workspace key unavailable', async () => {
      const driver = createMockAgentDriver({ isAvailable: true });
      const deps = createDependencies({
        agentDriver: driver,
        getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
      });

      await autoConnectAI('session-123', 'workspace-456', deps);

      // Should open the session WITHOUT an apiKey in opts (uses env key)
      expect(driver.openSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({ apiKey: expect.anything() })
      );
    });

    test('skips workspace key lookup when workspaceRepository is null', async () => {
      const driver = createMockAgentDriver({ isAvailable: true });
      const getWorkspaceApiKey = vi.fn();
      const deps = createDependencies({
        agentDriver: driver,
        workspaceRepository: null,
        getWorkspaceApiKey,
      });

      await autoConnectAI('session-123', 'workspace-456', deps);

      expect(getWorkspaceApiKey).not.toHaveBeenCalled();
      expect(driver.openSession).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('broadcasts sanitized error on openSession failure', async () => {
      const driver = createMockAgentDriver({
        shouldThrow: true,
        throwMessage: 'Internal server error with sensitive path /var/secrets/api.key',
      });
      const deps = createDependencies({ agentDriver: driver });

      await autoConnectAI('session-123', 'workspace-456', deps);

      const lastCall = (deps.registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0];
      expect(lastCall[1]).toEqual({
        type: 'session-ai-status',
        sessionId: 'session-123',
        connecting: false,
        connected: false,
        error: 'Failed to connect AI assistant',
      });
      expect(lastCall[1].error).not.toContain('Internal server error');
      expect(lastCall[1].error).not.toContain('/var/secrets');
    });

    test('logs full error server-side', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const driver = createMockAgentDriver({
        shouldThrow: true,
        throwMessage: 'Detailed error for debugging',
      });
      const deps = createDependencies({ agentDriver: driver });

      await autoConnectAI('session-123', 'workspace-456', deps);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AI] Auto-connect failed for session session-123:'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('does not throw - handles errors gracefully', async () => {
      const driver = createMockAgentDriver({ shouldThrow: true });
      const deps = createDependencies({ agentDriver: driver });

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
      expect(deps.agentDriver.openSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ displayLines: 20 })
      );
    });
  });
});

describe('shouldAutoConnect', () => {
  test('returns true when first device and no AI session exists', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const driver = createMockAgentDriver({ hasSession: false });

    const result = shouldAutoConnect('session-123', sessionRepo, driver);

    expect(result).toBe(true);
    expect(sessionRepo.getDevices).toHaveBeenCalledWith('session-123');
    expect(driver.hasSession).toHaveBeenCalledWith('session-123');
  });

  test('returns false when second device joins', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }, { id: 'device-2' }]);
    const driver = createMockAgentDriver({ hasSession: false });

    expect(shouldAutoConnect('session-123', sessionRepo, driver)).toBe(false);
  });

  test('returns false when driver already has the session', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const driver = createMockAgentDriver({ hasSession: true });

    expect(shouldAutoConnect('session-123', sessionRepo, driver)).toBe(false);
  });

  test('returns false for empty session ID', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const driver = createMockAgentDriver({ hasSession: false });

    expect(shouldAutoConnect('', sessionRepo, driver)).toBe(false);
  });

  test('returns false for anonymous session', () => {
    const sessionRepo = createMockSessionRepository([{ id: 'device-1' }]);
    const driver = createMockAgentDriver({ hasSession: false });

    expect(shouldAutoConnect(ANONYMOUS_SESSION_ID, sessionRepo, driver)).toBe(false);
  });

  test('returns false when no devices in session', () => {
    const sessionRepo = createMockSessionRepository([]);
    const driver = createMockAgentDriver({ hasSession: false });

    expect(shouldAutoConnect('session-123', sessionRepo, driver)).toBe(false);
  });
});
