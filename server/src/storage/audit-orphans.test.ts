import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { SQLiteStore } from './sqlite.js';
import { auditOrphans, formatOrphanReport, ORPHAN_CHECKS } from './audit-orphans.js';

describe('audit-orphans (#262)', () => {
  let store: SQLiteStore;
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `voice-relay-audit-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'audit.db');
    store = new SQLiteStore({ path: dbPath });
    await store.connect();
  });

  afterEach(async () => {
    await store.disconnect();
    rmSync(testDir, { recursive: true, force: true });
  });

  /**
   * Insert orphan rows by temporarily turning FK enforcement OFF on the
   * connection — that's the only way to reproduce the "schema says NO, the
   * data says YES" state that this audit exists to find.
   */
  const insertOrphan = (sql: string, params: unknown[] = []): void => {
    const db = store.getDatabase()!;
    db.pragma('foreign_keys = OFF');
    try {
      db.prepare(sql).run(...params);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  };

  it('returns zero orphans on a freshly migrated, empty database', () => {
    const db = store.getDatabase()!;
    const { results, totalOrphans } = auditOrphans(db);
    expect(totalOrphans).toBe(0);
    // Every check should have run (no skips) and reported 0.
    expect(results.every(r => !r.skipped)).toBe(true);
    expect(results.every(r => r.count === 0)).toBe(true);
  });

  it('detects every FK class of orphan (cascade, set-null, restrict)', () => {
    // Insert orphan rows representative of each FK category:
    //  - cascade:  devices.workspace_id pointing nowhere
    //  - set-null: messages.session_id pointing nowhere
    //  - restrict: workspaces.owner_id pointing nowhere
    insertOrphan(
      `INSERT INTO devices (id, workspace_id, name, mode, created_at)
       VALUES ('d-orphan', 'ws-missing', 'dev', 'speaker', datetime('now'))`
    );
    insertOrphan(
      `INSERT INTO messages (utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial)
       VALUES ('u-orphan', 'ws-missing', 'sess-missing', 'sender', 'Sender', 'hi', 0)`
    );
    insertOrphan(
      `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at)
       VALUES ('w-bad-owner', 'user-missing', 'WS', 'slug-bad', 'CODE', datetime('now'))`
    );

    const db = store.getDatabase()!;
    const { results, totalOrphans } = auditOrphans(db);

    const byLabel = new Map(results.map(r => [r.label, r]));
    expect(byLabel.get('devices.workspace_id -> workspaces.id')?.count).toBe(1);
    expect(byLabel.get('messages.session_id -> sessions.id (SET NULL)')?.count).toBe(1);
    expect(byLabel.get('workspaces.owner_id -> users.id (RESTRICT)')?.count).toBe(1);
    // Plus the inserted bad workspace itself shows up as an orphan parent for
    // its dependent rows (devices+messages we inserted with ws-missing, not
    // w-bad-owner). So those counts above are the only orphans.
    expect(totalOrphans).toBe(3);
  });

  it('does NOT flag rows whose FK column is legitimately NULL', () => {
    // Seed a valid user → workspace → message-with-no-session.
    const db = store.getDatabase()!;
    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES ('u1', 1, 'u1', datetime('now'), datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at)
       VALUES ('w1', 'u1', 'WS', 'slug-1', 'C1', datetime('now'))`
    ).run();
    // Message with session_id IS NULL (legitimate — column is nullable)
    db.prepare(
      `INSERT INTO messages (utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial)
       VALUES ('u-null-session', 'w1', NULL, 'sender', 'Sender', 'hi', 0)`
    ).run();

    const { totalOrphans } = auditOrphans(db);
    expect(totalOrphans).toBe(0);
  });

  it('migration 013 cleans up exactly the orphans the audit reports', async () => {
    // Seed orphans before re-running migrations: we open a fresh store,
    // skipMigrations=true, run migrations 001-011 manually then insert
    // orphans, then re-open with full migrations so 013 runs.

    // 1) Insert orphans into the current (already-migrated) DB.
    insertOrphan(
      `INSERT INTO devices (id, workspace_id, name, mode, created_at)
       VALUES ('d-orphan-a', 'ws-missing', 'dev', 'speaker', datetime('now'))`
    );
    insertOrphan(
      `INSERT INTO devices (id, workspace_id, name, mode, created_at)
       VALUES ('d-orphan-b', 'ws-missing', 'dev', 'speaker', datetime('now'))`
    );
    insertOrphan(
      `INSERT INTO messages (utterance_id, workspace_id, session_id, sender_id, sender_name, text, partial)
       VALUES ('u-orphan', 'ws-missing', 'sess-missing', 'sender', 'Sender', 'hi', 0)`
    );

    // 2) Force the migration tracking row for 013 to be absent so that the
    //    next `connect()` re-runs it. (013 is idempotent — it's just DELETEs.)
    const db = store.getDatabase()!;
    db.prepare('DELETE FROM _migrations WHERE version = 13').run();

    // Confirm the orphans are present and the audit sees them.
    const before = auditOrphans(db);
    expect(before.totalOrphans).toBeGreaterThanOrEqual(3);

    // 3) Reconnect — this re-runs pending migrations including 013.
    await store.disconnect();
    store = new SQLiteStore({ path: dbPath });
    await store.connect();

    // 4) Audit again: all CASCADE/SET-NULL orphans we created must be gone.
    const after = auditOrphans(store.getDatabase()!);
    const byLabel = new Map(after.results.map(r => [r.label, r]));
    expect(byLabel.get('devices.workspace_id -> workspaces.id')?.count).toBe(0);
    // messages.session_id is SET-NULL'd, not deleted — the row stays but
    // the FK column should be null, so the audit no longer flags it.
    expect(byLabel.get('messages.session_id -> sessions.id (SET NULL)')?.count).toBe(0);
  });

  it('formats a human-readable report with a total line', () => {
    const db = store.getDatabase()!;
    const report = auditOrphans(db);
    const text = formatOrphanReport(dbPath, report);
    expect(text).toContain('# voice-relay orphan audit');
    expect(text).toContain(`# database: ${dbPath}`);
    expect(text).toContain('total orphans: 0');
    // Every declared check should appear.
    for (const c of ORPHAN_CHECKS) {
      expect(text).toContain(c.label);
    }
  });

  it('skips checks whose tables do not exist (forward-compatibility)', () => {
    // Open a brand-new DB with only the users table present. The audit must
    // not crash; it should skip checks whose tables are missing.
    const isolatedPath = join(testDir, 'isolated.db');
    const isolated = new Database(isolatedPath);
    isolated.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        github_id INTEGER UNIQUE NOT NULL,
        username TEXT NOT NULL,
        created_at TEXT,
        last_login_at TEXT
      )
    `);

    const { results, totalOrphans } = auditOrphans(isolated);
    isolated.close();

    expect(totalOrphans).toBe(0);
    // Most checks reference tables that don't exist in this minimal DB, so
    // they should be marked skipped.
    expect(results.some(r => r.skipped)).toBe(true);
    const skipReasons = results.filter(r => r.skipped).map(r => r.skipReason);
    expect(skipReasons.every(reason => reason !== undefined)).toBe(true);
  });

  it('skips checks whose FK column has been dropped (forward-compatibility)', () => {
    // Build a DB where both tables exist but the FK column is missing on the
    // child. Future migrations that drop a column should not crash the audit.
    const isolatedPath = join(testDir, 'no-col.db');
    const isolated = new Database(isolatedPath);
    isolated.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY);
      -- workspace_members exists but is missing the user_id column.
      CREATE TABLE workspace_members (workspace_id TEXT, role TEXT);
    `);

    const { results } = auditOrphans(isolated);
    isolated.close();

    const userIdCheck = results.find(
      r => r.label === 'workspace_members.user_id -> users.id'
    );
    expect(userIdCheck?.skipped).toBe(true);
    expect(userIdCheck?.skipReason).toMatch(/column missing.*workspace_members\.user_id/);
  });

  it('formatOrphanReport renders non-zero orphan counts inline', () => {
    insertOrphan(
      `INSERT INTO devices (id, workspace_id, name, mode, created_at)
       VALUES ('d-orphan', 'ws-missing', 'dev', 'speaker', datetime('now'))`
    );
    const text = formatOrphanReport(dbPath, auditOrphans(store.getDatabase()!));
    expect(text).toContain('total orphans: 1');
    // The cascade label line should show "1" in the orphan count column.
    expect(text).toMatch(/devices\.workspace_id -> workspaces\.id\s+\|\s+cascade\s+\|\s+1/);
  });
});
