import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionRepository } from './session-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

describe('SessionRepository', () => {
  let db: Database.Database;
  let repo: SessionRepository;
  let testWorkspaceId: string;
  let testDeviceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    // Create devices and sessions tables
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
      
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utterance_id TEXT NOT NULL UNIQUE,
        workspace_id TEXT,
        session_id TEXT,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        partial INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    
    repo = new SessionRepository(db);

    // Create test workspace and device
    testWorkspaceId = 'workspace-123';
    testDeviceId = 'device-123';
    const testUserId = 'user-123';
    
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 12345, 'testuser');
    
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId, 'Test Workspace', 'test-workspace', 'ABCD-1234');

    db.prepare(`
      INSERT INTO devices (id, workspace_id, name, mode, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(testDeviceId, testWorkspaceId, 'Test Device', 'mobile');
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a session with default name', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      expect(session.id).toBeDefined();
      expect(session.workspaceId).toBe(testWorkspaceId);
      expect(session.name).toContain('Session');
      expect(session.status).toBe('active');
      expect(session.startedAt).toBeDefined();
      expect(session.endedAt).toBeNull();
    });

    it('creates a session with custom name', () => {
      const session = repo.create({ 
        workspaceId: testWorkspaceId, 
        name: 'Morning Standup' 
      });

      expect(session.name).toBe('Morning Standup');
    });
  });

  describe('findById', () => {
    it('finds an existing session', () => {
      const created = repo.create({ workspaceId: testWorkspaceId });

      const found = repo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns null for non-existent session', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByWorkspace', () => {
    it('finds all sessions in a workspace', () => {
      repo.create({ workspaceId: testWorkspaceId, name: 'Session 1' });
      repo.create({ workspaceId: testWorkspaceId, name: 'Session 2' });
      repo.create({ workspaceId: testWorkspaceId, name: 'Session 3' });

      const sessions = repo.findByWorkspace(testWorkspaceId);
      expect(sessions).toHaveLength(3);
    });

    it('filters by status', () => {
      const session1 = repo.create({ workspaceId: testWorkspaceId, name: 'Active 1' });
      const session2 = repo.create({ workspaceId: testWorkspaceId, name: 'Active 2' });
      repo.endSession(session1.id);

      const active = repo.findByWorkspace(testWorkspaceId, 'active');
      const ended = repo.findByWorkspace(testWorkspaceId, 'ended');
      
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Active 2');
      expect(ended).toHaveLength(1);
      expect(ended[0].name).toBe('Active 1');
    });
  });

  describe('getActiveSessions', () => {
    it('returns only active sessions', () => {
      const active = repo.create({ workspaceId: testWorkspaceId, name: 'Active' });
      const ended = repo.create({ workspaceId: testWorkspaceId, name: 'Ended' });
      repo.endSession(ended.id);

      const sessions = repo.getActiveSessions(testWorkspaceId);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(active.id);
    });
  });

  describe('getOrCreateActiveSession', () => {
    it('returns existing active session', () => {
      const existing = repo.create({ workspaceId: testWorkspaceId });

      const session = repo.getOrCreateActiveSession(testWorkspaceId);
      expect(session.id).toBe(existing.id);
    });

    it('creates new session if none active', () => {
      const session = repo.getOrCreateActiveSession(testWorkspaceId);
      expect(session.id).toBeDefined();
      expect(session.status).toBe('active');
    });

    it('creates new session if all existing are ended', () => {
      const old = repo.create({ workspaceId: testWorkspaceId });
      repo.endSession(old.id);

      const session = repo.getOrCreateActiveSession(testWorkspaceId);
      expect(session.id).not.toBe(old.id);
      expect(session.status).toBe('active');
    });
  });

  describe('update', () => {
    it('updates session name', () => {
      const session = repo.create({ workspaceId: testWorkspaceId, name: 'Old Name' });

      const updated = repo.update(session.id, { name: 'New Name' });
      expect(updated?.name).toBe('New Name');
    });

    it('updates session status', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      const updated = repo.update(session.id, { status: 'ended' });
      expect(updated?.status).toBe('ended');
      expect(updated?.endedAt).toBeDefined();
    });

    it('returns null for non-existent session', () => {
      const updated = repo.update('non-existent', { name: 'Test' });
      expect(updated).toBeNull();
    });
  });

  describe('updateMetadata', () => {
    it('updates session metadata', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      const updated = repo.updateMetadata(session.id, {
        aiConversationId: 'conv-123',
        displayContent: { type: 'markdown', content: '# Hello' },
      });

      expect(updated?.metadata?.aiConversationId).toBe('conv-123');
      expect(updated?.metadata?.displayContent?.type).toBe('markdown');
    });

    it('merges with existing metadata', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.updateMetadata(session.id, { aiConversationId: 'conv-123' });
      repo.updateMetadata(session.id, { stats: { messageCount: 10, deviceCount: 2 } });

      const found = repo.findById(session.id);
      expect(found?.metadata?.aiConversationId).toBe('conv-123');
      expect(found?.metadata?.stats?.messageCount).toBe(10);
    });
  });

  describe('endSession', () => {
    it('sets status to ended and adds endedAt', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      const ended = repo.endSession(session.id);
      expect(ended?.status).toBe('ended');
      expect(ended?.endedAt).toBeDefined();
    });
  });

  describe('archiveSession', () => {
    it('sets status to archived', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      const archived = repo.archiveSession(session.id);
      expect(archived?.status).toBe('archived');
    });
  });

  describe('getSessionSummaries', () => {
    it('returns summaries with device counts and lastActiveAt', () => {
      const session = repo.create({ workspaceId: testWorkspaceId, name: 'Test Session' });
      repo.addDevice(session.id, testDeviceId);

      const summaries = repo.getSessionSummaries(testWorkspaceId);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe(session.id);
      expect(summaries[0].name).toBe('Test Session');
      expect(summaries[0].deviceCount).toBe(1);
      // lastActiveAt defaults to startedAt when no messages
      expect(summaries[0].lastActiveAt).toBe(session.startedAt);
    });

    it('filters by status', () => {
      const active = repo.create({ workspaceId: testWorkspaceId, name: 'Active' });
      const ended = repo.create({ workspaceId: testWorkspaceId, name: 'Ended' });
      repo.endSession(ended.id);

      const activeSummaries = repo.getSessionSummaries(testWorkspaceId, 'active');
      expect(activeSummaries).toHaveLength(1);
      expect(activeSummaries[0].name).toBe('Active');
    });

    it('returns lastActiveAt from most recent message', () => {
      const session = repo.create({ workspaceId: testWorkspaceId, name: 'Test Session' });
      
      // Insert a message
      const messageTime = new Date().toISOString();
      db.prepare(`
        INSERT INTO messages (utterance_id, workspace_id, session_id, sender_id, sender_name, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('test-utterance', testWorkspaceId, session.id, 'device-1', 'Test Device', 'Hello', messageTime);

      const summaries = repo.getSessionSummaries(testWorkspaceId);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].lastActiveAt).toBe(messageTime);
    });
  });

  describe('device membership', () => {
    it('adds device to session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      const membership = repo.addDevice(session.id, testDeviceId);
      expect(membership.sessionId).toBe(session.id);
      expect(membership.deviceId).toBe(testDeviceId);
      expect(membership.joinedAt).toBeDefined();
    });

    it('fails with FK constraint if device does not exist', () => {
      // This test documents the bug from issue #23:
      // addDevice() must be called AFTER device exists in devices table
      const session = repo.create({ workspaceId: testWorkspaceId });
      const nonExistentDeviceId = 'device-does-not-exist';

      expect(() => {
        repo.addDevice(session.id, nonExistentDeviceId);
      }).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('removes device from session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.addDevice(session.id, testDeviceId);

      repo.removeDevice(session.id, testDeviceId);
      
      const devices = repo.getDevices(session.id);
      expect(devices).toHaveLength(0);
    });

    it('gets all devices in a session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      
      // Create additional device
      const device2Id = 'device-456';
      db.prepare(`
        INSERT INTO devices (id, workspace_id, name, mode, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(device2Id, testWorkspaceId, 'Device 2', 'kiosk');

      repo.addDevice(session.id, testDeviceId);
      repo.addDevice(session.id, device2Id);

      const devices = repo.getDevices(session.id);
      expect(devices).toHaveLength(2);
    });

    it('gets device session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.addDevice(session.id, testDeviceId);

      const deviceSession = repo.getDeviceSession(testDeviceId);
      expect(deviceSession?.id).toBe(session.id);
    });

    it('returns null when device is in no active session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.addDevice(session.id, testDeviceId);
      repo.endSession(session.id);

      const deviceSession = repo.getDeviceSession(testDeviceId);
      expect(deviceSession).toBeNull();
    });

    it('moves device between sessions', () => {
      const session1 = repo.create({ workspaceId: testWorkspaceId, name: 'Session 1' });
      const session2 = repo.create({ workspaceId: testWorkspaceId, name: 'Session 2' });
      repo.addDevice(session1.id, testDeviceId);

      repo.moveDevice(testDeviceId, session1.id, session2.id);

      const devices1 = repo.getDevices(session1.id);
      const devices2 = repo.getDevices(session2.id);
      expect(devices1).toHaveLength(0);
      expect(devices2).toHaveLength(1);
    });

    it('removes device from all sessions', () => {
      const session1 = repo.create({ workspaceId: testWorkspaceId, name: 'Session 1' });
      const session2 = repo.create({ workspaceId: testWorkspaceId, name: 'Session 2' });
      repo.addDevice(session1.id, testDeviceId);
      repo.addDevice(session2.id, testDeviceId);

      repo.removeDeviceFromAll(testDeviceId);

      const devices1 = repo.getDevices(session1.id);
      const devices2 = repo.getDevices(session2.id);
      expect(devices1).toHaveLength(0);
      expect(devices2).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('deletes a session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      repo.delete(session.id);
      
      expect(repo.findById(session.id)).toBeNull();
    });
  });
});
