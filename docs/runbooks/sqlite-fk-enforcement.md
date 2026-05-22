# Runbook: SQLite Foreign-Key Enforcement (Issue #262)

Starting with the release that closes #262, the server explicitly enables
`PRAGMA foreign_keys = ON` (plus WAL journaling and a 5s busy timeout) and
asserts that FK enforcement is on. Migration 013 sweeps out any orphan rows
that may have been written while enforcement was implicit so the assertion
cannot fire against pre-existing data.

This runbook documents the safe deploy procedure.

## Pragmas applied at startup

In `SQLiteStore.connect()`:

```ts
this.db.pragma('journal_mode = WAL');      // persistent in the DB file
this.db.pragma('foreign_keys = ON');       // per-connection, every start
this.db.pragma('synchronous = NORMAL');    // per-connection, safe under WAL
this.db.pragma('busy_timeout = 5000');     // per-connection retry window
```

A post-set readback asserts `foreign_keys` is `1` and throws otherwise. The
process refuses to start rather than continue with silent referential
integrity loss.

## Pre-deploy: audit production for orphans

The cleanup migration (013) deletes orphan rows (or `SET NULL`s, where the
FK declares `ON DELETE SET NULL`). Run the audit script first to see what
will be cleaned up — ideally against a copy of the production database:

```bash
# 1) SSH to the box, then copy the live DB.
ssh prod
sudo cp /var/www/vr.chorecraft.net/app/data/messages.db /tmp/messages-audit.db
chmod a+r /tmp/messages-audit.db

# 2) From a workstation with this repo checked out:
scp prod:/tmp/messages-audit.db /tmp/messages-audit.db
npx tsx scripts/audit-orphans.ts /tmp/messages-audit.db
```

Exit codes:

- `0` — no orphans, the migration will be a no-op
- `1` — orphans found, the report lists which checks/rows
- `2` — invocation error (bad path, unreadable file, etc.)

Sample output:

```
check                                                              | action   | orphan_rows
-------------------------------------------------------------------+----------+------------
workspaces.owner_id -> users.id (RESTRICT)                         | restrict | 0
devices.workspace_id -> workspaces.id                              | cascade  | 0
messages.session_id -> sessions.id (SET NULL)                      | set-null | 0
...
total orphans: 0
```

If `total orphans > 0`, review the breakdown. Migration 013 will delete the
cascade and set-null orphans automatically; the only category it leaves
alone is `workspaces.owner_id` (RESTRICT — we don't want to lose a whole
workspace just because a user record disappeared).

## Deploy

The cleanup migration runs in the same release as the PRAGMA assertion, so
the two ship together by construction:

1. Merge the PR — main auto-deploys to `vr.chorecraft.net`.
2. On start, `SQLiteStore.connect()` sets the PRAGMAs, then runs migrations.
   Migration 013 (`fk_orphan_cleanup`) executes inside the migrator's
   transaction. If it fails, nothing is committed and the previous schema
   state is preserved.
3. After migrations, the connect path asserts `foreign_keys = 1`. If the
   assertion ever fires in production, the process exits and systemd
   restarts it; that gives operators a clear log to investigate from.

WAL switching is one-way for practical purposes: once the DB file is in WAL
mode, older builds without the PRAGMA can still read/write it transparently
(SQLite handles WAL files at the engine level, not the application level).
The `-wal` and `-shm` sidecar files appear next to `messages.db` and are
fine to leave in place.

## Rollback

- Removing the PRAGMA call reverts to the previous (implicit) behavior.
- WAL files (`-wal`, `-shm`) on disk remain compatible with the prior build.
- Migration 013 is **not** reversible — the deleted orphan rows cannot be
  restored. Rolling it back via the migrator only removes the `_migrations`
  tracking row; it does not bring data back.

If a rollback is required, that's fine — the schema and surviving data are
in a strictly better (referentially clean) state than before the deploy.

## Verifying enforcement in production after deploy

```bash
ssh prod
sqlite3 /var/www/vr.chorecraft.net/app/data/messages.db \
  'PRAGMA journal_mode;'
# expected: wal
```

`PRAGMA foreign_keys` from the CLI will always print `0` (it reports the
*CLI's* connection state, not the app's). To confirm the running app has FK
on, check the startup logs — the absence of the
`[SQLiteStore] foreign_keys pragma not enabled` error line is the positive
signal. The same goes for any future health-check endpoint.

## Related

- Migration tooling improvements: #263
- This runbook was drafted by an AI agent (OpenHands) on behalf of
  @jpshackelford.
