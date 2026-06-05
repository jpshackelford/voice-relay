import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../migrator.js';
import { migrations } from './index.js';

/**
 * Verifies migration 018 (per-kiosk active sessions, issue #393):
 *   - additive `sessions.target_kiosk_device_id` column;
 *   - partial index on `(target_kiosk_device_id, status)`;
 *   - the up direction does not touch existing session rows;
 *   - ON DELETE SET NULL on the FK to `devices`;
 *   - down rebuilds the legacy schema and preserves session rows;
 *   - up → down → up round-trips cleanly;
 *   - re-running `migrateUp` is idempotent.
 */
describe('migration 018: session_target_kiosk', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  async function migrateAll() {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();
  }

  function getColumns(table: string): string[] {
    const rows = db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  function indexExists(name: string): boolean {
    const row = db
      .prepare(
        `SELECT 1 AS x FROM sqlite_master WHERE type='index' AND name = ?`,
      )
      .get(name) as { x: number } | undefined;
    return !!row;
  }

  function seedKiosk(deviceId = 'kiosk-1'): { workspaceId: string; deviceId: string } {
    const workspaceId = 'ws-1';
    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`,
    ).run('u1', 1, 'alice', 'Alice');
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`,
    ).run(workspaceId, 'u1', 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
    ).run(deviceId, workspaceId, `Kiosk ${deviceId}`, 'kiosk');
    return { workspaceId, deviceId };
  }

  it('adds target_kiosk_device_id as a nullable column on sessions', async () => {
    await migrateAll();

    const cols = getColumns('sessions');
    expect(cols).toContain('target_kiosk_device_id');

    // PRAGMA confirms the column is nullable (notnull == 0).
    const colInfo = db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const target = colInfo.find((c) => c.name === 'target_kiosk_device_id');
    expect(target).toBeDefined();
    expect(target!.notnull).toBe(0);
    expect(target!.dflt_value).toBeNull();
  });

  it('creates the partial picker-lookup index', async () => {
    await migrateAll();
    expect(indexExists('idx_sessions_target_kiosk')).toBe(true);
  });

  it('leaves pre-existing sessions with NULL target_kiosk_device_id on up-migrate', async () => {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(17);

    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username) VALUES (?, ?, ?)`,
    ).run('u1', 1, 'alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`,
    ).run('ws-1', 'u1', 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name, status) VALUES (?, ?, ?, 'active')`,
    ).run('sess-pre', 'ws-1', 'Pre-migration session');

    await migrator.migrateUp();

    const row = db
      .prepare(`SELECT id, target_kiosk_device_id FROM sessions WHERE id = ?`)
      .get('sess-pre') as { id: string; target_kiosk_device_id: string | null };
    expect(row.id).toBe('sess-pre');
    expect(row.target_kiosk_device_id).toBeNull();
  });

  it('sets target_kiosk_device_id to NULL when the kiosk is deleted (ON DELETE SET NULL)', async () => {
    await migrateAll();
    db.pragma('foreign_keys = ON');

    const { workspaceId, deviceId } = seedKiosk();
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name, status, target_kiosk_device_id)
       VALUES (?, ?, ?, 'active', ?)`,
    ).run('sess-1', workspaceId, 'Bound', deviceId);

    db.prepare(`DELETE FROM devices WHERE id = ?`).run(deviceId);

    const row = db
      .prepare(`SELECT target_kiosk_device_id FROM sessions WHERE id = ?`)
      .get('sess-1') as { target_kiosk_device_id: string | null };
    expect(row.target_kiosk_device_id).toBeNull();
  });

  it('round-trips: up -> down -> up restores the column and preserves session rows', async () => {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(17);

    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username) VALUES (?, ?, ?)`,
    ).run('u1', 1, 'alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`,
    ).run('ws-1', 'u1', 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name, status) VALUES (?, ?, ?, 'active')`,
    ).run('sess-rt', 'ws-1', 'Round-trip session');

    await migrator.migrateUp();
    expect(getColumns('sessions')).toContain('target_kiosk_device_id');

    await migrator.migrateTo(17);
    expect(getColumns('sessions')).not.toContain('target_kiosk_device_id');
    expect(indexExists('idx_sessions_target_kiosk')).toBe(false);

    // The row survives the rebuild.
    const after = db
      .prepare(`SELECT id, name, status FROM sessions WHERE id = ?`)
      .get('sess-rt') as { id: string; name: string; status: string };
    expect(after.id).toBe('sess-rt');
    expect(after.name).toBe('Round-trip session');
    expect(after.status).toBe('active');

    await migrator.migrateUp();
    expect(getColumns('sessions')).toContain('target_kiosk_device_id');
    expect(indexExists('idx_sessions_target_kiosk')).toBe(true);
  });

  it('is idempotent against a re-run of migrateUp()', async () => {
    await migrateAll();
    await expect(migrateAll()).resolves.not.toThrow();
    const rows = db
      .prepare(`SELECT version FROM _migrations WHERE version = ?`)
      .all(18);
    expect(rows).toHaveLength(1);
  });
});
