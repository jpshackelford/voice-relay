import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator, type Migration } from './migrator.js';

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
  });

  describe('getApplied', () => {
    it('returns empty array when no migrations applied', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      expect(migrator.getApplied()).toEqual([]);
    });

    it('returns applied migrations after migrateUp', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      
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

    it('returns empty array when all applied', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      expect(migrator.getPending()).toHaveLength(0);
    });

    it('returns only unapplied migrations', () => {
      const migrator = new Migrator({ db, migrations: [testMigrations[0]] });
      migrator.migrateUp();
      
      // Add more migrations
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

    it('returns highest applied version', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      expect(migrator.getCurrentVersion()).toBe(3);
    });
  });

  describe('migrateUp', () => {
    it('applies all pending migrations', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = migrator.migrateUp();
      
      expect(result.applied).toBe(3);
      expect(result.migrations).toEqual(['1_create_users', '2_add_email', '3_create_posts']);
    });

    it('creates tables correctly', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      
      // Check users table exists with both columns
      const usersInfo = db.prepare('PRAGMA table_info(users)').all();
      const columnNames = usersInfo.map((c: any) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('email');
      
      // Check posts table exists
      const postsInfo = db.prepare('PRAGMA table_info(posts)').all();
      expect(postsInfo.length).toBeGreaterThan(0);
    });

    it('is idempotent - does not re-apply migrations', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      
      const result2 = migrator.migrateUp();
      expect(result2.applied).toBe(0);
      expect(result2.migrations).toEqual([]);
    });

    it('handles migrations in non-sequential order', () => {
      const unorderedMigrations = [testMigrations[2], testMigrations[0], testMigrations[1]];
      const migrator = new Migrator({ db, migrations: unorderedMigrations });
      
      const result = migrator.migrateUp();
      expect(result.migrations).toEqual(['1_create_users', '2_add_email', '3_create_posts']);
    });
  });

  describe('migrateDown', () => {
    it('rolls back the most recent migration', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      
      const result = migrator.migrateDown();
      expect(result.rolledBack).toBe('3_create_posts');
      expect(migrator.getCurrentVersion()).toBe(2);
    });

    it('returns null when no migrations to roll back', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = migrator.migrateDown();
      expect(result.rolledBack).toBeNull();
    });

    it('removes table when rolling back', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      migrator.migrateDown();
      
      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='posts'
      `).all();
      expect(tables).toHaveLength(0);
    });
  });

  describe('migrateTo', () => {
    it('returns no-op when already at target version', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = migrator.migrateTo(0);
      expect(result).toEqual({ direction: 'none', count: 0 });
    });

    it('migrates up to target version', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      const result = migrator.migrateTo(2);
      
      expect(result).toEqual({ direction: 'up', count: 2 });
      expect(migrator.getCurrentVersion()).toBe(2);
    });

    it('migrates down to target version', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      
      const result = migrator.migrateTo(1);
      expect(result).toEqual({ direction: 'down', count: 2 });
      expect(migrator.getCurrentVersion()).toBe(1);
    });

    it('can migrate down to 0', () => {
      const migrator = new Migrator({ db, migrations: testMigrations });
      migrator.migrateUp();
      
      const result = migrator.migrateTo(0);
      expect(result).toEqual({ direction: 'down', count: 3 });
      expect(migrator.getCurrentVersion()).toBe(0);
    });
  });

  describe('transaction safety', () => {
    it('rolls back on migration failure', () => {
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
      
      expect(() => migrator.migrateUp()).toThrow();
      
      // First migration should have succeeded
      expect(migrator.getCurrentVersion()).toBe(1);
    });
  });

  describe('applied_at timestamp', () => {
    it('records timestamp when migration is applied', () => {
      const migrator = new Migrator({ db, migrations: [testMigrations[0]] });
      migrator.migrateUp();
      
      const applied = migrator.getApplied();
      expect(applied[0].applied_at).toBeDefined();
      expect(typeof applied[0].applied_at).toBe('string');
    });
  });
});
