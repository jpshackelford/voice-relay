/**
 * Integration test for issue #351.
 *
 * Threads the full register-time-discovery flow against a real
 * in-memory SQLite + `SessionAIStateRepository`:
 *
 *   1. The boot rehydration pass attempts to attach a session whose
 *      `aiConversationId` points at a dead upstream conversation. The
 *      driver throws; the pass logs, broadcasts `degraded`, and
 *      persists `state='degraded'` to `session_ai_state`.
 *
 *   2. A kiosk then registers in that session *after* the failed
 *      rehydration. The driver still reports `state='absent'` (no live
 *      binding was created). The register-time resync helper consults
 *      the durable repo, finds the sticky `degraded` row, and sends a
 *      synthesized `degraded` snapshot — both the legacy
 *      `session-ai-status` and the unified `session-state` — to the
 *      registering WS only.
 *
 * If any link in the chain breaks, this test catches the regression
 * the issue describes: stale "✨ AI Connected" UI sitting on the
 * kiosk until the user types and the dropped-text handler fires.
 */

import { describe, test, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  SessionAIStateRepository,
} from './sessions/session-ai-state-repository.js';
import { migrations } from './storage/migrations/index.js';
import { rehydrateAgentSessions } from './agent-rehydrate.js';
import { resyncAgentSessionStatus } from './resync-agent-status.js';
import type {
  SessionRepository,
} from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { AgentDriver, AgentSessionStatus } from './agent-driver/index.js';
import type { Session } from './sessions/types.js';
import type { DeviceRegistry } from './registry.js';
import { UpstreamConversationEndedError } from './openhands.js';

function applyAllMigrations(db: Database.Database): void {
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    db.exec(m.up);
  }
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
    metadata: { aiConversationId: conversationId },
  } as Session;
}

function fakeSessionRepository(sessions: Session[]): SessionRepository {
  return {
    listActiveWithAiConversation: vi.fn().mockReturnValue(sessions),
    getDisplaySecret: vi.fn().mockReturnValue(null),
  } as unknown as SessionRepository;
}

function fakeWorkspaceRepository(): WorkspaceRepository {
  return {
    getSettings: vi.fn().mockReturnValue(null),
  } as unknown as WorkspaceRepository;
}

interface MockRegistry {
  broadcastMessageToSession: ReturnType<typeof vi.fn>;
  broadcastToSession: ReturnType<typeof vi.fn>;
  registry: DeviceRegistry;
}

function fakeRegistry(): MockRegistry {
  const broadcastMessageToSession = vi.fn();
  const broadcastToSession = vi.fn();
  return {
    broadcastMessageToSession,
    broadcastToSession,
    registry: {
      broadcastMessageToSession,
      broadcastToSession,
    } as unknown as DeviceRegistry,
  };
}

describe('Issue #351 — register-time degraded broadcast after failed boot rehydration', () => {
  test('kiosk registering after a failed rehydration sees exactly one degraded broadcast (legacy + unified)', async () => {
    const sessionId = 'session-stale';
    const workspaceId = 'workspace-1';
    const conversationId = 'conv-dead-123';

    // --- Stage 0: real in-memory DB + repo, no row yet ----------------
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyAllMigrations(db);
    const aiStateRepository = new SessionAIStateRepository(db);

    // Seed the parent rows the FK chain needs so the upsert in the
    // rehydration failure path actually persists.
    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-test', 1, 'tester');
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(workspaceId, 'user-test', 'Workspace', `ws-${workspaceId}`, 'CODE-0000');
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name, status, started_at, metadata)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    ).run(
      sessionId,
      workspaceId,
      'Stale Session',
      'active',
      JSON.stringify({ aiConversationId: conversationId }),
    );

    expect(aiStateRepository.findBySessionId(sessionId)).toBeNull();

    // --- Stage 1: boot rehydration fails ------------------------------
    const upstreamErr = new UpstreamConversationEndedError(
      conversationId,
      'Upstream conversation no longer reachable',
    );
    const driverOpenSession = vi.fn(async () => {
      throw upstreamErr;
    });
    const driverGetSessionStatus = vi.fn(
      async (sid: string): Promise<AgentSessionStatus> => ({
        sessionId: sid,
        // No live binding after the failed attach — exactly what the
        // bug describes: production observes `absent` here.
        state: 'absent',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      }),
    );
    const driver: AgentDriver = {
      openSession: driverOpenSession,
      getSessionStatus: driverGetSessionStatus,
      hasSession: vi.fn().mockReturnValue(false),
      closeSession: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as AgentDriver;

    const registry = fakeRegistry();

    // Silence the expected `[AI] Rehydration failed` log.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcomes = await rehydrateAgentSessions({
      sessionRepository: fakeSessionRepository([
        activeSession(sessionId, workspaceId, conversationId),
      ]),
      workspaceRepository: fakeWorkspaceRepository(),
      agentDriver: driver,
      registry: registry.registry,
      getWorkspaceApiKey: vi.fn().mockResolvedValue('api-key'),
      aiStateRepository,
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      sessionId,
      conversationId,
      status: 'failed',
    });
    expect(driverOpenSession).toHaveBeenCalledTimes(1);

    // The rehydration broadcast happened — but to an empty room. The
    // registry call is recorded, but no client was connected to hear
    // it. This is the original silent-failure surface.
    expect(registry.broadcastMessageToSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        type: 'session-state',
        ai: expect.objectContaining({ state: 'degraded' }),
      }),
    );

    // The durable row now carries the give-up decision.
    const persisted = aiStateRepository.findBySessionId(sessionId);
    expect(persisted).not.toBeNull();
    expect(persisted!.state).toBe('degraded');
    expect(persisted!.conversationId).toBe(conversationId);
    expect(persisted!.stateReason).toBeTruthy();

    // --- Stage 2: a kiosk registers; resync sees the sticky row ------
    const wsSends: string[] = [];
    const ws = { send: (data: string) => wsSends.push(data) };

    await resyncAgentSessionStatus(ws, sessionId, driver, aiStateRepository);

    // Driver was consulted exactly once and reported `absent`; the
    // durable repo carried the day.
    expect(driverGetSessionStatus).toHaveBeenCalledWith(sessionId);

    // Two messages: legacy `session-ai-status` + unified `session-state`.
    expect(wsSends).toHaveLength(2);
    const messages = wsSends.map((s) => JSON.parse(s));

    const legacy = messages[0] as {
      type: string;
      sessionId: string;
      connected: boolean;
      connecting: boolean;
      conversationId?: string;
      error?: string;
    };
    expect(legacy.type).toBe('session-ai-status');
    expect(legacy.sessionId).toBe(sessionId);
    expect(legacy.connected).toBe(false);
    expect(legacy.connecting).toBe(false);
    expect(legacy.conversationId).toBe(conversationId);
    expect(legacy.error).toBeTruthy();

    const unified = messages[1] as {
      type: string;
      sessionId: string;
      ai: AgentSessionStatus;
    };
    expect(unified.type).toBe('session-state');
    expect(unified.sessionId).toBe(sessionId);
    expect(unified.ai.state).toBe('degraded');
    expect(unified.ai.conversationId).toBe(conversationId);

    errSpy.mockRestore();
    db.close();
  });

  test('after a subsequent successful attach, the next register no longer sees degraded', async () => {
    // Smoke-test the "successful attach clears the persisted flag"
    // acceptance criterion: we don't need to run a full openSession
    // flow here — we exercise the contract directly by upserting
    // `running` (which is what `AISessionManager.persistInitialState`
    // does on every fresh attach) and re-running the resync.
    const sessionId = 'session-recovered';
    const workspaceId = 'workspace-1';
    const conversationId = 'conv-back';

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyAllMigrations(db);
    const aiStateRepository = new SessionAIStateRepository(db);

    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-test', 1, 'tester');
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(workspaceId, 'user-test', 'Workspace', `ws-${workspaceId}`, 'CODE-0001');
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name, status, started_at, metadata)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    ).run(sessionId, workspaceId, 'Recovered', 'active', null);

    // Pre-seed: previous rehydration marked the row degraded.
    aiStateRepository.upsert({
      sessionId,
      conversationId,
      state: 'degraded',
      stateReason: 'last attempt failed',
    });

    // Successful subsequent attach → manager would call
    // `persistInitialState`, which is an upsert of `running`.
    aiStateRepository.upsert({
      sessionId,
      conversationId,
      state: 'running',
      stateReason: null,
    });

    // Now the driver reports the live binding (ready). The register
    // path emits a normal `ready` snapshot; no synthesized degraded.
    const readyDriver: Pick<AgentDriver, 'getSessionStatus'> = {
      getSessionStatus: async (sid: string): Promise<AgentSessionStatus> => ({
        sessionId: sid,
        state: 'ready',
        conversationId,
        error: null,
        thinkingSince: null,
        startingSince: null,
      }),
    };

    const wsSends: string[] = [];
    const ws = { send: (data: string) => wsSends.push(data) };

    await resyncAgentSessionStatus(ws, sessionId, readyDriver, aiStateRepository);

    expect(wsSends).toHaveLength(2);
    const [legacy, unified] = wsSends.map((s) => JSON.parse(s)) as Array<{
      type: string;
      connected?: boolean;
      ai?: AgentSessionStatus;
    }>;
    expect(legacy).toMatchObject({
      type: 'session-ai-status',
      connected: true,
    });
    expect(unified).toMatchObject({
      type: 'session-state',
      ai: expect.objectContaining({ state: 'ready', conversationId }),
    });

    db.close();
  });
});
