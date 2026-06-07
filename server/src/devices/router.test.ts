import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createDeviceRouter } from './router.js';
import { DeviceRepository } from './device-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { SessionRepository } from '../sessions/session-repository.js';
import { SpeakerRepository } from '../speakers/speaker-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
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

  // Issue #433: device-token-authenticated active-speaker endpoint.
  // Lets the first-run claim card on an unclaimed device say "this turn
  // is from <name>" without requiring the human to be a workspace member.
  describe('POST /:deviceId/sessions/:sessionId/active-speaker (#433)', () => {
    let sessionRepository: SessionRepository;
    let speakerRepository: SpeakerRepository;
    let claimApp: Express;
    let sessionId: string;

    beforeEach(() => {
      // Add the tables this endpoint needs. The router-test setup
      // already created `devices` inline (see top-level beforeEach), so
      // we just add the speaker-identity stack here.
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT,
          metadata TEXT,
          display_api_secret_encrypted TEXT,
          display_api_secret_iv TEXT,
          display_api_secret_tag TEXT,
          target_kiosk_device_id TEXT,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS session_devices (
          session_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          joined_at TEXT NOT NULL DEFAULT (datetime('now')),
          active_speaker_id TEXT,
          PRIMARY KEY (session_id, device_id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS speakers (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          preferred_name TEXT,
          pronouns TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_speakers_workspace_user
          ON speakers(workspace_id, user_id)
          WHERE user_id IS NOT NULL;
      `);

      sessionRepository = new SessionRepository(db);
      speakerRepository = new SpeakerRepository(db);

      const session = sessionRepository.create({ workspaceId: testWorkspaceId });
      sessionId = session.id;

      claimApp = express();
      claimApp.use(express.json());
      claimApp.use(
        '/api/devices',
        createDeviceRouter({
          deviceRepository,
          workspaceRepository,
          sessionRepository,
          speakerRepository,
          authConfig: { jwtService, userRepository },
        })
      );
    });

    it('creates anonymous speaker and writes session_devices.active_speaker_id', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      const response = await request(claimApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'JP', pronouns: 'he/him' })
        .expect(201);

      expect(response.body.speakerId).toBeDefined();

      const speaker = speakerRepository.findById(testWorkspaceId, response.body.speakerId);
      expect(speaker).not.toBeNull();
      expect(speaker?.userId).toBeNull(); // anonymous
      expect(speaker?.preferredName).toBe('JP');
      expect(speaker?.pronouns).toBe('he/him');

      expect(sessionRepository.getActiveSpeaker(sessionId, device.id)).toBe(speaker!.id);
    });

    it('accepts call without pronouns', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      const response = await request(claimApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'Anna' })
        .expect(201);

      const speaker = speakerRepository.findById(testWorkspaceId, response.body.speakerId);
      expect(speaker?.pronouns).toBeNull();
    });

    it('rejects mismatched device token (401)', async () => {
      const { device: deviceA } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk A',
        mode: 'kiosk',
      });
      const { token: tokenB } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk B',
        mode: 'kiosk',
      });

      // tokenB belongs to a different device — endpoint must reject.
      const response = await request(claimApp)
        .post(`/api/devices/${deviceA.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ preferredName: 'Mallory' })
        .expect(401);

      expect(response.body.error).toBe('Invalid device token');

      // Side-effect check: no speaker was created and no override was written.
      expect(speakerRepository.listForWorkspace(testWorkspaceId)).toHaveLength(0);
      expect(sessionRepository.getActiveSpeaker(sessionId, deviceA.id)).toBeNull();
    });

    it('rejects missing Authorization header (401)', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      await request(claimApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .send({ preferredName: 'JP' })
        .expect(401);
    });

    it('rejects empty preferredName (400)', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      const response = await request(claimApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: '   ' })
        .expect(400);

      expect(response.body.error).toBe('preferredName cannot be empty');
    });

    it('rejects preferredName over 80 chars (400)', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      await request(claimApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'x'.repeat(81) })
        .expect(400);
    });

    it('rejects session that lives in a different workspace (404)', async () => {
      // Second workspace + session.
      const otherWorkspaceId = 'workspace-other';
      db.prepare(`
        INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(otherWorkspaceId, testUserId, 'Other', 'other', 'WXYZ-9999');
      const otherSession = sessionRepository.create({ workspaceId: otherWorkspaceId });

      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      await request(claimApp)
        .post(`/api/devices/${device.id}/sessions/${otherSession.id}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'JP' })
        .expect(404);
    });
  });

  // Issue #443: workspace-level cap + dedup on anonymous speakers.
  describe('POST /:deviceId/sessions/:sessionId/active-speaker — #443 quota + dedup', () => {
    let sessionRepository: SessionRepository;
    let speakerRepository: SpeakerRepository;
    let cappedApp: Express;
    let sessionId: string;
    const CAP = 2;

    beforeEach(() => {
      // Same schema as the #433 block above.
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT,
          metadata TEXT,
          display_api_secret_encrypted TEXT,
          display_api_secret_iv TEXT,
          display_api_secret_tag TEXT,
          target_kiosk_device_id TEXT,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS session_devices (
          session_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          joined_at TEXT NOT NULL DEFAULT (datetime('now')),
          active_speaker_id TEXT,
          PRIMARY KEY (session_id, device_id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS speakers (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          preferred_name TEXT,
          pronouns TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_speakers_workspace_user
          ON speakers(workspace_id, user_id)
          WHERE user_id IS NOT NULL;
      `);

      sessionRepository = new SessionRepository(db);
      speakerRepository = new SpeakerRepository(db);

      const session = sessionRepository.create({ workspaceId: testWorkspaceId });
      sessionId = session.id;

      // Tiny cap so the test doesn't have to spam 100 names.
      cappedApp = express();
      cappedApp.use(express.json());
      cappedApp.use(
        '/api/devices',
        createDeviceRouter({
          deviceRepository,
          workspaceRepository,
          sessionRepository,
          speakerRepository,
          maxAnonymousSpeakersPerWorkspace: CAP,
          authConfig: { jwtService, userRepository },
        })
      );
    });

    it('dedup hit: re-submitting the same name returns the same speakerId (201)', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      const first = await request(cappedApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'Alex', pronouns: 'they/them' })
        .expect(201);

      const second = await request(cappedApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'alex', pronouns: 'they/them' }) // case-insensitive
        .expect(201);

      expect(second.body.speakerId).toBe(first.body.speakerId);
      expect(speakerRepository.listForWorkspace(testWorkspaceId)).toHaveLength(1);
    });

    it('returns 429 with Retry-After when workspace hits the anonymous cap', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      // Fill the cap with distinct names.
      for (let i = 0; i < CAP; i++) {
        await request(cappedApp)
          .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
          .set('Authorization', `Bearer ${token}`)
          .send({ preferredName: `Person${i}` })
          .expect(201);
      }
      expect(speakerRepository.listForWorkspace(testWorkspaceId)).toHaveLength(CAP);

      const blocked = await request(cappedApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'Newcomer' })
        .expect(429);

      expect(blocked.body.error).toBe('Workspace anonymous speaker quota exceeded');
      expect(blocked.body.retryAfter).toBe(60);
      expect(blocked.headers['retry-after']).toBe('60');

      // No row leaked through.
      expect(speakerRepository.listForWorkspace(testWorkspaceId)).toHaveLength(CAP);
    });

    it('dedup against an existing row succeeds even when workspace is at cap', async () => {
      const { device, token } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Kiosk',
        mode: 'kiosk',
      });

      const firstAlex = await request(cappedApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'Alex' })
        .expect(201);
      await request(cappedApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'Bree' })
        .expect(201);
      // At cap now.
      expect(speakerRepository.listForWorkspace(testWorkspaceId)).toHaveLength(CAP);

      // Re-claim as Alex — dedup hit, MUST NOT 429.
      const reAlex = await request(cappedApp)
        .post(`/api/devices/${device.id}/sessions/${sessionId}/active-speaker`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preferredName: 'ALEX' })
        .expect(201);

      expect(reAlex.body.speakerId).toBe(firstAlex.body.speakerId);
      expect(speakerRepository.listForWorkspace(testWorkspaceId)).toHaveLength(CAP);
    });
  });
});
