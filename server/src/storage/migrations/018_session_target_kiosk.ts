import type { Migration } from '../migrator.js';

/**
 * Migration 018: Per-kiosk active sessions (issue #393)
 *
 * Adds `sessions.target_kiosk_device_id` so a session can be anchored
 * to a specific kiosk device. This is the load-bearing schema change
 * that powers the mobile kiosk picker:
 *
 *   - When a mobile registers with `targetKioskDeviceId`, the WS
 *     `register` handler looks up (or creates) the active session
 *     **for that kiosk** instead of falling back to the
 *     workspace-wide single active session. This gives every kiosk a
 *     well-defined "Idle / In session" pill, makes
 *     `metadata.displayContent` per-kiosk, and unblocks the
 *     "Join in progress" affordance.
 *
 *   - The column is NULLABLE. Legacy sessions (created before this
 *     migration, including the auto-created active session for
 *     single-kiosk workspaces and the anonymous-mode placeholder)
 *     keep working unchanged because `targetKioskDeviceId IS NULL`
 *     continues to mean "no kiosk binding — use legacy single-active
 *     resolution."
 *
 *   - ON DELETE SET NULL: if the bound kiosk is removed from the
 *     workspace, the session survives but loses its binding. The next
 *     mobile that registers without a target falls back to the legacy
 *     single-active resolution, exactly as it would for any unbound
 *     session.
 *
 * **FK-safety:** the migration is additive — single `ALTER TABLE …
 * ADD COLUMN` plus one index. It is safe to run inside the migrator's
 * transaction with `PRAGMA foreign_keys = ON`. No existing data is
 * touched.
 *
 * Marked `destructive: true` because the `down` direction has to
 * rebuild `sessions` (SQLite < 3.35 cannot `DROP COLUMN`) and would
 * lose any non-NULL `target_kiosk_device_id` values written between
 * the up and the down. In practice this matches `017_speakers`'s
 * disposition for the same reason.
 */
export const migration: Migration = {
  version: 18,
  name: 'session_target_kiosk',
  destructive: true,

  up: `
    -- Additive: a new nullable FK from sessions to devices. The column
    -- holds the kiosk that anchors the session (NULL = legacy
    -- workspace-wide single-active behaviour).
    ALTER TABLE sessions ADD COLUMN target_kiosk_device_id TEXT
      REFERENCES devices(id) ON DELETE SET NULL;

    -- Lookup index for getActiveSessionForKiosk(). Partial — most
    -- sessions stay NULL forever (anonymous + legacy), so a partial
    -- index keeps the b-tree small and fast.
    CREATE INDEX idx_sessions_target_kiosk
      ON sessions(target_kiosk_device_id, status)
      WHERE target_kiosk_device_id IS NOT NULL;
  `,

  down: `
    -- SQLite < 3.35 does not support ALTER TABLE DROP COLUMN. Rebuild
    -- sessions without target_kiosk_device_id. The recreate is
    -- FK-safe because the rebuilt table keeps the same name and PK
    -- shape — child FKs (session_devices.session_id,
    -- messages.session_id) resolve by name lookup.
    DROP INDEX IF EXISTS idx_sessions_target_kiosk;

    CREATE TABLE sessions_backup AS SELECT
      id, workspace_id, name, status, started_at, ended_at, metadata,
      display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag
    FROM sessions;

    DROP INDEX IF EXISTS idx_sessions_workspace;
    DROP INDEX IF EXISTS idx_sessions_status;

    DROP TABLE sessions;

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      metadata TEXT,
      display_api_secret_encrypted TEXT,
      display_api_secret_iv TEXT,
      display_api_secret_tag TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    INSERT INTO sessions (
      id, workspace_id, name, status, started_at, ended_at, metadata,
      display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag
    )
    SELECT
      id, workspace_id, name, status, started_at, ended_at, metadata,
      display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag
    FROM sessions_backup;

    DROP TABLE sessions_backup;

    CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `,
};
