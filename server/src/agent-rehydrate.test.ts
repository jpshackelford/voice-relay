/**
 * Tests for the startup rehydration pass (issue #341).
 *
 * Covers:
 *  - Zero active sessions → no driver calls, no broadcasts.
 *  - One active session → driver.openSession invoked with existingConversationId.
 *  - Multiple sessions → each one independently rehydrated; one failure does
 *    not abort the rest.
 *  - Upstream "ended" — `openSession` throws → `degraded` session-state
 *    broadcast and a `failed` outcome.
 *  - Skipped path — no workspace key and the driver advertises itself as
 *    unavailable.
 *  - Successful rehydration emits a unified `session-state` broadcast.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { rehydrateAgentSessions } from './agent-rehydrate.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { AgentDriver, AgentSessionStatus } from './agent-driver/index.js';
import type { Session } from './sessions/types.js';

function readyStatus(sessionId: string, conversationId: string): AgentSessionStatus {
  return {
    sessionId,
    state: 'ready',
    conversationId,
    error: null,
    thinkingSince: null,
    startingSince: null,
  };
}

function activeSession(
  id: string,
  workspaceId: string,
  conversationId: string,
): Session {
  return {
    id,
    workspaceId,
    name: id,
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    metadata: { aiConversationId: conversationId },
    displayApiSecretEncrypted: null,
    displayApiSecretIv: null,
    displayApiSecretTag: null,
  };
}

function createMockSessionRepository(sessions: Session[]): SessionRepository {
  return {
    listActiveWithAiConversation: vi.fn().mockReturnValue(sessions),
    getDisplaySecret: vi.fn().mockReturnValue(null),
    findById: vi.fn().mockImplementation((id: string) => sessions.find((s) => s.id === id) ?? null),
    // `updateMetadata` is invoked by `attachOrCreateAgentSession` (#348)
    // and `persistAiConversationId` (#347) on both the happy-path
    // attach and the fresh-create branches. The integration tests below
    // assert on its call shape, so the mock must be a spy.
    updateMetadata: vi.fn().mockReturnValue(null),
  } as unknown as SessionRepository;
}

function createMockWorkspaceRepository(): WorkspaceRepository {
  return {
    getSettings: vi.fn().mockReturnValue(null),
  } as unknown as WorkspaceRepository;
}

interface MockDriverConfig {
  isAvailable?: boolean;
  /** Per-sessionId overrides: 'throw' (UpstreamConversationEnded-like) or a status. */
  responses?: Record<string, AgentSessionStatus | { throw: Error }>;
}

function createMockAgentDriver(config: MockDriverConfig = {}): AgentDriver {
  const { isAvailable = true, responses = {} } = config;
  return {
    isAvailable: vi.fn().mockReturnValue(isAvailable),
    hasSession: vi.fn().mockReturnValue(false),
    openSession: vi
      .fn()
      .mockImplementation(
        async (
          sessionId: string,
          opts: { existingConversationId?: string },
        ) => {
          const r = responses[sessionId];
          if (r && 'throw' in r) throw r.throw;
          return (
            r ??
            readyStatus(
              sessionId,
              // Model the production OH adapter's attach contract: when
              // attaching, the returned status carries the same id we
              // were asked to attach to. Tests that simulate fresh-create
              // can override with a per-session response.
              opts.existingConversationId ?? `conv-default-${sessionId}`,
            )
          );
        },
      ),
    sendMessage: vi.fn(),
    restartSession: vi.fn(),
    getSessionStatus: vi.fn(),
    closeSession: vi.fn(),
  } as unknown as AgentDriver;
}

function createRegistry() {
  return {
    broadcastMessageToSession: vi.fn(),
  };
}

describe('rehydrateAgentSessions (#341)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns empty when no active sessions with aiConversationId exist', async () => {
    const deps = {
      sessionRepository: createMockSessionRepository([]),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: createMockAgentDriver(),
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toEqual([]);
    expect(deps.agentDriver.openSession).not.toHaveBeenCalled();
  });

  test('rehydrates a single active session, calling openSession with existingConversationId', async () => {
    const sessions = [activeSession('session-1', 'ws-1', 'conv-1')];
    const driver = createMockAgentDriver();
    const registry = createRegistry();
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: registry as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('test-api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(1);
    // The outcome carries the LIVE conversation id (from the driver
    // status). The updated mock models the OH adapter's attach contract
    // (returns the requested id), so the outcome matches the persisted
    // id on the happy attach path.
    expect(outcomes[0]).toEqual({
      sessionId: 'session-1',
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      status: 'rehydrated',
    });
    expect(driver.openSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        workspaceId: 'ws-1',
        apiKey: 'test-api-key',
        existingConversationId: 'conv-1',
      }),
    );
    // session-state broadcast emitted for success
    const stateBroadcasts = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { type?: string }).type === 'session-state');
    expect(stateBroadcasts).toHaveLength(1);
    expect((stateBroadcasts[0][1] as { ai: AgentSessionStatus }).ai.state).toBe('ready');
  });

  test('rehydrates multiple sessions independently', async () => {
    const sessions = [
      activeSession('session-a', 'ws-1', 'conv-a'),
      activeSession('session-b', 'ws-2', 'conv-b'),
      activeSession('session-c', 'ws-1', 'conv-c'),
    ];
    const driver = createMockAgentDriver();
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((o) => o.status === 'rehydrated')).toBe(true);
    expect(driver.openSession).toHaveBeenCalledTimes(3);
    for (const conv of ['conv-a', 'conv-b', 'conv-c']) {
      expect(driver.openSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ existingConversationId: conv }),
      );
    }
  });

  test('one failed session does not abort the rest of the pass', async () => {
    const sessions = [
      activeSession('session-good-1', 'ws-1', 'conv-good-1'),
      activeSession('session-bad', 'ws-1', 'conv-bad'),
      activeSession('session-good-2', 'ws-1', 'conv-good-2'),
    ];
    const driver = createMockAgentDriver({
      responses: {
        'session-bad': { throw: new Error('Upstream conversation no longer available') },
      },
    });
    const registry = createRegistry();
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: registry as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.find((o) => o.sessionId === 'session-good-1')?.status).toBe('rehydrated');
    expect(outcomes.find((o) => o.sessionId === 'session-good-2')?.status).toBe('rehydrated');
    const bad = outcomes.find((o) => o.sessionId === 'session-bad');
    expect(bad?.status).toBe('failed');
    expect(bad?.error).toContain('Upstream conversation no longer available');

    // Degraded broadcast emitted for the failure
    const stateBroadcasts = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { type?: string }).type === 'session-state');
    const degraded = stateBroadcasts
      .map((c) => c[1] as { sessionId: string; ai: AgentSessionStatus })
      .find((m) => m.sessionId === 'session-bad' && m.ai.state === 'degraded');
    expect(degraded).toBeDefined();
    expect(degraded!.ai.error).toContain('restart');
  });

  test('skips session when no workspace key and driver advertises unavailable', async () => {
    const sessions = [activeSession('session-x', 'ws-no-key', 'conv-x')];
    const driver = createMockAgentDriver({ isAvailable: false });
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('skipped');
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  test('uses env driver when workspace key is null but driver isAvailable', async () => {
    const sessions = [activeSession('session-y', 'ws-1', 'conv-y')];
    const driver = createMockAgentDriver({ isAvailable: true });
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes[0].status).toBe('rehydrated');
    expect(driver.openSession).toHaveBeenCalledWith(
      'session-y',
      expect.not.objectContaining({ apiKey: expect.anything() }),
    );
  });

  test('threads displayApiSecret through when present', async () => {
    const sessions = [activeSession('session-d', 'ws-1', 'conv-d')];
    const driver = createMockAgentDriver();
    const sessionRepo = createMockSessionRepository(sessions);
    (sessionRepo.getDisplaySecret as ReturnType<typeof vi.fn>).mockReturnValue('secret-xyz');
    const deps = {
      sessionRepository: sessionRepo,
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    await rehydrateAgentSessions(deps);

    expect(driver.openSession).toHaveBeenCalledWith(
      'session-d',
      expect.objectContaining({ displayApiSecret: 'secret-xyz' }),
    );
  });

  test('skips session with null aiConversationId (defensive guard)', async () => {
    const bogusSession: Session = {
      ...activeSession('session-bogus', 'ws-1', 'placeholder'),
      metadata: { aiConversationId: null as unknown as string },
    };
    const driver = createMockAgentDriver();
    const deps = {
      sessionRepository: createMockSessionRepository([bogusSession]),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toEqual([]);
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  test('works without workspaceRepository (env-driver only)', async () => {
    const sessions = [activeSession('session-z', 'ws-1', 'conv-z')];
    const driver = createMockAgentDriver({ isAvailable: true });
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: null,
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes[0].status).toBe('rehydrated');
    expect(driver.openSession).toHaveBeenCalled();
    // Should not have queried the workspace key path
    expect(deps.getWorkspaceApiKey).not.toHaveBeenCalled();
  });

  // ---- #348: fresh-create fallback at boot ----

  test('upstream-ended attach triggers fresh-create fallback, marks rehydrated-fresh, persists new id', async () => {
    const sessions = [activeSession('session-stale', 'ws-1', 'conv-stale')];
    // First call (attach with existingConversationId) throws upstream-ended;
    // second call (fresh-create, no existingConversationId) returns a new
    // status. We model this by sequencing through openSession's mock.
    const driver = createMockAgentDriver();
    const seq: Array<() => Promise<AgentSessionStatus>> = [
      async () => {
        throw new (await import('./openhands.js')).UpstreamConversationEndedError('conv-stale');
      },
      async () => readyStatus('session-stale', 'conv-fresh-id'),
    ];
    (driver.openSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const fn = seq.shift();
      if (!fn) throw new Error('openSession called too many times');
      return fn();
    });
    const repo = createMockSessionRepository(sessions);
    const registry = createRegistry();
    const deps = {
      sessionRepository: repo,
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: registry as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual({
      sessionId: 'session-stale',
      workspaceId: 'ws-1',
      conversationId: 'conv-fresh-id',
      status: 'rehydrated-fresh',
    });
    // Two openSession calls: attach + fresh-create.
    expect(driver.openSession).toHaveBeenCalledTimes(2);
    // First call had existingConversationId set; second did not. The
    // fresh-create call carries the dead id forward as
    // `previousConversationId` so the OH adapter can seed the new
    // conversation with prior context (#349).
    const calls = (driver.openSession as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toEqual(expect.objectContaining({ existingConversationId: 'conv-stale' }));
    expect(calls[1][1]).not.toHaveProperty('existingConversationId');
    expect(calls[1][1]).toEqual(
      expect.objectContaining({ previousConversationId: 'conv-stale' }),
    );

    // Metadata writes (helper-driven): stash dead id THEN persist new id.
    // Both happen BEFORE the broadcast (persist-before-broadcast invariant).
    expect(repo.updateMetadata).toHaveBeenCalledTimes(2);
    const metaCalls = (repo.updateMetadata as ReturnType<typeof vi.fn>).mock.calls;
    expect(metaCalls[0]).toEqual([
      'session-stale',
      { aiConversationId: undefined, previousAiConversationId: 'conv-stale' },
    ]);
    expect(metaCalls[1]).toEqual([
      'session-stale',
      { aiConversationId: 'conv-fresh-id' },
    ]);

    // Broadcast: state=ready with the NEW conversation id.
    const stateBroadcasts = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { type?: string }).type === 'session-state');
    expect(stateBroadcasts).toHaveLength(1);
    expect((stateBroadcasts[0][1] as { ai: AgentSessionStatus }).ai.state).toBe('ready');
    expect((stateBroadcasts[0][1] as { ai: AgentSessionStatus }).ai.conversationId).toBe('conv-fresh-id');
  });

  test('fresh-create itself fails: outcome is failed, degraded broadcast emitted', async () => {
    const sessions = [activeSession('session-stale', 'ws-1', 'conv-stale')];
    const driver = createMockAgentDriver();
    const seq: Array<() => Promise<AgentSessionStatus>> = [
      async () => {
        throw new (await import('./openhands.js')).UpstreamConversationEndedError('conv-stale');
      },
      async () => {
        throw new Error('fresh-create failed: upstream 500');
      },
    ];
    (driver.openSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const fn = seq.shift();
      if (!fn) throw new Error('openSession called too many times');
      return fn();
    });
    const repo = createMockSessionRepository(sessions);
    const registry = createRegistry();
    const deps = {
      sessionRepository: repo,
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: registry as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].error).toContain('fresh-create failed');
    // Degraded broadcast emitted for the failure.
    const degraded = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[1] as { type?: string; sessionId?: string; ai?: AgentSessionStatus })
      .find((m) => m.type === 'session-state' && m.ai?.state === 'degraded');
    expect(degraded).toBeDefined();
  });

  test('non-Upstream error does NOT trigger fresh-create (no retry, no metadata mutation)', async () => {
    const sessions = [activeSession('session-blip', 'ws-1', 'conv-blip')];
    const generic = new Error('transient REST blip');
    const driver = createMockAgentDriver({
      responses: { 'session-blip': { throw: generic } },
    });
    const repo = createMockSessionRepository(sessions);
    const registry = createRegistry();
    const deps = {
      sessionRepository: repo,
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: registry as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].error).toContain('transient REST blip');
    // No retry: openSession called exactly once.
    expect(driver.openSession).toHaveBeenCalledTimes(1);
    // No metadata mutation: persisted id stays untouched.
    expect(repo.updateMetadata).not.toHaveBeenCalled();
    // Degraded broadcast emitted.
    const degraded = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[1] as { type?: string; sessionId?: string; ai?: AgentSessionStatus })
      .find((m) => m.type === 'session-state' && m.ai?.state === 'degraded');
    expect(degraded).toBeDefined();
  });

  test('mixed pass: dead, healthy, transient-fail — fresh-create only triggers for the dead one', async () => {
    const sessions = [
      activeSession('session-dead', 'ws-1', 'conv-dead'),
      activeSession('session-ok', 'ws-1', 'conv-ok'),
      activeSession('session-blip', 'ws-1', 'conv-blip'),
    ];
    const driver = createMockAgentDriver();
    (driver.openSession as ReturnType<typeof vi.fn>).mockImplementation(
      async (sessionId: string, opts: { existingConversationId?: string }) => {
        if (sessionId === 'session-blip') {
          throw new Error('transient blip');
        }
        if (sessionId === 'session-dead') {
          // First call (attach) throws; second (fresh) succeeds.
          if (opts.existingConversationId) {
            throw new (await import('./openhands.js')).UpstreamConversationEndedError(opts.existingConversationId);
          }
          return readyStatus(sessionId, 'conv-new-for-dead');
        }
        return readyStatus(sessionId, opts.existingConversationId ?? `conv-default-${sessionId}`);
      },
    );
    const repo = createMockSessionRepository(sessions);
    const registry = createRegistry();
    const deps = {
      sessionRepository: repo,
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: registry as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    const byId = Object.fromEntries(outcomes.map((o) => [o.sessionId, o]));
    expect(byId['session-dead'].status).toBe('rehydrated-fresh');
    expect(byId['session-dead'].conversationId).toBe('conv-new-for-dead');
    expect(byId['session-ok'].status).toBe('rehydrated');
    expect(byId['session-ok'].conversationId).toBe('conv-ok');
    expect(byId['session-blip'].status).toBe('failed');
  });
});
