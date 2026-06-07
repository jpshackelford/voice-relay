import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createDeviceRouter } from './router.js';
import { DeviceRepository } from './device-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { SessionRepository } from '../sessions/session-repository.js';
import { SpeakerRepository } from '../speakers/speaker-repository.js';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

describe('Device Router', () => {
  let app: Express;
  let db: Database.Database;
  let deviceRepository: DeviceRepository;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let testUserId: string;
  let authToken: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    // Create devices table with new secure schema. `primary_user_id`
    // is part of the live schema (migration 017, #383); the migration
    // would ADD it via ALTER, so we just include it inline here to
    // keep the test setup self-contained.
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        device_token_hash TEXT UNIQUE,
        token_expires_at TEXT,
        last_seen_at TEXT,
        config TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        primary_user_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);

    deviceRepository = new DeviceRepository(db);
    workspaceRepository = new WorkspaceRepository(db);
    userRepository = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    // Create test user and workspace
    testUserId = 'user-123';
    testWorkspaceId = 'workspace-123';

    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 12345, 'testuser');

    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Add owner as workspace member (required for canAccess to work)
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, testUserId, 'owner');

    // Get user for token generation
    const user = userRepository.findById(testUserId)!;
    authToken = jwtService.sign(user);

    // Set up Express app
    app = express();
    app.use(express.json());

    const router = createDeviceRouter({
      deviceRepository,
      workspaceRepository,
      authConfig: { jwtService, userRepository },
    });
    app.use('/api/devices', router);
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /validate', () => {
    it('validates a correct device token', async () => {
      const { token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: token })
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.device.name).toBe('Test Device');
      expect(response.body.device.mode).toBe('mobile');
      expect(response.body.expiresAt).toBeDefined();
      expect(response.body.tokenExpiringSoon).toBe(false);
    });

    it('rejects invalid token with 401', async () => {
      const response = await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: 'invalid-token' })
        .expect(401);

      expect(response.body.error).toBe('Invalid device token');
    });

    it('rejects missing token with 400', async () => {
      const response = await request(app)
        .post('/api/devices/validate')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('deviceToken required');
    });

    it('rejects expired tokens', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      // Manually expire the token
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      db.prepare('UPDATE devices SET token_expires_at = ? WHERE id = ?')
        .run(pastDate.toISOString(), device.id);

      const response = await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: token })
        .expect(401);

      expect(response.body.error).toBe('Invalid device token');
    });

    it('indicates when token is expiring soon', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      // Set expiration to 3 days from now (within 7 day threshold)
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      db.prepare('UPDATE devices SET token_expires_at = ? WHERE id = ?')
        .run(soonDate.toISOString(), device.id);

      const response = await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: token })
        .expect(200);

      expect(response.body.tokenExpiringSoon).toBe(true);
    });
  });

  describe('GET /:deviceId', () => {
    it('requires authentication', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .get(`/api/devices/${device.id}`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('returns device info when authenticated', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'kiosk',
      });

      const response = await request(app)
        .get(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(device.id);
      expect(response.body.name).toBe('Test Device');
      expect(response.body.mode).toBe('kiosk');
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app)
        .get('/api/devices/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Device not found');
    });
  });

  describe('POST /:deviceId/token', () => {
    it('requires authentication', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .post(`/api/devices/${device.id}/token`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('regenerates device token', async () => {
      const { device, token: oldToken } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .post(`/api/devices/${device.id}/token`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.deviceId).toBe(device.id);
      expect(response.body.deviceToken).toBeDefined();
      expect(response.body.deviceToken).not.toBe(oldToken);
      expect(response.body.expiresAt).toBeDefined();

      // Old token should no longer work
      const validateResponse = await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: oldToken })
        .expect(401);

      // New token should work
      await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: response.body.deviceToken })
        .expect(200);
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app)
        .post('/api/devices/non-existent-id/token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Device not found');
    });
  });

  describe('POST /:deviceId/token/renew', () => {
    it('requires authentication', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .post(`/api/devices/${device.id}/token/renew`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('renews token expiration without changing token', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      // Set expiration to soon
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      db.prepare('UPDATE devices SET token_expires_at = ? WHERE id = ?')
        .run(soonDate.toISOString(), device.id);

      const response = await request(app)
        .post(`/api/devices/${device.id}/token/renew`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.deviceId).toBe(device.id);
      expect(response.body.expiresAt).toBeDefined();
      expect(response.body.message).toBe('Token expiration renewed');

      // Original token should still work
      await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: token })
        .expect(200);

      // New expiration should be ~90 days from now
      const newExpiry = new Date(response.body.expiresAt);
      const now = new Date();
      const daysDiff = (newExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(85);
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app)
        .post('/api/devices/non-existent-id/token/renew')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Device not found');
    });
  });

  describe('DELETE /:deviceId/token', () => {
    it('requires authentication', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .delete(`/api/devices/${device.id}/token`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('revokes device token', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .delete(`/api/devices/${device.id}/token`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Device token revoked');

      // Token should no longer work
      await request(app)
        .post('/api/devices/validate')
        .send({ deviceToken: token })
        .expect(401);
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app)
        .delete('/api/devices/non-existent-id/token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Device not found');
    });
  });

  describe('DELETE /:deviceId', () => {
    it('requires authentication', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .delete(`/api/devices/${device.id}`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('deletes device', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .delete(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Device deleted');

      // Device should no longer exist
      const found = deviceRepository.findById(device.id);
      expect(found).toBeNull();
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app)
        .delete('/api/devices/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Device not found');
    });
  });

  describe('PATCH /:deviceId', () => {
    it('requires authentication', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .patch(`/api/devices/${device.id}`)
        .send({ name: 'New Name' })
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('renames device when user has workspace access', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Original Name',
        mode: 'mobile',
      });

      const response = await request(app)
        .patch(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Name' })
        .expect(200);

      expect(response.body.name).toBe('New Name');
      expect(response.body.id).toBe(device.id);
    });

    it('returns 403 when user lacks workspace access', async () => {
      // Create another user and workspace they don't have access to
      const otherUserId = 'other-user-456';
      const otherWorkspaceId = 'other-workspace-456';

      db.prepare(`
        INSERT INTO users (id, github_id, username, created_at, last_login_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(otherUserId, 99999, 'otheruser');

      db.prepare(`
        INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(otherWorkspaceId, otherUserId, 'Other Workspace', 'other-workspace', 'WXYZ-9999');

      // Create device in the OTHER workspace
      const { device } = deviceRepository.create({
        workspaceId: otherWorkspaceId,
        name: 'Other Device',
        mode: 'mobile',
      });

      // Try to rename with testUser's token (who is NOT in otherWorkspace)
      const response = await request(app)
        .patch(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);

      expect(response.body.error).toBe('Access denied');

      // Verify device wasn't renamed
      const unchangedDevice = deviceRepository.findById(device.id);
      expect(unchangedDevice?.name).toBe('Other Device');
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app)
        .patch('/api/devices/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Name' })
        .expect(404);

      expect(response.body.error).toBe('Device not found');
    });

    it('rejects empty device name', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Original Name',
        mode: 'mobile',
      });

      const response = await request(app)
        .patch(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '   ' })
        .expect(400);

      expect(response.body.error).toBe('Device name is required');
    });

    it('rejects device name that is too long', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Original Name',
        mode: 'mobile',
      });

      const longName = 'x'.repeat(101);
      const response = await request(app)
        .patch(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: longName })
        .expect(400);

      expect(response.body.error).toBe('Device name too long (max 100 chars)');
    });

    it('trims whitespace from device name', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Original Name',
        mode: 'mobile',
      });

      const response = await request(app)
        .patch(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '  Trimmed Name  ' })
        .expect(200);

      expect(response.body.name).toBe('Trimmed Name');
    });

    // Issue #383: PATCH claims the device for the authenticated user and
    // must also refresh the in-memory registry cache so the next utterance
    // resolves to the correct speaker without a DB lookup.
    it('refreshes deviceRegistry cache when device is claimed (#383)', async () => {
      const { DeviceRegistry } = await import('../registry.js');
      const registry = new DeviceRegistry();

      // Mount a fresh router wired to the registry.
      const claimApp = express();
      claimApp.use(express.json());
      claimApp.use(
        '/api/devices',
        createDeviceRouter({
          deviceRepository,
          workspaceRepository,
          deviceRegistry: registry,
          authConfig: { jwtService, userRepository },
        })
      );

      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      // Simulate a live websocket-registered device with no claimed user.
      const fakeWs = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as never;
      registry.register(
        device.id, testWorkspaceId, fakeWs, 'Kiosk', 'kiosk',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        null,
      );
      expect(registry.getDevice(device.id)?.primaryUserId).toBeNull();

      await request(claimApp)
        .patch(`/api/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Kiosk' })
        .expect(200);

      expect(deviceRepository.findById(device.id)?.primaryUserId).toBe(testUserId);
      expect(registry.getDevice(device.id)?.primaryUserId).toBe(testUserId);
    });
  });
});

/**
 * #433: tests for the device-token POST /:deviceId/sessions/:sessionId
 * /active-speaker route. These run on the full migration chain so
 * sessions, session_devices and speakers are present with the same
 * schema production uses.
 */
describe('POST /:deviceId/sessions/:sessionId/active-speaker (#433)', () => {
  let app: Express;
  let db: Database.Database;
  let deviceRepository: DeviceRepository;
  let sessionRepository: SessionRepository;
  let speakerRepository: SpeakerRepository;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let testSessionId: string;
  let testDeviceId: string;
  let testDeviceToken: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();

    deviceRepository = new DeviceRepository(db);
    sessionRepository = new SessionRepository(db);
    speakerRepository = new SpeakerRepository(db);
    workspaceRepository = new WorkspaceRepository(db);
    userRepository = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    const owner = userRepository.create({
      githubId: 7777,
      username: 'owner',
      displayName: 'Owner',
    });
    const workspace = workspaceRepository.create(owner.id, {
      name: 'WS-433',
    });
    testWorkspaceId = workspace.id;

    const session = sessionRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Test session',
    });
    testSessionId = session.id;

    const created = deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Test kiosk',
      mode: 'kiosk',
    });
    testDeviceId = created.device.id;
    testDeviceToken = created.token;

    app = express();
    app.use(express.json());
    const router = createDeviceRouter({
      deviceRepository,
      workspaceRepository,
      sessionRepository,
      speakerRepository,
      authConfig: { jwtService, userRepository },
    });
    app.use('/api/devices', router);
  });

  afterEach(() => {
    db.close();
  });

  it('creates an anonymous speaker and sets active_speaker_id on success', async () => {
    const res = await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane', pronouns: 'she/her' })
      .expect(201);

    expect(typeof res.body.speakerId).toBe('string');
    expect(res.body.speakerId.length).toBeGreaterThan(0);

    // Speaker row written, with userId = null and matching name/pronouns.
    const speaker = speakerRepository.findById(
      testWorkspaceId,
      res.body.speakerId
    );
    expect(speaker).not.toBeNull();
    expect(speaker?.userId).toBeNull();
    expect(speaker?.preferredName).toBe('Jane');
    expect(speaker?.pronouns).toBe('she/her');

    // session_devices.active_speaker_id is set for (sessionId, deviceId).
    const activeSpeakerId = sessionRepository.getActiveSpeaker(
      testSessionId,
      testDeviceId
    );
    expect(activeSpeakerId).toBe(res.body.speakerId);
  });

  it('omits pronouns when not provided', async () => {
    const res = await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Pat' })
      .expect(201);

    const speaker = speakerRepository.findById(
      testWorkspaceId,
      res.body.speakerId
    );
    expect(speaker?.pronouns).toBeNull();
  });

  it('rejects requests with no Authorization header (401)', async () => {
    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .send({ preferredName: 'Jane' })
      .expect(401);
  });

  it('rejects requests where the device token belongs to a different device (401)', async () => {
    const other = deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Other device',
      mode: 'kiosk',
    });

    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${other.token}`)
      .send({ preferredName: 'Jane' })
      .expect(401);

    // No speaker created, no override written.
    expect(
      sessionRepository.getActiveSpeaker(testSessionId, testDeviceId)
    ).toBeNull();
  });

  it('rejects requests with a non-existent session (404)', async () => {
    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/does-not-exist/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane' })
      .expect(404);
  });

  it('rejects requests when the session belongs to another workspace (403)', async () => {
    // Make a second workspace + session, but call with our device's token.
    const otherOwner = userRepository.create({
      githubId: 9999,
      username: 'other',
      displayName: 'Other',
    });
    const otherWorkspace = workspaceRepository.create(otherOwner.id, {
      name: 'Other WS',
    });
    const otherSession = sessionRepository.create({
      workspaceId: otherWorkspace.id,
      name: 'Other session',
    });

    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${otherSession.id}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane' })
      .expect(403);
  });

  it('rejects blank preferredName (400)', async () => {
    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: '   ' })
      .expect(400);
  });

  it('rejects missing preferredName (400)', async () => {
    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({})
      .expect(400);
  });

  it('rejects preferredName longer than 200 chars (400)', async () => {
    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'x'.repeat(201) })
      .expect(400);
  });

  it('rejects pronouns longer than 64 chars (400)', async () => {
    await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane', pronouns: 'p'.repeat(65) })
      .expect(400);
  });

  it('treats blank pronouns as null', async () => {
    const res = await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane', pronouns: '   ' })
      .expect(201);
    const speaker = speakerRepository.findById(
      testWorkspaceId,
      res.body.speakerId
    );
    expect(speaker?.pronouns).toBeNull();
  });

  it('replaces the previous active speaker on a subsequent call', async () => {
    const first = await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane' })
      .expect(201);

    const second = await request(app)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Bob' })
      .expect(201);

    expect(second.body.speakerId).not.toBe(first.body.speakerId);
    expect(
      sessionRepository.getActiveSpeaker(testSessionId, testDeviceId)
    ).toBe(second.body.speakerId);
  });

  it('returns 503 when sessionRepository is not configured', async () => {
    const limpApp = express();
    limpApp.use(express.json());
    limpApp.use(
      '/api/devices',
      createDeviceRouter({
        deviceRepository,
        workspaceRepository,
        authConfig: { jwtService, userRepository },
        // sessionRepository / speakerRepository deliberately omitted.
      })
    );

    await request(limpApp)
      .post(
        `/api/devices/${testDeviceId}/sessions/${testSessionId}/active-speaker`
      )
      .set('Authorization', `Bearer ${testDeviceToken}`)
      .send({ preferredName: 'Jane' })
      .expect(503);
  });
});
