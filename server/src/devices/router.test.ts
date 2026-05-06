import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createDeviceRouter } from './router.js';
import { DeviceRepository } from './device-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';

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
    db.exec(workspacesMigration.up);
    // Create devices table with new secure schema
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
});
