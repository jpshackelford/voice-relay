import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../migrator.js';
import { migrations } from './index.js';
import { migration as migration021 } from './021_backfill_devices_primary_user.js';

/**
 * Verifies migration 021 backfills `devices.primary_user_id` for
 * single-owner workspaces, leaves ambiguous/orphaned cases alone, does
 * not overwrite existing claims, and is safely re-runnable.
 *
 * Test matrix mirrors the acceptance criteria on issue #432:
 *   A. Single-owner workspace, NULL primary_user_id → set to owner.
 *   B. Multi-owner workspace → stays NULL.
 *   C. Device already claimed → unchanged.
 *   D. Workspace with no owners → stays NULL.
 *   E. Idempotency: applying the up SQL twice changes nothing on pass 2.
 */
describe('migration 021: backfill_devices_primary_user', () => {
  let db: Database.Database;
  let migrator: Migrator;

  beforeEach(async () => {
    db = new Database(':memory:');
    // Migrations should run with foreign keys enforced — that matches
    // how SQLiteStore.connect() drives the migrator in production.
    db.pragma('foreign_keys = ON');
    migrator = new Migrator({ db, migrations });
    // Land on the pre-021 schema so we can seed using the exact column
    // shapes the migration will read.
    await migrator.migrateTo(20);
  });

  afterEach(() => {
    db.close();
  });

  let githubIdSeq = 1_000;
  function insertUser(id: string, displayName: string): void {
    const githubId = ++githubIdSeq;
    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, githubId, `user_${githubId}`, displayName, '2024-01-01T00:00:00Z');
  }

  function insertWorkspace(id: string, ownerId: string): void {
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug)
       VALUES (?, ?, ?, ?)`
    ).run(id, ownerId, `Workspace ${id}`, id);
  }

  function insertMember(
    workspaceId: string,
    userId: string,
    role: 'owner' | 'member'
  ): void {
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES (?, ?, ?)`
    ).run(workspaceId, userId, role);
  }

  function insertDevice(
    id: string,
    workspaceId: string,
    primaryUserId: string | null
  ): void {
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode, primary_user_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, workspaceId, `Device ${id}`, 'kiosk', primaryUserId);
  }

  function getDevicePrimaryUser(id: string): string | null {
    const row = db
      .prepare(`SELECT primary_user_id FROM devices WHERE id = ?`)
      .get(id) as { primary_user_id: string | null } | undefined;
    return row?.primary_user_id ?? null;
  }

  it('A. backfills a single-owner workspace', async () => {
    insertUser('user-a', 'Owner A');
    insertWorkspace('ws-a', 'user-a');
    insertMember('ws-a', 'user-a', 'owner');
    insertDevice('dev-a', 'ws-a', null);

    await migrator.migrateUp();

    expect(getDevicePrimaryUser('dev-a')).toBe('user-a');
  });

  it('B. leaves multi-owner workspaces NULL', async () => {
    insertUser('user-b1', 'Owner B1');
    insertUser('user-b2', 'Owner B2');
    insertWorkspace('ws-b', 'user-b1');
    insertMember('ws-b', 'user-b1', 'owner');
    insertMember('ws-b', 'user-b2', 'owner');
    insertDevice('dev-b', 'ws-b', null);

    await migrator.migrateUp();

    expect(getDevicePrimaryUser('dev-b')).toBeNull();
  });

  it('C. does not overwrite an already-claimed device', async () => {
    insertUser('user-c-owner', 'Owner C');
    insertUser('user-c-member', 'Member C');
    insertWorkspace('ws-c', 'user-c-owner');
    insertMember('ws-c', 'user-c-owner', 'owner');
    insertMember('ws-c', 'user-c-member', 'member');
    // Device is already claimed by the *member*, not the owner.
    insertDevice('dev-c', 'ws-c', 'user-c-member');

    await migrator.migrateUp();

    expect(getDevicePrimaryUser('dev-c')).toBe('user-c-member');
  });

  it('D. leaves NULL when the workspace has no owners', async () => {
    insertUser('user-d', 'Lone Member D');
    insertWorkspace('ws-d', 'user-d');
    // Only a 'member' row — no 'owner' role at all.
    insertMember('ws-d', 'user-d', 'member');
    insertDevice('dev-d', 'ws-d', null);

    await migrator.migrateUp();

    expect(getDevicePrimaryUser('dev-d')).toBeNull();
  });

  it('E. is idempotent: re-running the up SQL changes nothing', async () => {
    insertUser('user-e', 'Owner E');
    insertWorkspace('ws-e', 'user-e');
    insertMember('ws-e', 'user-e', 'owner');
    insertDevice('dev-e', 'ws-e', null);

    await migrator.migrateUp();
    expect(getDevicePrimaryUser('dev-e')).toBe('user-e');

    // Re-applying the migration's own up SQL should be a no-op:
    // the value remains unchanged and db.exec returns the db handle
    // without throwing. This mirrors migration 017's idempotency test
    // and avoids duplicating the migration SQL in the test.
    const result = db.exec(migration021.up);
    expect(getDevicePrimaryUser('dev-e')).toBe('user-e');
    expect(result).toBe(db);
  });

  it('processes a mixed workload in a single up pass', async () => {
    // Single-owner WS that should be backfilled.
    insertUser('user-1', 'Solo');
    insertWorkspace('ws-1', 'user-1');
    insertMember('ws-1', 'user-1', 'owner');
    insertDevice('dev-1', 'ws-1', null);

    // Multi-owner WS that should NOT be touched.
    insertUser('user-2a', 'Co-owner A');
    insertUser('user-2b', 'Co-owner B');
    insertWorkspace('ws-2', 'user-2a');
    insertMember('ws-2', 'user-2a', 'owner');
    insertMember('ws-2', 'user-2b', 'owner');
    insertDevice('dev-2', 'ws-2', null);

    // Already-claimed device that must be preserved.
    insertUser('user-3', 'Other Owner');
    insertUser('user-3-extra', 'Already Claimed');
    insertWorkspace('ws-3', 'user-3');
    insertMember('ws-3', 'user-3', 'owner');
    insertDevice('dev-3', 'ws-3', 'user-3-extra');

    await migrator.migrateUp();

    expect(getDevicePrimaryUser('dev-1')).toBe('user-1');
    expect(getDevicePrimaryUser('dev-2')).toBeNull();
    expect(getDevicePrimaryUser('dev-3')).toBe('user-3-extra');
  });

  it('down is a no-op for the data side', async () => {
    insertUser('user-down', 'Down Owner');
    insertWorkspace('ws-down', 'user-down');
    insertMember('ws-down', 'user-down', 'owner');
    insertDevice('dev-down', 'ws-down', null);

    await migrator.migrateUp();
    expect(getDevicePrimaryUser('dev-down')).toBe('user-down');

    // Roll back 021 only. The data should survive — only 017 can drop
    // the column.
    await migrator.migrateTo(20);

    expect(getDevicePrimaryUser('dev-down')).toBe('user-down');
  });

  it('is registered in the migrations index at version 21', () => {
    // Guards against forgetting the import + append in
    // migrations/index.ts.
    const v21 = migrations.find((m) => m.version === 21);
    expect(v21).toBeDefined();
    expect(v21?.name).toBe('backfill_devices_primary_user');
    expect(v21?.destructive).toBe(false);
  });
});
