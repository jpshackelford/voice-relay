import Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export interface MigratorOptions {
  db: Database.Database;
  migrations: Migration[];
}

export interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

/**
 * Database migration runner.
 * Tracks applied migrations and runs pending ones on startup.
 */
export class Migrator {
  private readonly db: Database.Database;
  private readonly migrations: Migration[];

  constructor(options: MigratorOptions) {
    this.db = options.db;
    this.migrations = options.migrations.sort((a, b) => a.version - b.version);
    this.ensureMigrationsTable();
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /** Get all applied migration versions */
  getApplied(): AppliedMigration[] {
    const stmt = this.db.prepare<[], AppliedMigration>(`
      SELECT version, name, applied_at FROM _migrations ORDER BY version ASC
    `);
    return stmt.all();
  }

  /** Get pending migrations that haven't been applied yet */
  getPending(): Migration[] {
    const applied = new Set(this.getApplied().map(m => m.version));
    return this.migrations.filter(m => !applied.has(m.version));
  }

  /** Get the current schema version (highest applied migration) */
  getCurrentVersion(): number {
    const applied = this.getApplied();
    if (applied.length === 0) return 0;
    return Math.max(...applied.map(m => m.version));
  }

  /** Run all pending migrations */
  migrateUp(): { applied: number; migrations: string[] } {
    const pending = this.getPending();
    const applied: string[] = [];

    for (const migration of pending) {
      this.runMigration(migration, 'up');
      applied.push(`${migration.version}_${migration.name}`);
    }

    return { applied: applied.length, migrations: applied };
  }

  /** Roll back the most recent migration */
  migrateDown(): { rolledBack: string | null } {
    const applied = this.getApplied();
    if (applied.length === 0) {
      return { rolledBack: null };
    }

    const latest = applied[applied.length - 1];
    const migration = this.migrations.find(m => m.version === latest.version);
    
    if (!migration) {
      throw new Error(`Migration ${latest.version} not found in codebase`);
    }

    this.runMigration(migration, 'down');
    return { rolledBack: `${migration.version}_${migration.name}` };
  }

  /** Migrate to a specific version (up or down as needed) */
  migrateTo(targetVersion: number): { direction: 'up' | 'down' | 'none'; count: number } {
    const current = this.getCurrentVersion();
    
    if (targetVersion === current) {
      return { direction: 'none', count: 0 };
    }

    if (targetVersion > current) {
      // Migrate up to target
      const pending = this.getPending().filter(m => m.version <= targetVersion);
      for (const migration of pending) {
        this.runMigration(migration, 'up');
      }
      return { direction: 'up', count: pending.length };
    } else {
      // Migrate down to target
      const applied = this.getApplied()
        .filter(m => m.version > targetVersion)
        .reverse();
      
      for (const appliedMigration of applied) {
        const migration = this.migrations.find(m => m.version === appliedMigration.version);
        if (!migration) {
          throw new Error(`Migration ${appliedMigration.version} not found`);
        }
        this.runMigration(migration, 'down');
      }
      return { direction: 'down', count: applied.length };
    }
  }

  private runMigration(migration: Migration, direction: 'up' | 'down'): void {
    const sql = direction === 'up' ? migration.up : migration.down;
    
    console.log(`[Migrator] Running ${direction}: ${migration.version}_${migration.name}`);
    
    // Run in a transaction
    const transaction = this.db.transaction(() => {
      // Execute the migration SQL
      this.db.exec(sql);
      
      // Update migrations tracking table
      if (direction === 'up') {
        this.db.prepare(`
          INSERT INTO _migrations (version, name) VALUES (?, ?)
        `).run(migration.version, migration.name);
      } else {
        this.db.prepare(`
          DELETE FROM _migrations WHERE version = ?
        `).run(migration.version);
      }
    });

    transaction();
  }
}
