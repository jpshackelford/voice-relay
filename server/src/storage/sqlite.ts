import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RelayedTextMessage } from '../types.js';
import type { MessageStore } from './types.js';
import { Migrator } from './migrator.js';
import { getMigrations } from './migrations/index.js';

export interface SQLiteStoreOptions {
  path: string;
  /** If true, skip migrations (for testing) */
  skipMigrations?: boolean;
}

export class SQLiteStore implements MessageStore {
  private db: Database.Database | null = null;
  private readonly path: string;
  private readonly skipMigrations: boolean;

  constructor(options: SQLiteStoreOptions) {
    this.path = options.path;
    this.skipMigrations = options.skipMigrations ?? false;
  }

  async connect(): Promise<void> {
    // Ensure directory exists
    mkdirSync(dirname(this.path), { recursive: true });
    
    this.db = new Database(this.path);
    
    // Run migrations
    if (!this.skipMigrations) {
      const migrator = new Migrator({
        db: this.db,
        migrations: getMigrations(),
      });
      
      const pending = migrator.getPending();
      if (pending.length > 0) {
        console.log(`[SQLiteStore] ${pending.length} pending migration(s)`);
        const result = migrator.migrateUp();
        console.log(`[SQLiteStore] Applied ${result.applied} migration(s):`, result.migrations);
      } else {
        console.log(`[SQLiteStore] Schema up to date (version ${migrator.getCurrentVersion()})`);
      }
    }

    console.log('[SQLiteStore] Connected to', this.path);
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
    console.log('[SQLiteStore] Disconnected');
  }

  /** Get the underlying database instance (for migrations/testing) */
  getDatabase(): Database.Database | null {
    return this.db;
  }

  async append(message: RelayedTextMessage): Promise<void> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    const stmt = this.db.prepare(`
      INSERT INTO messages (utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.utteranceId,
      message.workspaceId,
      message.sessionId ?? null,
      message.senderId,
      message.senderName,
      message.text,
      message.partial ? 1 : 0
    );
  }

  async getRecent(limit: number = 100, workspaceId?: string): Promise<RelayedTextMessage[]> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    // Filter by workspace if provided
    const sql = workspaceId
      ? `SELECT utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial
         FROM messages
         WHERE workspace_id = ?
         ORDER BY id DESC
         LIMIT ?`
      : `SELECT utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial
         FROM messages
         ORDER BY id DESC
         LIMIT ?`;

    const stmt = this.db.prepare(sql);
    const rows = (workspaceId ? stmt.all(workspaceId, limit) : stmt.all(limit)) as Array<{
      utterance_id: string;
      workspace_id: string | null;
      session_id: string | null;
      sender_id: string;
      sender_name: string;
      text: string;
      partial: number;
    }>;

    // Reverse to get oldest-first order
    return rows.reverse().map(row => ({
      type: 'text' as const,
      utteranceId: row.utterance_id,
      workspaceId: row.workspace_id || 'default',
      sessionId: row.session_id ?? undefined,
      senderId: row.sender_id,
      senderName: row.sender_name,
      text: row.text,
      partial: row.partial === 1,
    }));
  }

  async getRecentBySession(limit: number, sessionId: string): Promise<RelayedTextMessage[]> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    const stmt = this.db.prepare(`
      SELECT utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial
      FROM messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);

    const rows = stmt.all(sessionId, limit) as Array<{
      utterance_id: string;
      workspace_id: string | null;
      session_id: string | null;
      sender_id: string;
      sender_name: string;
      text: string;
      partial: number;
    }>;

    // Reverse to get oldest-first order
    return rows.reverse().map(row => ({
      type: 'text' as const,
      utteranceId: row.utterance_id,
      workspaceId: row.workspace_id || 'default',
      sessionId: row.session_id ?? undefined,
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
