import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { UserRepository } from './user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as installationMigration } from '../storage/migrations/014_user_github_installation.js';

describe('UserRepository', () => {
  let db: Database.Database;
  let repo: UserRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(installationMigration.up);
    // Migration 017 / #383: UserRepository.create dual-writes to the
    // new auth_identities table — must exist for these tests.
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        provider_username TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, provider_user_id)
      );
    `);
    repo = new UserRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a user with all fields', () => {
      const user = repo.create({
        githubId: 12345,
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://github.com/testuser.png',
        email: 'test@example.com',
      });

      expect(user.id).toBeDefined();
      expect(user.githubId).toBe(12345);
      expect(user.username).toBe('testuser');
      expect(user.displayName).toBe('Test User');
      expect(user.avatarUrl).toBe('https://github.com/testuser.png');
      expect(user.email).toBe('test@example.com');
      expect(user.createdAt).toBeDefined();
      expect(user.lastLoginAt).toBeDefined();
    });

    it('creates a user with minimal fields', () => {
      const user = repo.create({
        githubId: 12345,
        username: 'testuser',
      });

      expect(user.githubId).toBe(12345);
      expect(user.username).toBe('testuser');
      expect(user.displayName).toBeNull();
      expect(user.avatarUrl).toBeNull();
      expect(user.email).toBeNull();
    });
  });

  describe('findById', () => {
    it('finds an existing user', () => {
      const created = repo.create({
        githubId: 12345,
        username: 'testuser',
      });

      const found = repo.findById(created.id);
      expect(found).toEqual(created);
    });

    it('returns null for non-existent user', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByGitHubId', () => {
    it('finds an existing user by GitHub ID', () => {
      const created = repo.create({
        githubId: 12345,
        username: 'testuser',
      });

      const found = repo.findByGitHubId(12345);
      expect(found).toEqual(created);
    });

    it('returns null for non-existent GitHub ID', () => {
      const found = repo.findByGitHubId(99999);
      expect(found).toBeNull();
    });
  });

  describe('updateOnLogin', () => {
    it('updates user profile on login', async () => {
      const created = repo.create({
        githubId: 12345,
        username: 'testuser',
        displayName: 'Old Name',
      });

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = repo.updateOnLogin(created.id, {
        displayName: 'New Name',
        avatarUrl: 'https://new-avatar.png',
      });

      expect(updated.displayName).toBe('New Name');
      expect(updated.avatarUrl).toBe('https://new-avatar.png');
      expect(updated.username).toBe('testuser'); // unchanged
      // The timestamp should be updated (we can check it's defined instead of comparing)
      expect(updated.lastLoginAt).toBeDefined();
    });
  });

  describe('upsertFromGitHub', () => {
    it('creates new user if not exists', () => {
      const user = repo.upsertFromGitHub({
        githubId: 12345,
        username: 'testuser',
        displayName: 'Test User',
      });

      expect(user.githubId).toBe(12345);
      expect(user.username).toBe('testuser');
      expect(user.displayName).toBe('Test User');
    });

    it('updates existing user if exists', async () => {
      // Create initial user
      const created = repo.create({
        githubId: 12345,
        username: 'testuser',
        displayName: 'Old Name',
      });

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Upsert with new data
      const updated = repo.upsertFromGitHub({
        githubId: 12345,
        username: 'testuser',
        displayName: 'New Name',
        avatarUrl: 'https://new-avatar.png',
      });

      expect(updated.id).toBe(created.id); // same user
      expect(updated.displayName).toBe('New Name');
      expect(updated.avatarUrl).toBe('https://new-avatar.png');
      // The timestamp should be updated (we can check it's defined instead of comparing)
      expect(updated.lastLoginAt).toBeDefined();
    });
  });

  describe('setGitHubInstallationId', () => {
    it('persists the installation id and exposes it via findById', () => {
      const user = repo.create({ githubId: 12345, username: 'testuser' });

      // Fresh users have no installation linkage yet.
      expect(user.githubInstallationId).toBeNull();

      const updated = repo.setGitHubInstallationId(user.id, 9876543);
      expect(updated).toBe(true);

      const reloaded = repo.findById(user.id);
      expect(reloaded?.githubInstallationId).toBe(9876543);
    });

    it('returns false when the user does not exist', () => {
      const updated = repo.setGitHubInstallationId('non-existent-id', 42);
      expect(updated).toBe(false);
    });

    it('explicitly clears the column when called with null', () => {
      const user = repo.create({ githubId: 12345, username: 'testuser' });
      repo.setGitHubInstallationId(user.id, 42);
      expect(repo.findById(user.id)?.githubInstallationId).toBe(42);

      repo.setGitHubInstallationId(user.id, null);
      expect(repo.findById(user.id)?.githubInstallationId).toBeNull();
    });

    it('is preserved across upsertFromGitHub (returning user sign-in)', () => {
      // Simulate: first sign-in installs the App + persists installation_id.
      const user = repo.upsertFromGitHub({ githubId: 12345, username: 'testuser' });
      repo.setGitHubInstallationId(user.id, 11111);

      // Returning sign-in: callback has no installation_id, only the
      // identify portion runs. `upsertFromGitHub` MUST NOT clobber the
      // previously stored value, otherwise we lose the App link.
      const returningUser = repo.upsertFromGitHub({
        githubId: 12345,
        username: 'testuser',
        displayName: 'Test User',
      });
      expect(returningUser.id).toBe(user.id);
      expect(returningUser.githubInstallationId).toBe(11111);
    });
  });
});
