import type { Migration } from '../migrator.js';

/**
 * Migration 013: Clean up orphan rows that violate declared foreign keys.
 *
 * Issue #262: Until this release `PRAGMA foreign_keys = ON` was not set
 * explicitly in `SQLiteStore.connect()`. Whether FK enforcement was actually
 * on depended implicitly on `better-sqlite3`'s compile-time
 * `SQLITE_DEFAULT_FOREIGN_KEYS` flag, with no startup assertion. Any window
 * during which FK enforcement was off (older binaries, tests, manual
 * connections via the `sqlite3` CLI) may have allowed orphan rows to be
 * written. This migration sweeps them out before the new startup assertion
 * lights up FK enforcement for good.
 *
 * Strategy:
 *  - For every CASCADE-declared child column, delete rows whose parent is
 *    missing.
 *  - For every SET-NULL-declared child column, null the FK where parent is
 *    missing.
 *  - For the one non-cascading FK (`workspaces.owner_id REFERENCES users(id)`)
 *    we intentionally do NOT delete the workspace — losing an entire workspace
 *    and all its data because a user record disappeared would be far more
 *    destructive than tolerating the orphan reference. With FK enforcement on,
 *    future INSERTs/UPDATEs that touch `owner_id` are still validated; only
 *    pre-existing orphan references remain, and they cannot do further harm
 *    unless explicitly touched.
 *
 * Cascade interaction: this migration runs AFTER `connect()` enables
 * `foreign_keys=ON`, so a `DELETE FROM sessions WHERE workspace_id NOT IN ...`
 * will also cascade to `session_devices`, `qr_tokens` and set `messages.
 * session_id` to NULL automatically. The follow-up DELETE/UPDATE statements
 * here are belt-and-braces: they cover rows whose own parent is missing even
 * if the cascade path above didn't reach them.
 *
 * The whole migration runs inside the migrator's per-migration transaction
 * so a partial failure cannot leave the database half-cleaned.
 *
 * NOT REVERSIBLE: the down migration cannot bring deleted rows back. We
 * provide a no-op down so the migrator's invariants hold, but rolling back
 * is a no-op and a warning.
 */
export const migration: Migration = {
  version: 13,
  name: 'fk_orphan_cleanup',

  up: `
    -- 1) Orphans referencing workspaces.id
    DELETE FROM workspace_settings
      WHERE workspace_id NOT IN (SELECT id FROM workspaces);

    DELETE FROM workspace_members
      WHERE workspace_id NOT IN (SELECT id FROM workspaces);

    DELETE FROM devices
      WHERE workspace_id NOT IN (SELECT id FROM workspaces);

    DELETE FROM sessions
      WHERE workspace_id NOT IN (SELECT id FROM workspaces);

    DELETE FROM qr_tokens
      WHERE workspace_id NOT IN (SELECT id FROM workspaces);

    DELETE FROM workspace_join_requests
      WHERE workspace_id NOT IN (SELECT id FROM workspaces);

    -- 2) Orphans referencing users.id
    DELETE FROM workspace_members
      WHERE user_id NOT IN (SELECT id FROM users);

    DELETE FROM workspace_join_requests
      WHERE user_id NOT IN (SELECT id FROM users);

    -- 3) Orphans referencing sessions.id (cascades may have done most of this
    --    already via DELETE FROM sessions above, but be explicit).
    DELETE FROM session_devices
      WHERE session_id NOT IN (SELECT id FROM sessions);

    DELETE FROM qr_tokens
      WHERE session_id NOT IN (SELECT id FROM sessions);

    -- 4) Orphans referencing devices.id
    DELETE FROM session_devices
      WHERE device_id NOT IN (SELECT id FROM devices);

    -- 5) SET NULL fixes for FKs declared ON DELETE SET NULL.
    UPDATE messages
      SET session_id = NULL
      WHERE session_id IS NOT NULL
        AND session_id NOT IN (SELECT id FROM sessions);

    UPDATE workspace_join_requests
      SET resolved_by = NULL
      WHERE resolved_by IS NOT NULL
        AND resolved_by NOT IN (SELECT id FROM users);
  `,

  // Down is intentionally a no-op: we cannot resurrect deleted rows. Leaving
  // an empty SQL block means "rolling back" just removes the row from
  // _migrations, which is the only honest answer here.
  down: `
    -- Migration 013 is non-reversible: deleted orphan rows cannot be
    -- restored. Rolling back this migration only removes its tracking row.
    SELECT 1;
  `,
};
