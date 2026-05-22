import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  Migrator,
  hashMigrationSql,
  normalizeSqlForHashing,
  type Migration,
} from './migrator.js';

describe('Migrator', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  const testMigrations: Migration[] = [
    {
      version: 1,
      name: 'create_users',
      up: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);',
      down: 'DROP TABLE users;',
    },
    {
      version: 2,
      name: 'add_email',
      up: 'ALTER TABLE users ADD COLUMN email TEXT;',
      down: 'ALTER TABLE users DROP COLUMN email;',
    },
    {
      version: 3,
      name: 'create_posts',
      up: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT);',
      down: 'DROP TABLE posts;',
    },
  ];

  describe('constructor', () => {
    it('creates _migrations table on initialization', () => {
      new Migrator({ db, migrations: [] });

      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'
      `).all();

      expect(tables).toHaveLength(1);
    });

    it('does not fail if _migrations table already exists', () => {
      new Migrator({ db, migrations: [] });
      expect(() => new Migrator({ db, migrations: [] })).not.toThrow();
    });

    it('creates _migrations table with forensic columns', () => {
      new Migrator({ db, migrations: [] });
      const info = db.prepare(`PRAGMA table_info(_migrations)`).all() as Array<{
        name: string;
      }>;
      const names = info.map(r => r.name);
      expect(names).toContain('duration_ms');
      expect(names).toContain('sql_hash');
    });

    it('idempotently adds forensic columns to a pre-existing table', () => {
      // Simulate an old DB that does not yet have the new columns.
      db.exec(
        `CREATE TABLE _migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      );
      db.prepare(
        `INSERT INTO _migrations (version, name) VALUES (1, 'create_users')`
      ).run();

      // First construction should ALTER both columns in.
      new Migrator({ db, migrations: testMigrations });
      // Second construction should be a no-op.
      expect(() => new Migrator({ db, migrations: testMigrations })).not.toThrow();

      const info = db.prepare(`PRAGMA table_info(_migrations)`).all() as Array<{
        name: string;
      }>;
      const names = info.map(r => r.name);
      expect(names).toContain('duration_ms');
      expect(names).toContain('sql_hash');
    });
  });

  describe('getApplied', () => {
    it('returns empty array when no migrations applied', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      expect(migrator.getApplied()).toEqual([]);
    });

    it('returns applied migrations after migrateUp', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const applied = migrator.getApplied();
      expect(applied).toHaveLength(3);
      expect(applied[0].version).toBe(1);
      expect(applied[0].name).toBe('create_users');
      expect(applied[1].version).toBe(2);
      expect(applied[2].version).toBe(3);
    });
  });

  describe('getPending', () => {
    it('returns all migrations when none applied', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const pending = migrator.getPending();
      expect(pending).toHaveLength(3);
    });

    it('returns empty array when all applied', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();
      expect(migrator.getPending()).toHaveLength(0);
    });

    it('returns only unapplied migrations', async () => {
      const migrator = new Migrator({ db, migrations: [testMigrations[0]] });
      await migrator.migrateUp();

      const migrator2 = new Migrator({ db, migrations: testMigrations });
      const pending = migrator2.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0].version).toBe(2);
      expect(pending[1].version).toBe(3);
    });
  });

  describe('getCurrentVersion', () => {
    it('returns 0 when no migrations applied', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      expect(migrator.getCurrentVersion()).toBe(0);
    });

    it('returns highest applied version', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();
      expect(migrator.getCurrentVersion()).toBe(3);
    });
  });

  describe('migrateUp', () => {
    it('applies all pending migrations', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = await migrator.migrateUp();

      expect(result.applied).toBe(3);
      expect(result.migrations).toEqual(['1_create_users', '2_add_email', '3_create_posts']);
    });

    it('creates tables correctly', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const usersInfo = db.prepare('PRAGMA table_info(users)').all();
      const columnNames = usersInfo.map((c: any) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('email');

      const postsInfo = db.prepare('PRAGMA table_info(posts)').all();
      expect(postsInfo.length).toBeGreaterThan(0);
    });

    it('is idempotent - does not re-apply migrations', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const result2 = await migrator.migrateUp();
      expect(result2.applied).toBe(0);
      expect(result2.migrations).toEqual([]);
    });

    it('handles migrations in non-sequential order', async () => {
      const unorderedMigrations = [testMigrations[2], testMigrations[0], testMigrations[1]];
      const migrator = new Migrator({ db, migrations: unorderedMigrations });

      const result = await migrator.migrateUp();
      expect(result.migrations).toEqual(['1_create_users', '2_add_email', '3_create_posts']);
    });
  });

  describe('migrateDown', () => {
    it('rolls back the most recent migration', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const result = await migrator.migrateDown();
      expect(result.rolledBack).toBe('3_create_posts');
      expect(migrator.getCurrentVersion()).toBe(2);
    });

    it('returns null when no migrations to roll back', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = await migrator.migrateDown();
      expect(result.rolledBack).toBeNull();
    });

    it('removes table when rolling back', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();
      await migrator.migrateDown();

      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='posts'
      `).all();
      expect(tables).toHaveLength(0);
    });
  });

  describe('migrateTo', () => {
    it('returns no-op when already at target version', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = await migrator.migrateTo(0);
      expect(result).toEqual({ direction: 'none', count: 0 });
    });

    it('migrates up to target version', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = await migrator.migrateTo(2);

      expect(result).toEqual({ direction: 'up', count: 2 });
      expect(migrator.getCurrentVersion()).toBe(2);
    });

    it('migrates down to target version', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const result = await migrator.migrateTo(1);
      expect(result).toEqual({ direction: 'down', count: 2 });
      expect(migrator.getCurrentVersion()).toBe(1);
    });

    it('can migrate down to 0', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const result = await migrator.migrateTo(0);
      expect(result).toEqual({ direction: 'down', count: 3 });
      expect(migrator.getCurrentVersion()).toBe(0);
    });
  });

  describe('transaction safety', () => {
    it('rolls back on migration failure', async () => {
      const badMigrations: Migration[] = [
        {
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE users (id INTEGER PRIMARY KEY);',
          down: 'DROP TABLE users;',
        },
        {
          version: 2,
          name: 'bad_migration',
          up: 'THIS IS NOT VALID SQL;',
          down: 'DROP TABLE nonexistent;',
        },
      ];

      const migrator = new Migrator({ db, migrations: badMigrations });

      await expect(migrator.migrateUp()).rejects.toThrow();

      // First migration should have succeeded
      expect(migrator.getCurrentVersion()).toBe(1);
    });
  });

  describe('applied_at timestamp', () => {
    it('records timestamp when migration is applied', async () => {
      const migrator = new Migrator({ db, migrations: [testMigrations[0]] });
      await migrator.migrateUp();

      const applied = migrator.getApplied();
      expect(applied[0].applied_at).toBeDefined();
      expect(typeof applied[0].applied_at).toBe('string');
    });
  });

  describe('forensic columns', () => {
    it('records duration_ms and sql_hash on apply', async () => {
      const migrator = new Migrator({ db, migrations: [testMigrations[0]] });
      await migrator.migrateUp();

      const applied = migrator.getApplied();
      expect(applied[0].sql_hash).toBe(hashMigrationSql(testMigrations[0].up));
      expect(applied[0].duration_ms).toBeTypeOf('number');
      expect(applied[0].duration_ms!).toBeGreaterThanOrEqual(0);
    });
  });

  describe('hash normalization', () => {
    it('treats CRLF and trailing whitespace as equivalent to LF', () => {
      const a = 'SELECT 1;\n   ';
      const b = 'SELECT 1;\r\n';
      expect(normalizeSqlForHashing(a)).toBe(normalizeSqlForHashing(b));
      expect(hashMigrationSql(a)).toBe(hashMigrationSql(b));
    });

    it('detects internal whitespace changes (no false negatives)', () => {
      const a = 'SELECT 1;';
      const b = 'SELECT  1;'; // double space
      expect(hashMigrationSql(a)).not.toBe(hashMigrationSql(b));
    });
  });

  describe('drift detection', () => {
    it('returns empty when no drift', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();
      expect(migrator.detectDrift()).toEqual([]);
    });

    it('reports drift when an applied migration is edited', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const edited: Migration[] = testMigrations.map(m =>
        m.version === 2
          ? { ...m, up: 'ALTER TABLE users ADD COLUMN email TEXT;  -- edited!' }
          : m
      );
      const migrator2 = new Migrator({ db, migrations: edited });
      const drift = migrator2.detectDrift();
      expect(drift).toHaveLength(1);
      expect(drift[0].version).toBe(2);
      expect(drift[0].storedHash).toBe(hashMigrationSql(testMigrations[1].up));
      expect(drift[0].currentHash).toBe(hashMigrationSql(edited[1].up));
    });

    it('reports missing-file drift when an applied row has no source', async () => {
      // Apply v1 then construct a migrator with v1 absent.
      const fullMigrator = new Migrator({ db, migrations: testMigrations });
      await fullMigrator.migrateUp();

      const subset = testMigrations.filter(m => m.version !== 1);
      const migrator = new Migrator({ db, migrations: subset });
      const drift = migrator.detectDrift();
      expect(drift.some(d => d.version === 1 && d.currentHash === '')).toBe(true);
    });

    it('does not throw or block on drift', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const edited: Migration[] = testMigrations.map(m =>
        m.version === 2 ? { ...m, up: 'SELECT 1;' } : m
      );
      const migrator2 = new Migrator({ db, migrations: edited });
      expect(() => migrator2.detectDrift()).not.toThrow();
    });
  });

  describe('hash backfill', () => {
    it('backfills sql_hash for rows that pre-date hashing', () => {
      // Simulate an old DB shape: pre-existing _migrations without hash column.
      db.exec(
        `CREATE TABLE _migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      );
      db.prepare(
        `INSERT INTO _migrations (version, name) VALUES (1, 'create_users')`
      ).run();

      const migrator = new Migrator({ db, migrations: testMigrations });
      const applied = migrator.getApplied();
      expect(applied[0].sql_hash).toBe(hashMigrationSql(testMigrations[0].up));
      // duration_ms cannot be reconstructed and stays NULL.
      expect(applied[0].duration_ms).toBeNull();
    });

    it('does not overwrite an existing hash on subsequent calls', async () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      await migrator.migrateUp();

      const originalHash = migrator.getApplied()[0].sql_hash;
      // Reading again must still report the same recorded hash.
      const readAgain = migrator.getApplied()[0].sql_hash;
      expect(readAgain).toBe(originalHash);
    });
  });

  describe('destructive marker', () => {
    it('is optional and round-trips through the migrator', async () => {
      const m: Migration = {
        version: 1,
        name: 'create_users',
        up: 'CREATE TABLE users (id INTEGER PRIMARY KEY);',
        down: 'DROP TABLE users;',
        destructive: true,
      };
      const migrator = new Migrator({ db, migrations: [m] });
      await migrator.migrateUp();
      // The flag lives on the in-memory migration; the runner ignores it
      // (the CLI enforces). Confirm migrateUp still runs.
      expect(migrator.getCurrentVersion()).toBe(1);
    });
  });

  describe('lock integration', () => {
    it('uses the provided MigrationLock', async () => {
      const acquireSpy = vi.fn(async () => {});
      const releaseSpy = vi.fn(async () => {});
      const migrator = new Migrator({
        db,
        migrations: [testMigrations[0]],
        lock: { acquire: acquireSpy, release: releaseSpy },
      });
      await migrator.migrateUp();
      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    });

    it('releases the lock even when a migration throws', async () => {
      const releaseSpy = vi.fn(async () => {});
      const migrator = new Migrator({
        db,
        migrations: [
          {
            version: 1,
            name: 'bad',
            up: 'NOT VALID SQL;',
            down: '',
          },
        ],
        lock: { acquire: async () => {}, release: releaseSpy },
      });
      await expect(migrator.migrateUp()).rejects.toThrow();
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    });

    it('propagates lock acquisition timeouts', async () => {
      const migrator = new Migrator({
        db,
        migrations: [testMigrations[0]],
        lock: {
          acquire: async () => {
            throw new Error('timed out');
          },
          release: async () => {},
        },
      });
      await expect(migrator.migrateUp()).rejects.toThrow(/timed out/);
    });
  });
});
