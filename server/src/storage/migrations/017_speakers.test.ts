import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../migrator.js';
import { migrations } from './index.js';

/**
 * Verifies migration 017 (speaker identity model) creates the expected
 * schema, preserves existing user / device / message rows when run
 * against a populated DB, and round-trips up → down → up cleanly.
 *
 * Acceptance criteria covered:
 *   - users is provider-agnostic; existing rows migrated.
 *   - GitHub becomes one row per user in auth_identities.
 *   - speakers, session_devices.active_speaker_id, messages.speaker_id exist.
 *   - Existing messages and session_devices rows continue to round-trip.
 */
describe('migration 017: speakers', () => {
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

  function tableExists(name: string): boolean {
    const row = db
      .prepare(
        `SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?`
      )
      .get(name) as { x: number } | undefined;
    return !!row;
  }

  it('creates auth_identities, speakers, and adds the additive columns on a fresh DB', async () => {
    await migrateAll();

    expect(tableExists('auth_identities')).toBe(true);
    expect(tableExists('speakers')).toBe(true);

    // \`users\` keeps its existing columns; this migration is additive.
    expect(getColumns('users')).toEqual(
      expect.arrayContaining([
        'id',
        'display_name',
        'email',
        'avatar_url',
        'created_at',
        'last_login_at',
        'github_installation_id',
      ])
    );

    expect(getColumns('devices')).toContain('primary_user_id');
    expect(getColumns('session_devices')).toContain('active_speaker_id');
    expect(getColumns('messages')).toContain('speaker_id');
  });

  it('backfills existing GitHub users into auth_identities and preserves the user PK', async () => {
    // Migrate up to version 16 (the pre-17 schema). Migration 016 was
    // introduced by PR #385 (session-settings) and lives alongside this
    // one in the chain, so we use 15 as our pre-state to avoid coupling
    // this test to a specific 016 schema. (In a real production DB the
    // pre-17 state could be either 15 or 16 — we accept both.)
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(15);

    // Seed a GitHub-authed user under the legacy schema.
    db.prepare(
      `INSERT INTO users (
         id, github_id, username, display_name, email, avatar_url,
         created_at, last_login_at, github_installation_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'user-jp',
      4242,
      'jpshackelford',
      'JP Shackelford',
      'jp@example.com',
      'https://example.com/jp.png',
      '2024-01-01T00:00:00Z',
      '2024-06-01T00:00:00Z',
      777
    );
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`
    ).run('ws-1', 'user-jp', 'JP workspace', 'ws-1');

    await migrator.migrateUp();

    // User PK survives, profile fields preserved.
    const user = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get('user-jp') as {
        id: string;
        display_name: string;
        email: string;
        avatar_url: string;
        created_at: string;
        last_login_at: string;
        github_installation_id: number;
      };
    expect(user.id).toBe('user-jp');
    expect(user.display_name).toBe('JP Shackelford');
    expect(user.email).toBe('jp@example.com');
    expect(user.github_installation_id).toBe(777);

    // GitHub identity got backfilled.
    const identity = db
      .prepare(
        `SELECT provider, provider_user_id, provider_username, user_id
         FROM auth_identities WHERE user_id = ?`
      )
      .get('user-jp') as {
        provider: string;
        provider_user_id: string;
        provider_username: string;
        user_id: string;
      };
    expect(identity).toBeDefined();
    expect(identity.provider).toBe('github');
    expect(identity.provider_user_id).toBe('4242');
    expect(identity.provider_username).toBe('jpshackelford');

    // The owner FK on workspaces still resolves.
    const ws = db
      .prepare(`SELECT owner_id FROM workspaces WHERE id = ?`)
      .get('ws-1') as { owner_id: string };
    expect(ws.owner_id).toBe('user-jp');
  });

  it('keeps users.username available for legacy reads after backfill', async () => {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(15);

    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('user-nodn', 99, 'somelogin', null);

    await migrator.migrateUp();

    const user = db
      .prepare(`SELECT username, display_name FROM users WHERE id = ?`)
      .get('user-nodn') as { username: string; display_name: string | null };
    // username column is preserved as a backward-compat shadow of the
    // GitHub identity for the duration of the multi-step migration to
    // a fully provider-agnostic users table.
    expect(user.username).toBe('somelogin');
    expect(user.display_name).toBeNull();

    // ...and the identity row is the canonical source going forward.
    const identity = db
      .prepare(
        `SELECT provider_username FROM auth_identities WHERE user_id = ?`
      )
      .get('user-nodn') as { provider_username: string };
    expect(identity.provider_username).toBe('somelogin');
  });

  it('enforces UNIQUE(provider, provider_user_id) on auth_identities', async () => {
    await migrateAll();

    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u1', 1, 'alice', 'Alice');
    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u2', 2, 'bob', 'Bob');

    db.prepare(
      `INSERT INTO auth_identities
       (id, user_id, provider, provider_user_id, provider_username)
       VALUES (?, ?, ?, ?, ?)`
    ).run('id-a', 'u1', 'github', '111', 'alice');

    expect(() =>
      db
        .prepare(
          `INSERT INTO auth_identities
           (id, user_id, provider, provider_user_id, provider_username)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run('id-b', 'u2', 'github', '111', 'bob')
    ).toThrow(/UNIQUE/);
  });

  it('enforces a partial unique index on speakers(workspace_id, user_id) when user_id is set', async () => {
    await migrateAll();
    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u1', 1, 'alice', 'Alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`
    ).run('ws-1', 'u1', 'WS', 'ws-1');

    db.prepare(
      `INSERT INTO speakers (id, workspace_id, user_id, preferred_name)
       VALUES (?, ?, ?, ?)`
    ).run('sp-1', 'ws-1', 'u1', 'Alice');

    expect(() =>
      db
        .prepare(
          `INSERT INTO speakers (id, workspace_id, user_id, preferred_name)
           VALUES (?, ?, ?, ?)`
        )
        .run('sp-2', 'ws-1', 'u1', 'Alice2')
    ).toThrow(/UNIQUE/);

    // Anonymous speakers (NULL user_id) are allowed to repeat.
    db.prepare(
      `INSERT INTO speakers (id, workspace_id, user_id, preferred_name)
       VALUES (?, ?, ?, ?)`
    ).run('sp-3', 'ws-1', null, 'Voice A');
    db.prepare(
      `INSERT INTO speakers (id, workspace_id, user_id, preferred_name)
       VALUES (?, ?, ?, ?)`
    ).run('sp-4', 'ws-1', null, 'Voice B');
  });

  it('cascades speakers when their workspace is deleted', async () => {
    await migrateAll();
    db.pragma('foreign_keys = ON');

    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u1', 1, 'alice', 'Alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`
    ).run('ws-1', 'u1', 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO speakers (id, workspace_id, user_id, preferred_name)
       VALUES (?, ?, ?, ?)`
    ).run('sp-1', 'ws-1', 'u1', 'Alice');

    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run('ws-1');
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM speakers WHERE workspace_id = ?`)
      .get('ws-1') as { c: number };
    expect(count.c).toBe(0);
  });

  it('sets devices.primary_user_id to NULL when the user is deleted', async () => {
    await migrateAll();
    db.pragma('foreign_keys = ON');

    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u1', 1, 'alice', 'Alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`
    ).run('ws-1', 'u1', 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode, primary_user_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run('dev-1', 'ws-1', 'Kitchen iPad', 'kiosk', 'u1');

    // workspace_members must reference the user too, so populate it
    // before the delete to avoid the RESTRICT FK on workspaces.owner_id.
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)`
    ).run('ws-1', 'u1', 'owner');

    // We can't delete the user because workspaces.owner_id RESTRICTs.
    // So move the workspace owner first then delete.
    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u2', 2, 'bob', 'Bob');
    db.prepare(`UPDATE workspaces SET owner_id = ? WHERE id = ?`).run(
      'u2',
      'ws-1'
    );
    db.prepare(`DELETE FROM workspace_members WHERE user_id = ?`).run('u1');
    db.prepare(`DELETE FROM users WHERE id = ?`).run('u1');

    const dev = db
      .prepare(`SELECT primary_user_id FROM devices WHERE id = ?`)
      .get('dev-1') as { primary_user_id: string | null };
    expect(dev.primary_user_id).toBeNull();
  });

  it('preserves existing messages and session_devices rows on up-migrate', async () => {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(15);

    db.prepare(
      `INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`
    ).run('u1', 1, 'alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`
    ).run('ws-1', 'u1', 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name) VALUES (?, ?, ?)`
    ).run('sess-1', 'ws-1', 'Session A');
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`
    ).run('dev-1', 'ws-1', 'Kitchen iPad', 'kiosk');
    db.prepare(
      `INSERT INTO session_devices (session_id, device_id) VALUES (?, ?)`
    ).run('sess-1', 'dev-1');
    db.prepare(
      `INSERT INTO messages (utterance_id, workspace_id, session_id,
         sender_id, sender_name, text, partial)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('utt-1', 'ws-1', 'sess-1', 'dev-1', 'Kitchen iPad', 'hello', 0);

    await migrator.migrateUp();

    const msg = db
      .prepare(
        `SELECT utterance_id, workspace_id, session_id, sender_id,
           sender_name, text, speaker_id
         FROM messages WHERE utterance_id = ?`
      )
      .get('utt-1') as Record<string, unknown>;
    expect(msg.utterance_id).toBe('utt-1');
    expect(msg.text).toBe('hello');
    expect(msg.speaker_id).toBeNull();

    const sd = db
      .prepare(
        `SELECT session_id, device_id, active_speaker_id
         FROM session_devices WHERE session_id = ? AND device_id = ?`
      )
      .get('sess-1', 'dev-1') as Record<string, unknown>;
    expect(sd.session_id).toBe('sess-1');
    expect(sd.active_speaker_id).toBeNull();
  });

  it('round-trips: up -> down -> up restores the speakers schema', async () => {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(15);

    db.prepare(
      `INSERT INTO users (id, github_id, username, display_name) VALUES (?, ?, ?, ?)`
    ).run('u1', 1, 'alice', 'Alice');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`
    ).run('ws-1', 'u1', 'WS', 'ws-1');

    // Up.
    await migrator.migrateUp();
    expect(tableExists('speakers')).toBe(true);
    expect(tableExists('auth_identities')).toBe(true);

    // Down.
    await migrator.migrateTo(15);
    expect(tableExists('speakers')).toBe(false);
    expect(tableExists('auth_identities')).toBe(false);
    expect(getColumns('users')).toContain('github_id');
    expect(getColumns('users')).toContain('username');
    expect(getColumns('devices')).not.toContain('primary_user_id');
    expect(getColumns('messages')).not.toContain('speaker_id');
    expect(getColumns('session_devices')).not.toContain('active_speaker_id');

    // The user row survives the down — we never recreated \`users\` on
    // either direction, so github_id / username are still on the row.
    const restored = db
      .prepare(`SELECT github_id, username FROM users WHERE id = ?`)
      .get('u1') as { github_id: number; username: string };
    expect(restored.github_id).toBe(1);
    expect(restored.username).toBe('alice');

    // Up again — chain remains stable.
    await migrator.migrateUp();
    expect(tableExists('speakers')).toBe(true);
    expect(tableExists('auth_identities')).toBe(true);
  });

  it('is idempotent against a re-run of migrateUp()', async () => {
    await migrateAll();
    await expect(migrateAll()).resolves.not.toThrow();
    // Exactly one row in _migrations for version 17.
    const rows = db
      .prepare(`SELECT version FROM _migrations WHERE version = ?`)
      .all(17);
    expect(rows).toHaveLength(1);
  });
});
