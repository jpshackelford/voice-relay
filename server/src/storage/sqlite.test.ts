import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStore } from './sqlite.js';
import type { RelayedTextMessage } from '../types.js';

describe('SQLiteStore', () => {
  let store: SQLiteStore;
  let testDbPath: string;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `voice-relay-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, 'test.db');
    store = new SQLiteStore({ path: testDbPath });
  });

  afterEach(async () => {
    await store.disconnect();
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createMessage = (overrides: Partial<RelayedTextMessage> = {}): RelayedTextMessage => ({
    type: 'text',
    utteranceId: `utt-${Date.now()}`,
    workspaceId: 'test-workspace',
    senderId: 'device-1',
    senderName: 'Test Device',
    text: 'Hello, world!',
    partial: false,
    ...overrides,
  });

  describe('connect', () => {
    it('creates database file and runs migrations', async () => {
      await store.connect();
      
      expect(existsSync(testDbPath)).toBe(true);
      
      // Verify migrations table exists
      const db = store.getDatabase();
      expect(db).not.toBeNull();
      
      const tables = db!.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'
      `).all();
      expect(tables).toHaveLength(1);
    });

    it('creates messages table through migration', async () => {
      await store.connect();
      
      const db = store.getDatabase();
      const tables = db!.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='messages'
      `).all();
      expect(tables).toHaveLength(1);
    });

    it('creates parent directory if it does not exist', async () => {
      const nestedPath = join(testDir, 'nested', 'deep', 'db.sqlite');
      const nestedStore = new SQLiteStore({ path: nestedPath });
      
      await nestedStore.connect();
      expect(existsSync(nestedPath)).toBe(true);
      
      await nestedStore.disconnect();
    });

    it('can skip migrations for testing', async () => {
      const skipStore = new SQLiteStore({ path: testDbPath, skipMigrations: true });
      await skipStore.connect();
      
      const db = skipStore.getDatabase();
      // Should only have _migrations table if migrations ran, but messages should not exist
      const tables = db!.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='messages'
      `).all();
      expect(tables).toHaveLength(0);
      
      await skipStore.disconnect();
    });
  });

  describe('disconnect', () => {
    it('closes database connection', async () => {
      await store.connect();
      await store.disconnect();
      
      expect(store.getDatabase()).toBeNull();
    });

    it('is safe to call multiple times', async () => {
      await store.connect();
      await store.disconnect();
      await expect(store.disconnect()).resolves.not.toThrow();
    });
  });

  describe('append', () => {
    beforeEach(async () => {
      await store.connect();
    });

    it('stores a message in the database', async () => {
      const message = createMessage({ text: 'Test message' });
      await store.append(message);
      
      const messages = await store.getRecent();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Test message');
    });

    it('stores all message fields correctly', async () => {
      const message = createMessage({
        utteranceId: 'utt-123',
        workspaceId: 'workspace-123',
        senderId: 'device-xyz',
        senderName: 'My Device',
        text: 'Hello!',
        partial: false,
      });
      await store.append(message);
      
      const messages = await store.getRecent();
      expect(messages[0]).toMatchObject({
        type: 'text',
        utteranceId: 'utt-123',
        workspaceId: 'workspace-123',
        senderId: 'device-xyz',
        senderName: 'My Device',
        text: 'Hello!',
        partial: false,
      });
      // createdAt is populated from the SQLite `created_at` column on read
      // (issue #264) — assert ISO Zulu form (with `Z` suffix).
      expect(messages[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('stores partial messages', async () => {
      const message = createMessage({ partial: true });
      await store.append(message);
      
      const messages = await store.getRecent();
      expect(messages[0].partial).toBe(true);
    });

    it('throws if not connected', async () => {
      await store.disconnect();
      await expect(store.append(createMessage())).rejects.toThrow('not connected');
    });
  });

  describe('getRecent', () => {
    beforeEach(async () => {
      await store.connect();
    });

    it('returns empty array when no messages', async () => {
      const messages = await store.getRecent();
      expect(messages).toEqual([]);
    });

    it('returns messages in chronological order (oldest first)', async () => {
      await store.append(createMessage({ text: 'First' }));
      await store.append(createMessage({ text: 'Second' }));
      await store.append(createMessage({ text: 'Third' }));
      
      const messages = await store.getRecent();
      expect(messages.map(m => m.text)).toEqual(['First', 'Second', 'Third']);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.append(createMessage({ text: `Message ${i}` }));
      }
      
      const messages = await store.getRecent(3);
      expect(messages).toHaveLength(3);
      // Should return the 3 most recent, oldest first
      expect(messages.map(m => m.text)).toEqual(['Message 7', 'Message 8', 'Message 9']);
    });

    it('uses default limit of 100', async () => {
      for (let i = 0; i < 150; i++) {
        await store.append(createMessage({ text: `Message ${i}` }));
      }
      
      const messages = await store.getRecent();
      expect(messages).toHaveLength(100);
    });

    it('throws if not connected', async () => {
      await store.disconnect();
      await expect(store.getRecent()).rejects.toThrow('not connected');
    });

    it('filters by workspaceId when provided', async () => {
      await store.append(createMessage({ text: 'WS1 Message 1', workspaceId: 'workspace-1' }));
      await store.append(createMessage({ text: 'WS2 Message 1', workspaceId: 'workspace-2' }));
      await store.append(createMessage({ text: 'WS1 Message 2', workspaceId: 'workspace-1' }));
      
      const ws1Messages = await store.getRecent(10, 'workspace-1');
      expect(ws1Messages).toHaveLength(2);
      expect(ws1Messages.map(m => m.text)).toEqual(['WS1 Message 1', 'WS1 Message 2']);

      const ws2Messages = await store.getRecent(10, 'workspace-2');
      expect(ws2Messages).toHaveLength(1);
      expect(ws2Messages[0].text).toBe('WS2 Message 1');
    });

    it('returns all messages when workspaceId is not provided', async () => {
      await store.append(createMessage({ text: 'WS1 Message', workspaceId: 'workspace-1' }));
      await store.append(createMessage({ text: 'WS2 Message', workspaceId: 'workspace-2' }));
      
      const allMessages = await store.getRecent();
      expect(allMessages).toHaveLength(2);
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      await store.connect();
    });

    it('removes all messages', async () => {
      await store.append(createMessage({ text: 'Message 1' }));
      await store.append(createMessage({ text: 'Message 2' }));
      
      await store.clear();
      
      const messages = await store.getRecent();
      expect(messages).toEqual([]);
    });

    it('is safe to call on empty database', async () => {
      await expect(store.clear()).resolves.not.toThrow();
    });

    it('throws if not connected', async () => {
      await store.disconnect();
      await expect(store.clear()).rejects.toThrow('not connected');
    });
  });

  describe('persistence', () => {
    it('persists messages across reconnect', async () => {
      await store.connect();
      await store.append(createMessage({ text: 'Persisted message' }));
      await store.disconnect();
      
      // Create new store instance pointing to same file
      const newStore = new SQLiteStore({ path: testDbPath });
      await newStore.connect();
      
      const messages = await newStore.getRecent();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Persisted message');
      
      await newStore.disconnect();
    });
  });

  describe('backward compatibility', () => {
    it('works with existing database that has messages table', async () => {
      // Simulate an existing database created with old schema
      const Database = (await import('better-sqlite3')).default;
      mkdirSync(testDir, { recursive: true });
      const db = new Database(testDbPath);
      
      // Create table manually (old way)
      db.exec(`
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utterance_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          text TEXT NOT NULL,
          partial INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      
      // Insert some data
      db.prepare(`
        INSERT INTO messages (utterance_id, sender_id, sender_name, text, partial)
        VALUES (?, ?, ?, ?, ?)
      `).run('existing-1', 'old-device', 'Old Device', 'Existing message', 0);
      
      db.close();
      
      // Now connect with the new store that runs migrations
      const newStore = new SQLiteStore({ path: testDbPath });
      await newStore.connect();
      
      // Should see existing data
      const messages = await newStore.getRecent();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Existing message');
      
      // Should be able to add new messages
      await newStore.append(createMessage({ text: 'New message' }));
      const allMessages = await newStore.getRecent();
      expect(allMessages).toHaveLength(2);
      
      await newStore.disconnect();
    });
  });

  describe('getDatabase', () => {
    it('returns null when not connected', () => {
      expect(store.getDatabase()).toBeNull();
    });

    it('returns database when connected', async () => {
      await store.connect();
      expect(store.getDatabase()).not.toBeNull();
    });
  });

  describe('session support', () => {
    // Helper to create test sessions in the database
    const createTestSession = (db: ReturnType<typeof store.getDatabase>, sessionId: string, workspaceId: string = 'test-workspace') => {
      // First need a user for the workspace owner FK
      db!.prepare(`
        INSERT OR IGNORE INTO users (id, github_id, username, created_at, last_login_at)
        VALUES ('owner-1', 12345, 'testuser', datetime('now'), datetime('now'))
      `).run();
      // Then ensure workspace exists (required by FK)
      db!.prepare(`
        INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
        VALUES (?, 'owner-1', 'Test Workspace', 'test', 'TEST', datetime('now'), datetime('now'))
      `).run(workspaceId);
      // Now create the session
      db!.prepare(`
        INSERT INTO sessions (id, workspace_id, name, status, started_at)
        VALUES (?, ?, 'Test Session', 'active', datetime('now'))
      `).run(sessionId, workspaceId);
    };

    beforeEach(async () => {
      await store.connect();
    });

    it('stores sessionId with message', async () => {
      const db = store.getDatabase();
      createTestSession(db, 'session-123');

      const message = createMessage({
        text: 'Session message',
        sessionId: 'session-123',
      });
      await store.append(message);

      const messages = await store.getRecent();
      expect(messages).toHaveLength(1);
      expect(messages[0].sessionId).toBe('session-123');
    });

    it('stores message without sessionId', async () => {
      const message = createMessage({ text: 'No session' });
      // Ensure sessionId is not set
      delete (message as any).sessionId;
      await store.append(message);

      const messages = await store.getRecent();
      expect(messages).toHaveLength(1);
      expect(messages[0].sessionId).toBeUndefined();
    });

    describe('getRecentBySession', () => {
      it('returns messages for a specific session', async () => {
        const db = store.getDatabase();
        createTestSession(db, 'session-a');
        createTestSession(db, 'session-b');

        await store.append(createMessage({ text: 'Session A msg 1', sessionId: 'session-a' }));
        await store.append(createMessage({ text: 'Session B msg 1', sessionId: 'session-b' }));
        await store.append(createMessage({ text: 'Session A msg 2', sessionId: 'session-a' }));
        await store.append(createMessage({ text: 'Session B msg 2', sessionId: 'session-b' }));

        const sessionAMessages = await store.getRecentBySession(10, 'session-a');
        expect(sessionAMessages).toHaveLength(2);
        expect(sessionAMessages.map(m => m.text)).toEqual(['Session A msg 1', 'Session A msg 2']);

        const sessionBMessages = await store.getRecentBySession(10, 'session-b');
        expect(sessionBMessages).toHaveLength(2);
        expect(sessionBMessages.map(m => m.text)).toEqual(['Session B msg 1', 'Session B msg 2']);
      });

      it('returns empty array for non-existent session', async () => {
        const db = store.getDatabase();
        createTestSession(db, 'session-a');

        await store.append(createMessage({ text: 'Session A msg', sessionId: 'session-a' }));

        const messages = await store.getRecentBySession(10, 'non-existent');
        expect(messages).toEqual([]);
      });

      it('excludes messages without sessionId', async () => {
        const db = store.getDatabase();
        createTestSession(db, 'session-a');

        await store.append(createMessage({ text: 'With session', sessionId: 'session-a' }));
        const noSession = createMessage({ text: 'No session' });
        delete (noSession as any).sessionId;
        await store.append(noSession);

        const sessionMessages = await store.getRecentBySession(10, 'session-a');
        expect(sessionMessages).toHaveLength(1);
        expect(sessionMessages[0].text).toBe('With session');
      });

      it('respects limit parameter', async () => {
        const db = store.getDatabase();
        createTestSession(db, 'session-a');

        for (let i = 0; i < 10; i++) {
          await store.append(createMessage({ text: `Message ${i}`, sessionId: 'session-a' }));
        }

        const messages = await store.getRecentBySession(3, 'session-a');
        expect(messages).toHaveLength(3);
        expect(messages.map(m => m.text)).toEqual(['Message 7', 'Message 8', 'Message 9']);
      });

      it('returns messages in chronological order (oldest first)', async () => {
        const db = store.getDatabase();
        createTestSession(db, 'session-a');

        await store.append(createMessage({ text: 'First', sessionId: 'session-a' }));
        await store.append(createMessage({ text: 'Second', sessionId: 'session-a' }));
        await store.append(createMessage({ text: 'Third', sessionId: 'session-a' }));

        const messages = await store.getRecentBySession(10, 'session-a');
        expect(messages.map(m => m.text)).toEqual(['First', 'Second', 'Third']);
      });

      it('throws if not connected', async () => {
        await store.disconnect();
        await expect(store.getRecentBySession(10, 'session-a')).rejects.toThrow('not connected');
      });
    });
  });
});
