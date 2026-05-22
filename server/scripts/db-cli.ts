/**
 * Database migration CLI for voice-relay.
 *
 * Usage:
 *   tsx scripts/db-cli.ts status
 *   tsx scripts/db-cli.ts migrate
 *   tsx scripts/db-cli.ts rollback [--confirm-destructive] [--yes]
 *   tsx scripts/db-cli.ts new <name>
 *
 * Runs entirely without booting the application server: opens the SQLite DB
 * directly using the same `SQLITE_PATH` env var the server uses, defaulting
 * to `./data/messages.db`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import Database from 'better-sqlite3';
import { Migrator, type Migration } from '../src/storage/migrator.js';
import { getMigrations } from '../src/storage/migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DB_PATH = './data/messages.db';
const MIGRATIONS_DIR = resolve(__dirname, '..', 'src', 'storage', 'migrations');
const INDEX_PATH = join(MIGRATIONS_DIR, 'index.ts');
const TEMPLATE_PATH = resolve(__dirname, 'migration-template.ts.tmpl');

function getDbPath(): string {
  return process.env.SQLITE_PATH ?? DEFAULT_DB_PATH;
}

function openDb(): Database.Database {
  const path = getDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

function buildMigrator(db: Database.Database): Migrator {
  return new Migrator({ db, migrations: getMigrations() });
}

async function status(): Promise<void> {
  const db = openDb();
  try {
    const migrator = buildMigrator(db);
    const applied = migrator.getApplied();
    const pending = migrator.getPending();
    const drift = migrator.detectDrift();

    console.log(`Database: ${getDbPath()}`);
    console.log(`Current version: ${migrator.getCurrentVersion()}`);
    console.log('');
    console.log(`Applied (${applied.length}):`);
    if (applied.length === 0) {
      console.log('  (none)');
    } else {
      for (const m of applied) {
        const dur = m.duration_ms != null ? ` (${m.duration_ms}ms)` : '';
        const hash = m.sql_hash ? ` hash=${m.sql_hash.slice(0, 12)}…` : ' hash=(none)';
        console.log(`  ✓ ${m.version}_${m.name} @ ${m.applied_at}${dur}${hash}`);
      }
    }
    console.log('');
    console.log(`Pending (${pending.length}):`);
    if (pending.length === 0) {
      console.log('  (none)');
    } else {
      for (const m of pending) {
        const tag = m.destructive ? ' [destructive]' : '';
        console.log(`  • ${m.version}_${m.name}${tag}`);
      }
    }

    if (drift.length > 0) {
      console.log('');
      console.log(`⚠️  DRIFT detected (${drift.length}):`);
      for (const d of drift) {
        if (d.currentHash === '') {
          console.log(`  ! ${d.version}_${d.name} applied but no matching file in codebase`);
        } else {
          console.log(
            `  ! ${d.version}_${d.name} edited since apply ` +
              `(stored=${d.storedHash?.slice(0, 12)}… current=${d.currentHash.slice(0, 12)}…)`
          );
        }
      }
    }
  } finally {
    db.close();
  }
}

async function migrate(): Promise<void> {
  const db = openDb();
  try {
    const migrator = buildMigrator(db);
    const pending = migrator.getPending();
    if (pending.length === 0) {
      console.log('No pending migrations. 0 applied.');
      return;
    }
    console.log(`Applying ${pending.length} migration(s)...`);
    const result = await migrator.migrateUp();
    console.log(`Applied ${result.applied}:`);
    for (const m of result.migrations) console.log(`  ✓ ${m}`);
  } finally {
    db.close();
  }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolveAnswer => {
    rl.question(question, answer => {
      rl.close();
      resolveAnswer(answer);
    });
  });
}

async function rollback(opts: {
  confirmDestructive: boolean;
  assumeYes: boolean;
}): Promise<number> {
  const db = openDb();
  try {
    const migrator = buildMigrator(db);
    const applied = migrator.getApplied();
    if (applied.length === 0) {
      console.log('Nothing to roll back.');
      return 0;
    }
    const latest = applied[applied.length - 1];
    const migration: Migration | undefined = getMigrations().find(
      m => m.version === latest.version
    );
    if (!migration) {
      console.error(
        `Refusing to roll back ${latest.version}_${latest.name}: no matching file in codebase.`
      );
      return 2;
    }

    if (migration.destructive && !opts.confirmDestructive) {
      console.error(
        `Refusing to roll back destructive migration ${migration.version}_${migration.name}.`
      );
      console.error('Pass --confirm-destructive to override.');
      return 2;
    }

    if (!opts.assumeYes) {
      const tag = migration.destructive ? ' (DESTRUCTIVE)' : '';
      const answer = await prompt(
        `Roll back ${migration.version}_${migration.name}${tag}? [y/N]: `
      );
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Aborted.');
        return 1;
      }
    }

    const result = await migrator.migrateDown();
    console.log(`Rolled back: ${result.rolledBack ?? '(none)'}`);
    return 0;
  } finally {
    db.close();
  }
}

function readKnownMigrations(): Migration[] {
  return getMigrations();
}

function nextVersion(): number {
  const all = readKnownMigrations();
  return all.length === 0 ? 1 : Math.max(...all.map(m => m.version)) + 1;
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

function sanitizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function scaffold(rawName: string | undefined): Promise<number> {
  if (!rawName) {
    console.error('Usage: db:new <name>');
    return 1;
  }
  const name = sanitizeName(rawName);
  if (!name) {
    console.error(`Invalid migration name: ${rawName}`);
    return 1;
  }
  const version = nextVersion();
  const filename = `${pad3(version)}_${name}.ts`;
  const filepath = join(MIGRATIONS_DIR, filename);

  if (existsSync(filepath)) {
    console.error(`Refusing to overwrite existing file: ${filepath}`);
    return 1;
  }

  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const contents = template
    .replace(/\{\{VERSION\}\}/g, String(version))
    .replace(/\{\{NAME\}\}/g, name);
  writeFileSync(filepath, contents, 'utf8');

  console.log(`Created ${filepath}`);
  console.log(
    `\nAdd the migration to ${INDEX_PATH}:\n` +
      `  1. Add an import: import { migration as migration${pad3(version)} } from './${pad3(
        version
      )}_${name}.js';\n` +
      `  2. Append migration${pad3(version)} to the migrations array.\n`
  );
  return 0;
}

function printHelp(): void {
  console.log(`voice-relay database migration CLI

Usage:
  tsx scripts/db-cli.ts <command> [args]

Commands:
  status                          List applied vs. pending migrations + drift
  migrate                         Apply all pending migrations
  rollback [--confirm-destructive] [--yes]
                                  Roll back the most recent migration
  new <name>                      Scaffold a new migration file

Environment:
  SQLITE_PATH                     Path to the SQLite database (default: ${DEFAULT_DB_PATH})
`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case 'status':
      await status();
      return 0;
    case 'migrate':
      await migrate();
      return 0;
    case 'rollback':
      return rollback({
        confirmDestructive: argv.includes('--confirm-destructive'),
        assumeYes: argv.includes('--yes') || argv.includes('-y'),
      });
    case 'new':
      return scaffold(argv[1]);
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      printHelp();
      return 1;
  }
}

main()
  .then(code => process.exit(code ?? 0))
  .catch(err => {
    console.error('[db-cli] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
