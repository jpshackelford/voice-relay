import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createWorkspaceRouter } from './router.js';
import { WorkspaceRepository } from './workspace-repository.js';
import { DeviceRepository } from '../devices/device-repository.js';
import { QrTokenRepository } from '../qr-tokens/index.js';
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

// Helper to set up test database and app
function setupTestEnv() {
  const db = new Database(':memory:');
  db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
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
      primary_user_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
  // Create sessions table for QR tokens FK constraint
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
  db.exec(qrTokensMigration.up);
  db.exec(elevenlabsMigration.up);
  db.exec(kioskTickersMigration.up);
  db.exec(defaultAgentPromptMigration.up);

  const workspaceRepository = new WorkspaceRepository(db);
  const deviceRepository = new DeviceRepository(db);
  const qrTokenRepository = new QrTokenRepository(db);
  const userRepository = new UserRepository(db);
  const jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

  const app = express();
  app.use(express.json());
  const router = createWorkspaceRouter({
    workspaceRepository,
    deviceRepository,
    qrTokenRepository,
    authConfig: { jwtService, userRepository },
  });
  app.use('/api/workspaces', router);

  return { db, app, workspaceRepository, deviceRepository, qrTokenRepository, userRepository, jwtService };
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

  it('requires QR token when requireQrToken is enabled', async () => {
    const env = setupTestEnv();
    const { app, db, workspaceRepository, qrTokenRepository, userRepository, jwtService } = env;

    // Create owner
    const ownerId = 'owner-qr';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 55555, 'ownerqr');

    // Create workspace
    const workspaceId = 'workspace-qr';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(workspaceId, ownerId, 'QR Workspace', 'qr-workspace', 'QR-CODE-1234');

    // Add owner as workspace member
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(workspaceId, ownerId, 'owner');

    // Enable both auto-join AND require QR token
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, require_qr_token, updated_at)
      VALUES (?, 1, 1, datetime('now'))
    `).run(workspaceId);

    // Create session for QR token
    db.prepare(`
      INSERT INTO sessions (id, workspace_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('session-qr', workspaceId, 'QR Session', 'active');

    // Create a new user who is NOT a member
    const newUserId = 'new-user-qr';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 66666, 'newuserqr');

    const newUser = userRepository.findById(newUserId)!;
    const token = jwtService.sign(newUser);

    // Attempt auto-join WITHOUT QR token - should be denied
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/auto-join`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.error).toContain('Invalid or expired QR code');
    expect(response.body.code).toBe('QR_TOKEN_REQUIRED');

    // Verify user is still NOT a member
    expect(workspaceRepository.canAccess(workspaceId, newUserId)).toBe(false);

    db.close();
  });

  it('allows auto-join with valid QR token', async () => {
    const env = setupTestEnv();
    const { app, db, workspaceRepository, qrTokenRepository, userRepository, jwtService } = env;

    // Create owner
    const ownerId = 'owner-qr2';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 77777, 'ownerqr2');

    // Create workspace
    const workspaceId = 'workspace-qr2';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(workspaceId, ownerId, 'QR Workspace 2', 'qr-workspace-2', 'QR-CODE-5678');

    // Add owner as workspace member
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(workspaceId, ownerId, 'owner');

    // Enable both auto-join AND require QR token
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, require_qr_token, updated_at)
      VALUES (?, 1, 1, datetime('now'))
    `).run(workspaceId);

    // Create session for QR token
    const sessionId = 'session-qr2';
    db.prepare(`
      INSERT INTO sessions (id, workspace_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(sessionId, workspaceId, 'QR Session 2', 'active');

    // Generate valid QR token
    const qrToken = qrTokenRepository.create({
      workspaceId,
      sessionId,
    });

    // Create a new user who is NOT a member
    const newUserId = 'new-user-qr2';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 88888, 'newuserqr2');

    const newUser = userRepository.findById(newUserId)!;
    const token = jwtService.sign(newUser);

    // Attempt auto-join WITH valid QR token - should succeed
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/auto-join?qr=${qrToken.token}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.id).toBe(workspaceId);
    expect(response.body.joined).toBe(true);

    // Verify user is now a member
    expect(workspaceRepository.canAccess(workspaceId, newUserId)).toBe(true);

    db.close();
  });

  it('denies auto-join with expired QR token', async () => {
    const env = setupTestEnv();
    const { app, db, workspaceRepository, qrTokenRepository, userRepository, jwtService } = env;

    // Create owner
    const ownerId = 'owner-qr3';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 99999, 'ownerqr3');

    // Create workspace
    const workspaceId = 'workspace-qr3';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(workspaceId, ownerId, 'QR Workspace 3', 'qr-workspace-3', 'QR-CODE-9999');

    // Add owner as workspace member
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(workspaceId, ownerId, 'owner');

    // Enable both auto-join AND require QR token
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, require_qr_token, updated_at)
      VALUES (?, 1, 1, datetime('now'))
    `).run(workspaceId);

    // Create session for QR token
    const sessionId = 'session-qr3';
    db.prepare(`
      INSERT INTO sessions (id, workspace_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(sessionId, workspaceId, 'QR Session 3', 'active');

    // Generate EXPIRED QR token
    const qrToken = qrTokenRepository.create({
      workspaceId,
      sessionId,
      ttlMs: -1000, // Already expired
    });

    // Create a new user who is NOT a member
    const newUserId = 'new-user-qr3';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(newUserId, 11111, 'newuserqr3');

    const newUser = userRepository.findById(newUserId)!;
    const token = jwtService.sign(newUser);

    // Attempt auto-join with expired QR token - should be denied
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/auto-join?qr=${qrToken.token}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.error).toContain('expired');
    expect(response.body.code).toBe('QR_TOKEN_EXPIRED');

    // Verify user is still NOT a member
    expect(workspaceRepository.canAccess(workspaceId, newUserId)).toBe(false);

    db.close();
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
    db.exec(userGithubInstallationMigration.up);
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
        primary_user_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);
    // Create sessions table for QR tokens FK constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);
    db.exec(qrTokensMigration.up);
    db.exec(elevenlabsMigration.up);
    db.exec(kioskTickersMigration.up);
  db.exec(defaultAgentPromptMigration.up);

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

describe('Workspace Router - API Key Endpoints', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let ownerId: string;
  let ownerToken: string;
  let nonOwnerId: string;
  let nonOwnerToken: string;

  beforeEach(() => {
    // Set encryption secret for tests
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-for-tests';
    
    const env = setupTestEnv();
    db = env.db;
    app = env.app;
    workspaceRepository = env.workspaceRepository;
    userRepository = env.userRepository;
    jwtService = env.jwtService;

    // Create workspace owner
    ownerId = 'owner-api-key';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 99999, 'apikey-owner');

    // Create workspace
    testWorkspaceId = 'workspace-api-key';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, ownerId, 'API Key Test Workspace', 'api-key-test', 'APIKEY12');

    // Add owner as workspace member
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, ownerId, 'owner');

    // Create settings row
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, updated_at)
      VALUES (?, datetime('now'))
    `).run(testWorkspaceId);

    const owner = userRepository.findById(ownerId)!;
    ownerToken = jwtService.sign(owner);
    
    // Create a non-owner member
    nonOwnerId = 'non-owner-api-key';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(nonOwnerId, 88888, 'apikey-nonowner');
    
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, nonOwnerId, 'member');
    
    const nonOwner = userRepository.findById(nonOwnerId)!;
    nonOwnerToken = jwtService.sign(nonOwner);
  });

  afterEach(() => {
    db.close();
    delete process.env.ENCRYPTION_SECRET;
  });

  describe('PUT /:id/settings/api-key', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .put(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .send({ apiKey: 'test_api_key_12345678901234567890' })
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('requires owner permission', async () => {
      const response = await request(app)
        .put(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${nonOwnerToken}`)
        .send({ apiKey: 'test_api_key_12345678901234567890' })
        .expect(403);

      expect(response.body.error).toBe('Only owner can set API key');
    });

    it('validates API key is provided', async () => {
      const response = await request(app)
        .put(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('API key is required');
    });

    it('validates API key format', async () => {
      const response = await request(app)
        .put(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ apiKey: 'too_short' })
        .expect(400);

      expect(response.body.error).toBe('Invalid API key format');
    });

    it('saves API key successfully', async () => {
      const response = await request(app)
        .put(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ apiKey: 'valid_api_key_12345678901234567890' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.hasApiKey).toBe(true);

      // Verify it's stored
      const settings = workspaceRepository.getSettings(testWorkspaceId);
      expect(settings?.openhandsApiKeyEncrypted).toBeDefined();
      expect(settings?.openhandsApiKeyIv).toBeDefined();
      expect(settings?.openhandsApiKeyTag).toBeDefined();
    });

    it('returns 404 for non-existent workspace', async () => {
      const response = await request(app)
        .put('/api/workspaces/nonexistent/settings/api-key')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ apiKey: 'valid_api_key_12345678901234567890' })
        .expect(404);

      expect(response.body.error).toBe('Workspace not found');
    });
  });

  describe('POST /:id/settings/api-key/test', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/settings/api-key/test`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('requires owner permission', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/settings/api-key/test`)
        .set('Authorization', `Bearer ${nonOwnerToken}`)
        .expect(403);

      expect(response.body.error).toBe('Only owner can test API key');
    });

    it('returns no key configured when no key exists', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/settings/api-key/test`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.message).toBe('No API key configured');
    });
  });

  describe('DELETE /:id/settings/api-key', () => {
    beforeEach(async () => {
      // Set up an API key to delete
      await request(app)
        .put(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ apiKey: 'valid_api_key_12345678901234567890' })
        .expect(200);
    });

    it('requires authentication', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });

    it('requires owner permission', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${nonOwnerToken}`)
        .expect(403);

      expect(response.body.error).toBe('Only owner can remove API key');
    });

    it('removes API key successfully', async () => {
      // Verify key exists
      let settings = workspaceRepository.getSettings(testWorkspaceId);
      expect(settings?.openhandsApiKeyEncrypted).toBeDefined();

      // Delete it
      await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/settings/api-key`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // Verify it's gone
      settings = workspaceRepository.getSettings(testWorkspaceId);
      expect(settings?.openhandsApiKeyEncrypted).toBeNull();
    });

    it('returns 404 for non-existent workspace', async () => {
      const response = await request(app)
        .delete('/api/workspaces/nonexistent/settings/api-key')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(response.body.error).toBe('Workspace not found');
    });
  });
});

describe('Workspace Router - DELETE /:id/devices/:deviceId', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let deviceRepository: DeviceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let testDeviceId: string;
  let ownerId: string;
  let ownerToken: string;
  let nonOwnerId: string;
  let nonOwnerToken: string;

  beforeEach(() => {
    const env = setupTestEnv();
    db = env.db;
    app = env.app;
    workspaceRepository = env.workspaceRepository;
    deviceRepository = env.deviceRepository;
    userRepository = env.userRepository;
    jwtService = env.jwtService;

    // Create workspace owner
    ownerId = 'owner-123';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 12345, 'owner');

    // Create non-owner user
    nonOwnerId = 'nonowner-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(nonOwnerId, 67890, 'nonowner');

    // Create workspace
    testWorkspaceId = 'workspace-123';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, ownerId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Add owner and non-owner as workspace members
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, ownerId, 'owner');
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, nonOwnerId, 'member');

    // Create a device in the workspace
    const { device } = deviceRepository.create({
      workspaceId: testWorkspaceId,
      name: 'Test Device',
      mode: 'mobile',
    });
    testDeviceId = device.id;

    const owner = userRepository.findById(ownerId)!;
    ownerToken = jwtService.sign(owner);

    const nonOwner = userRepository.findById(nonOwnerId)!;
    nonOwnerToken = jwtService.sign(nonOwner);
  });

  afterEach(() => {
    db.close();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/${testDeviceId}`)
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
  });

  it('requires owner permission', async () => {
    const response = await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${nonOwnerToken}`)
      .expect(403);

    expect(response.body.error).toBe('Only owner can remove devices');
  });

  it('removes device successfully', async () => {
    // Verify device exists
    let device = deviceRepository.findById(testDeviceId);
    expect(device).toBeDefined();

    // Delete it
    await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Verify it's gone
    device = deviceRepository.findById(testDeviceId);
    expect(device).toBeNull();
  });

  it('returns 404 for non-existent workspace', async () => {
    const response = await request(app)
      .delete(`/api/workspaces/nonexistent/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.error).toBe('Workspace not found');
  });

  it('returns 404 for non-existent device', async () => {
    const response = await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/nonexistent-device`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.error).toBe('Device not found in workspace');
  });

  it('returns 404 for device in different workspace', async () => {
    // Create a second workspace
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('workspace-456', ownerId, 'Other Workspace', 'other-workspace', 'EFGH-5678');

    // Create device in the second workspace
    const { device } = deviceRepository.create({
      workspaceId: 'workspace-456',
      name: 'Other Device',
      mode: 'mobile',
    });

    // Try to delete device from first workspace (should fail)
    const response = await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/${device.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.error).toBe('Device not found in workspace');
  });

  it('calls onDeviceRemoved callback when provided', async () => {
    // Set up app with onDeviceRemoved callback
    let callbackCalled = false;
    let callbackDeviceId: string | null = null;
    let callbackWorkspaceId: string | null = null;

    const customApp = express();
    customApp.use(express.json());
    
    const router = createWorkspaceRouter({
      workspaceRepository,
      deviceRepository,
      // Don't pass sessionRepository to avoid table dependency
      authConfig: { jwtService, userRepository },
      onDeviceRemoved: (deviceId, workspaceId) => {
        callbackCalled = true;
        callbackDeviceId = deviceId;
        callbackWorkspaceId = workspaceId;
      },
    });
    customApp.use('/api/workspaces', router);

    await request(customApp)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    expect(callbackCalled).toBe(true);
    expect(callbackDeviceId).toBe(testDeviceId);
    expect(callbackWorkspaceId).toBe(testWorkspaceId);
  });

  it('removes device from sessions when sessionRepository is provided', async () => {
    // Set up app with session repository
    const customApp = express();
    customApp.use(express.json());
    const { SessionRepository } = await import('../sessions/session-repository.js');
    
    // Drop existing sessions table (created earlier with different schema) and recreate with full schema
    db.exec(`DROP TABLE IF EXISTS sessions;`);
    db.exec(`
      CREATE TABLE sessions (
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
    `);
    
    // Create session_devices table
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, device_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
    `);
    
    const sessionRepository = new SessionRepository(db);
    
    // Create a session and add device to it
    const session = sessionRepository.create({ workspaceId: testWorkspaceId, name: 'Test Session' });
    sessionRepository.addDevice(session.id, testDeviceId);
    
    // Verify device is in session
    let sessionDevices = sessionRepository.getDevices(session.id);
    expect(sessionDevices.length).toBe(1);
    
    const router = createWorkspaceRouter({
      workspaceRepository,
      deviceRepository,
      sessionRepository,
      authConfig: { jwtService, userRepository },
    });
    customApp.use('/api/workspaces', router);

    await request(customApp)
      .delete(`/api/workspaces/${testWorkspaceId}/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Verify device is removed from session
    sessionDevices = sessionRepository.getDevices(session.id);
    expect(sessionDevices.length).toBe(0);
  });
});

// Helper to set up test database with messages table for deletion tests
function setupDeletionTestEnv() {
  const db = new Database(':memory:');
  db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
  db.exec(workspacesMigration.up);
  db.exec(allowAutoJoinMigration.up);
  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utterance_id TEXT NOT NULL,
      workspace_id TEXT,
      session_id TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
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
      primary_user_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
  db.exec(qrTokensMigration.up);
  db.exec(elevenlabsMigration.up);
  db.exec(kioskTickersMigration.up);
  db.exec(defaultAgentPromptMigration.up);

  const workspaceRepository = new WorkspaceRepository(db);
  const deviceRepository = new DeviceRepository(db);
  const qrTokenRepository = new QrTokenRepository(db);
  const userRepository = new UserRepository(db);
  const jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

  const app = express();
  app.use(express.json());
  const router = createWorkspaceRouter({
    workspaceRepository,
    deviceRepository,
    qrTokenRepository,
    authConfig: { jwtService, userRepository },
  });
  app.use('/api/workspaces', router);

  return { db, app, workspaceRepository, deviceRepository, qrTokenRepository, userRepository, jwtService };
}

describe('Workspace Router - GET /:id/deletion-preview', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let deviceRepository: DeviceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let ownerId: string;
  let ownerToken: string;
  let nonOwnerId: string;
  let nonOwnerToken: string;

  beforeEach(() => {
    const env = setupDeletionTestEnv();
    db = env.db;
    app = env.app;
    workspaceRepository = env.workspaceRepository;
    deviceRepository = env.deviceRepository;
    userRepository = env.userRepository;
    jwtService = env.jwtService;

    // Create workspace owner
    ownerId = 'owner-123';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(ownerId, 12345, 'owner');

    // Create non-owner user
    nonOwnerId = 'nonowner-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(nonOwnerId, 67890, 'nonowner');

    // Create workspace
    testWorkspaceId = 'workspace-123';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, ownerId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Add owner and non-owner as workspace members
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, ownerId, 'owner');
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, nonOwnerId, 'member');

    // Create some data in the workspace
    // Sessions
    db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-1', testWorkspaceId, 'Session 1');
    db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-2', testWorkspaceId, 'Session 2');

    // Devices
    deviceRepository.create({ workspaceId: testWorkspaceId, name: 'Device 1', mode: 'kiosk' });
    deviceRepository.create({ workspaceId: testWorkspaceId, name: 'Device 2', mode: 'mobile' });
    deviceRepository.create({ workspaceId: testWorkspaceId, name: 'Device 3', mode: 'mobile' });

    // Messages
    db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', testWorkspaceId, 'user-1', 'User', 'Hello', 0);
    db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', testWorkspaceId, 'user-2', 'User2', 'World', 0);

    const owner = userRepository.findById(ownerId)!;
    ownerToken = jwtService.sign(owner);

    const nonOwner = userRepository.findById(nonOwnerId)!;
    nonOwnerToken = jwtService.sign(nonOwner);
  });

  afterEach(() => {
    db.close();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/deletion-preview`)
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
  });

  it('requires owner permission', async () => {
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/deletion-preview`)
      .set('Authorization', `Bearer ${nonOwnerToken}`)
      .expect(403);

    expect(response.body.error).toBe('Only owner can view deletion preview');
  });

  it('returns counts of items to be deleted', async () => {
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/deletion-preview`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body).toEqual({
      sessions: 2,
      devices: 3,
      messages: 2,
      members: 2, // owner + non-owner
    });
  });

  it('returns 404 for non-existent workspace', async () => {
    const response = await request(app)
      .get('/api/workspaces/nonexistent/deletion-preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.error).toBe('Workspace not found');
  });

  it('returns zero counts for empty workspace', async () => {
    // Create an empty workspace
    const emptyWorkspaceId = 'empty-workspace';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(emptyWorkspaceId, ownerId, 'Empty Workspace', 'empty-workspace', 'EFGH-5678');
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(emptyWorkspaceId, ownerId, 'owner');

    const response = await request(app)
      .get(`/api/workspaces/${emptyWorkspaceId}/deletion-preview`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body).toEqual({
      sessions: 0,
      devices: 0,
      messages: 0,
      members: 1, // just the owner
    });
  });
});

describe('Workspace Router - DELETE /:id (enhanced)', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let ownerId: string;
  let ownerToken: string;
  let nonOwnerId: string;
  let nonOwnerToken: string;

  beforeEach(() => {
    const env = setupDeletionTestEnv();
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

    // Create non-owner user
    nonOwnerId = 'nonowner-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(nonOwnerId, 67890, 'nonowner');

    // Create workspace
    testWorkspaceId = 'workspace-123';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, ownerId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Add members
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, ownerId, 'owner');
    db.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(testWorkspaceId, nonOwnerId, 'member');

    // Create some messages
    db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', testWorkspaceId, 'user-1', 'User', 'Hello', 0);
    db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', testWorkspaceId, 'user-2', 'User2', 'World', 0);

    const owner = userRepository.findById(ownerId)!;
    ownerToken = jwtService.sign(owner);

    const nonOwner = userRepository.findById(nonOwnerId)!;
    nonOwnerToken = jwtService.sign(nonOwner);
  });

  afterEach(() => {
    db.close();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}`)
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
  });

  it('requires owner permission', async () => {
    const response = await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}`)
      .set('Authorization', `Bearer ${nonOwnerToken}`)
      .expect(403);

    expect(response.body.error).toBe('Only owner can delete workspace');
  });

  it('deletes workspace and messages', async () => {
    // Verify workspace and messages exist
    expect(workspaceRepository.findById(testWorkspaceId)).not.toBeNull();
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?').get(testWorkspaceId) as { count: number } | undefined;
    expect(messageCount?.count).toBe(2);

    // Delete workspace
    await request(app)
      .delete(`/api/workspaces/${testWorkspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Verify workspace is deleted
    expect(workspaceRepository.findById(testWorkspaceId)).toBeNull();

    // Verify messages are deleted
    const messagesAfter = db.prepare('SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?').get(testWorkspaceId) as { count: number } | undefined;
    expect(messagesAfter?.count).toBe(0);
  });

  it('returns 404 for non-existent workspace', async () => {
    const response = await request(app)
      .delete('/api/workspaces/nonexistent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.error).toBe('Workspace not found');
  });

  it('calls onWorkspaceDeleted callback when provided', async () => {
    let callbackCalled = false;
    let callbackWorkspaceId: string | null = null;

    const customApp = express();
    customApp.use(express.json());

    const router = createWorkspaceRouter({
      workspaceRepository,
      authConfig: { jwtService, userRepository },
      onWorkspaceDeleted: (workspaceId) => {
        callbackCalled = true;
        callbackWorkspaceId = workspaceId;
      },
    });
    customApp.use('/api/workspaces', router);

    await request(customApp)
      .delete(`/api/workspaces/${testWorkspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    expect(callbackCalled).toBe(true);
    expect(callbackWorkspaceId).toBe(testWorkspaceId);
  });

  it('returns 204 even if onWorkspaceDeleted callback throws', async () => {
    const customApp = express();
    customApp.use(express.json());

    const router = createWorkspaceRouter({
      workspaceRepository,
      authConfig: { jwtService, userRepository },
      onWorkspaceDeleted: () => {
        throw new Error('Device disconnection failed');
      },
    });
    customApp.use('/api/workspaces', router);

    await request(customApp)
      .delete(`/api/workspaces/${testWorkspaceId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Workspace should still be deleted despite callback error
    expect(workspaceRepository.findById(testWorkspaceId)).toBeNull();
  });
});

// Tests for POST /:id/settings/voice-preview endpoint
describe('Workspace Router - POST /:id/settings/voice-preview', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let userRepository: UserRepository;
  let jwtService: JWTService;
  let testWorkspaceId: string;
  let ownerId: string;
  let ownerToken: string;
  let nonOwnerId: string;
  let nonOwnerToken: string;

  beforeEach(() => {
    const env = setupDeletionTestEnv();
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

    // Create non-owner user
    nonOwnerId = 'nonowner-456';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(nonOwnerId, 67890, 'nonowner');

    // Create workspace
    testWorkspaceId = 'workspace-123';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, ownerId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    // Generate tokens using user objects
    const owner = userRepository.findById(ownerId)!;
    ownerToken = jwtService.sign(owner);
    const nonOwner = userRepository.findById(nonOwnerId)!;
    nonOwnerToken = jwtService.sign(nonOwner);
  });

  afterEach(() => {
    db.close();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/settings/voice-preview`)
      .send({ voiceId: 'test-voice' })
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
  });

  it('requires owner permission', async () => {
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/settings/voice-preview`)
      .set('Authorization', `Bearer ${nonOwnerToken}`)
      .send({ voiceId: 'test-voice' })
      .expect(403);

    expect(response.body.error).toBe('Only owner can generate voice previews');
  });

  it('returns 404 for non-existent workspace', async () => {
    const response = await request(app)
      .post('/api/workspaces/nonexistent/settings/voice-preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ voiceId: 'test-voice' })
      .expect(404);

    expect(response.body.error).toBe('Workspace not found');
  });

  it('requires voiceId in request body', async () => {
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/settings/voice-preview`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);

    expect(response.body.error).toBe('voiceId is required');
  });

  it('requires ElevenLabs API key to be configured', async () => {
    // Workspace has no ElevenLabs API key configured
    const response = await request(app)
      .post(`/api/workspaces/${testWorkspaceId}/settings/voice-preview`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ voiceId: 'test-voice' })
      .expect(400);

    expect(response.body.error).toBe('ElevenLabs API key not configured');
  });
});

// Issue #340: anonymous kiosk-config endpoint
describe('Workspace Router - GET /:id/kiosk-config', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepository: WorkspaceRepository;
  let testWorkspaceId: string;

  beforeEach(() => {
    const env = setupTestEnv();
    db = env.db;
    app = env.app;
    workspaceRepository = env.workspaceRepository;

    // Owning user + workspace
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run('owner-1', 1, 'owner');

    const ws = workspaceRepository.create('owner-1', { name: 'Kiosk WS' });
    testWorkspaceId = ws.id;
  });

  afterEach(() => {
    db.close();
  });

  it('returns kioskFooterTickersEnabled=false by default without auth', async () => {
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/kiosk-config`)
      .expect(200);
    expect(response.body).toEqual({
      workspaceId: testWorkspaceId,
      kioskFooterTickersEnabled: false,
    });
  });

  it('reflects the updated kioskFooterTickersEnabled flag', async () => {
    workspaceRepository.updateSettings(testWorkspaceId, {
      kioskFooterTickersEnabled: true,
    });
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/kiosk-config`)
      .expect(200);
    expect(response.body.kioskFooterTickersEnabled).toBe(true);
  });

  it('returns 404 for an unknown workspace', async () => {
    await request(app)
      .get('/api/workspaces/does-not-exist/kiosk-config')
      .expect(404);
  });

  it('does not require an Authorization header', async () => {
    // Explicitly omit auth and assert success.
    const response = await request(app)
      .get(`/api/workspaces/${testWorkspaceId}/kiosk-config`)
      .set('Authorization', '') // intentionally blank
      .expect(200);
    expect(response.body.workspaceId).toBe(testWorkspaceId);
  });
});
