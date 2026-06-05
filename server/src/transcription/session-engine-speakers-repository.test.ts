import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';
import { SessionEngineSpeakersRepository } from './session-engine-speakers-repository.js';

/**
 * Round-trip tests for the engine-label → speaker.id mapping repository.
 *
 * Issue: #386
 */
describe('SessionEngineSpeakersRepository', () => {
  let db: Database.Database;
  let repo: SessionEngineSpeakersRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();

    db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
      .run('u1', 1, 'alice');
    db.prepare(`INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`)
      .run('ws1', 'u1', 'WS', 'ws1');
    db.prepare(`INSERT INTO sessions (id, workspace_id) VALUES (?, ?)`)
      .run('s1', 'ws1');
    db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`)
      .run('d1', 'ws1', 'Kiosk', 'kiosk');
    db.prepare(
      `INSERT INTO speakers (id, workspace_id, user_id, preferred_name)
       VALUES (?, ?, ?, ?)`,
    ).run('sp-jp', 'ws1', 'u1', 'JP');

    repo = new SessionEngineSpeakersRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for unmapped (session, device, label) triples', () => {
    expect(repo.find('s1', 'd1', 'S1')).toBeNull();
    expect(repo.resolveSpeakerId('s1', 'd1', 'S1')).toBeNull();
  });

  it('upserts an unresolved mapping with null speaker_id', () => {
    const m = repo.upsert('s1', 'd1', 'S1', null);
    expect(m.speakerId).toBeNull();
    expect(m.sessionId).toBe('s1');
    expect(repo.resolveSpeakerId('s1', 'd1', 'S1')).toBeNull();
  });

  it('upsert overwrites an existing mapping (most-recent-claim-wins)', () => {
    repo.upsert('s1', 'd1', 'S1', null);
    repo.upsert('s1', 'd1', 'S1', 'sp-jp');
    expect(repo.resolveSpeakerId('s1', 'd1', 'S1')).toBe('sp-jp');
  });

  it('different (device, label) pairs in the same session are independent', () => {
    db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`)
      .run('d2', 'ws1', 'Kiosk2', 'kiosk');
    repo.upsert('s1', 'd1', 'S1', 'sp-jp');
    repo.upsert('s1', 'd2', 'S1', null); // d2's S1 is a different person
    expect(repo.resolveSpeakerId('s1', 'd1', 'S1')).toBe('sp-jp');
    expect(repo.resolveSpeakerId('s1', 'd2', 'S1')).toBeNull();
  });

  it('cascades deletion when the session is deleted', () => {
    repo.upsert('s1', 'd1', 'S1', 'sp-jp');
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run('s1');
    expect(repo.find('s1', 'd1', 'S1')).toBeNull();
  });

  /*
   * Speaker / device deletion is intentionally not FK-cascaded —
   * the mapping table is auxiliary and orphans are tolerable. See the
   * commentary in migration 019. We just confirm that deleting a speaker
   * leaves the mapping intact (so future-us doesn't accidentally
   * reintroduce a stricter constraint without thinking through the
   * test-fixture cost).
   */
  it('does not cascade when a referenced speaker is deleted', () => {
    repo.upsert('s1', 'd1', 'S1', 'sp-jp');
    db.prepare(`DELETE FROM speakers WHERE id = ?`).run('sp-jp');
    const after = repo.find('s1', 'd1', 'S1');
    expect(after).not.toBeNull();
    // Stale speaker_id is acceptable; application code is responsible
    // for treating "unknown speaker.id" as a cache miss.
    expect(after!.speakerId).toBe('sp-jp');
  });

  it('listForSession returns rows ordered by created_at ASC', () => {
    repo.upsert('s1', 'd1', 'S1', 'sp-jp');
    repo.upsert('s1', 'd1', 'S2', null);
    const all = repo.listForSession('s1');
    expect(all).toHaveLength(2);
    expect(all[0]!.engineLabel).toBe('S1');
    expect(all[1]!.engineLabel).toBe('S2');
  });
});
