import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { SQLiteTableLock, type MigrationLock } from './migration-lock.js';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
  /**
   * When true, the `down` of this migration drops a table or column holding
   * user data. The CLI rollback path refuses to roll back destructive
   * migrations without an explicit `--confirm-destructive` flag.
   */
  destructive?: boolean;
}

export interface MigratorOptions {
  db: Database.Database;
  migrations: Migration[];
  /**
   * Optional lock factory. When provided, `migrateUp` / `migrateDown` /
   * `migrateTo` acquire the lock before doing work. Default: a
   * {@link SQLiteTableLock} bound to the same database.
   */
  lock?: MigrationLock;
  /** How long to wait when acquiring the lock. Default: 30s. */
  lockTimeoutMs?: number;
}

export interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
  duration_ms: number | null;
  sql_hash: string | null;
}

export interface DriftRecord {
  version: number;
  name: string;
  storedHash: string | null;
  currentHash: string;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/**
 * Normalize SQL prior to hashing. CRLF and trailing whitespace are
 * stripped (catches Git autocrlf churn); internal whitespace is preserved
 * so cosmetic reformatting of an applied migration triggers a warning —
 * any edit to applied SQL is suspicious by default.
 */
export function normalizeSqlForHashing(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+$/, ''))
    .join('\n')
    .replace(/^\s+|\s+$/g, '');
}

export function hashMigrationSql(sql: string): string {
  return createHash('sha256').update(normalizeSqlForHashing(sql)).digest('hex');
}

/**
 * Database migration runner.
 * Tracks applied migrations and runs pending ones on startup.
 */
export class Migrator {
  private readonly db: Database.Database;
  private readonly migrations: Migration[];
  private readonly lock: MigrationLock;
  private readonly lockTimeoutMs: number;
  private backfilled = false;

  constructor(options: MigratorOptions) {
    this.db = options.db;
    this.migrations = options.migrations.slice().sort((a, b) => a.version - b.version);
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.ensureMigrationsTable();
    this.ensureForensicColumns();
    // Lock must come last; it creates its own table and relies on the DB
    // being writable. Default to a SQLite table-row lock bound to the
    // same database.
    this.lock = options.lock ?? new SQLiteTableLock(this.db);
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        duration_ms INTEGER,
        sql_hash TEXT
      )
    `);
  }

  /**
   * For databases created before this version: ALTER in any missing
   * forensic columns idempotently. PRAGMA table_info is used because
   * SQLite's `ALTER TABLE ADD COLUMN` errors if the column already
   * exists.
   */
  private ensureForensicColumns(): void {
    const info = this.db
      .prepare<[], { name: string }>(`PRAGMA table_info(_migrations)`)
      .all();
    const existing = new Set(info.map(row => row.name));
    if (!existing.has('duration_ms')) {
      this.db.exec(`ALTER TABLE _migrations ADD COLUMN duration_ms INTEGER`);
    }
    if (!existing.has('sql_hash')) {
      this.db.exec(`ALTER TABLE _migrations ADD COLUMN sql_hash TEXT`);
    }
  }

  /**
   * Backfill `sql_hash` for any applied rows that pre-date the hashing
   * feature. Runs at most once per Migrator instance. Idempotent: only
   * updates rows where `sql_hash IS NULL`.
   */
  private backfillHashes(): void {
    if (this.backfilled) return;
    this.backfilled = true;
    const rows = this.db
      .prepare<[], { version: number }>(
        `SELECT version FROM _migrations WHERE sql_hash IS NULL`
      )
      .all();
    if (rows.length === 0) return;
    const update = this.db.prepare(
      `UPDATE _migrations SET sql_hash = ? WHERE version = ? AND sql_hash IS NULL`
    );
    const txn = this.db.transaction(() => {
      for (const row of rows) {
        const migration = this.migrations.find(m => m.version === row.version);
        if (!migration) continue; // mismatch — drift will report
        update.run(hashMigrationSql(migration.up), row.version);
      }
    });
    txn();
  }

  /** Get all applied migration versions */
  getApplied(): AppliedMigration[] {
    this.backfillHashes();
    const stmt = this.db.prepare<[], AppliedMigration>(`
      SELECT version, name, applied_at, duration_ms, sql_hash
      FROM _migrations ORDER BY version ASC
    `);
    return stmt.all();
  }

  /** Get pending migrations that haven't been applied yet */
  getPending(): Migration[] {
    const applied = new Set(this.getApplied().map(m => m.version));
    return this.migrations.filter(m => !applied.has(m.version));
  }

  /** Get the current schema version (highest applied migration) */
  getCurrentVersion(): number {
    const applied = this.getApplied();
    if (applied.length === 0) return 0;
    return Math.max(...applied.map(m => m.version));
  }

  /**
   * Detect drift between the stored `sql_hash` of each applied migration
   * and the hash of the migration source currently in the codebase. Drift
   * is a developer error (an applied migration's SQL was edited) — this
   * method returns the mismatches; it never throws or blocks startup.
   */
  detectDrift(): DriftRecord[] {
    const drifts: DriftRecord[] = [];
    for (const applied of this.getApplied()) {
      const migration = this.migrations.find(m => m.version === applied.version);
      if (!migration) {
        // Applied row with no matching file in the codebase. This is itself
        // a form of drift; surface it with currentHash='' so callers can
        // distinguish from edited migrations.
        drifts.push({
          version: applied.version,
          name: applied.name,
          storedHash: applied.sql_hash,
          currentHash: '',
        });
        continue;
      }
      const currentHash = hashMigrationSql(migration.up);
      if (applied.sql_hash && applied.sql_hash !== currentHash) {
        drifts.push({
          version: applied.version,
          name: migration.name,
          storedHash: applied.sql_hash,
          currentHash,
        });
      }
    }
    return drifts;
  }

  /** Run all pending migrations */
  async migrateUp(): Promise<{ applied: number; migrations: string[] }> {
    await this.lock.acquire(this.lockTimeoutMs);
    try {
      const pending = this.getPending();
      const applied: string[] = [];

      for (const migration of pending) {
        this.runMigration(migration, 'up');
        applied.push(`${migration.version}_${migration.name}`);
      }

      return { applied: applied.length, migrations: applied };
    } finally {
      await this.lock.release();
    }
  }

  /** Roll back the most recent migration */
  async migrateDown(): Promise<{ rolledBack: string | null }> {
    await this.lock.acquire(this.lockTimeoutMs);
    try {
      const applied = this.getApplied();
      if (applied.length === 0) {
        return { rolledBack: null };
      }

      const latest = applied[applied.length - 1];
      const migration = this.migrations.find(m => m.version === latest.version);

      if (!migration) {
        throw new Error(`Migration ${latest.version} not found in codebase`);
      }

      this.runMigration(migration, 'down');
      return { rolledBack: `${migration.version}_${migration.name}` };
    } finally {
      await this.lock.release();
    }
  }

  /** Migrate to a specific version (up or down as needed) */
  async migrateTo(
    targetVersion: number
  ): Promise<{ direction: 'up' | 'down' | 'none'; count: number }> {
    await this.lock.acquire(this.lockTimeoutMs);
    try {
      const current = this.getCurrentVersion();

      if (targetVersion === current) {
        return { direction: 'none', count: 0 };
      }

      if (targetVersion > current) {
        const pending = this.getPending().filter(m => m.version <= targetVersion);
        for (const migration of pending) {
          this.runMigration(migration, 'up');
        }
        return { direction: 'up', count: pending.length };
      } else {
        const applied = this.getApplied()
          .filter(m => m.version > targetVersion)
          .reverse();

        for (const appliedMigration of applied) {
          const migration = this.migrations.find(m => m.version === appliedMigration.version);
          if (!migration) {
            throw new Error(`Migration ${appliedMigration.version} not found`);
          }
          this.runMigration(migration, 'down');
        }
        return { direction: 'down', count: applied.length };
      }
    } finally {
      await this.lock.release();
    }
  }

  private runMigration(migration: Migration, direction: 'up' | 'down'): void {
    const sql = direction === 'up' ? migration.up : migration.down;

    console.log(`[Migrator] Running ${direction}: ${migration.version}_${migration.name}`);

    const startedAt = Date.now();

    // Run in a transaction
    const transaction = this.db.transaction(() => {
      this.db.exec(sql);

      if (direction === 'up') {
        const durationMs = Date.now() - startedAt;
        const hash = hashMigrationSql(migration.up);
        this.db
          .prepare(
            `INSERT INTO _migrations (version, name, duration_ms, sql_hash) VALUES (?, ?, ?, ?)`
          )
          .run(migration.version, migration.name, durationMs, hash);
      } else {
        this.db.prepare(`DELETE FROM _migrations WHERE version = ?`).run(migration.version);
      }
    });

    transaction();
  }
}
