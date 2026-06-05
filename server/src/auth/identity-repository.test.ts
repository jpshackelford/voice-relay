/**
 * AuthIdentityRepository tests (#383).
 *
 * Verifies provider-agnostic identity bookkeeping: create, lookup,
 * listing, the UNIQUE(provider, provider_user_id) collision check,
 * and the cross-user reassignment guard in `upsert`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AuthIdentityRepository } from './identity-repository.js';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';

interface TestEnv {
  db: Database.Database;
  repo: AuthIdentityRepository;
}

async function setup(): Promise<TestEnv> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const migrator = new Migrator({ db, migrations });
  await migrator.migrateUp();

  // Seed two users for the cross-user tests.
  db.prepare(
    `INSERT INTO users (id, github_id, username, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run('user-a', 1, 'alice');
  db.prepare(
    `INSERT INTO users (id, github_id, username, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run('user-b', 2, 'bob');
  // The migration backfilled `auth_identities` for both users; clear
  // it so every test starts from a known-empty state.
  db.prepare(`DELETE FROM auth_identities`).run();

  return { db, repo: new AuthIdentityRepository(db) };
}

describe('AuthIdentityRepository', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setup();
  });
  afterEach(() => {
    env.db.close();
  });

  it('create persists every field and returns the row shape', () => {
    const row = env.repo.create('user-a', {
      provider: 'github',
      providerUserId: '12345',
      providerUsername: 'alice',
    });
    expect(row).toMatchObject({
      userId: 'user-a',
      provider: 'github',
      providerUserId: '12345',
      providerUsername: 'alice',
    });
    expect(row.id).toBeTruthy();
    expect(row.createdAt).toBeTruthy();
  });

  it('create allows null providerUsername', () => {
    const row = env.repo.create('user-a', {
      provider: 'google',
      providerUserId: 'sub-1',
    });
    expect(row.providerUsername).toBeNull();
  });

  it('findByProvider returns the matching row', () => {
    const created = env.repo.create('user-a', {
      provider: 'github',
      providerUserId: '12345',
      providerUsername: 'alice',
    });
    const found = env.repo.findByProvider('github', '12345');
    expect(found?.id).toBe(created.id);
  });

  it('findByProvider returns null when no row matches', () => {
    expect(env.repo.findByProvider('github', 'does-not-exist')).toBeNull();
  });

  it('listForUser returns the user\'s identities oldest-first', async () => {
    const a = env.repo.create('user-a', {
      provider: 'github',
      providerUserId: '1',
      providerUsername: 'alice',
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = env.repo.create('user-a', {
      provider: 'google',
      providerUserId: 'sub-1',
    });
    const list = env.repo.listForUser('user-a');
    expect(list.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('listForUser returns [] when the user has no identities', () => {
    expect(env.repo.listForUser('user-a')).toEqual([]);
  });

  it('create rejects duplicate (provider, provider_user_id) via UNIQUE', () => {
    env.repo.create('user-a', {
      provider: 'github',
      providerUserId: '12345',
    });
    expect(() =>
      env.repo.create('user-b', {
        provider: 'github',
        providerUserId: '12345',
      })
    ).toThrow();
  });

  describe('upsert', () => {
    it('inserts a new row when none exists', () => {
      const row = env.repo.upsert('user-a', {
        provider: 'github',
        providerUserId: '12345',
        providerUsername: 'alice',
      });
      expect(row.userId).toBe('user-a');
      expect(env.repo.listForUser('user-a')).toHaveLength(1);
    });

    it('returns the existing row without re-inserting', () => {
      const first = env.repo.upsert('user-a', {
        provider: 'github',
        providerUserId: '12345',
        providerUsername: 'alice',
      });
      const second = env.repo.upsert('user-a', {
        provider: 'github',
        providerUserId: '12345',
        providerUsername: 'alice',
      });
      expect(second.id).toBe(first.id);
      expect(env.repo.listForUser('user-a')).toHaveLength(1);
    });

    it('updates the providerUsername shadow when GitHub renames the user', () => {
      const first = env.repo.upsert('user-a', {
        provider: 'github',
        providerUserId: '12345',
        providerUsername: 'alice',
      });
      const renamed = env.repo.upsert('user-a', {
        provider: 'github',
        providerUserId: '12345',
        providerUsername: 'alice-2',
      });
      expect(renamed.id).toBe(first.id);
      expect(renamed.providerUsername).toBe('alice-2');
      expect(
        env.repo.findByProvider('github', '12345')?.providerUsername
      ).toBe('alice-2');
    });

    it('throws when the identity already belongs to a different user', () => {
      env.repo.create('user-a', {
        provider: 'github',
        providerUserId: '12345',
      });
      expect(() =>
        env.repo.upsert('user-b', {
          provider: 'github',
          providerUserId: '12345',
        })
      ).toThrow(/already belongs/);
    });
  });

  it('cascades identity deletion when the user is deleted', () => {
    env.repo.create('user-a', {
      provider: 'github',
      providerUserId: '12345',
    });
    env.db.prepare(`DELETE FROM users WHERE id = ?`).run('user-a');
    expect(env.repo.findByProvider('github', '12345')).toBeNull();
  });
});
