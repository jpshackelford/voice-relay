import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionRepository } from './session-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';
import { migration as displayApiSecretsMigration } from '../storage/migrations/010_display_api_secrets.js';

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

describe('SessionRepository', () => {
  let db: Database.Database;
  let repo: SessionRepository;
  let testWorkspaceId: string;
  let testDeviceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
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
        display_api_secret_encrypted TEXT,
        display_api_secret_iv TEXT,
        display_api_secret_tag TEXT,
        target_kiosk_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_target_kiosk
        ON sessions(target_kiosk_device_id, status)
        WHERE target_kiosk_device_id IS NOT NULL;
      
      CREATE TABLE IF NOT EXISTS session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        -- #433: per-session speaker override column (migration 017 adds
        -- this in production). Including it inline keeps this test
        -- self-contained without dragging in the full migration chain.
        active_speaker_id TEXT,
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

  describe('listActiveWithAiConversation (#341)', () => {
    it('returns active sessions with non-null metadata.aiConversationId', () => {
      const s1 = repo.create({ workspaceId: testWorkspaceId, name: 'with-ai' });
      repo.updateMetadata(s1.id, { aiConversationId: 'conv-abc' });

      const results = repo.listActiveWithAiConversation();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(s1.id);
      expect(results[0].metadata?.aiConversationId).toBe('conv-abc');
    });

    it('returns multiple matching sessions (multi-workspace, multi-session)', () => {
      const wsB = 'workspace-b';
      db.prepare(`
        INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(wsB, 'user-123', 'Workspace B', 'workspace-b', 'EFGH-5678');

      const s1 = repo.create({ workspaceId: testWorkspaceId, name: 's1' });
      const s2 = repo.create({ workspaceId: wsB, name: 's2' });
      const s3 = repo.create({ workspaceId: testWorkspaceId, name: 's3' });
      repo.updateMetadata(s1.id, { aiConversationId: 'conv-1' });
      repo.updateMetadata(s2.id, { aiConversationId: 'conv-2' });
      repo.updateMetadata(s3.id, { aiConversationId: 'conv-3' });

      const results = repo.listActiveWithAiConversation();
      const ids = results.map((s) => s.id).sort();
      expect(ids).toEqual([s1.id, s2.id, s3.id].sort());
    });

    it('returns empty array when no sessions exist', () => {
      expect(repo.listActiveWithAiConversation()).toEqual([]);
    });

    it('excludes ended sessions even when aiConversationId is set', () => {
      const s1 = repo.create({ workspaceId: testWorkspaceId, name: 'ended-but-with-conv' });
      repo.updateMetadata(s1.id, { aiConversationId: 'conv-old' });
      repo.endSession(s1.id);

      expect(repo.listActiveWithAiConversation()).toEqual([]);
    });

    it('excludes archived sessions', () => {
      const s1 = repo.create({ workspaceId: testWorkspaceId, name: 'archived' });
      repo.updateMetadata(s1.id, { aiConversationId: 'conv-arc' });
      repo.archiveSession(s1.id);

      expect(repo.listActiveWithAiConversation()).toEqual([]);
    });

    it('excludes sessions with no metadata at all', () => {
      repo.create({ workspaceId: testWorkspaceId, name: 'no-metadata' });
      expect(repo.listActiveWithAiConversation()).toEqual([]);
    });

    it('excludes sessions whose metadata has other fields but no aiConversationId', () => {
      const s1 = repo.create({ workspaceId: testWorkspaceId, name: 'no-conv' });
      repo.updateMetadata(s1.id, {
        ttsSettings: { enabled: true, outputDeviceId: null },
      });
      expect(repo.listActiveWithAiConversation()).toEqual([]);
    });

    it('returns only the matching subset when mixed', () => {
      const withConv = repo.create({ workspaceId: testWorkspaceId, name: 'has-ai' });
      const withoutConv = repo.create({ workspaceId: testWorkspaceId, name: 'no-ai' });
      const ended = repo.create({ workspaceId: testWorkspaceId, name: 'ended-with-ai' });
      repo.updateMetadata(withConv.id, { aiConversationId: 'conv-yes' });
      repo.updateMetadata(ended.id, { aiConversationId: 'conv-end' });
      repo.endSession(ended.id);

      const results = repo.listActiveWithAiConversation();
      expect(results.map((s) => s.id)).toEqual([withConv.id]);
      expect(results.find((s) => s.id === withoutConv.id)).toBeUndefined();
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

  // Issue #393: per-kiosk active sessions for the mobile kiosk picker.
  describe('per-kiosk active sessions (#393)', () => {
    const kioskA = 'kiosk-a';
    const kioskB = 'kiosk-b';

    beforeEach(() => {
      db.prepare(
        `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
      ).run(kioskA, testWorkspaceId, 'Kiosk A', 'kiosk');
      db.prepare(
        `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
      ).run(kioskB, testWorkspaceId, 'Kiosk B', 'kiosk');
    });

    it('create() persists targetKioskDeviceId when provided', () => {
      const sess = repo.create({
        workspaceId: testWorkspaceId,
        targetKioskDeviceId: kioskA,
      });
      expect(sess.targetKioskDeviceId).toBe(kioskA);

      const fresh = repo.findById(sess.id);
      expect(fresh?.targetKioskDeviceId).toBe(kioskA);
    });

    it('create() defaults targetKioskDeviceId to null when omitted', () => {
      const sess = repo.create({ workspaceId: testWorkspaceId });
      expect(sess.targetKioskDeviceId).toBeNull();
    });

    it('getActiveSessionForKiosk returns null when no session is bound', () => {
      expect(repo.getActiveSessionForKiosk(kioskA)).toBeNull();
    });

    it('getActiveSessionForKiosk returns only the kiosk-bound active session', () => {
      // Workspace-wide legacy session (unbound) should NOT be returned.
      repo.create({ workspaceId: testWorkspaceId });
      // Bound session for kiosk A.
      const bound = repo.create({
        workspaceId: testWorkspaceId,
        targetKioskDeviceId: kioskA,
      });

      const found = repo.getActiveSessionForKiosk(kioskA);
      expect(found?.id).toBe(bound.id);
      // Kiosk B has no binding yet.
      expect(repo.getActiveSessionForKiosk(kioskB)).toBeNull();
    });

    it('getActiveSessionForKiosk ignores ended sessions', () => {
      const bound = repo.create({
        workspaceId: testWorkspaceId,
        targetKioskDeviceId: kioskA,
      });
      repo.endSession(bound.id);
      expect(repo.getActiveSessionForKiosk(kioskA)).toBeNull();
    });

    it('getOrCreateActiveSessionForKiosk reuses an existing binding', () => {
      const first = repo.getOrCreateActiveSessionForKiosk(testWorkspaceId, kioskA);
      const second = repo.getOrCreateActiveSessionForKiosk(testWorkspaceId, kioskA);
      expect(second.id).toBe(first.id);
      expect(second.targetKioskDeviceId).toBe(kioskA);
    });

    it('getOrCreateActiveSessionForKiosk creates separate sessions per kiosk', () => {
      const a = repo.getOrCreateActiveSessionForKiosk(testWorkspaceId, kioskA);
      const b = repo.getOrCreateActiveSessionForKiosk(testWorkspaceId, kioskB);
      expect(a.id).not.toBe(b.id);
      expect(a.targetKioskDeviceId).toBe(kioskA);
      expect(b.targetKioskDeviceId).toBe(kioskB);
    });

    it('getOrCreateActiveSessionForKiosk claims an existing unbound active session (backward compat)', () => {
      // Mobile (or pre-#393 client) registered first and created a
      // legacy workspace-wide session with no target kiosk.
      const legacy = repo.create({ workspaceId: testWorkspaceId });
      expect(legacy.targetKioskDeviceId).toBeNull();

      // First kiosk to register should claim that session rather than
      // opening a duplicate one — otherwise the dashboard ends up with
      // two "View" buttons in single-kiosk workspaces.
      const claimed = repo.getOrCreateActiveSessionForKiosk(testWorkspaceId, kioskA);
      expect(claimed.id).toBe(legacy.id);
      expect(claimed.targetKioskDeviceId).toBe(kioskA);

      // And the DB row is actually updated, not just the returned value.
      const reread = repo.findById(legacy.id);
      expect(reread?.targetKioskDeviceId).toBe(kioskA);
    });

    it('getKioskPickerEnrichment returns activeSessionId + lastUsedAt per kiosk', () => {
      // Kiosk A has an active bound session.
      const sessA = repo.getOrCreateActiveSessionForKiosk(testWorkspaceId, kioskA);
      repo.addDevice(sessA.id, kioskA);
      // Kiosk B has no session yet.

      const enrichment = repo.getKioskPickerEnrichment(testWorkspaceId);

      expect(enrichment.get(kioskA)?.activeSessionId).toBe(sessA.id);
      expect(typeof enrichment.get(kioskA)?.lastUsedAt).toBe('string');

      expect(enrichment.get(kioskB)?.activeSessionId).toBeNull();
      expect(enrichment.get(kioskB)?.lastUsedAt).toBeNull();

      // Mobile devices are not included in the enrichment map.
      expect(enrichment.has(testDeviceId)).toBe(false);
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

    it('round-trips a full displayContent payload through SQLite metadata (issue #338)', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      repo.updateMetadata(session.id, {
        displayContent: {
          type: 'markdown',
          content: '# Daily Brief\n\n- Item 1\n- Item 2',
          title: 'Operator Brief',
        },
      });

      // Force re-read from the DB to prove the JSON column round-tripped.
      const found = repo.findById(session.id);
      expect(found?.metadata?.displayContent).toEqual({
        type: 'markdown',
        content: '# Daily Brief\n\n- Item 1\n- Item 2',
        title: 'Operator Brief',
      });
    });

    it('round-trips an image displayContent payload (issue #338)', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      repo.updateMetadata(session.id, {
        displayContent: {
          type: 'image',
          content: 'https://example.com/chart.png',
        },
      });

      const found = repo.findById(session.id);
      expect(found?.metadata?.displayContent).toEqual({
        type: 'image',
        content: 'https://example.com/chart.png',
      });
    });
  });

  describe('clearDisplayContent (issue #338)', () => {
    it('removes the displayContent key from metadata', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.updateMetadata(session.id, {
        displayContent: { type: 'markdown', content: '# Hello', title: 't' },
      });
      expect(repo.findById(session.id)?.metadata?.displayContent).toBeDefined();

      const cleared = repo.clearDisplayContent(session.id);

      expect(cleared?.metadata?.displayContent).toBeUndefined();
      // Confirm via a fresh read too, not just the returned object.
      expect(repo.findById(session.id)?.metadata?.displayContent).toBeUndefined();
    });

    it('preserves co-existing metadata fields (ttsSettings, aiConversationId)', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.updateMetadata(session.id, {
        aiConversationId: 'conv-abc',
        ttsSettings: { enabled: true, outputDeviceId: 'kiosk-1' },
        displayContent: { type: 'markdown', content: '# Hello' },
      });

      repo.clearDisplayContent(session.id);

      const found = repo.findById(session.id);
      expect(found?.metadata?.displayContent).toBeUndefined();
      expect(found?.metadata?.aiConversationId).toBe('conv-abc');
      expect(found?.metadata?.ttsSettings).toEqual({
        enabled: true,
        outputDeviceId: 'kiosk-1',
      });
    });

    it('is a no-op (no throw) when called on a session with no displayContent', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.updateMetadata(session.id, { aiConversationId: 'conv-abc' });

      const cleared = repo.clearDisplayContent(session.id);

      expect(cleared?.metadata?.displayContent).toBeUndefined();
      expect(cleared?.metadata?.aiConversationId).toBe('conv-abc');
    });

    it('returns null for an unknown session id', () => {
      expect(repo.clearDisplayContent('does-not-exist')).toBeNull();
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

  describe('active speaker override (#433)', () => {
    it('returns null when no row exists', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      expect(repo.getActiveSpeaker(session.id, testDeviceId)).toBeNull();
    });

    it('returns null when row exists but override is unset', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.addDevice(session.id, testDeviceId);
      expect(repo.getActiveSpeaker(session.id, testDeviceId)).toBeNull();
    });

    it('sets and reads the active speaker id', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.addDevice(session.id, testDeviceId);
      repo.setActiveSpeaker(session.id, testDeviceId, 'speaker-abc');
      expect(repo.getActiveSpeaker(session.id, testDeviceId)).toBe('speaker-abc');
    });

    it('clears the override when speakerId is null', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      repo.addDevice(session.id, testDeviceId);
      repo.setActiveSpeaker(session.id, testDeviceId, 'speaker-abc');
      repo.setActiveSpeaker(session.id, testDeviceId, null);
      expect(repo.getActiveSpeaker(session.id, testDeviceId)).toBeNull();
    });

    it('no-ops silently when the session_devices row does not exist', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });
      expect(() =>
        repo.setActiveSpeaker(session.id, testDeviceId, 'speaker-abc')
      ).not.toThrow();
      expect(repo.getActiveSpeaker(session.id, testDeviceId)).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a session', () => {
      const session = repo.create({ workspaceId: testWorkspaceId });

      repo.delete(session.id);
      
      expect(repo.findById(session.id)).toBeNull();
    });
  });

  describe('display API secrets', () => {
    describe('createWithDisplaySecret', () => {
      it('creates a session with encrypted display API secret', () => {
        const { session, displayApiSecret } = repo.createWithDisplaySecret({ 
          workspaceId: testWorkspaceId 
        });

        expect(session.id).toBeDefined();
        expect(session.workspaceId).toBe(testWorkspaceId);
        expect(session.status).toBe('active');
        
        // Secret should be returned
        expect(displayApiSecret).toBeDefined();
        expect(displayApiSecret.length).toBeGreaterThan(0);
        
        // Encrypted fields should be stored
        expect(session.displayApiSecretEncrypted).toBeDefined();
        expect(session.displayApiSecretIv).toBeDefined();
        expect(session.displayApiSecretTag).toBeDefined();
      });

      it('creates unique secrets for each session', () => {
        const { displayApiSecret: secret1 } = repo.createWithDisplaySecret({ 
          workspaceId: testWorkspaceId 
        });
        const { displayApiSecret: secret2 } = repo.createWithDisplaySecret({ 
          workspaceId: testWorkspaceId 
        });

        expect(secret1).not.toBe(secret2);
      });
    });

    describe('getDisplaySecret', () => {
      it('returns the decrypted display API secret', () => {
        const { session, displayApiSecret } = repo.createWithDisplaySecret({ 
          workspaceId: testWorkspaceId 
        });

        const retrieved = repo.getDisplaySecret(session.id);
        expect(retrieved).toBe(displayApiSecret);
      });

      it('returns null for non-existent session', () => {
        const secret = repo.getDisplaySecret('non-existent-id');
        expect(secret).toBeNull();
      });

      it('returns null for session without display secret', () => {
        const session = repo.create({ workspaceId: testWorkspaceId });
        const secret = repo.getDisplaySecret(session.id);
        expect(secret).toBeNull();
      });
    });

    describe('setDisplaySecret', () => {
      it('adds a display API secret to an existing session', () => {
        // Create session without secret
        const session = repo.create({ workspaceId: testWorkspaceId });
        expect(repo.getDisplaySecret(session.id)).toBeNull();

        // Set secret
        const secret = repo.setDisplaySecret(session.id);
        expect(secret).toBeDefined();
        expect(secret!.length).toBeGreaterThan(0);

        // Verify it can be retrieved
        const retrieved = repo.getDisplaySecret(session.id);
        expect(retrieved).toBe(secret);
      });

      it('returns null for non-existent session', () => {
        const secret = repo.setDisplaySecret('non-existent-id');
        expect(secret).toBeNull();
      });

      it('generates unique secrets on each call', () => {
        const session = repo.create({ workspaceId: testWorkspaceId });
        
        const secret1 = repo.setDisplaySecret(session.id);
        const secret2 = repo.setDisplaySecret(session.id);
        
        // Each call should generate a new secret
        expect(secret1).not.toBe(secret2);
      });
    });

    describe('regular create does not include display secret', () => {
      it('session created with create() has no display secret', () => {
        const session = repo.create({ workspaceId: testWorkspaceId });

        expect(session.displayApiSecretEncrypted).toBeNull();
        expect(session.displayApiSecretIv).toBeNull();
        expect(session.displayApiSecretTag).toBeNull();
      });
    });
  });
});
