import type { Migration } from '../migrator.js';

/**
 * Migration 021: Backfill `devices.primary_user_id` (issue #432)
 *
 * Migration 017 added `devices.primary_user_id` so the server can resolve
 * a per-device "primary speaker" and emit the `[speaker id=…]` agent
 * header. The column was left `NULL` for every existing row and only
 * gets populated going forward in
 * `PATCH /api/devices/:deviceId` (`server/src/devices/router.ts`,
 * `deviceRepository.setPrimaryUser`).
 *
 * As a result, every device paired *before* 017 shipped — or before
 * the device-config screen was visited — stays at
 * `primary_user_id = NULL` indefinitely, even when the workspace's
 * sole owner is the only person who could possibly be using it. This
 * one-shot data backfill closes the gap.
 *
 * **Rule (conservative, single heuristic):**
 *
 *   For every device where `primary_user_id IS NULL`, look up the
 *   owning workspace. If that workspace has *exactly one*
 *   `workspace_members` row with `role = 'owner'`, set the device's
 *   `primary_user_id` to that owner's `user_id`. Otherwise leave it
 *   `NULL` — multi-owner and orphaned-owner workspaces are resolved
 *   later by the unknown-speaker flow (#431) or a future "claim this
 *   device" UX.
 *
 * **Idempotency:** the `WHERE primary_user_id IS NULL` predicate makes
 * the UPDATE naturally a no-op the second time it runs. We also never
 * overwrite an existing non-NULL claim.
 *
 * **Data-only:** no schema is touched, no FK juggling, no table
 * rebuild. `destructive: false`.
 *
 * **`down`:** intentionally a no-op for the data side. There's no safe
 * inverse without knowing which rows we set vs. which the application
 * set after the fact. Rolling 017 back is what removes the column
 * (and the 017 down already handles that via table rebuild).
 */
export const migration: Migration = {
  version: 21,
  name: 'backfill_devices_primary_user',
  destructive: false,

  up: `
    -- One-shot backfill: set devices.primary_user_id to the workspace
    -- owner's user_id, but only when ownership is unambiguous (the
    -- workspace has exactly one role='owner' row in workspace_members).
    --
    -- Naturally idempotent: re-running matches no rows the second time
    -- because the WHERE clause filters on primary_user_id IS NULL.
    UPDATE devices
    SET primary_user_id = (
      SELECT wm.user_id
      FROM workspace_members wm
      WHERE wm.workspace_id = devices.workspace_id
        AND wm.role = 'owner'
    )
    WHERE devices.primary_user_id IS NULL
      AND (
        SELECT COUNT(*)
        FROM workspace_members wm
        WHERE wm.workspace_id = devices.workspace_id
          AND wm.role = 'owner'
      ) = 1;
  `,

  down: `
    -- 021 down is intentionally a no-op for the data side.
    --
    -- Once a device's primary_user_id has been set (whether by this
    -- backfill or by the PATCH /devices/:id path), we never undo the
    -- claim from inside the migrator — there's no safe inverse without
    -- knowing which rows were ours. Rolling 017 back is what drops the
    -- column, so rolling 021 back is harmless to leave empty.
    SELECT 1;  -- placeholder so the up/down hash diff is non-trivial
  `,
};
