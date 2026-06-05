import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';
import { StttUsageRepository, currentUtcMonth } from './usage-repository.js';

/**
 * Round-trip tests for the per-month STT usage counter (#386).
 */
describe('StttUsageRepository', () => {
  let db: Database.Database;
  let repo: StttUsageRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();
    db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
      .run('u1', 1, 'alice');
    db.prepare(`INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`)
      .run('ws1', 'u1', 'WS', 'ws1');
    repo = new StttUsageRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('reports 0 minutes for a workspace with no row yet', () => {
    expect(repo.getCurrentMonthMinutes('ws1')).toBe(0);
  });

  it('increments by the supplied minute delta', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(repo.incrementMinutes('ws1', 1.5, now)).toBeCloseTo(1.5);
    expect(repo.incrementMinutes('ws1', 0.25, now)).toBeCloseTo(1.75);
    expect(repo.getCurrentMonthMinutes('ws1', now)).toBeCloseTo(1.75);
  });

  it('clamps negative and NaN deltas to zero (counter never moves backwards)', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    repo.incrementMinutes('ws1', 5, now);
    expect(repo.incrementMinutes('ws1', -3, now)).toBeCloseTo(5);
    expect(repo.incrementMinutes('ws1', Number.NaN, now)).toBeCloseTo(5);
  });

  it('uses distinct buckets per UTC month', () => {
    const june = new Date('2026-06-30T23:59:00Z');
    const july = new Date('2026-07-01T00:01:00Z');
    repo.incrementMinutes('ws1', 10, june);
    repo.incrementMinutes('ws1', 2, july);
    expect(repo.getCurrentMonthMinutes('ws1', june)).toBe(10);
    expect(repo.getCurrentMonthMinutes('ws1', july)).toBe(2);
  });

  it('currentUtcMonth pads single-digit months to two digits', () => {
    expect(currentUtcMonth(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01');
    expect(currentUtcMonth(new Date('2026-11-05T00:00:00Z'))).toBe('2026-11');
  });

  it('cascades when the workspace is deleted', () => {
    repo.incrementMinutes('ws1', 1);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run('ws1');
    expect(repo.getCurrentMonthMinutes('ws1')).toBe(0);
  });
});
