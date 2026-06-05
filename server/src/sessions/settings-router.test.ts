/**
 * Tests for `createSessionSettingsRouter` (issue #378).
 *
 * Covers both auth paths (DISPLAY_API_SECRET bearer + JWT workspace
 * member) and the GET/PATCH happy paths + 400/401/403/404 failure
 * matrix. The settings service runs against an in-memory SQLite with the
 * real repositories so we exercise the full validation/persist path; the
 * registry is stubbed to keep broadcasts out of the way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createSessionSettingsRouter } from './settings-router.js';
import { createSessionSettingsService } from './settings-service.js';
import { SessionRepository } from './session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';
import { migration as qrTokensMigration } from '../storage/migrations/008_qr_tokens.js';
import { migration as elevenlabsMigration } from '../storage/migrations/011_elevenlabs.js';
import { migration as kioskTickersMigration } from '../storage/migrations/015_kiosk_footer_tickers.js';
import { migration as defaultAgentPromptMigration } from '../storage/migrations/016_default_agent_prompt.js';
import { migration as hostedSttMigration } from '../storage/migrations/019_hosted_stt.js';
import type { DeviceRegistry } from '../registry.js';

describe('Session Settings Router', () => {
  let app: Express;
  let db: Database.Database;
  let sessionRepo: SessionRepository;
  let workspaceRepo: WorkspaceRepository;
  let userRepo: UserRepository;
  let jwtService: JWTService;
  let workspaceId: string;
  let sessionId: string;
  let displaySecret: string;
  let memberToken: string;
  let outsiderToken: string;

  beforeEach(() => {
    process.env.ENCRYPTION_SECRET ||= 'test-encryption-secret-1234567890abcdef';
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
        target_kiosk_device_id TEXT,
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
    db.exec(qrTokensMigration.up);
    db.exec(elevenlabsMigration.up);
    db.exec(kioskTickersMigration.up);
    db.exec(defaultAgentPromptMigration.up);
    db.exec(hostedSttMigration.up);

    sessionRepo = new SessionRepository(db);
    workspaceRepo = new WorkspaceRepository(db);
    userRepo = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-owner', 1, 'owner');
    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-outsider', 2, 'outsider');

    workspaceId = 'ws-1';
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(workspaceId, 'user-owner', 'Test', 'test', 'JC-1');

    const { session, displayApiSecret } = sessionRepo.createWithDisplaySecret({
      workspaceId,
      name: 'sess-1',
    });
    sessionId = session.id;
    displaySecret = displayApiSecret;

    memberToken = jwtService.sign(userRepo.findById('user-owner')!);
    outsiderToken = jwtService.sign(userRepo.findById('user-outsider')!);

    const registry = {
      broadcastMessageToSession: vi.fn(),
    } as unknown as DeviceRegistry;

    const service = createSessionSettingsService({
      sessionRepository: sessionRepo,
      workspaceRepository: workspaceRepo,
      registry,
    });

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(
      '/api/sessions',
      createSessionSettingsRouter({
        sessionRepository: sessionRepo,
        workspaceRepository: workspaceRepo,
        settingsService: service,
        authConfig: { jwtService, userRepository: userRepo },
      }),
    );
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('Bearer DISPLAY_API_SECRET path', () => {
    it('GET returns 200 with current settings', async () => {
      const res = await request(app)
        .get(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .expect(200);
      expect(res.body.sessionId).toBe(sessionId);
      expect(res.body.workspaceId).toBe(workspaceId);
      expect(res.body.tts).toEqual({ enabled: true, outputDeviceId: null });
      expect(res.body.inputMode).toBe('unified');
      expect(res.body.agentPrompt.source).toBe('builtin');
    });

    it('PATCH updates inputMode and returns the new snapshot', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ inputMode: 'voice' })
        .expect(200);
      expect(res.body.inputMode).toBe('voice');
      expect(sessionRepo.findById(sessionId)?.metadata?.inputMode).toBe('voice');
    });

    it('PATCH agentPrompt persists and sets source=session', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ agentPrompt: 'SESSION OVERRIDE' })
        .expect(200);
      expect(res.body.agentPrompt.source).toBe('session');
      expect(res.body.agentPrompt.effective).toBe('SESSION OVERRIDE');
    });

    it('rejects an invalid bearer secret with 401 fallthrough', async () => {
      // When the bearer isn't a valid display secret and isn't a JWT
      // either, we should get a 401 from the JWT fallback.
      const res = await request(app)
        .get(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', 'Bearer not-a-real-secret')
        .expect(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('JWT workspace-member path', () => {
    it('GET succeeds for a workspace member with a JWT', async () => {
      const res = await request(app)
        .get(`/api/sessions/${sessionId}/settings`)
        .set('Cookie', [`voice_relay_auth=${memberToken}`])
        .expect(200);
      expect(res.body.sessionId).toBe(sessionId);
    });

    it('PATCH succeeds for a workspace member with a JWT', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}/settings`)
        .set('Cookie', [`voice_relay_auth=${memberToken}`])
        .send({ autoSubmit: false })
        .expect(200);
      expect(res.body.autoSubmit).toBe(false);
    });

    it('returns 403 for a JWT belonging to a non-member', async () => {
      await request(app)
        .get(`/api/sessions/${sessionId}/settings`)
        .set('Cookie', [`voice_relay_auth=${outsiderToken}`])
        .expect(403);
    });

    it('returns 401 when no auth is supplied', async () => {
      await request(app).get(`/api/sessions/${sessionId}/settings`).expect(401);
    });
  });

  describe('error cases', () => {
    it('returns 404 for an unknown session id', async () => {
      await request(app)
        .get('/api/sessions/does-not-exist/settings')
        .set('Authorization', `Bearer ${displaySecret}`)
        .expect(404);
    });

    it('returns 400 for a malformed body (array)', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send([])
        .expect(400);
      expect(res.body.error).toMatch(/JSON object/);
    });

    it('returns 400 for an unknown field in body', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ unknownField: 'x' })
        .expect(400);
      expect(res.body.error).toMatch(/Unknown field/);
    });

    it('returns 400 for an invalid inputMode value', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}/settings`)
        .set('Authorization', `Bearer ${displaySecret}`)
        .send({ inputMode: 'invalid' })
        .expect(400);
      expect(res.body.error).toMatch(/inputMode/);
    });
  });
});
