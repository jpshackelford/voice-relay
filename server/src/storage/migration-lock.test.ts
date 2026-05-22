import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { SQLiteTableLock } from './migration-lock.js';

describe('SQLiteTableLock', () => {
  // Use a real file rather than :memory: so multiple Database handles can
  // open the same database (required to exercise cross-connection contention).
  let tmp: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'vr-lock-'));
    dbPath = join(tmp, 'lock.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates the _migrations_lock sentinel table', () => {
    new SQLiteTableLock(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations_lock'`)
      .all();
    expect(tables).toHaveLength(1);
  });

  it('acquires and releases successfully', async () => {
    const lock = new SQLiteTableLock(db);
    await lock.acquire(1_000);
    const row = db.prepare('SELECT COUNT(*) AS n FROM _migrations_lock').get() as { n: number };
    expect(row.n).toBe(1);
    await lock.release();
    const after = db.prepare('SELECT COUNT(*) AS n FROM _migrations_lock').get() as { n: number };
    expect(after.n).toBe(0);
  });

  it('refuses re-acquire on the same instance', async () => {
    const lock = new SQLiteTableLock(db);
    await lock.acquire(500);
    await expect(lock.acquire(100)).rejects.toThrow(/already held/);
    await lock.release();
  });

  it('release without acquire is a no-op (warns) and does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const lock = new SQLiteTableLock(db);
      await expect(lock.release()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('times out when another holder has the lock', async () => {
    const db2 = new Database(dbPath);
    try {
      const a = new SQLiteTableLock(db, { retryIntervalMs: 25, owner: 'A' });
      const b = new SQLiteTableLock(db2, { retryIntervalMs: 25, owner: 'B' });
      await a.acquire(500);
      const start = Date.now();
      await expect(b.acquire(150)).rejects.toThrow(/timed out/);
      // Give the timeout some slack; just confirm we did wait.
      expect(Date.now() - start).toBeGreaterThanOrEqual(100);
      await a.release();
    } finally {
      db2.close();
    }
  });

  it('second waiter acquires after the first releases', async () => {
    const db2 = new Database(dbPath);
    try {
      const a = new SQLiteTableLock(db, { retryIntervalMs: 25, owner: 'A' });
      const b = new SQLiteTableLock(db2, { retryIntervalMs: 25, owner: 'B' });
      await a.acquire(500);

      const bAcquire = b.acquire(2_000);
      // Let B try-and-fail a couple of times, then release A.
      setTimeout(() => {
        void a.release();
      }, 100);

      await bAcquire;
      const row = db
        .prepare('SELECT owner FROM _migrations_lock WHERE id = 1')
        .get() as { owner: string };
      expect(row.owner).toBe('B');
      await b.release();
    } finally {
      db2.close();
    }
  });

  it('force-releases a stale lock and acquires', async () => {
    // Manually plant a stale row.
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO _migrations_lock (id, owner, acquired_at) VALUES (1, 'ghost', '1970-01-01 00:00:00')`
    ).run();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const lock = new SQLiteTableLock(db, { staleAfterMs: 10, owner: 'live' });
      await lock.acquire(500);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('force-releasing stale lock')
      );
      const row = db
        .prepare('SELECT owner FROM _migrations_lock WHERE id = 1')
        .get() as { owner: string };
      expect(row.owner).toBe('live');
      await lock.release();
    } finally {
      warn.mockRestore();
    }
  });

  it('owner check prevents release from clobbering another holder', async () => {
    const lockA = new SQLiteTableLock(db, { owner: 'A' });
    await lockA.acquire(500);
    // Simulate a stale-takeover scenario: pretend A's lock was forcibly
    // taken by B while A is still alive.
    db.prepare(`UPDATE _migrations_lock SET owner = 'B' WHERE id = 1`).run();
    await lockA.release();
    // The row owned by B must still be there.
    const row = db
      .prepare('SELECT owner FROM _migrations_lock WHERE id = 1')
      .get() as { owner: string } | undefined;
    expect(row?.owner).toBe('B');
  });
});
