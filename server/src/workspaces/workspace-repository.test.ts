import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkspaceRepository } from './workspace-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';
import { migration as qrTokensMigration } from '../storage/migrations/008_qr_tokens.js';
import { migration as elevenlabsMigration } from '../storage/migrations/011_elevenlabs.js';
import { migration as kioskTickersMigration } from '../storage/migrations/015_kiosk_footer_tickers.js';

describe('WorkspaceRepository', () => {
  let db: Database.Database;
  let repo: WorkspaceRepository;
  let testUserId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    // Create sessions table (minimal version for QR tokens FK constraint)
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

    it('creates settings row with allowAutoJoin=false (security-first)', () => {
      // This test verifies the security-first design: new workspaces must opt-in to auto-join
      const workspace = repo.create(testUserId, { name: 'Security First Workspace' });
      
      // Settings row should be created automatically during workspace creation
      const settings = repo.getSettings(workspace.id);
      
      // Must have settings row (not null)
      expect(settings).not.toBeNull();
      // Must default to false for security-first
      expect(settings?.allowAutoJoin).toBe(false);
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

    it('defaults allowAutoJoin to false for new workspaces (security-first)', () => {
      const workspace = repo.create(testUserId, { name: 'New Workspace' });
      
      // Set some non-allowAutoJoin setting to create settings record
      repo.updateSettings(workspace.id, { ttsVoice: 'alloy' });
      
      const settings = repo.getSettings(workspace.id);
      // Should default to false for new workspaces
      expect(settings?.allowAutoJoin).toBe(false);
    });

    it('respects explicit allowAutoJoin=true when specified', () => {
      const workspace = repo.create(testUserId, { name: 'New Workspace' });
      
      repo.updateSettings(workspace.id, { allowAutoJoin: true });
      
      const settings = repo.getSettings(workspace.id);
      expect(settings?.allowAutoJoin).toBe(true);
    });

    it('allows updating allowAutoJoin to false after creation', () => {
      const workspace = repo.create(testUserId, { name: 'New Workspace' });
      
      // First enable it
      repo.updateSettings(workspace.id, { allowAutoJoin: true });
      expect(repo.getSettings(workspace.id)?.allowAutoJoin).toBe(true);
      
      // Then disable it
      repo.updateSettings(workspace.id, { allowAutoJoin: false });
      expect(repo.getSettings(workspace.id)?.allowAutoJoin).toBe(false);
    });

    // Issue #340: workspace-level kiosk footer ticker toggle
    it('defaults kioskFooterTickersEnabled to false', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      const settings = repo.getSettings(workspace.id);
      expect(settings?.kioskFooterTickersEnabled).toBe(false);
    });

    it('persists kioskFooterTickersEnabled toggles', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });

      repo.updateSettings(workspace.id, { kioskFooterTickersEnabled: true });
      expect(repo.getSettings(workspace.id)?.kioskFooterTickersEnabled).toBe(true);

      repo.updateSettings(workspace.id, { kioskFooterTickersEnabled: false });
      expect(repo.getSettings(workspace.id)?.kioskFooterTickersEnabled).toBe(false);
    });

    it('preserves kioskFooterTickersEnabled across unrelated updates', () => {
      const workspace = repo.create(testUserId, { name: 'Test' });
      repo.updateSettings(workspace.id, { kioskFooterTickersEnabled: true });
      repo.updateSettings(workspace.id, { ttsVoice: 'nova' });
      const settings = repo.getSettings(workspace.id);
      expect(settings?.kioskFooterTickersEnabled).toBe(true);
      expect(settings?.ttsVoice).toBe('nova');
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

  describe('getDeletionCounts', () => {
    beforeEach(() => {
      // Create additional tables for deletion counts
      db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mode TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utterance_id TEXT NOT NULL,
          workspace_id TEXT,
          sender_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          text TEXT NOT NULL,
          partial INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    });

    it('returns zero counts for empty workspace', () => {
      const workspace = repo.create(testUserId, { name: 'Empty Workspace' });
      const counts = repo.getDeletionCounts(workspace.id);

      expect(counts.sessions).toBe(0);
      expect(counts.devices).toBe(0);
      expect(counts.messages).toBe(0);
      expect(counts.members).toBe(1); // just the owner
    });

    it('returns correct counts for workspace with data', () => {
      const workspace = repo.create(testUserId, { name: 'Test Workspace' });

      // Add another member
      const memberId = 'member-456';
      db.prepare(`INSERT INTO users (id, github_id, username, created_at, last_login_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`).run(memberId, 67890, 'member');
      repo.addMember(workspace.id, memberId);

      // Add sessions
      db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-1', workspace.id, 'Session 1');
      db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-2', workspace.id, 'Session 2');
      db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-3', workspace.id, 'Session 3');

      // Add devices
      db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`).run('device-1', workspace.id, 'Device 1', 'kiosk');
      db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`).run('device-2', workspace.id, 'Device 2', 'mobile');

      // Add messages
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', workspace.id, 'user-1', 'User', 'Hello', 0);
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', workspace.id, 'user-2', 'User2', 'World', 0);
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u3', workspace.id, 'user-1', 'User', 'Test', 0);
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u4', workspace.id, 'user-2', 'User2', 'Message', 0);

      const counts = repo.getDeletionCounts(workspace.id);

      expect(counts.sessions).toBe(3);
      expect(counts.devices).toBe(2);
      expect(counts.messages).toBe(4);
      expect(counts.members).toBe(2); // owner + member
    });

    it('does not count data from other workspaces', () => {
      const workspace1 = repo.create(testUserId, { name: 'Workspace 1' });
      const workspace2 = repo.create(testUserId, { name: 'Workspace 2' });

      // Add data to workspace 1
      db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-1', workspace1.id, 'Session 1');
      db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`).run('device-1', workspace1.id, 'Device 1', 'kiosk');
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', workspace1.id, 'user-1', 'User', 'Hello', 0);

      // Add data to workspace 2
      db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-2', workspace2.id, 'Session 2');
      db.prepare(`INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`).run('session-3', workspace2.id, 'Session 3');
      db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`).run('device-2', workspace2.id, 'Device 2', 'mobile');
      db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`).run('device-3', workspace2.id, 'Device 3', 'mobile');
      db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`).run('device-4', workspace2.id, 'Device 4', 'mobile');

      // Counts for workspace 1 should only include workspace 1 data
      const counts1 = repo.getDeletionCounts(workspace1.id);
      expect(counts1.sessions).toBe(1);
      expect(counts1.devices).toBe(1);
      expect(counts1.messages).toBe(1);
      expect(counts1.members).toBe(1);

      // Counts for workspace 2 should only include workspace 2 data
      const counts2 = repo.getDeletionCounts(workspace2.id);
      expect(counts2.sessions).toBe(2);
      expect(counts2.devices).toBe(3);
      expect(counts2.messages).toBe(0);
      expect(counts2.members).toBe(1);
    });
  });

  describe('deleteMessages', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utterance_id TEXT NOT NULL,
          workspace_id TEXT,
          sender_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          text TEXT NOT NULL,
          partial INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    });

    it('deletes all messages for a workspace', () => {
      const workspace = repo.create(testUserId, { name: 'Test Workspace' });

      // Add messages
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', workspace.id, 'user-1', 'User', 'Hello', 0);
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', workspace.id, 'user-2', 'User2', 'World', 0);

      // Verify messages exist
      const countBefore = db.prepare('SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?').get(workspace.id) as { count: number } | undefined;
      expect(countBefore?.count).toBe(2);

      // Delete messages
      const deletedCount = repo.deleteMessages(workspace.id);
      expect(deletedCount).toBe(2);

      // Verify messages are deleted
      const countAfter = db.prepare('SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?').get(workspace.id) as { count: number } | undefined;
      expect(countAfter?.count).toBe(0);
    });

    it('returns zero when no messages to delete', () => {
      const workspace = repo.create(testUserId, { name: 'Empty Workspace' });
      const deletedCount = repo.deleteMessages(workspace.id);
      expect(deletedCount).toBe(0);
    });

    it('only deletes messages from specified workspace', () => {
      const workspace1 = repo.create(testUserId, { name: 'Workspace 1' });
      const workspace2 = repo.create(testUserId, { name: 'Workspace 2' });

      // Add messages to both workspaces
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', workspace1.id, 'user-1', 'User', 'Hello', 0);
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', workspace2.id, 'user-2', 'User2', 'World', 0);
      db.prepare(`INSERT INTO messages (utterance_id, workspace_id, sender_id, sender_name, text, partial) VALUES (?, ?, ?, ?, ?, ?)`).run('u3', workspace2.id, 'user-2', 'User2', 'Test', 0);

      // Delete messages from workspace 1 only
      repo.deleteMessages(workspace1.id);

      // Verify only workspace 1 messages are deleted
      const count1 = db.prepare('SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?').get(workspace1.id) as { count: number } | undefined;
      const count2 = db.prepare('SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?').get(workspace2.id) as { count: number } | undefined;

      expect(count1?.count).toBe(0);
      expect(count2?.count).toBe(2);
    });
  });
});
