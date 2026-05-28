/**
 * Regression tests for issue #341 — agent-driver rehydration after restart.
 *
 * Simulates a server lifecycle: the previous process persisted
 * `metadata.aiConversationId` on a session before dying. On boot the
 * rehydration pass must:
 *
 *   1. Find every active session with a non-null `aiConversationId`.
 *   2. Re-attach the in-memory `AgentDriver` to the existing upstream
 *      OpenHands conversation (not create a new one — that path orphans
 *      the original and loses context).
 *   3. Tolerate per-session failures (deleted upstream conversation,
 *      transient network, missing workspace key) without blocking the
 *      rest of the pass.
 *
 * Uses {@link FakeDriver} so the test exercises the driver seam without
 * any OpenHands coupling. The `wasAttached` helper (added in #341)
 * lets us assert the rehydration code took the attach branch.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { rehydrateAgentSessions, type RehydrateDependencies } from './agent-rehydrate.js';
import { FakeDriver, UpstreamConversationEndedError } from './agent-driver/index.js';
import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { Session } from './sessions/types.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { AgentDriver } from './agent-driver/index.js';

function fakeSession(overrides: Partial<Session> & Pick<Session, 'id' | 'workspaceId'>): Session {
  return {
    id: overrides.id,
    workspaceId: overrides.workspaceId,
    name: overrides.name ?? null,
    status: overrides.status ?? 'active',
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00Z',
    endedAt: overrides.endedAt ?? null,
    metadata: overrides.metadata ?? null,
    displayApiSecretEncrypted: overrides.displayApiSecretEncrypted ?? null,
    displayApiSecretIv: overrides.displayApiSecretIv ?? null,
    displayApiSecretTag: overrides.displayApiSecretTag ?? null,
  };
}

function createMockRegistry(): DeviceRegistry {
  return {
    broadcastMessageToSession: vi.fn(),
  } as unknown as DeviceRegistry;
}

function createMockSessionRepository(
  sessions: Session[],
  displaySecrets: Record<string, string | null> = {},
): SessionRepository {
  return {
    listActiveWithAiConversation: vi.fn().mockReturnValue(sessions),
    getDisplaySecret: vi.fn((id: string) => displaySecrets[id] ?? null),
  } as unknown as SessionRepository;
}

function createDeps(overrides: Partial<RehydrateDependencies> = {}): RehydrateDependencies {
  return {
    registry: createMockRegistry(),
    sessionRepository: createMockSessionRepository([]),
    workspaceRepository: {} as WorkspaceRepository,
    agentDriver: new FakeDriver(),
    getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('rehydrateAgentSessions', () => {
  describe('happy path', () => {
    test('rehydrates each active session with persisted aiConversationId', async () => {
      const driver = new FakeDriver();
      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
        fakeSession({
          id: 'sess-2',
          workspaceId: 'ws-2',
          metadata: { aiConversationId: 'conv-2' },
        }),
      ];
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
      });

      const result = await rehydrateAgentSessions(deps);

      expect(result).toMatchObject({
        candidates: 2,
        rehydrated: 2,
        upstreamEnded: 0,
        failed: 0,
      });
      // Both sessions now have a binding in the driver.
      expect(driver.hasSession('sess-1')).toBe(true);
      expect(driver.hasSession('sess-2')).toBe(true);
      // And BOTH took the attach path (the whole point of the fix).
      expect(driver.wasAttached('sess-1')).toBe(true);
      expect(driver.wasAttached('sess-2')).toBe(true);
    });

    test('broadcasts session-state for each rehydrated session', async () => {
      const driver = new FakeDriver();
      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
      ];
      const registry = createMockRegistry();
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
        registry,
      });

      await rehydrateAgentSessions(deps);

      expect(registry.broadcastMessageToSession).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          type: 'session-state',
          sessionId: 'sess-1',
          ai: expect.objectContaining({ state: expect.any(String) }),
        }),
      );
    });

    test('passes workspace API key into openSession when available', async () => {
      const driver = new FakeDriver();
      const openSpy = vi.spyOn(driver, 'openSession');
      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
      ];
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
        getWorkspaceApiKey: vi.fn().mockResolvedValue('workspace-key-123'),
      });

      await rehydrateAgentSessions(deps);

      expect(openSpy).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          existingConversationId: 'conv-1',
          apiKey: 'workspace-key-123',
        }),
      );
    });

    test('passes persisted displayApiSecret into openSession when present', async () => {
      const driver = new FakeDriver();
      const openSpy = vi.spyOn(driver, 'openSession');
      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
      ];
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions, { 'sess-1': 'display-sec' }),
      });

      await rehydrateAgentSessions(deps);

      expect(openSpy).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ displayApiSecret: 'display-sec' }),
      );
    });

    test('skips sessions the driver already has a binding for (idempotency)', async () => {
      const driver = new FakeDriver();
      // Pre-bind sess-1 with a fresh conversation id (no existingConversationId)
      await driver.openSession('sess-1', { workspaceId: 'ws-1' });
      expect(driver.wasAttached('sess-1')).toBe(false);

      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
      ];
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
      });
      const openSpy = vi.spyOn(driver, 'openSession');

      const result = await rehydrateAgentSessions(deps);

      expect(result.alreadyBound).toBe(1);
      expect(result.rehydrated).toBe(0);
      // openSession not called again — already bound.
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('continues after one session fails (best-effort)', async () => {
      const driver = new FakeDriver();
      const openSpy = vi.spyOn(driver, 'openSession');
      // First call throws a generic error; second succeeds.
      openSpy.mockImplementationOnce(async () => {
        throw new Error('transient blip');
      });

      const sessions = [
        fakeSession({
          id: 'sess-bad',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-bad' },
        }),
        fakeSession({
          id: 'sess-good',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-good' },
        }),
      ];
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
      });

      const result = await rehydrateAgentSessions(deps);

      expect(result.candidates).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.rehydrated).toBe(1);
      // The good session is bound; the bad one is not.
      expect(driver.hasSession('sess-good')).toBe(true);
    });

    test('broadcasts degraded state when upstream conversation is gone', async () => {
      const driver = new FakeDriver();
      vi.spyOn(driver, 'openSession').mockImplementation(async (sessionId, _opts) => {
        throw new UpstreamConversationEndedError('conv-gone');
      });
      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-gone' },
        }),
      ];
      const registry = createMockRegistry();
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
        registry,
      });

      const result = await rehydrateAgentSessions(deps);

      expect(result.upstreamEnded).toBe(1);
      expect(result.rehydrated).toBe(0);
      // Broadcast a degraded snapshot so the kiosk can surface the
      // restart affordance when it reconnects.
      expect(registry.broadcastMessageToSession).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          type: 'session-state',
          ai: expect.objectContaining({
            state: 'degraded',
            error: expect.stringMatching(/Upstream conversation/),
          }),
        }),
      );
    });

    test('does NOT broadcast degraded on generic transient failures', async () => {
      const driver = new FakeDriver();
      vi.spyOn(driver, 'openSession').mockRejectedValue(new Error('ECONNRESET'));
      const sessions = [
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
      ];
      const registry = createMockRegistry();
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: createMockSessionRepository(sessions),
        registry,
      });

      await rehydrateAgentSessions(deps);

      // Critically, no degraded broadcast on a transient: the next device
      // join will retry, and surfacing "AI permanently broken" to the
      // user for what's really a network hiccup is the wrong UX.
      const degradedCall = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>)
        .mock.calls.find(
          (c) =>
            (c[1] as { ai?: { state?: string } })?.ai?.state === 'degraded',
        );
      expect(degradedCall).toBeUndefined();
    });
  });

  describe('short-circuits', () => {
    test('skips entire pass when driver is unavailable', async () => {
      const driver = new FakeDriver();
      driver.setAvailable(false);
      const sessionsSpy = vi.fn().mockReturnValue([
        fakeSession({
          id: 'sess-1',
          workspaceId: 'ws-1',
          metadata: { aiConversationId: 'conv-1' },
        }),
      ]);
      const deps = createDeps({
        agentDriver: driver,
        sessionRepository: {
          listActiveWithAiConversation: sessionsSpy,
          getDisplaySecret: vi.fn(),
        } as unknown as SessionRepository,
      });

      const result = await rehydrateAgentSessions(deps);

      expect(result.candidates).toBe(0);
      expect(result.rehydrated).toBe(0);
      // Crucially, we don't even hit the DB to enumerate candidates.
      expect(sessionsSpy).not.toHaveBeenCalled();
    });

    test('returns clean result when no candidates exist', async () => {
      const deps = createDeps({
        sessionRepository: createMockSessionRepository([]),
      });

      const result = await rehydrateAgentSessions(deps);

      expect(result).toEqual({
        candidates: 0,
        rehydrated: 0,
        alreadyBound: 0,
        upstreamEnded: 0,
        failed: 0,
      });
    });
  });

  // Regression test for issue #341 — end-to-end shape, no mocks except
  // the repo + registry. Demonstrates that the bug repro (driver loses
  // binding while metadata persists) is mechanically reproducible
  // pre-fix and is fixed by the rehydration pass.
  describe('regression: server restart with kiosk + mobile devices (issue #341)', () => {
    test('rehydration re-attaches the AI binding lost on restart', async () => {
      const driver = new FakeDriver();

      // -------- Pre-restart state simulation --------
      // The previous server lifecycle: kiosk + mobile in session, AI
      // was auto-connected, metadata.aiConversationId persisted.
      await driver.openSession('sess-aa841160', { workspaceId: 'ws-prod' });
      expect(driver.hasSession('sess-aa841160')).toBe(true);
      const preRestartConvId = (await driver.getSessionStatus('sess-aa841160')).conversationId!;
      expect(preRestartConvId).toBeTruthy();

      // -------- Restart --------
      // Simulate process death: a fresh driver, the same DB rows.
      const driverAfterRestart = new FakeDriver();
      expect(driverAfterRestart.hasSession('sess-aa841160')).toBe(false);

      const sessions = [
        fakeSession({
          id: 'sess-aa841160',
          workspaceId: 'ws-prod',
          metadata: { aiConversationId: preRestartConvId },
        }),
      ];
      const deps = createDeps({
        agentDriver: driverAfterRestart,
        sessionRepository: createMockSessionRepository(sessions),
      });

      // -------- Rehydration runs at startup --------
      const result = await rehydrateAgentSessions(deps);

      // Driver is bound again, AND it attached to the same conversation.
      expect(result.rehydrated).toBe(1);
      expect(driverAfterRestart.hasSession('sess-aa841160')).toBe(true);
      expect(driverAfterRestart.wasAttached('sess-aa841160')).toBe(true);
      const newStatus = await driverAfterRestart.getSessionStatus('sess-aa841160');
      expect(newStatus.conversationId).toBe(preRestartConvId);
    });
  });
});

// Ensure shutdown of FakeDriver doesn't leak between tests.
beforeEach(() => {
  vi.clearAllMocks();
});

// Type-only assertion: AgentDriver is exported and consumed.
function _typeCheck(d: AgentDriver): void {
  void d;
}
