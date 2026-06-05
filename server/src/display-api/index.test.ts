import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { authenticateDisplayRequest } from './index.js';
import { SessionRepository } from '../sessions/session-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

// Mock encryption functions to avoid needing ENCRYPTION_SECRET env var
vi.mock('../workspaces/encryption.js', () => ({
  encryptApiKey: vi.fn((secret: string) => ({
    encrypted: Buffer.from(secret).toString('base64'),
    iv: 'test-iv',
    tag: 'test-tag',
  })),
  decryptApiKey: vi.fn((encrypted: { encrypted: string }) => {
    return Buffer.from(encrypted.encrypted, 'base64').toString('utf-8');
  }),
}));

describe('Display API Authentication', () => {
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let validSessionId: string;
  let validSecret: string;
  const testWorkspaceId = 'test-workspace-123';

  beforeEach(() => {
    // Set up in-memory database with required migrations
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);

    // Create devices and sessions tables (inline to avoid migration dependencies)
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        device_token TEXT UNIQUE,
        device_token_hash TEXT,
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
        PRIMARY KEY (session_id, device_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
    `);

    // Create test user and workspace
    const testUserId = 'test-user-id';
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 12345, 'testuser');

    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    sessionRepository = new SessionRepository(db);

    // Create a test session with display API secret
    const { session, displayApiSecret } = sessionRepository.createWithDisplaySecret({
      workspaceId: testWorkspaceId,
      name: 'Test Session',
    });
    validSessionId = session.id;
    validSecret = displayApiSecret;
  });

  describe('authenticateDisplayRequest', () => {
    it('authenticates successfully with valid session and secret', async () => {
      const result = await authenticateDisplayRequest(
        `Bearer ${validSecret}`,
        validSessionId,
        sessionRepository
      );

      expect(result.authenticated).toBe(true);
      if (result.authenticated) {
        expect(result.workspaceId).toBe(testWorkspaceId);
      }
    });

    it('rejects missing Authorization header', async () => {
      const result = await authenticateDisplayRequest(
        undefined,
        validSessionId,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Authorization header required. Format: Bearer <secret>');
      }
    });

    it('rejects Authorization header without Bearer prefix', async () => {
      const result = await authenticateDisplayRequest(
        validSecret, // Missing "Bearer " prefix
        validSessionId,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Authorization header required. Format: Bearer <secret>');
      }
    });

    it('rejects invalid secret', async () => {
      const result = await authenticateDisplayRequest(
        'Bearer wrong-secret-here',
        validSessionId,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Invalid secret');
      }
    });

    it('rejects missing sessionId', async () => {
      const result = await authenticateDisplayRequest(
        `Bearer ${validSecret}`,
        undefined,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(400);
        expect(result.error).toBe('sessionId is required');
      }
    });

    it('rejects invalid sessionId', async () => {
      const result = await authenticateDisplayRequest(
        `Bearer ${validSecret}`,
        'non-existent-session-id',
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Invalid session');
      }
    });

    it('rejects session without display API secret', async () => {
      // Create a session without display API secret
      const session = sessionRepository.create({
        workspaceId: testWorkspaceId,
        name: 'Session Without Secret',
      });

      const result = await authenticateDisplayRequest(
        'Bearer some-random-secret',
        session.id,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Session has no display API secret');
      }
    });

    it('rejects when session repository is null', async () => {
      const result = await authenticateDisplayRequest(
        `Bearer ${validSecret}`,
        validSessionId,
        null
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(500);
        expect(result.error).toBe('Session repository not available');
      }
    });

    it('rejects secrets of different lengths', async () => {
      // Test that different length secrets are rejected
      const result = await authenticateDisplayRequest(
        'Bearer x', // Very short secret
        validSessionId,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Invalid secret');
      }
    });

    it('rejects empty Bearer token', async () => {
      const result = await authenticateDisplayRequest(
        'Bearer ',
        validSessionId,
        sessionRepository
      );

      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.statusCode).toBe(401);
        expect(result.error).toBe('Invalid secret');
      }
    });
  });
});
