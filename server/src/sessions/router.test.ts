import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createSessionRouter } from './router.js';
import { SessionRepository } from './session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { DeviceRepository } from '../devices/device-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';

describe('Session Router', () => {
  let app: Express;
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let workspaceRepository: WorkspaceRepository;
  let deviceRepository: DeviceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let testUserId: string;
  let otherUserId: string;
  let authToken: string;
  let otherAuthToken: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(workspacesMigration.up);
    // Create devices and sessions tables
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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        metadata TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, device_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
    `);

    sessionRepository = new SessionRepository(db);
    workspaceRepository = new WorkspaceRepository(db);
    deviceRepository = new DeviceRepository(db);
    userRepository = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    // Create test users
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

    // Create test workspace owned by testUserId
    testWorkspaceId = 'workspace-123';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Generate auth tokens
    const user = userRepository.findById(testUserId)!;
    authToken = jwtService.sign(user);
    const otherUser = userRepository.findById(otherUserId)!;
    otherAuthToken = jwtService.sign(otherUser);

    // Set up Express app with merged params (for :workspaceId)
    app = express();
    app.use(express.json());

    const router = createSessionRouter({
      sessionRepository,
      workspaceRepository,
      authConfig: { jwtService, userRepository },
    });
    app.use('/api/workspaces/:workspaceId/sessions', router);
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /sessions', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('returns 403 for non-member', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(403);

      expect(response.body.error).toBe('Access denied to workspace');
    });

    it('returns empty array when no sessions', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.sessions).toEqual([]);
    });

    it('returns sessions list', async () => {
      sessionRepository.create({ workspaceId: testWorkspaceId, name: 'Session 1' });
      sessionRepository.create({ workspaceId: testWorkspaceId, name: 'Session 2' });

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(2);
    });

    it('filters by status', async () => {
      const session1 = sessionRepository.create({ workspaceId: testWorkspaceId, name: 'Active' });
      const session2 = sessionRepository.create({ workspaceId: testWorkspaceId, name: 'Ended' });
      sessionRepository.endSession(session2.id);

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions?status=active`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0].name).toBe('Active');
    });
  });

  describe('GET /sessions/current', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/current`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('returns 403 for non-member', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/current`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(403);

      expect(response.body.error).toBe('Access denied to workspace');
    });

    it('creates session if none exists', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/current`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.session).toBeDefined();
      expect(response.body.session.workspaceId).toBe(testWorkspaceId);
      expect(response.body.session.status).toBe('active');
    });

    it('returns existing active session', async () => {
      const created = sessionRepository.create({ 
        workspaceId: testWorkspaceId, 
        name: 'Existing Session' 
      });

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/current`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.session.id).toBe(created.id);
      expect(response.body.session.name).toBe('Existing Session');
    });
  });

  describe('POST /sessions', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions`)
        .send({ name: 'New Session' })
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('returns 403 for non-member', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .send({ name: 'New Session' })
        .expect(403);

      expect(response.body.error).toBe('Access denied to workspace');
    });

    it('creates a new session', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Session' })
        .expect(201);

      expect(response.body.session.name).toBe('New Session');
      expect(response.body.session.workspaceId).toBe(testWorkspaceId);
      expect(response.body.session.status).toBe('active');
    });

    it('creates session without name', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(201);

      expect(response.body.session).toBeDefined();
      expect(response.body.session.status).toBe('active');
    });
  });

  describe('GET /sessions/:sessionId', () => {
    it('requires authentication', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('returns session with devices', async () => {
      const session = sessionRepository.create({ 
        workspaceId: testWorkspaceId,
        name: 'Test Session'
      });
      
      // Add a device to the session
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });
      sessionRepository.addDevice(session.id, device.id);

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.session.id).toBe(session.id);
      expect(response.body.session.name).toBe('Test Session');
      expect(response.body.session.devices).toHaveLength(1);
      expect(response.body.session.devices[0].deviceId).toBe(device.id);
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/sessions/non-existent`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('PATCH /sessions/:sessionId', () => {
    it('requires authentication', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });

      const response = await request(app)
        .patch(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}`)
        .send({ name: 'Updated' })
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('updates session name', async () => {
      const session = sessionRepository.create({ 
        workspaceId: testWorkspaceId,
        name: 'Original'
      });

      const response = await request(app)
        .patch(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.session.name).toBe('Updated Name');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${testWorkspaceId}/sessions/non-existent`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated' })
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('POST /sessions/:sessionId/end', () => {
    it('ends an active session', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.session.status).toBe('ended');
      expect(response.body.session.endedAt).toBeDefined();
      expect(response.body.message).toBe('Session ended');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/non-existent/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('POST /sessions/:sessionId/archive', () => {
    it('archives a session', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });
      sessionRepository.endSession(session.id);

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}/archive`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.session.status).toBe('archived');
      expect(response.body.message).toBe('Session archived');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/non-existent/archive`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('POST /sessions/:sessionId/devices', () => {
    it('adds device to session', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}/devices`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ deviceId: device.id })
        .expect(200);

      expect(response.body.membership).toBeDefined();
      expect(response.body.membership.deviceId).toBe(device.id);
    });

    it('returns 400 when deviceId missing', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}/devices`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('deviceId required');
    });

    it('returns 404 for non-existent session', async () => {
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/sessions/non-existent/devices`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ deviceId: device.id })
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('DELETE /sessions/:sessionId/devices/:deviceId', () => {
    it('removes device from session', async () => {
      const session = sessionRepository.create({ workspaceId: testWorkspaceId });
      const { device } = deviceRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });
      sessionRepository.addDevice(session.id, device.id);

      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/sessions/${session.id}/devices/${device.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Device removed from session');

      // Verify device was removed
      const devices = sessionRepository.getDevices(session.id);
      expect(devices).toHaveLength(0);
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/sessions/non-existent/devices/device-123`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });
});
