import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createAgentEventRouter } from './router.js';
import { AgentEventRehydrator, type EnsureHydratedRequest } from './rehydrator.js';
import { AgentEventRepository } from '../storage/agent-event-repository.js';
import { SessionRepository } from '../sessions/session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';
import { migration as displayApiSecretsMigration } from '../storage/migrations/010_display_api_secrets.js';
import { migration as agentEventsMigration } from '../storage/migrations/012_agent_events.js';

// Mock encryption so the session repo doesn't need ENCRYPTION_SECRET
vi.mock('../workspaces/encryption.js', () => ({
  encryptApiKey: vi.fn((s: string) => ({
    encrypted: Buffer.from(s).toString('base64'),
    iv: 'iv',
    tag: 'tag',
  })),
  decryptApiKey: vi.fn((e: { encrypted: string }) =>
    Buffer.from(e.encrypted, 'base64').toString('utf-8')
  ),
}));

describe('AgentEvent Router', () => {
  let app: Express;
  let db: Database.Database;
  let agentEventRepository: AgentEventRepository;
  let sessionRepository: SessionRepository;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let rehydrator: AgentEventRehydrator;

  let testWorkspaceId: string;
  let testSessionId: string;
  let testUserId: string;
  let otherUserId: string;
  let authToken: string;
  let otherAuthToken: string;

  let ensureHydratedSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');

    // Required base tables for SessionRepository / WorkspaceRepository
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    // Sessions / devices schema (minimal subset matching migration 005)
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        metadata TEXT,
        target_kiosk_device_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, device_id)
      );
    `);
    db.exec(displayApiSecretsMigration.up);
    db.exec(agentEventsMigration.up);

    agentEventRepository = new AgentEventRepository(db);
    sessionRepository = new SessionRepository(db);
    workspaceRepository = new WorkspaceRepository(db);
    userRepository = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    testUserId = 'user-1';
    otherUserId = 'user-2';
    testWorkspaceId = 'ws-1';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 1, 'me');
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(otherUserId, 2, 'other');
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, 'WS', 'ws-1', 'JOIN-1234', datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId);

    const session = sessionRepository.create({ workspaceId: testWorkspaceId });
    testSessionId = session.id;

    const user = userRepository.findById(testUserId)!;
    authToken = jwtService.sign(user);
    const other = userRepository.findById(otherUserId)!;
    otherAuthToken = jwtService.sign(other);

    // Rehydrator with stubbed deps (we replace ensureHydrated per-test)
    rehydrator = new AgentEventRehydrator({
      repo: agentEventRepository,
      buildClient: () => {
        throw new Error('buildClient should not be invoked in router tests');
      },
      getWorkspaceApiKey: async () => 'wk-key',
      sleep: async () => {},
      backoffMs: [1, 1, 1, 1, 1, 1],
    });
    ensureHydratedSpy = vi
      .spyOn(rehydrator, 'ensureHydrated')
      .mockResolvedValue({ rehydrated: false, complete: true, inserted: 0, pagesFetched: 0 });

    app = express();
    app.use(express.json());
    app.use(
      '/api/sessions',
      createAgentEventRouter({
        agentEventRepository,
        rehydrator,
        sessionRepository,
        workspaceRepository,
        authConfig: { jwtService, userRepository },
      })
    );
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/sessions/${testSessionId}/agent-events`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(app)
      .get('/api/sessions/does-not-exist/agent-events')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-workspace-member', async () => {
    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(res.status).toBe(403);
  });

  it('returns stored events ordered by event_timestamp ASC', async () => {
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: 'b', kind: 'K', timestamp: '2026-05-21T11:00:00Z' },
    });
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: 'a', kind: 'K', timestamp: '2026-05-21T10:00:00Z' },
    });
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['a', 'b']);
    expect(res.body.total).toBe(2);
    expect(res.body.rehydrated).toBe(false);
    expect(res.body.rehydration_complete).toBe(true);
    expect(res.body.conversation_id).toBe('c1');
    // Rehydrator not called because rows already exist
    expect(ensureHydratedSpy).not.toHaveBeenCalled();
  });

  it('auto-rehydrates when there are zero rows and aiConversationId is set', async () => {
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });
    ensureHydratedSpy.mockImplementation(async (req: EnsureHydratedRequest) => {
      agentEventRepository.insert({
        conversationId: req.conversationId,
        sessionId: req.sessionId,
        workspaceId: req.workspaceId,
        rawEvent: { id: 'rehydrated-1', kind: 'K', timestamp: '2026-05-21T10:00:00Z' },
      });
      return { rehydrated: true, complete: true, inserted: 1, pagesFetched: 1 };
    });

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rehydrated).toBe(true);
    expect(res.body.rehydration_complete).toBe(true);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('rehydrated-1');
    expect(ensureHydratedSpy).toHaveBeenCalledTimes(1);
  });

  it('does not call rehydrator when aiConversationId is unknown', async () => {
    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rehydrated).toBe(false);
    expect(res.body.conversation_id).toBeNull();
    expect(ensureHydratedSpy).not.toHaveBeenCalled();
  });

  it('honors rehydrate=never even when rows are empty', async () => {
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });
    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events?rehydrate=never`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(ensureHydratedSpy).not.toHaveBeenCalled();
  });

  it('honors rehydrate=force even when rows already exist', async () => {
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: 'a', kind: 'K' },
    });
    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events?rehydrate=force`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(ensureHydratedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ force: true })
    );
  });

  it('surfaces partial rehydration via rehydration_complete:false', async () => {
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });
    ensureHydratedSpy.mockResolvedValue({
      rehydrated: true,
      complete: false,
      inserted: 0,
      pagesFetched: 0,
      error: 'OH down',
    });
    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.rehydration_complete).toBe(false);
    expect(res.body.rehydration_error).toBe('OH down');
  });

  it('applies kind and after filters from query string', async () => {
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: '1', kind: 'ActionEvent', timestamp: '2026-05-21T10:00:00Z' },
    });
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: '2', kind: 'MessageEvent', timestamp: '2026-05-21T11:00:00Z' },
    });

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events?kind=ActionEvent&after=2026-05-21T09:00:00Z`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('1');
  });

  it('drops kiosk-timeline-noise kinds from the default response (issue #280)', async () => {
    // Seed one of each filtered kind plus a TerminalAction / TerminalObservation
    // pair that *must* survive the filter. After the filter the response should
    // contain only the surviving pair, but `total` should still reflect the raw
    // stored row count (drives the rehydration-completeness UI from #269).
    const seed: Array<{ id: string; raw: Record<string, unknown> }> = [
      { id: 'csu', raw: { id: 'csu', kind: 'ConversationStateUpdateEvent', source: 'environment', timestamp: '2026-05-21T10:00:00Z' } },
      { id: 'sp', raw: { id: 'sp', kind: 'SystemPromptEvent', source: 'agent', timestamp: '2026-05-21T10:01:00Z' } },
      { id: 'mu', raw: { id: 'mu', kind: 'MessageEvent', source: 'user', timestamp: '2026-05-21T10:02:00Z' } },
      { id: 'ma', raw: { id: 'ma', kind: 'MessageEvent', source: 'agent', timestamp: '2026-05-21T10:03:00Z' } },
      { id: 'cerr', raw: { id: 'cerr', kind: 'ConversationErrorEvent', timestamp: '2026-05-21T10:04:00Z' } },
      { id: 'serr', raw: { id: 'serr', kind: 'ServerErrorEvent', timestamp: '2026-05-21T10:05:00Z' } },
      { id: 'act', raw: { id: 'act', kind: 'ActionEvent', source: 'agent', action: { kind: 'TerminalAction', command: 'ls' }, timestamp: '2026-05-21T10:06:00Z' } },
      { id: 'obs', raw: { id: 'obs', kind: 'ObservationEvent', source: 'environment', observation: { kind: 'TerminalObservation' }, timestamp: '2026-05-21T10:07:00Z' } },
    ];
    for (const s of seed) {
      agentEventRepository.insert({
        conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
        rawEvent: s.raw,
      });
    }
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['act', 'obs']);
    // total reflects raw stored rows, not filtered count
    expect(res.body.total).toBe(seed.length);
  });

  it('honors explicit ?kind= overrides past the kiosk-timeline filter (issue #280)', async () => {
    // Forensics / debug callers must be able to retrieve filtered kinds via
    // an explicit `?kind=` query.
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: 'm1', kind: 'MessageEvent', source: 'agent', timestamp: '2026-05-21T10:00:00Z' },
    });
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events?kind=MessageEvent`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['m1']);
  });

  it('keeps unknown future event kinds in the default response (regression guard for #280)', async () => {
    // Default-show behaviour: never silently swallow new event kinds.
    agentEventRepository.insert({
      conversationId: 'c1', sessionId: testSessionId, workspaceId: testWorkspaceId,
      rawEvent: { id: 'fut', kind: 'SomeFutureEvent', source: 'agent', timestamp: '2026-05-21T10:00:00Z' },
    });
    sessionRepository.updateMetadata(testSessionId, { aiConversationId: 'c1' });

    const res = await request(app)
      .get(`/api/sessions/${testSessionId}/agent-events`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['fut']);
  });
});
