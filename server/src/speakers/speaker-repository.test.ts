/**
 * SpeakerRepository tests (#383). All cases run against an in-memory
 * SQLite DB seeded with the relevant migrations so foreign keys and
 * the partial unique index behave exactly as production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SpeakerRepository } from './speaker-repository.js';
import { AnonymousSpeakerQuotaExceeded } from './types.js';
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

  // Issue #443: dedup-aware insert for anonymous speakers + per-workspace cap.
  describe('findOrCreateAnonymous (#443)', () => {
    it('dedups: same name + same pronouns returns the existing row', () => {
      const first = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: 'they/them',
        maxAnonymousPerWorkspace: 100,
      });
      const second = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: 'they/them',
        maxAnonymousPerWorkspace: 100,
      });

      expect(second.id).toBe(first.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(1);
    });

    it('case-insensitive dedup: "Alex" and "alex" collapse to one row', () => {
      const first = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });
      const lowered = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'alex',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });
      const upper = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'ALEX',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });

      expect(lowered.id).toBe(first.id);
      expect(upper.id).toBe(first.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(1);
    });

    it('different pronouns are intentionally distinct rows', () => {
      const a = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: 'they/them',
        maxAnonymousPerWorkspace: 100,
      });
      const b = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: 'she/her',
        maxAnonymousPerWorkspace: 100,
      });

      expect(b.id).not.toBe(a.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(2);
    });

    it('null pronouns dedup against each other but not against a non-null value', () => {
      const nullPronouns = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Sam',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });
      const sameNull = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Sam',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });
      const withPronouns = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Sam',
        pronouns: 'he/him',
        maxAnonymousPerWorkspace: 100,
      });

      expect(sameNull.id).toBe(nullPronouns.id);
      expect(withPronouns.id).not.toBe(nullPronouns.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(2);
    });

    it('does not dedup against an authenticated (user_id set) speaker', () => {
      // A workspace member named "Alex" already has a user-linked row.
      env.repo.create({
        workspaceId: env.workspaceId,
        userId: env.userId,
        preferredName: 'Alex',
        pronouns: 'they/them',
      });

      const anon = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: 'they/them',
        maxAnonymousPerWorkspace: 100,
      });

      // Brand-new anonymous row — the user-linked row was correctly
      // excluded by the user_id IS NULL filter.
      expect(anon.userId).toBeNull();
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(1);
    });

    it('does not dedup across workspaces', () => {
      // Second workspace owned by the same user.
      const otherWorkspaceId = 'ws-other';
      env.db
        .prepare(
          `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
        .run(otherWorkspaceId, env.userId, 'Other', 'other', 'OTHR123');

      const a = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });
      const b = env.repo.findOrCreateAnonymous({
        workspaceId: otherWorkspaceId,
        preferredName: 'Alex',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });

      expect(b.id).not.toBe(a.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(1);
      expect(env.repo.countAnonymousInWorkspace(otherWorkspaceId)).toBe(1);
    });

    it('throws AnonymousSpeakerQuotaExceeded when at cap and no dedup hit', () => {
      const cap = 3;
      // Fill the cap with distinct names.
      for (let i = 0; i < cap; i++) {
        env.repo.findOrCreateAnonymous({
          workspaceId: env.workspaceId,
          preferredName: `Person ${i}`,
          pronouns: null,
          maxAnonymousPerWorkspace: cap,
        });
      }
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(cap);

      expect(() =>
        env.repo.findOrCreateAnonymous({
          workspaceId: env.workspaceId,
          preferredName: 'Newcomer',
          pronouns: null,
          maxAnonymousPerWorkspace: cap,
        })
      ).toThrow(AnonymousSpeakerQuotaExceeded);

      // Cap-exceeded throw did not roll an extra row through.
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(cap);
    });

    it('dedup bypasses the quota: existing row returned even at cap', () => {
      const cap = 2;
      const first = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: null,
        maxAnonymousPerWorkspace: cap,
      });
      env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Bree',
        pronouns: null,
        maxAnonymousPerWorkspace: cap,
      });
      // We are AT cap now — but a dedup hit should still succeed.
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(cap);

      const reAlex = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'alex', // case-insensitive dedup
        pronouns: null,
        maxAnonymousPerWorkspace: cap,
      });

      expect(reAlex.id).toBe(first.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(cap);
    });

    it('throws on empty preferredName (defensive guard)', () => {
      expect(() =>
        env.repo.findOrCreateAnonymous({
          workspaceId: env.workspaceId,
          preferredName: '',
          pronouns: null,
          maxAnonymousPerWorkspace: 100,
        })
      ).toThrow(/preferredName must be non-empty/);
    });

    it('AnonymousSpeakerQuotaExceeded carries workspaceId and cap', () => {
      try {
        env.repo.findOrCreateAnonymous({
          workspaceId: env.workspaceId,
          preferredName: 'Alex',
          pronouns: null,
          maxAnonymousPerWorkspace: 0,
        });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AnonymousSpeakerQuotaExceeded);
        const quotaErr = err as AnonymousSpeakerQuotaExceeded;
        expect(quotaErr.workspaceId).toBe(env.workspaceId);
        expect(quotaErr.cap).toBe(0);
        expect(quotaErr.name).toBe('AnonymousSpeakerQuotaExceeded');
      }
    });

    it('returns the earliest-created row when multiple legacy duplicates already exist', () => {
      // Simulate the pre-#443 world: two duplicate anonymous rows
      // already exist (e.g. created before this fix shipped).
      const first = env.repo.create({
        workspaceId: env.workspaceId,
        userId: null,
        preferredName: 'Alex',
        pronouns: null,
      });
      // Force the second row's created_at to be strictly later.
      env.db
        .prepare(`UPDATE speakers SET created_at = ? WHERE id = ?`)
        .run('9999-12-31T23:59:59.000Z', first.id);
      const second = env.repo.create({
        workspaceId: env.workspaceId,
        userId: null,
        preferredName: 'Alex',
        pronouns: null,
      });
      env.db
        .prepare(`UPDATE speakers SET created_at = ? WHERE id = ?`)
        .run('1900-01-01T00:00:00.000Z', second.id);

      const resolved = env.repo.findOrCreateAnonymous({
        workspaceId: env.workspaceId,
        preferredName: 'Alex',
        pronouns: null,
        maxAnonymousPerWorkspace: 100,
      });

      // Deterministic tie-break on created_at ASC: pick `second` (the
      // one we forced to be the older timestamp).
      expect(resolved.id).toBe(second.id);
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(2);
    });
  });

  describe('countAnonymousInWorkspace (#443)', () => {
    it('counts only anonymous (user_id IS NULL) rows in the workspace', () => {
      env.repo.create({
        workspaceId: env.workspaceId,
        userId: env.userId, // authenticated speaker
        preferredName: 'Owner',
      });
      env.repo.create({ workspaceId: env.workspaceId, preferredName: 'A' });
      env.repo.create({ workspaceId: env.workspaceId, preferredName: 'B' });

      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(2);
    });

    it('returns 0 when no anonymous speakers exist', () => {
      expect(env.repo.countAnonymousInWorkspace(env.workspaceId)).toBe(0);
    });
  });
});
