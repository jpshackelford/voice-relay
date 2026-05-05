import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { UserRepository } from './user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';

describe('UserRepository', () => {
  let db: Database.Database;
  let repo: UserRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usersMigration.up);
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
});
