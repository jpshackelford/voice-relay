import type { Migration } from '../migrator.js';

/**
 * Migration 017: Speaker identity model (issue #383)
 *
 * Adds the four-part speaker identity model agreed in the 2026-06-04
 * design session:
 *
 *   1. **Provider-agnostic identity** — new `auth_identities` join table
 *      so users can be authenticated via multiple providers (GitHub,
 *      Google, email magic-link, …). Every existing GitHub-authed user
 *      is backfilled into `auth_identities` with `provider='github'`.
 *
 *      The original `users.github_id` / `users.username` columns are
 *      retained as a compatibility shadow so this migration is purely
 *      additive against the existing FK graph (see "FK-safety" below);
 *      a future migration can drop them once every read path uses
 *      `auth_identities`.
 *
 *   2. **Device → primary user link** — additive `devices.primary_user_id`
 *      column with `ON DELETE SET NULL` so deleting a user demotes the
 *      device to anonymous rather than destroying it.
 *
 *   3. **Workspace-scoped speaker profiles** — new `speakers` table
 *      holding the agent's persistent learnings about each speaker
 *      (preferred name, pronouns, free-text notes). A given user has at
 *      most one `speakers` row per workspace (partial unique index);
 *      `user_id` is nullable so the agent can also record an anonymous
 *      speaker it learned by voice / context.
 *
 *   4. **Per-session / per-utterance speaker override** —
 *      `session_devices.active_speaker_id` lets a borrowed device say
 *      "this is actually someone else right now"; `messages.speaker_id`
 *      anchors each persisted utterance to the speaker as resolved at
 *      utterance time so later overrides don't rewrite history.
 *
 * **FK-safety:** this migration is entirely additive — it only `CREATE
 * TABLE`s, `ADD COLUMN`s, and `INSERT`s. No existing table is dropped
 * or recreated. That keeps the migration safe to run inside the
 * migrator's transaction with `PRAGMA foreign_keys = ON` (which
 * production sets before migrations run; see `SQLiteStore.connect()`).
 *
 * Marked `destructive: true` because rolling back drops
 * `auth_identities` and `speakers` (and their data).
 */
export const migration: Migration = {
  version: 17,
  name: 'speakers',
  destructive: true,

  up: `
    ---------------------------------------------------------------------
    -- 1. auth_identities — provider-agnostic identity join table.
    ---------------------------------------------------------------------

    CREATE TABLE auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      provider_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, provider_user_id)
    );
    CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

    -- Backfill every existing user as a GitHub identity. provider_user_id
    -- is TEXT so the schema can accept opaque provider ids (Google's
    -- \`sub\`, email addresses, …) without a future schema change.
    INSERT INTO auth_identities (
      id, user_id, provider, provider_user_id, provider_username, created_at
    )
    SELECT
      lower(hex(randomblob(16))),
      id,
      'github',
      CAST(github_id AS TEXT),
      username,
      created_at
    FROM users
    WHERE github_id IS NOT NULL;

    ---------------------------------------------------------------------
    -- 2. Device → primary user link.
    ---------------------------------------------------------------------

    ALTER TABLE devices ADD COLUMN primary_user_id TEXT
      REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX idx_devices_primary_user ON devices(primary_user_id);

    ---------------------------------------------------------------------
    -- 3. Workspace-scoped speaker profiles.
    ---------------------------------------------------------------------

    CREATE TABLE speakers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      preferred_name TEXT,
      pronouns TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_speakers_workspace ON speakers(workspace_id);
    CREATE INDEX idx_speakers_user ON speakers(user_id);
    -- One speaker per (workspace, user) when user_id is known. Multiple
    -- anonymous (user_id IS NULL) speakers per workspace are allowed —
    -- the agent may learn several humans by voice before any of them
    -- authenticates.
    CREATE UNIQUE INDEX idx_speakers_workspace_user
      ON speakers(workspace_id, user_id)
      WHERE user_id IS NOT NULL;

    ---------------------------------------------------------------------
    -- 4. Per-session / per-utterance speaker override.
    ---------------------------------------------------------------------

    ALTER TABLE session_devices ADD COLUMN active_speaker_id TEXT
      REFERENCES speakers(id) ON DELETE SET NULL;

    ALTER TABLE messages ADD COLUMN speaker_id TEXT
      REFERENCES speakers(id) ON DELETE SET NULL;
    CREATE INDEX idx_messages_speaker ON messages(speaker_id);
  `,

  down: `
    -- 4. messages.speaker_id, session_devices.active_speaker_id.
    --
    -- SQLite < 3.35 does not support ALTER TABLE DROP COLUMN. Rebuild
    -- messages and session_devices without the new columns. The
    -- recreate is FK-safe because the rebuilt tables keep the same name
    -- and the same PK shape — child FKs (none in either case) resolve
    -- by name lookup.
    DROP INDEX IF EXISTS idx_messages_speaker;

    CREATE TABLE messages_backup AS SELECT
      id, utterance_id, workspace_id, session_id,
      sender_id, sender_name, text, partial, created_at
    FROM messages;
    DROP TABLE messages;
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utterance_id TEXT NOT NULL,
      workspace_id TEXT,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO messages (
      id, utterance_id, workspace_id, session_id,
      sender_id, sender_name, text, partial, created_at
    )
    SELECT
      id, utterance_id, workspace_id, session_id,
      sender_id, sender_name, text, partial, created_at
    FROM messages_backup;
    DROP TABLE messages_backup;
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON messages(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE session_devices_backup AS SELECT
      session_id, device_id, joined_at
    FROM session_devices;
    DROP TABLE session_devices;
    CREATE TABLE session_devices (
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, device_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
    INSERT INTO session_devices (session_id, device_id, joined_at)
    SELECT session_id, device_id, joined_at FROM session_devices_backup;
    DROP TABLE session_devices_backup;

    -- 3. Speakers.
    DROP INDEX IF EXISTS idx_speakers_workspace_user;
    DROP INDEX IF EXISTS idx_speakers_user;
    DROP INDEX IF EXISTS idx_speakers_workspace;
    DROP TABLE IF EXISTS speakers;

    -- 2. devices.primary_user_id — rebuild devices without it.
    DROP INDEX IF EXISTS idx_devices_primary_user;
    CREATE TABLE devices_backup AS SELECT
      id, workspace_id, name, mode, device_token_hash,
      token_expires_at, last_seen_at, config, created_at
    FROM devices;
    DROP INDEX IF EXISTS idx_devices_workspace;
    DROP INDEX IF EXISTS idx_devices_token_hash;
    DROP INDEX IF EXISTS idx_devices_expires;
    DROP TABLE devices;
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      device_token_hash TEXT UNIQUE,
      token_expires_at TEXT,
      last_seen_at TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    INSERT INTO devices (
      id, workspace_id, name, mode, device_token_hash,
      token_expires_at, last_seen_at, config, created_at
    )
    SELECT
      id, workspace_id, name, mode, device_token_hash,
      token_expires_at, last_seen_at, config, created_at
    FROM devices_backup;
    DROP TABLE devices_backup;
    CREATE INDEX idx_devices_workspace ON devices(workspace_id);
    CREATE INDEX idx_devices_token_hash ON devices(device_token_hash);
    CREATE INDEX idx_devices_expires ON devices(token_expires_at);

    -- 1. auth_identities.
    DROP INDEX IF EXISTS idx_auth_identities_user;
    DROP TABLE IF EXISTS auth_identities;
  `,
};
