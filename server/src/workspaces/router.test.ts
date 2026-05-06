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
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

// Helper to set up test database and app
function setupTestEnv() {
  const db = new Database(':memory:');
  db.exec(usersMigration.up);
  db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
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

  const workspaceRepository = new WorkspaceRepository(db);
  const deviceRepository = new DeviceRepository(db);
  const userRepository = new UserRepository(db);
  const jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

  const app = express();
  app.use(express.json());
  const router = createWorkspaceRouter({
    workspaceRepository,
    deviceRepository,
    authConfig: { jwtService, userRepository },
  });
  app.use('/api/workspaces', router);

  return { db, app, workspaceRepository, deviceRepository, userRepository, jwtService };
}

describe('Workspace Router - POST /:id/auto-join', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let ownerId: string;
  let ownerToken: string;

  beforeEach(() => {
    const env = setupTestEnv();
    db = env.db;
    app = env.app;
    workspaceRepository = env.workspaceRepository;
    userRepository = env.userRepository;
    jwtService = env.jwtService;

    // Create workspace owner
    ownerId = 'owner-123';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 12345, 'owner');

    // Create workspace
    testWorkspaceId = 'workspace-123';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, ownerId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Add owner as workspace member
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, ownerId, 'owner');

    // Create settings row with auto-join enabled (simulates a workspace that opted in)
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, updated_at)
      VALUES (?, 1, datetime('now'))
    `).run(testWorkspaceId);

    const owner = userRepository.findById(ownerId)!;
    ownerToken = jwtService.sign(owner);
  });

  afterEach(() => {
    db.close();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/auto-join`)
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
  });

  it('auto-joins a new user to the workspace', async () => {
    // Create a new user who is NOT a member
    const newUserId = 'new-user-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 67890, 'newuser');

    const newUser = userRepository.findById(newUserId)!;
    const newUserToken = jwtService.sign(newUser);

    // Verify user is NOT a member
    expect(workspaceRepository.canAccess(testWorkspaceId, newUserId)).toBe(false);

    // Auto-join
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/auto-join`)
      .set('Authorization', `Bearer ${newUserToken}`)
      .expect(200);

    // Verify response
    expect(response.body.id).toBe(testWorkspaceId);
    expect(response.body.name).toBe('Test Workspace');
    expect(response.body.joined).toBe(true);
    expect(response.body.isOwner).toBe(false);

    // Verify user is now a member
    expect(workspaceRepository.canAccess(testWorkspaceId, newUserId)).toBe(true);
  });

  it('returns joined=false for existing members', async () => {
    // Owner is already a member
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/auto-join`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body.id).toBe(testWorkspaceId);
    expect(response.body.joined).toBe(false);
    expect(response.body.isOwner).toBe(true);
  });

  it('returns 404 for non-existent workspace', async () => {
    const response = await request(app)
      .post('/api/workspaces/nonexistent-workspace/auto-join')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.error).toBe('Workspace not found');
  });

  it('allows joining a second workspace', async () => {
    // Create a second workspace with auto-join enabled
    const secondWorkspaceId = 'workspace-456';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(secondWorkspaceId, ownerId, 'Second Workspace', 'second-workspace', 'EFGH-5678');
    
    // Enable auto-join for this workspace
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, updated_at)
      VALUES (?, 1, datetime('now'))
    `).run(secondWorkspaceId);

    // Create a new user
    const userId = 'user-789';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(userId, 11111, 'someuser');

    const user = userRepository.findById(userId)!;
    const userToken = jwtService.sign(user);

    // Auto-join second workspace
    const response = await request(app)
      .post(`/api/workspaces/${secondWorkspaceId}/auto-join`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.id).toBe(secondWorkspaceId);
    expect(response.body.joined).toBe(true);
    expect(workspaceRepository.canAccess(secondWorkspaceId, userId)).toBe(true);
  });

  it('denies auto-join when allowAutoJoin is disabled', async () => {
    // Update settings to disable auto-join (setup already created with allow_auto_join=1)
    db.prepare(`
      UPDATE workspace_settings SET allow_auto_join = 0, updated_at = datetime('now')
      WHERE workspace_id = ?
    `).run(testWorkspaceId);

    // Create a new user who is NOT a member
    const newUserId = 'blocked-user';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 99999, 'blockeduser');
    
    const newUser = userRepository.findById(newUserId)!;
    const token = jwtService.sign(newUser);

    // Verify user is NOT a member
    expect(workspaceRepository.canAccess(testWorkspaceId, newUserId)).toBe(false);

    // Attempt auto-join - should be denied
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/auto-join`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.error).toContain('Auto-join is disabled');
    
    // Verify user is still NOT a member
    expect(workspaceRepository.canAccess(testWorkspaceId, newUserId)).toBe(false);
  });

  it('allows auto-join when allowAutoJoin is explicitly enabled', async () => {
    // Settings row already has allow_auto_join=1 from setup

    // Create a new user who is NOT a member
    const newUserId = 'allowed-user';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 88888, 'alloweduser');
    
    const newUser = userRepository.findById(newUserId)!;
    const token = jwtService.sign(newUser);

    // Attempt auto-join - should succeed
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/auto-join`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.joined).toBe(true);
    expect(workspaceRepository.canAccess(testWorkspaceId, newUserId)).toBe(true);
  });

  it('denies auto-join for workspace without settings row (security-first)', async () => {
    // Create a workspace WITHOUT a settings row (simulates edge case or data corruption)
    const noSettingsWorkspaceId = 'workspace-no-settings';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(noSettingsWorkspaceId, ownerId, 'No Settings Workspace', 'no-settings', 'NOSETTING-1234');
    // Note: Intentionally NOT inserting a workspace_settings row

    // Create a new user who is NOT a member
    const newUserId = 'edge-case-user';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 77777, 'edgecaseuser');
    
    const newUser = userRepository.findById(newUserId)!;
    const token = jwtService.sign(newUser);

    // Verify user is NOT a member
    expect(workspaceRepository.canAccess(noSettingsWorkspaceId, newUserId)).toBe(false);

    // Attempt auto-join - should be DENIED (security-first default)
    const response = await request(app)
      .post(`/api/workspaces/${noSettingsWorkspaceId}/auto-join`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.error).toContain('Auto-join is disabled');
    
    // Verify user is still NOT a member
    expect(workspaceRepository.canAccess(noSettingsWorkspaceId, newUserId)).toBe(false);
  });
});

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
    db.exec(allowAutoJoinMigration.up);
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
