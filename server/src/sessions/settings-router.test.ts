import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import request from 'supertest';

// Mock encryption so we don't need ENCRYPTION_SECRET in the env. Matches the
// pattern used by `session-repository.test.ts`.
vi.mock('../workspaces/encryption.js', () => ({
  encryptApiKey: vi.fn((secret: string) => ({
    encrypted: Buffer.from(secret).toString('base64'),
    iv: 'test-iv',
    tag: 'test-tag',
  })),
  decryptApiKey: vi.fn((encrypted: { encrypted: string }) =>
    Buffer.from(encrypted.encrypted, 'base64').toString('utf-8'),
  ),
}));

import { createSessionSettingsRouter } from './settings-router.js';
import { SessionRepository } from './session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import type { DeviceRegistry } from '../registry.js';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';

function makeRegistry(): DeviceRegistry {
  return {
    broadcastMessageToSession: vi.fn(),
  } as unknown as DeviceRegistry;
}

describe('Session Settings Router — /api/sessions/:sessionId/settings', () => {
  let app: Express;
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let registry: DeviceRegistry;

  let testWorkspaceId: string;
  let testSessionId: string;
  let testUserId: string;
  let otherUserId: string;
  let authToken: string;
  let otherAuthToken: string;
  let displaySecret: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();

    sessionRepository = new SessionRepository(db);
    workspaceRepository = new WorkspaceRepository(db);
    userRepository = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });
    registry = makeRegistry();

    testUserId = 'user-1';
    otherUserId = 'user-2';
    db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
      .run(testUserId, 1, 'alice');
    db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
      .run(otherUserId, 2, 'bob');

    testWorkspaceId = 'ws-A';
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`,
    ).run(testWorkspaceId, testUserId, 'WS', 'ws-a');

    const created = sessionRepository.createWithDisplaySecret({
      workspaceId: testWorkspaceId,
      name: 's1',
    });
    testSessionId = created.session.id;
    displaySecret = created.displayApiSecret;

    authToken = jwtService.sign(userRepository.findById(testUserId)!);
    otherAuthToken = jwtService.sign(userRepository.findById(otherUserId)!);

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(
      '/api/sessions',
      createSessionSettingsRouter({
        sessionRepository,
        workspaceRepository,
        registry,
        authConfig: { jwtService, userRepository },
      }),
    );
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('GET /:sessionId/settings', () => {
    it('returns 401 with no auth header', async () => {
      await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .expect(401);
    });

    it('returns 401 with wrong display secret', async () => {
      await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', 'Bearer wrong-secret-value')
        .expect(401);
    });

    it('returns 404 for an unknown session', async () => {
      await request(app)
        .get('/api/sessions/no-such/settings')
        .set('Authorization', `Bearer ${displaySecret}`)
        .expect(404);
    });

    it('returns 403 for a JWT from a different workspace', async () => {
      await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(403);
    });

    it('returns 200 with DISPLAY_API_SECRET and reports defaults', async () => {
      const response = await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .expect(200);

      expect(response.body.sessionId).toBe(testSessionId);
      expect(response.body.workspaceId).toBe(testWorkspaceId);
      expect(response.body.tts).toEqual({ enabled: false, outputDeviceId: null });
      expect(response.body.inputMode).toBeNull();
      expect(response.body.autoSubmit).toBeNull();
      expect(response.body.agentPrompt).toEqual({
        effective: null,
        source: 'builtin',
      });
    });

    it('returns 200 with workspace-member JWT', async () => {
      const response = await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(response.body.sessionId).toBe(testSessionId);
    });

    it('reports agentPrompt.source=workspace-default when set', async () => {
      workspaceRepository.updateSettings(testWorkspaceId, {
        defaultAgentPrompt: 'WS DEFAULT',
      });
      const response = await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .expect(200);
      expect(response.body.agentPrompt).toEqual({
        effective: 'WS DEFAULT',
        source: 'workspace-default',
      });
    });
  });

  describe('PATCH /:sessionId/settings', () => {
    it('returns 401 with no auth', async () => {
      await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .send({ tts: { enabled: true } })
        .expect(401);
    });

    it('returns 400 with unknown field', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ unknownField: true })
        .expect(400);
      expect(response.body.error).toContain('Unknown field');
    });

    it('returns 400 for oversized agentPrompt', async () => {
      const big = 'x'.repeat(8193);
      await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ agentPrompt: big })
        .expect(400);
    });

    it('persists tts and broadcasts both legacy and snapshot messages', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ tts: { enabled: true, outputDeviceId: null } })
        .expect(200);

      expect(response.body.tts).toEqual({ enabled: true, outputDeviceId: null });

      const broadcast = registry.broadcastMessageToSession as ReturnType<typeof vi.fn>;
      const types = broadcast.mock.calls.map(
        (c) => (c[1] as { type?: string }).type,
      );
      expect(types).toContain('session-tts-settings-changed');
      expect(types).toContain('session-settings-changed');
    });

    it('persists inputMode and autoSubmit', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ inputMode: 'unified', autoSubmit: false })
        .expect(200);
      expect(response.body.inputMode).toBe('unified');
      expect(response.body.autoSubmit).toBe(false);

      // Persistence check.
      const session = sessionRepository.findById(testSessionId);
      expect(session?.metadata?.inputMode).toBe('unified');
      expect(session?.metadata?.autoSubmit).toBe(false);
    });

    it('persists agentPrompt override and reports it via GET', async () => {
      await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ agentPrompt: 'Be terse.' })
        .expect(200);

      const get = await request(app)
        .get(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .expect(200);
      expect(get.body.agentPrompt).toEqual({
        effective: 'Be terse.',
        source: 'session',
      });
    });

    it('allows clearing agentPrompt with null', async () => {
      sessionRepository.updateMetadata(testSessionId, {
        agentPrompt: 'old prompt',
      });
      const response = await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ agentPrompt: null })
        .expect(200);
      expect(response.body.agentPrompt.source).toBe('builtin');

      const session = sessionRepository.findById(testSessionId);
      expect(session?.metadata?.agentPrompt).toBeUndefined();
    });

    it('returns 403 for JWT from a different workspace', async () => {
      await request(app)
        .patch(`/api/sessions/${testSessionId}/settings`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .send({ tts: { enabled: true } })
        .expect(403);
    });
  });
});
