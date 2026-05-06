import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createWorkspaceRouter } from './router.js';
import { WorkspaceRepository } from './workspace-repository.js';
import { DeviceRepository } from '../devices/device-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';

describe('Workspace Router - GET /:id/devices', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let deviceRepository: DeviceRepository;
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
    // Create devices table
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

    workspaceRepository = new WorkspaceRepository(db);
    deviceRepository = new DeviceRepository(db);
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

    // Add owner as workspace member
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

    const router = createWorkspaceRouter({
      workspaceRepository,
      deviceRepository,
      authConfig: { jwtService, userRepository },
    });
    app.use('/api/workspaces', router);
  });

  afterEach(() => {
    db.close();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/devices`)
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
  });

  it('returns devices for workspace owner', async () => {
    // Create some devices
    deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Device 1',
      mode: 'mobile',
    });
    deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Device 2',
      mode: 'kiosk',
    });

    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/devices`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.devices).toHaveLength(2);
    expect(response.body.devices.map((d: { name: string }) => d.name)).toContain('Device 1');
    expect(response.body.devices.map((d: { name: string }) => d.name)).toContain('Device 2');
  });

  it('returns devices for workspace member', async () => {
    // Create another user as a member
    const memberId = 'member-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(memberId, 67890, 'memberuser');

    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, memberId, 'member');

    const member = userRepository.findById(memberId)!;
    const memberToken = jwtService.sign(member);

    // Create a device
    deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Shared Device',
      mode: 'mobile',
    });

    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/devices`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(response.body.devices).toHaveLength(1);
    expect(response.body.devices[0].name).toBe('Shared Device');
  });

  it('returns 403 for non-member', async () => {
    // Create another user who is NOT a member
    const nonMemberId = 'nonmember-789';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(nonMemberId, 11111, 'nonmemberuser');

    const nonMember = userRepository.findById(nonMemberId)!;
    const nonMemberToken = jwtService.sign(nonMember);

    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/devices`)
      .set('Authorization', `Bearer ${nonMemberToken}`)
      .expect(403);

    expect(response.body.error).toBe('Access denied');
  });

  it('returns 404 for non-existent workspace', async () => {
    const response = await request(app)
      .get('/api/workspaces/nonexistent-workspace/devices')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    expect(response.body.error).toBe('Workspace not found');
  });

  it('returns empty array when no devices exist', async () => {
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/devices`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.devices).toHaveLength(0);
    expect(response.body.devices).toEqual([]);
  });

  it('does not include device token information', async () => {
    deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Secure Device',
      mode: 'mobile',
    });

    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/devices`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const device = response.body.devices[0];
    expect(device.deviceToken).toBeUndefined();
    expect(device.deviceTokenHash).toBeUndefined();
    expect(device.token_expires_at).toBeUndefined();
    // But should include expected fields
    expect(device.id).toBeDefined();
    expect(device.name).toBe('Secure Device');
    expect(device.mode).toBe('mobile');
    expect(device.createdAt).toBeDefined();
  });
});
