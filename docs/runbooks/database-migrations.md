# Database Migrations

Voice Relay ships with an in-house migration runner (`server/src/storage/migrator.ts`)
and a small CLI (`server/scripts/db-cli.ts`) for operating on the database without
booting the application server. Migrations are TypeScript files under
`server/src/storage/migrations/NNN_<name>.ts`.

## CLI commands

All commands accept the same `SQLITE_PATH` env var the server uses
(default `./data/messages.db`).

| Command | What it does |
|---|---|
| `npm run db:status` | List applied vs. pending migrations and any drift |
| `npm run db:migrate` | Apply all pending migrations (idempotent) |
| `npm run db:rollback` | Roll back the most recent migration (interactive confirm) |
| `npm run db:new <name>` | Scaffold a new `NNN_<name>.ts` file at the next version |

Run them from the repository root (workspace forwarding) or from `server/`.

### Examples

```bash
# Read-only status check, with drift warnings if any applied migration has
# been edited since being recorded.
npm run db:status

# Apply pending migrations. Safe to re-run.
npm run db:migrate

# Roll back the latest migration. Will refuse without --confirm-destructive
# if the migration's `down` SQL drops a table or column with user data.
npm run db:rollback
npm run db:rollback -- --confirm-destructive
npm run db:rollback -- --yes                    # skip interactive prompt
npm run db:rollback -- --confirm-destructive --yes

# Create a new migration file. Prints reminder lines for editing index.ts.
npm run db:new add_some_column
```

## `AUTO_MIGRATE` environment variable

`SQLiteStore.connect()` consults `AUTO_MIGRATE`:

- **unset / `true` (default)** — pending migrations are applied at boot.
  Preserves existing behaviour and is appropriate for dev.
- **`false`** — `connect()` refuses to start when migrations are pending,
  exits non-zero, and prints the list of pending migrations and the command
  to run.

**Recommended production setup:** set `AUTO_MIGRATE=false` and run
`npm run db:migrate` as a deploy step that precedes the application restart.
This keeps schema changes explicit and avoids two server instances racing
to migrate the database during a rolling deploy.

## Drift detection

Each applied migration is hashed (`sha256` of the normalized `up` SQL) and
stored in `_migrations.sql_hash`. On startup and on `db:status`, hashes are
recomputed and compared. Mismatches are logged as `[SQLiteStore] DRIFT:` /
`⚠️ DRIFT detected` but **never block startup or fail the CLI** — drift is
a developer signal that an applied migration was edited and a new migration
should be written instead.

Normalization is intentionally minimal: CRLF and trailing whitespace are
stripped (to absorb Git autocrlf churn), internal whitespace is preserved.
Cosmetic reformatting of an applied migration will trigger a warning. That
is the intended behaviour.

`sql_hash` is backfilled on first run for migrations applied before the
hashing feature shipped; `duration_ms` is left `NULL` for those rows.

## Advisory locking

`Migrator.migrateUp / migrateDown / migrateTo` acquire a `MigrationLock`
before doing work. The default implementation, `SQLiteTableLock`, uses a
single-row sentinel table (`_migrations_lock`) acquired inside
`BEGIN IMMEDIATE`. Two concurrent `npm run db:migrate` invocations against
the same database will be serialized: one succeeds, the other waits up to
30 s and then either takes the lock cleanly or errors out — never
double-applies.

Stale rows (older than 5 min) are force-released with a warning. The
owner check on release prevents a process from clobbering another holder's
row after a stale takeover.

The same interface (`acquire(timeoutMs) / release()`) will be implemented
with `pg_advisory_lock` when the Postgres driver lands; no caller changes
will be required.

## Destructive marker

A migration with `destructive: true` is one whose `down` drops a table or
column containing user data. The CLI rollback path refuses to roll one
back without an explicit `--confirm-destructive` flag (exit code 2). The
runtime ignores the flag — it is purely a CLI guardrail.

Currently marked destructive:

- `001_messages`
- `002_users`
- `003_workspaces`
- `005_devices_sessions`
- `006_device_token_security`
- `008_qr_tokens`
- `009_join_requests`
- `012_agent_events`

When you write a new migration whose `down` would drop a table or column
holding user data, add `destructive: true` to its definition.

## Authoring a new migration

```bash
npm run db:new add_some_column
# Edit server/src/storage/migrations/NNN_add_some_column.ts
# Edit server/src/storage/migrations/index.ts to import + append
npm run db:status      # confirm it appears as pending
npm run db:migrate     # apply
```

The runner wraps every migration in a SQLite transaction; a partial failure
rolls back automatically and the row in `_migrations` is not written.
