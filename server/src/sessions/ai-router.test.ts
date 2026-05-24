/**
 * Tests for the session AI control router (issue #294).
 *
 * Covers the spec rows T-3.5.S.1 .. T-3.5.S.7 from the issue's technical
 * approach comment. The driver is mocked through the public `AgentDriver`
 * interface so tests do not require any upstream OH coupling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createSessionAIRouter } from './ai-router.js';
import { SessionRepository } from './session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import type { AgentDriver, AgentSessionStatus } from '../agent-driver/index.js';
import type { DeviceRegistry } from '../registry.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

// Minimal driver stub. Each test wires the methods it exercises; unused
// methods throw so accidental usage fails loudly.
function makeDriver(overrides: Partial<AgentDriver> = {}): AgentDriver {
  const notImpl = (name: string) =>
    vi.fn(() => {
      throw new Error(`AgentDriver.${name} not implemented in test`);
    });
  return {
    isAvailable: vi.fn(() => true),
    hasSession: vi.fn(() => true),
    openSession: notImpl('openSession') as unknown as AgentDriver['openSession'],
    sendMessage: notImpl('sendMessage') as unknown as AgentDriver['sendMessage'],
    restartSession: notImpl('restartSession') as unknown as AgentDriver['restartSession'],
    getSessionStatus: notImpl('getSessionStatus') as unknown as AgentDriver['getSessionStatus'],
    closeSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeRegistry(): DeviceRegistry {
  return {
    broadcastMessageToSession: vi.fn(),
  } as unknown as DeviceRegistry;
}

const startingStatus = (sessionId: string): AgentSessionStatus => ({
  sessionId,
  state: 'starting',
  conversationId: null,
  error: null,
  thinkingSince: null,
  startingSince: '2026-05-24T00:00:00.000Z',
});

describe('Session AI Router — POST /:sessionId/ai/restart', () => {
  let app: Express;
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;

  let testWorkspaceId: string;
  let testSessionId: string;
  let testUserId: string;
  let otherUserId: string;
  let authToken: string;
  let otherAuthToken: string;

  let driver: AgentDriver;
  let registry: DeviceRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        display_api_secret_encrypted TEXT,
        display_api_secret_iv TEXT,
        display_api_secret_tag TEXT,
        metadata TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, device_id)
      );
    `);

    sessionRepository = new SessionRepository(db);
    workspaceRepository = new WorkspaceRepository(db);
    userRepository = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    testUserId = 'user-123';
    otherUserId = 'user-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 12345, 'testuser');
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(otherUserId, 67890, 'otheruser');

    testWorkspaceId = 'workspace-abc';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    const created = sessionRepository.create({ workspaceId: testWorkspaceId, name: 's1' });
    testSessionId = created.id;

    authToken = jwtService.sign(userRepository.findById(testUserId)!);
    otherAuthToken = jwtService.sign(userRepository.findById(otherUserId)!);

    driver = makeDriver();
    registry = makeRegistry();

    app = express();
    app.use(express.json());
    app.use(
      '/api/sessions',
      createSessionAIRouter({
        sessionRepository,
        workspaceRepository,
        agentDriver: driver,
        registry,
        authConfig: { jwtService, userRepository },
      }),
    );
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  // T-3.5.S.1
  it('returns 200 with the new status for an authenticated member', async () => {
    const status = startingStatus(testSessionId);
    driver.restartSession = vi.fn(async () => status);

    const response = await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toEqual(status);
    expect(driver.restartSession).toHaveBeenCalledWith(testSessionId);
  });

  // T-3.5.S.2
  it('calls driver.restartSession exactly once per request', async () => {
    driver.restartSession = vi.fn(async () => startingStatus(testSessionId));

    await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(driver.restartSession).toHaveBeenCalledTimes(1);
    expect(driver.restartSession).toHaveBeenCalledWith(testSessionId);
  });

  // T-3.5.S.3
  it('returns 401 without auth', async () => {
    driver.restartSession = vi.fn(async () => startingStatus(testSessionId));

    const response = await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
    expect(driver.restartSession).not.toHaveBeenCalled();
  });

  // T-3.5.S.4
  it('returns 403 for a non-member of the workspace', async () => {
    driver.restartSession = vi.fn(async () => startingStatus(testSessionId));

    const response = await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(403);

    expect(response.body.error).toBe('Access denied to session');
    expect(driver.restartSession).not.toHaveBeenCalled();
  });

  // T-3.5.S.5
  it('returns 404 for an unknown session', async () => {
    driver.restartSession = vi.fn(async () => startingStatus('nope'));

    const response = await request(app)
      .post('/api/sessions/does-not-exist/ai/restart')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    expect(response.body.error).toBe('Session not found');
    expect(driver.restartSession).not.toHaveBeenCalled();
  });

  // T-3.5.S.6
  it('returns 503 if the driver throws', async () => {
    driver.restartSession = vi.fn(async () => {
      throw new Error('upstream exploded');
    });

    const response = await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(503);

    expect(response.body.error).toBe('upstream exploded');
    // Should also broadcast an error status so peer devices reconcile.
    const broadcast = registry.broadcastMessageToSession as ReturnType<typeof vi.fn>;
    expect(broadcast).toHaveBeenCalled();
    const lastCall = broadcast.mock.calls[broadcast.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({
      type: 'session-ai-status',
      sessionId: testSessionId,
      connecting: false,
      connected: false,
      error: 'upstream exploded',
    });
  });

  // T-3.5.S.7
  it('does not double-start when two requests arrive concurrently (single-flight delegated to driver)', async () => {
    // The driver itself owns the single-flight slot (lazyBindSession);
    // the endpoint just calls restartSession. Two near-simultaneous
    // POSTs should both succeed and the driver should be called twice
    // (with the same sessionId), with the driver's own deduplication
    // preventing duplicate upstream binds. Here we only assert the
    // endpoint's pass-through semantics.
    const status = startingStatus(testSessionId);
    driver.restartSession = vi.fn(async () => status);

    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/api/sessions/${testSessionId}/ai/restart`)
        .set('Authorization', `Bearer ${authToken}`),
      request(app)
        .post(`/api/sessions/${testSessionId}/ai/restart`)
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body).toEqual(status);
    expect(r2.body).toEqual(status);
    expect(driver.restartSession).toHaveBeenCalledTimes(2);
    expect(driver.restartSession).toHaveBeenNthCalledWith(1, testSessionId);
    expect(driver.restartSession).toHaveBeenNthCalledWith(2, testSessionId);
  });

  it('broadcasts a connecting announcement and a final state to peer devices', async () => {
    const status = startingStatus(testSessionId);
    driver.restartSession = vi.fn(async () => status);

    await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const broadcast = registry.broadcastMessageToSession as ReturnType<typeof vi.fn>;
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0][1]).toMatchObject({
      type: 'session-ai-status',
      sessionId: testSessionId,
      connecting: true,
      connected: false,
    });
    expect(broadcast.mock.calls[1][1]).toMatchObject({
      type: 'session-ai-status',
      sessionId: testSessionId,
      connecting: true, // starting → connecting=true, connected=false
      connected: false,
    });
  });

  it('works without a registry (broadcasts optional)', async () => {
    driver.restartSession = vi.fn(async () => startingStatus(testSessionId));

    const noRegistryApp = express();
    noRegistryApp.use(express.json());
    noRegistryApp.use(
      '/api/sessions',
      createSessionAIRouter({
        sessionRepository,
        workspaceRepository,
        agentDriver: driver,
        authConfig: { jwtService, userRepository },
      }),
    );

    await request(noRegistryApp)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('returns 503 with a generic message when a non-Error is thrown', async () => {
    driver.restartSession = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'oops';
    });

    const response = await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(503);

    expect(response.body.error).toBe('Failed to restart agent session');
  });

  it('survives a broadcast failure (announce + final) and still responds', async () => {
    driver.restartSession = vi.fn(async () => startingStatus(testSessionId));
    registry.broadcastMessageToSession = vi.fn(() => {
      throw new Error('broadcast borked');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Both broadcast attempts (announce and final) should have been
    // attempted and logged as errors, but neither should fail the request.
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('survives a broadcast failure on the driver-error path', async () => {
    driver.restartSession = vi.fn(async () => {
      throw new Error('driver boom');
    });
    registry.broadcastMessageToSession = vi.fn(() => {
      throw new Error('broadcast borked');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(app)
      .post(`/api/sessions/${testSessionId}/ai/restart`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(503);

    expect(consoleSpy).toHaveBeenCalled();
  });
});
