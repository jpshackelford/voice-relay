import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RelayedTextMessage } from '../types.js';
import type { MessageStore } from './types.js';

export interface SQLiteStoreOptions {
  path: string;
}

export class SQLiteStore implements MessageStore {
  private db: Database.Database | null = null;
  private readonly path: string;

  constructor(options: SQLiteStoreOptions) {
    this.path = options.path;
  }

  async connect(): Promise<void> {
    // Ensure directory exists
    mkdirSync(dirname(this.path), { recursive: true });
    
    this.db = new Database(this.path);
    
    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utterance_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        partial INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Index for efficient queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)
    `);

    console.log('[SQLiteStore] Connected to', this.path);
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
    console.log('[SQLiteStore] Disconnected');
  }

  async append(message: RelayedTextMessage): Promise<void> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    const stmt = this.db.prepare(`
      INSERT INTO messages (utterance_id, sender_id, sender_name, text, partial)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.utteranceId,
      message.senderId,
      message.senderName,
      message.text,
      message.partial ? 1 : 0
    );
  }

  async getRecent(limit: number = 100): Promise<RelayedTextMessage[]> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    const stmt = this.db.prepare(`
      SELECT utterance_id, sender_id, sender_name, text, partial
      FROM messages
      ORDER BY id DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<{
      utterance_id: string;
      sender_id: string;
      sender_name: string;
      text: string;
      partial: number;
    }>;

    // Reverse to get oldest-first order
    return rows.reverse().map(row => ({
      type: 'text' as const,
      utteranceId: row.utterance_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      text: row.text,
      partial: row.partial === 1,
    }));
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('SQLiteStore not connected');
    this.db.exec('DELETE FROM messages');
  }
}
