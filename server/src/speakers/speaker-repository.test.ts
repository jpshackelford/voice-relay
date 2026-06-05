/**
 * SpeakerRepository tests (#383). All cases run against an in-memory
 * SQLite DB seeded with the relevant migrations so foreign keys and
 * the partial unique index behave exactly as production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SpeakerRepository } from './speaker-repository.js';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';

interface TestEnv {
  db: Database.Database;
  repo: SpeakerRepository;
  workspaceId: string;
  userId: string;
}

async function setup(): Promise<TestEnv> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Run the real migration chain end-to-end. Cheaper than maintaining
  // a hand-rolled subset and guarantees the speakers table is wired
  // against the same FK graph production uses.
  const migrator = new Migrator({ db, migrations });
  await migrator.migrateUp();

  const userId = 'user-1';
  db.prepare(
    `INSERT INTO users (id, github_id, username, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(userId, 12345, 'alice');

  const workspaceId = 'ws-1';
  db.prepare(
    `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(workspaceId, userId, 'Workspace 1', 'workspace-1', 'JOIN123');

  return { db, repo: new SpeakerRepository(db), workspaceId, userId };
}

describe('SpeakerRepository', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setup();
  });
  afterEach(() => {
    env.db.close();
  });

  describe('create / findById', () => {
    it('persists every field and returns it from findById', () => {
      const created = env.repo.create({
        workspaceId: env.workspaceId,
        userId: env.userId,
        preferredName: 'Ali',
        pronouns: 'she/her',
        notes: 'prefers metric',
      });
      expect(created.id).toBeTruthy();
      expect(created.createdAt).toBe(created.updatedAt);

      const found = env.repo.findById(env.workspaceId, created.id);
      expect(found).toEqual(created);
    });

    it('accepts null-ish optional fields and stores them as NULL', () => {
      const created = env.repo.create({ workspaceId: env.workspaceId });
      expect(created.userId).toBeNull();
      expect(created.preferredName).toBeNull();
      expect(created.pronouns).toBeNull();
      expect(created.notes).toBeNull();
    });

    it('returns null for findById on the wrong workspace (anti-leak)', () => {
      const other = env.repo.create({ workspaceId: env.workspaceId });
      expect(env.repo.findById('ws-other', other.id)).toBeNull();
    });

    it('rejects a second row for the same (workspace,user)', () => {
      env.repo.create({ workspaceId: env.workspaceId, userId: env.userId });
      expect(() =>
        env.repo.create({ workspaceId: env.workspaceId, userId: env.userId })
      ).toThrow();
    });

    it('allows multiple anonymous speakers per workspace', () => {
      const a = env.repo.create({ workspaceId: env.workspaceId });
      const b = env.repo.create({ workspaceId: env.workspaceId });
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('listForWorkspace', () => {
    it('returns speakers most-recently-updated first', async () => {
      const a = env.repo.create({
        workspaceId: env.workspaceId,
        preferredName: 'Alpha',
      });
      // Ensure ms-resolution ordering.
      await new Promise((r) => setTimeout(r, 10));
      const b = env.repo.create({
        workspaceId: env.workspaceId,
        preferredName: 'Beta',
      });
      const list = env.repo.listForWorkspace(env.workspaceId);
      expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    });

    it('does not leak speakers from other workspaces', () => {
      env.repo.create({
        workspaceId: env.workspaceId,
        preferredName: 'In',
      });
      // Create a second workspace owned by the same user.
      env.db
        .prepare(
          `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
        .run('ws-2', env.userId, 'Workspace 2', 'workspace-2', 'JOIN456');
      env.repo.create({ workspaceId: 'ws-2', preferredName: 'Out' });
      const list = env.repo.listForWorkspace(env.workspaceId);
      expect(list).toHaveLength(1);
      expect(list[0].preferredName).toBe('In');
    });
  });

  describe('findByWorkspaceUser', () => {
    it('returns the matching row when one exists', () => {
      const created = env.repo.create({
        workspaceId: env.workspaceId,
        userId: env.userId,
        preferredName: 'Ali',
      });
      const found = env.repo.findByWorkspaceUser(
        env.workspaceId,
        env.userId
      );
      expect(found?.id).toBe(created.id);
    });

    it('returns null when the user has no row in this workspace', () => {
      expect(
        env.repo.findByWorkspaceUser(env.workspaceId, env.userId)
      ).toBeNull();
    });
  });

  describe('update', () => {
    it('writes only specified fields through and bumps updated_at', async () => {
      const created = env.repo.create({
        workspaceId: env.workspaceId,
        preferredName: 'Ali',
        pronouns: 'she/her',
        notes: 'note',
      });
      await new Promise((r) => setTimeout(r, 5));
      const updated = env.repo.update(env.workspaceId, created.id, {
        notes: 'new note',
      });
      expect(updated?.preferredName).toBe('Ali');
      expect(updated?.pronouns).toBe('she/her');
      expect(updated?.notes).toBe('new note');
      expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    it('treats explicit null as "clear this field"', () => {
      const created = env.repo.create({
        workspaceId: env.workspaceId,
        preferredName: 'Ali',
        pronouns: 'she/her',
      });
      const updated = env.repo.update(env.workspaceId, created.id, {
        pronouns: null,
      });
      expect(updated?.pronouns).toBeNull();
      expect(updated?.preferredName).toBe('Ali');
    });

    it('returns null when no row matches', () => {
      expect(
        env.repo.update(env.workspaceId, 'nope', { notes: 'x' })
      ).toBeNull();
    });

    it('refuses to leak rows across workspaces', () => {
      const created = env.repo.create({ workspaceId: env.workspaceId });
      expect(
        env.repo.update('ws-other', created.id, { notes: 'x' })
      ).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the row and returns true', () => {
      const created = env.repo.create({ workspaceId: env.workspaceId });
      expect(env.repo.delete(env.workspaceId, created.id)).toBe(true);
      expect(env.repo.findById(env.workspaceId, created.id)).toBeNull();
    });

    it('returns false when nothing was deleted', () => {
      expect(env.repo.delete(env.workspaceId, 'nope')).toBe(false);
    });

    it('does not delete across workspaces', () => {
      const created = env.repo.create({ workspaceId: env.workspaceId });
      expect(env.repo.delete('ws-other', created.id)).toBe(false);
      expect(env.repo.findById(env.workspaceId, created.id)).not.toBeNull();
    });
  });

  describe('upsertForUser', () => {
    it('creates a fresh row seeded with preferredName', () => {
      const speaker = env.repo.upsertForUser(env.workspaceId, env.userId, {
        preferredName: 'Ali',
      });
      expect(speaker.preferredName).toBe('Ali');
      expect(speaker.userId).toBe(env.userId);
    });

    it('on re-upsert, keeps the existing learning and bumps updated_at', async () => {
      const first = env.repo.upsertForUser(env.workspaceId, env.userId, {
        preferredName: 'Ali',
      });
      env.repo.update(env.workspaceId, first.id, { notes: 'agent-learned' });
      await new Promise((r) => setTimeout(r, 5));
      // A second upsert with a different seed must NOT overwrite the
      // agent's note or the original preferredName.
      const second = env.repo.upsertForUser(env.workspaceId, env.userId, {
        preferredName: 'IGNORED',
      });
      expect(second.id).toBe(first.id);
      expect(second.preferredName).toBe('Ali');
      expect(second.notes).toBe('agent-learned');
      expect(second.updatedAt).not.toBe(first.updatedAt);
    });
  });

  describe('FK semantics from migration 017', () => {
    it('nulls speaker.user_id when the user is deleted (SET NULL)', () => {
      // Use a non-owner user so the workspace-owner FK does not block
      // the user delete we're exercising here.
      const guestId = 'user-guest';
      env.db
        .prepare(
          `INSERT INTO users (id, github_id, username, created_at)
           VALUES (?, ?, ?, datetime('now'))`
        )
        .run(guestId, 67890, 'guest');
      const created = env.repo.create({
        workspaceId: env.workspaceId,
        userId: guestId,
        preferredName: 'Guest',
      });
      env.db.prepare(`DELETE FROM users WHERE id = ?`).run(guestId);
      const after = env.repo.findById(env.workspaceId, created.id);
      expect(after).not.toBeNull();
      expect(after!.userId).toBeNull();
      // Preferred name (agent learning) survives.
      expect(after!.preferredName).toBe('Guest');
    });

    it('cascades speaker deletion when the workspace is deleted', () => {
      const created = env.repo.create({ workspaceId: env.workspaceId });
      env.db
        .prepare(`DELETE FROM workspaces WHERE id = ?`)
        .run(env.workspaceId);
      expect(env.repo.findById(env.workspaceId, created.id)).toBeNull();
    });
  });
});
