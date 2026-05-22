import { hostname } from 'os';
import type Database from 'better-sqlite3';

/**
 * Driver-agnostic mutual-exclusion lock for migrations.
 *
 * Implementations are responsible for serializing concurrent migration
 * runners against the same database. Only `acquire` and `release` are
 * exposed deliberately — no `isHeld` / `owner` / introspection — so
 * callers cannot accidentally depend on driver-specific semantics
 * (SQLite uses a sentinel row + stale TTL; Postgres uses session-scoped
 * `pg_advisory_lock`).
 */
export interface MigrationLock {
  /** Acquire the lock or throw if it cannot be acquired within `timeoutMs`. */
  acquire(timeoutMs: number): Promise<void>;
  /** Release the lock. Safe to call after a successful acquire. */
  release(): Promise<void>;
}

/** Default time after which an unreleased lock row is considered stale. */
export const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

/** Default poll interval while waiting on a contested lock. */
export const DEFAULT_RETRY_INTERVAL_MS = 250;

interface LockRow {
  id: number;
  owner: string;
  acquired_at: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * SQLite implementation of {@link MigrationLock} using a single-row
 * sentinel table (`_migrations_lock`). Acquisition takes SQLite's write
 * lock (`BEGIN IMMEDIATE`) for the brief duration of the insert, then
 * commits — the per-migration transactions run independently.
 *
 * Stale rows older than `staleAfterMs` are force-released with a warning.
 * The owner check on `release()` prevents a process from accidentally
 * nuking another holder's row after a stale takeover.
 */
export class SQLiteTableLock implements MigrationLock {
  private readonly db: Database.Database;
  private readonly staleAfterMs: number;
  private readonly retryIntervalMs: number;
  private readonly owner: string;
  private heldOwner: string | null = null;

  constructor(
    db: Database.Database,
    options: {
      staleAfterMs?: number;
      retryIntervalMs?: number;
      owner?: string;
    } = {}
  ) {
    this.db = db;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.owner = options.owner ?? `${hostname()}:${process.pid}`;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      )
    `);
  }

  /**
   * Attempt a single acquire pass inside `BEGIN IMMEDIATE`. Returns true if
   * the lock is now held by this owner. Caller polls until success or timeout.
   */
  private tryAcquireOnce(): boolean {
    let acquired = false;
    const txn = this.db.transaction(() => {
      // Look for an existing row first; if it is stale we delete it so the
      // INSERT below succeeds.
      const existing = this.db
        .prepare<[], LockRow>('SELECT id, owner, acquired_at FROM _migrations_lock WHERE id = 1')
        .get();

      if (existing) {
        const acquiredAtMs = Date.parse(`${existing.acquired_at}Z`);
        const isStale =
          Number.isFinite(acquiredAtMs) && Date.now() - acquiredAtMs > this.staleAfterMs;
        if (isStale) {
          console.warn(
            `[MigrationLock] force-releasing stale lock held by ${existing.owner} ` +
              `since ${existing.acquired_at}`
          );
          this.db.prepare('DELETE FROM _migrations_lock WHERE id = 1').run();
        } else {
          return; // still held, leave acquired=false
        }
      }

      const nowIso = new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO _migrations_lock (id, owner, acquired_at) VALUES (1, ?, ?)`
        )
        .run(this.owner, nowIso);
      acquired = result.changes === 1;
    });
    // BEGIN IMMEDIATE: serializes write contenders so only one process runs
    // the body at a time.
    txn.immediate();
    return acquired;
  }

  async acquire(timeoutMs: number): Promise<void> {
    if (this.heldOwner !== null) {
      throw new Error('[MigrationLock] acquire() called while lock is already held by this instance');
    }
    const deadline = Date.now() + Math.max(0, timeoutMs);
    // First attempt without sleeping.
    if (this.tryAcquireOnce()) {
      this.heldOwner = this.owner;
      return;
    }
    while (Date.now() < deadline) {
      await sleep(this.retryIntervalMs);
      if (this.tryAcquireOnce()) {
        this.heldOwner = this.owner;
        return;
      }
    }
    throw new Error(
      `[MigrationLock] timed out after ${timeoutMs}ms waiting for _migrations_lock`
    );
  }

  async release(): Promise<void> {
    if (this.heldOwner === null) {
      // Idempotent: never throw on double-release; surface a warning so
      // misuse is visible without breaking the caller's finally block.
      console.warn('[MigrationLock] release() called without holding the lock');
      return;
    }
    const owner = this.heldOwner;
    this.heldOwner = null;
    // Owner check: avoids deleting another process's row after a stale
    // takeover let someone else in while we slept.
    this.db.prepare('DELETE FROM _migrations_lock WHERE id = 1 AND owner = ?').run(owner);
  }
}
