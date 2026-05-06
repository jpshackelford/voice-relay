import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { QrTokenRepository } from './qr-token-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';
import { migration as qrTokensMigration } from '../storage/migrations/008_qr_tokens.js';

function setupTestDb() {
  const db = new Database(':memory:');
  
  // Apply minimal migrations needed for qr_tokens table
  // Create users table first (needed for workspace owner FK)
  db.exec(usersMigration.up);
  
  // Create test user
  db.prepare(`
    INSERT INTO users (id, github_id, username, created_at, last_login_at)
    VALUES ('user-1', 12345, 'testuser', datetime('now'), datetime('now'))
  `).run();
  
  // Apply workspace migration
  db.exec(workspacesMigration.up);
  db.exec(allowAutoJoinMigration.up);
  
  // Create sessions table (minimal version for FK constraint)
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
  
  // Apply QR tokens migration
  db.exec(qrTokensMigration.up);
  
  // Create test workspace and session
  db.prepare(`
    INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
    VALUES ('ws-123', 'user-1', 'Test Workspace', 'test-workspace', 'ABCD-1234', datetime('now'), datetime('now'))
  `).run();
  
  db.prepare(`
    INSERT INTO sessions (id, workspace_id, name, status, created_at, updated_at)
    VALUES ('session-123', 'ws-123', 'Test Session', 'active', datetime('now'), datetime('now'))
  `).run();
  
  return db;
}

describe('QrTokenRepository', () => {
  let db: Database.Database;
  let repo: QrTokenRepository;

  beforeEach(() => {
    db = setupTestDb();
    repo = new QrTokenRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a new token with default TTL', () => {
      const token = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      expect(token.id).toBeDefined();
      expect(token.token).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(token.workspaceId).toBe('ws-123');
      expect(token.sessionId).toBe('session-123');
      expect(token.expiresAt).toBeDefined();
      expect(token.createdAt).toBeDefined();

      // Check expiration is ~5 minutes from now
      const expiresAt = new Date(token.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(4 * 60 * 1000); // > 4 min
      expect(diffMs).toBeLessThanOrEqual(5 * 60 * 1000); // <= 5 min
    });

    it('creates a token with custom TTL', () => {
      const token = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
        ttlMs: 60 * 1000, // 1 minute
      });

      const expiresAt = new Date(token.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(50 * 1000); // > 50 sec
      expect(diffMs).toBeLessThanOrEqual(60 * 1000); // <= 1 min
    });

    it('generates unique tokens', () => {
      const token1 = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });
      const token2 = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      expect(token1.token).not.toBe(token2.token);
      expect(token1.id).not.toBe(token2.id);
    });
  });

  describe('findByToken', () => {
    it('finds existing token', () => {
      const created = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      const found = repo.findByToken(created.token);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.workspaceId).toBe('ws-123');
    });

    it('returns null for non-existent token', () => {
      const found = repo.findByToken('nonexistent-token');
      expect(found).toBeNull();
    });
  });

  describe('validate', () => {
    it('returns valid for valid token', () => {
      const created = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      const result = repo.validate(created.token, 'ws-123');

      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token!.id).toBe(created.id);
      expect(result.error).toBeUndefined();
    });

    it('returns NOT_FOUND for non-existent token', () => {
      const result = repo.validate('nonexistent-token', 'ws-123');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns EXPIRED for expired token', () => {
      // Create token with very short TTL (already expired)
      const created = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
        ttlMs: -1000, // -1 second (already expired)
      });

      const result = repo.validate(created.token, 'ws-123');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('EXPIRED');
      expect(result.token).toBeDefined();
    });

    it('returns WORKSPACE_MISMATCH for wrong workspace', () => {
      // Create another workspace
      db.prepare(`
        INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
        VALUES ('ws-456', 'user-1', 'Other Workspace', 'other-workspace', 'EFGH-5678', datetime('now'), datetime('now'))
      `).run();

      const created = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      const result = repo.validate(created.token, 'ws-456');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('WORKSPACE_MISMATCH');
      expect(result.token).toBeDefined();
    });

    it('returns SESSION_MISMATCH for wrong session when provided', () => {
      // Create another session
      db.prepare(`
        INSERT INTO sessions (id, workspace_id, name, status, created_at, updated_at)
        VALUES ('session-456', 'ws-123', 'Other Session', 'active', datetime('now'), datetime('now'))
      `).run();

      const created = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      const result = repo.validate(created.token, 'ws-123', 'session-456');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('SESSION_MISMATCH');
      expect(result.token).toBeDefined();
    });

    it('ignores session mismatch when sessionId not provided', () => {
      const created = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      // Don't pass sessionId - should validate workspace only
      const result = repo.validate(created.token, 'ws-123');

      expect(result.valid).toBe(true);
    });
  });

  describe('cleanupExpired', () => {
    it('removes expired tokens', () => {
      // Create a valid token first
      const validToken = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
        ttlMs: 5 * 60 * 1000, // 5 min
      });

      // Insert expired token directly in DB (bypasses cleanup at create)
      const now = new Date();
      const expiredAt = new Date(now.getTime() - 1000);
      db.prepare(`
        INSERT INTO qr_tokens (id, token, workspace_id, session_id, expires_at, created_at)
        VALUES ('expired-id', 'expired-token', 'ws-123', 'session-123', ?, ?)
      `).run(expiredAt.toISOString(), now.toISOString());

      const removed = repo.cleanupExpired();

      expect(removed).toBe(1);
      expect(repo.findByToken(validToken.token)).not.toBeNull();
      expect(repo.findByToken('expired-token')).toBeNull();
    });

    it('is called automatically on create', () => {
      // Create an expired token directly in DB
      const now = new Date();
      const expiredAt = new Date(now.getTime() - 1000);
      db.prepare(`
        INSERT INTO qr_tokens (id, token, workspace_id, session_id, expires_at, created_at)
        VALUES ('old-token', 'expired-token-value', 'ws-123', 'session-123', ?, ?)
      `).run(expiredAt.toISOString(), now.toISOString());

      // Verify it exists
      expect(repo.findByToken('expired-token-value')).not.toBeNull();

      // Create a new token (should trigger cleanup)
      repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      // Expired token should be cleaned up
      expect(repo.findByToken('expired-token-value')).toBeNull();
    });
  });

  describe('deleteBySession', () => {
    it('deletes all tokens for a session', () => {
      // Create multiple tokens for same session
      const token1 = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });
      const token2 = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      const deleted = repo.deleteBySession('session-123');

      expect(deleted).toBe(2);
      expect(repo.findByToken(token1.token)).toBeNull();
      expect(repo.findByToken(token2.token)).toBeNull();
    });
  });

  describe('deleteByWorkspace', () => {
    it('deletes all tokens for a workspace', () => {
      // Create another session in the same workspace
      db.prepare(`
        INSERT INTO sessions (id, workspace_id, name, status, created_at, updated_at)
        VALUES ('session-456', 'ws-123', 'Other Session', 'active', datetime('now'), datetime('now'))
      `).run();

      // Create tokens for both sessions
      const token1 = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });
      const token2 = repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-456',
      });

      const deleted = repo.deleteByWorkspace('ws-123');

      expect(deleted).toBe(2);
      expect(repo.findByToken(token1.token)).toBeNull();
      expect(repo.findByToken(token2.token)).toBeNull();
    });
  });

  describe('getActiveCount', () => {
    it('returns count of non-expired tokens', () => {
      // Create some valid tokens
      repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });
      repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
      });

      // Create an expired token
      repo.create({
        workspaceId: 'ws-123',
        sessionId: 'session-123',
        ttlMs: -1000,
      });

      const count = repo.getActiveCount();

      expect(count).toBe(2);
    });
  });
});
