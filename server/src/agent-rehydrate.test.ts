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
import { UpstreamConversationEndedError } from './openhands.js';

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
    targetKioskDeviceId: null,
  };
}

function createMockSessionRepository(sessions: Session[]): SessionRepository {
  return {
    listActiveWithAiConversation: vi.fn().mockReturnValue(sessions),
    getDisplaySecret: vi.fn().mockReturnValue(null),
    findById: vi.fn().mockImplementation((id: string) => sessions.find((s) => s.id === id) ?? null),
  } as unknown as SessionRepository;
}

function createMockWorkspaceRepository(): WorkspaceRepository {
  return {
    getSettings: vi.fn().mockReturnValue(null),
  } as unknown as WorkspaceRepository;
}

interface MockDriverConfig {
  /** Per-sessionId overrides: 'throw' (UpstreamConversationEnded-like) or a status. */
  responses?: Record<string, AgentSessionStatus | { throw: Error }>;
}

function createMockAgentDriver(config: MockDriverConfig = {}): AgentDriver {
  const { responses = {} } = config;
  return {
    hasSession: vi.fn().mockReturnValue(false),
    openSession: vi.fn().mockImplementation(async (sessionId: string) => {
      const r = responses[sessionId];
      if (r && 'throw' in r) throw r.throw;
      return r ?? readyStatus(sessionId, `conv-default-${sessionId}`);
    }),
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

  test('skips session when workspace has no configured API key', async () => {
    // Post-#404: workspace key is the only credential source. The legacy
    // `isAvailable()` driver probe (env-keyed fallback) is gone.
    const sessions = [activeSession('session-x', 'ws-no-key', 'conv-x')];
    const driver = createMockAgentDriver();
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

  test('threads workspace API key through to openSession (#404)', async () => {
    // Pre-#404 the rehydrate path had two branches: workspace key, or
    // env-keyed driver fallback. Post-#404 only the first remains, and
    // the workspace key MUST be forwarded so the OH adapter can build a
    // workspace-scoped client per session (see #403 plumbing).
    const sessions = [activeSession('session-y', 'ws-1', 'conv-y')];
    const driver = createMockAgentDriver();
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: createMockWorkspaceRepository(),
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue('workspace-key-abc'),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes[0].status).toBe('rehydrated');
    expect(driver.openSession).toHaveBeenCalledWith(
      'session-y',
      expect.objectContaining({ apiKey: 'workspace-key-abc' }),
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

  test('skips rehydration when workspaceRepository is null (#404)', async () => {
    // Pre-#404 this asserted that the env-keyed driver kept rehydration
    // working when no workspace repo was wired. After the env fallback
    // was removed, there's no credential source in that mode, so each
    // session must be skipped rather than silently opened with a
    // missing key.
    const sessions = [activeSession('session-z', 'ws-1', 'conv-z')];
    const driver = createMockAgentDriver();
    const deps = {
      sessionRepository: createMockSessionRepository(sessions),
      workspaceRepository: null,
      agentDriver: driver,
      registry: createRegistry() as unknown as Parameters<typeof rehydrateAgentSessions>[0]['registry'],
      getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
    };

    const outcomes = await rehydrateAgentSessions(deps);

    expect(outcomes[0].status).toBe('skipped');
    expect(driver.openSession).not.toHaveBeenCalled();
    // Should not have queried the workspace key path
    expect(deps.getWorkspaceApiKey).not.toHaveBeenCalled();
  });

  test('propagates typed MissingWsHandshakeReason into the degraded broadcast (#405)', async () => {
    // When the driver throws `UpstreamConversationEndedError` carrying
    // a typed `reason`, the `degraded` `session-state` broadcast
    // should surface the error's self-describing message instead of
    // the generic "Upstream conversation no longer available — restart
    // session" string. The reconnecting device then sees the specific
    // cause (auth rejected / sandbox stopped / etc.) in the journal.
    const sessions = [activeSession('session-typed', 'ws-1', 'conv-typed')];
    const driver = createMockAgentDriver({
      responses: {
        'session-typed': {
          throw: new UpstreamConversationEndedError(
            'conv-typed',
            'Conversation conv-typed cannot open a WS session: sandbox is STOPPED.',
            'sandbox-stopped',
          ),
        },
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

    await rehydrateAgentSessions(deps);

    const stateBroadcasts = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { type?: string }).type === 'session-state');
    const degraded = stateBroadcasts
      .map((c) => c[1] as { sessionId: string; ai: AgentSessionStatus })
      .find((m) => m.sessionId === 'session-typed' && m.ai.state === 'degraded');
    expect(degraded).toBeDefined();
    expect(degraded!.ai.error).toBe(
      'Conversation conv-typed cannot open a WS session: sandbox is STOPPED.',
    );
  });

  test('falls back to generic message when UpstreamConversationEndedError has no reason (#405)', async () => {
    // `UpstreamConversationEndedError` thrown from the 404-on-attach
    // branch (or generic lookup failure) has no `reason` — the
    // degraded broadcast keeps the historical "Upstream conversation
    // no longer available — restart session" string so kiosks still
    // get a recovery-actionable hint.
    const sessions = [activeSession('session-plain', 'ws-1', 'conv-plain')];
    const driver = createMockAgentDriver({
      responses: {
        'session-plain': {
          throw: new UpstreamConversationEndedError(
            'conv-plain',
            'Failed to look up conversation conv-plain: HTTP 404',
          ),
        },
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

    await rehydrateAgentSessions(deps);

    const stateBroadcasts = (registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { type?: string }).type === 'session-state');
    const degraded = stateBroadcasts
      .map((c) => c[1] as { sessionId: string; ai: AgentSessionStatus })
      .find((m) => m.sessionId === 'session-plain' && m.ai.state === 'degraded');
    expect(degraded).toBeDefined();
    expect(degraded!.ai.error).toContain('restart');
    expect(degraded!.ai.error).not.toContain('HTTP 404');
  });
});
