import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkspaceRepository } from './workspace-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

describe('WorkspaceRepository', () => {
  let db: Database.Database;
  let repo: WorkspaceRepository;
  let testUserId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    repo = new WorkspaceRepository(db);

    // Create a test user
    testUserId = 'user-123';
    db.prepare(`
      INSERT INTO users (id, github_id, username, display_name, created_at, last_login_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 12345, 'testuser', 'Test User');
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a workspace with all fields', () => {
      const workspace = repo.create(testUserId, {
        name: 'My Workspace',
      });

      expect(workspace.id).toBeDefined();
      expect(workspace.ownerId).toBe(testUserId);
      expect(workspace.name).toBe('My Workspace');
      expect(workspace.slug).toBe('my-workspace');
      expect(workspace.joinCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(workspace.createdAt).toBeDefined();
      expect(workspace.updatedAt).toBeDefined();
    });

    it('creates workspace with custom slug', () => {
      const workspace = repo.create(testUserId, {
        name: 'My Workspace',
        slug: 'custom-slug',
      });

      expect(workspace.slug).toBe('custom-slug');
    });

    it('auto-generates unique slug on collision', () => {
      // Create first workspace
      repo.create(testUserId, { name: 'My Workspace' });
      
      // Create second with same name
      const second = repo.create(testUserId, { name: 'My Workspace' });

      expect(second.slug).toMatch(/^my-workspace-[a-f0-9]+$/);
    });

    it('adds owner as member', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      
      const members = repo.getMembers(workspace.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(testUserId);
      expect(members[0].role).toBe('owner');
    });

    it('rejects invalid workspace name', () => {
      expect(() => repo.create(testUserId, { name: '' }))
        .toThrow('Invalid workspace name');

      expect(() => repo.create(testUserId, { name: '   ' }))
        .toThrow('Invalid workspace name');
    });

    it('rejects invalid slug format', () => {
      expect(() => repo.create(testUserId, { name: 'Test', slug: 'Invalid_Slug!' }))
        .toThrow('Invalid slug format');
    });
  });

  describe('findById', () => {
    it('finds an existing workspace', () => {
      const created = repo.create(testUserId, { name: 'Test' });

      const found = repo.findById(created.id);
      expect(found).toEqual(created);
    });

    it('returns null for non-existent workspace', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('finds workspace by slug', () => {
      const created = repo.create(testUserId, { name: 'Test Workspace' });

      const found = repo.findBySlug('test-workspace');
      expect(found).toEqual(created);
    });

    it('returns null for non-existent slug', () => {
      const found = repo.findBySlug('no-such-slug');
      expect(found).toBeNull();
    });
  });

  describe('findByJoinCode', () => {
    it('finds workspace by join code', () => {
      const created = repo.create(testUserId, { name: 'Test' });

      const found = repo.findByJoinCode(created.joinCode!);
      expect(found).toEqual(created);
    });

    it('is case-insensitive', () => {
      const created = repo.create(testUserId, { name: 'Test' });

      const found = repo.findByJoinCode(created.joinCode!.toLowerCase());
      expect(found).toEqual(created);
    });

    it('returns null for invalid code', () => {
      const found = repo.findByJoinCode('XXXX-YYYY');
      expect(found).toBeNull();
    });
  });

  describe('findByOwner', () => {
    it('finds all workspaces owned by user', () => {
      repo.create(testUserId, { name: 'Workspace 1' });
      repo.create(testUserId, { name: 'Workspace 2' });
      repo.create(testUserId, { name: 'Workspace 3' });

      const workspaces = repo.findByOwner(testUserId);
      expect(workspaces).toHaveLength(3);
    });

    it('returns empty array for user with no workspaces', () => {
      const workspaces = repo.findByOwner('other-user');
      expect(workspaces).toHaveLength(0);
    });
  });

  describe('findAccessible', () => {
    it('finds owned workspaces', () => {
      repo.create(testUserId, { name: 'Owned' });

      const accessible = repo.findAccessible(testUserId);
      expect(accessible).toHaveLength(1);
      expect(accessible[0].name).toBe('Owned');
    });

    it('finds workspaces where user is a member', () => {
      // Create workspace owned by another user
      const otherUserId = 'user-456';
      db.prepare(`
        INSERT INTO users (id, github_id, username, created_at, last_login_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(otherUserId, 67890, 'otheruser');

      const workspace = repo.create(otherUserId, { name: 'Other Workspace' });
      
      // Add test user as member
      repo.addMember(workspace.id, testUserId);

      const accessible = repo.findAccessible(testUserId);
      expect(accessible).toHaveLength(1);
      expect(accessible[0].name).toBe('Other Workspace');
    });
  });

  describe('update', () => {
    it('updates workspace name', () => {
      const created = repo.create(testUserId, { name: 'Old Name' });

      const updated = repo.update(created.id, { name: 'New Name' });

      expect(updated.name).toBe('New Name');
      expect(updated.slug).toBe('old-name'); // Unchanged
    });

    it('updates workspace slug', () => {
      const created = repo.create(testUserId, { name: 'Test' });

      const updated = repo.update(created.id, { slug: 'new-slug' });

      expect(updated.slug).toBe('new-slug');
    });

    it('throws on non-existent workspace', () => {
      expect(() => repo.update('non-existent', { name: 'Test' }))
        .toThrow('Workspace not found');
    });

    it('throws on duplicate slug', () => {
      repo.create(testUserId, { name: 'First', slug: 'first-slug' });
      const second = repo.create(testUserId, { name: 'Second', slug: 'second-slug' });

      expect(() => repo.update(second.id, { slug: 'first-slug' }))
        .toThrow('Slug already taken');
    });
  });

  describe('delete', () => {
    it('deletes workspace and related data', () => {
      const workspace = repo.create(testUserId, { name: 'To Delete' });
      repo.updateSettings(workspace.id, { ttsVoice: 'test' });

      repo.delete(workspace.id);

      expect(repo.findById(workspace.id)).toBeNull();
      expect(repo.getSettings(workspace.id)).toBeNull();
      expect(repo.getMembers(workspace.id)).toHaveLength(0);
    });
  });

  describe('regenerateJoinCode', () => {
    it('generates a new join code', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      const oldCode = workspace.joinCode;

      const newCode = repo.regenerateJoinCode(workspace.id);

      expect(newCode).not.toBe(oldCode);
      expect(newCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      const found = repo.findByJoinCode(newCode);
      expect(found?.id).toBe(workspace.id);
    });
  });

  describe('settings', () => {
    it('creates and updates settings', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });

      const settings = repo.updateSettings(workspace.id, {
        ttsVoice: 'alloy',
        sttLanguage: 'en-US',
      });

      expect(settings.ttsVoice).toBe('alloy');
      expect(settings.sttLanguage).toBe('en-US');
    });

    it('preserves existing settings when updating', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      repo.updateSettings(workspace.id, { ttsVoice: 'alloy' });
      repo.updateSettings(workspace.id, { sttLanguage: 'en-US' });

      const settings = repo.getSettings(workspace.id);
      expect(settings?.ttsVoice).toBe('alloy');
      expect(settings?.sttLanguage).toBe('en-US');
    });

    it('clears API key', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      repo.updateSettings(workspace.id, {
        openhandsApiKeyEncrypted: 'encrypted',
        openhandsApiKeyIv: 'iv',
        openhandsApiKeyTag: 'tag',
      });

      repo.clearApiKey(workspace.id);

      const settings = repo.getSettings(workspace.id);
      expect(settings?.openhandsApiKeyEncrypted).toBeNull();
      expect(settings?.openhandsApiKeyIv).toBeNull();
      expect(settings?.openhandsApiKeyTag).toBeNull();
    });
  });

  describe('members', () => {
    it('adds and removes members', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      const memberId = 'member-789';
      
      // Create member user
      db.prepare(`
        INSERT INTO users (id, github_id, username, created_at, last_login_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(memberId, 99999, 'member');

      repo.addMember(workspace.id, memberId);

      expect(repo.isMember(workspace.id, memberId)).toBe(true);
      expect(repo.getMembers(workspace.id)).toHaveLength(2); // Owner + member

      repo.removeMember(workspace.id, memberId);

      expect(repo.isMember(workspace.id, memberId)).toBe(false);
      expect(repo.getMembers(workspace.id)).toHaveLength(1); // Just owner
    });

    it('checks access correctly', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      const nonMemberId = 'non-member';

      expect(repo.canAccess(workspace.id, testUserId)).toBe(true);
      expect(repo.canAccess(workspace.id, nonMemberId)).toBe(false);
    });

    it('checks ownership correctly', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      
      expect(repo.isOwner(workspace.id, testUserId)).toBe(true);
      expect(repo.isOwner(workspace.id, 'other-user')).toBe(false);
    });
  });
});
