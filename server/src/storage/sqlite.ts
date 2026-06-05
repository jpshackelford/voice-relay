import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RelayedTextMessage } from '../types.js';
import type { MessageStore } from './types.js';
import { Migrator } from './migrator.js';
import { getMigrations } from './migrations/index.js';
import { normalizeOhTimestamp } from '../utils/timestamp.js';

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

    // Configure pragmas BEFORE migrations run. journal_mode is persisted to
    // the database header (so it sticks across opens); the other three are
    // per-connection and must be re-applied every time connect() runs.
    //
    // Order:
    //   journal_mode=WAL    persistent; better read/write concurrency
    //   foreign_keys=ON     per-connection; enforces declared FKs + cascades
    //   synchronous=NORMAL  per-connection; safe pairing with WAL
    //   busy_timeout=5000   per-connection; explicit retry window on lock contention
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');

    // Fail-fast: if FK enforcement is not actually on we want to know at
    // startup rather than discovering a silent integrity issue in production.
    const fk = this.db.pragma('foreign_keys', { simple: true });
    if (fk !== 1) {
      throw new Error(
        `[SQLiteStore] foreign_keys pragma not enabled (got ${String(fk)}). ` +
          'Refusing to start to avoid silent referential integrity loss.'
      );
    }

    // Run migrations
    if (!this.skipMigrations) {
      const migrator = new Migrator({
        db: this.db,
        migrations: getMigrations(),
      });

      // Drift detection: warn loudly on hash mismatch, never block.
      for (const drift of migrator.detectDrift()) {
        if (drift.currentHash === '') {
          console.warn(
            `[SQLiteStore] DRIFT: migration ${drift.version}_${drift.name} is applied ` +
              `but no matching file exists in the codebase`
          );
        } else {
          console.warn(
            `[SQLiteStore] DRIFT: applied migration ${drift.version}_${drift.name} has been edited ` +
              `(stored hash=${drift.storedHash?.slice(0, 12)}…, current hash=${drift.currentHash.slice(0, 12)}…)`
          );
        }
      }

      const pending = migrator.getPending();
      if (pending.length > 0) {
        // AUTO_MIGRATE controls whether we apply pending migrations at boot.
        // Defaults to true to preserve the existing behaviour production
        // depends on; set AUTO_MIGRATE=false in prod and run `npm run db:migrate`
        // ahead of the deploy that requires them.
        const autoMigrate =
          (process.env.AUTO_MIGRATE ?? 'true').toLowerCase() !== 'false';
        if (!autoMigrate) {
          const list = pending.map(m => `${m.version}_${m.name}`).join(', ');
          throw new Error(
            `[SQLiteStore] ${pending.length} pending migration(s) and AUTO_MIGRATE=false. ` +
              `Pending: ${list}. Run: npm run db:migrate`
          );
        }
        console.log(`[SQLiteStore] ${pending.length} pending migration(s)`);
        const result = await migrator.migrateUp();
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
      INSERT INTO messages (utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial, speaker_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.utteranceId,
      message.workspaceId,
      message.sessionId ?? null,
      message.senderId,
      message.senderName,
      message.text,
      message.partial ? 1 : 0,
      message.speakerId ?? null
    );
  }

  async getRecent(limit: number = 100, workspaceId?: string): Promise<RelayedTextMessage[]> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    // Filter by workspace if provided
    const sql = workspaceId
      ? `SELECT utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial, created_at, speaker_id
         FROM messages
         WHERE workspace_id = ?
         ORDER BY id DESC
         LIMIT ?`
      : `SELECT utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial, created_at, speaker_id
         FROM messages
         ORDER BY id DESC
         LIMIT ?`;

    const stmt = this.db.prepare(sql);
    const rows = (workspaceId ? stmt.all(workspaceId, limit) : stmt.all(limit)) as MessageRow[];

    // Reverse to get oldest-first order
    return rows.reverse().map(rowToMessage);
  }

  async getRecentBySession(limit: number, sessionId: string): Promise<RelayedTextMessage[]> {
    if (!this.db) throw new Error('SQLiteStore not connected');

    const stmt = this.db.prepare(`
      SELECT utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial, created_at, speaker_id
      FROM messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);

    const rows = stmt.all(sessionId, limit) as MessageRow[];

    // Reverse to get oldest-first order
    return rows.reverse().map(rowToMessage);
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('SQLiteStore not connected');
    this.db.exec('DELETE FROM messages');
  }
}

interface MessageRow {
  utterance_id: string;
  workspace_id: string | null;
  session_id: string | null;
  sender_id: string;
  sender_name: string;
  text: string;
  partial: number;
  /**
   * SQLite stores `created_at` as a string. The default value from
   * `datetime('now')` is naive UTC with a space separator
   * (e.g. `2026-05-21 23:46:59`). We normalize on read so consumers always
   * see an ISO Zulu form (issue #264).
   */
  created_at: string | null;
  speaker_id: string | null;
}

function rowToMessage(row: MessageRow): RelayedTextMessage {
  const createdAt = normalizeOhTimestamp(row.created_at ?? undefined);
  return {
    type: 'text' as const,
    utteranceId: row.utterance_id,
    workspaceId: row.workspace_id || 'default',
    sessionId: row.session_id ?? undefined,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text,
    partial: row.partial === 1,
    ...(createdAt && { createdAt }),
    ...(row.speaker_id ? { speakerId: row.speaker_id } : {}),
  };
}
