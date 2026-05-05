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
        senderId: 'device-xyz',
        senderName: 'My Device',
        text: 'Hello!',
        partial: false,
      });
      await store.append(message);
      
      const messages = await store.getRecent();
      expect(messages[0]).toEqual({
        type: 'text',
        utteranceId: 'utt-123',
        senderId: 'device-xyz',
        senderName: 'My Device',
        text: 'Hello!',
        partial: false,
      });
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
});
