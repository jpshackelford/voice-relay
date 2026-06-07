/**
 * Unit tests for `SessionAIStateRepository` (issue #363).
 *
 * Strategy: drive a real in-memory SQLite against the actual migrations
 * (no mocks of the DB layer) so any drift between migration SQL and
 * repo SQL surfaces immediately. Sessions are inserted via raw SQL —
 * the goal is to exercise the new repo, not `SessionRepository`.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  SessionAIStateRepository,
  type SessionAIStateName,
} from './session-ai-state-repository.js';
import { migrations } from '../storage/migrations/index.js';

/**
 * Apply every migration in order. Equivalent to letting the production
 * `Migrator` run on an empty DB. Tests touch tables created by 020
 * and depend on `sessions` (005) + everything it transitively depends
 * on, so the simplest correct approach is the full chain.
 */
function applyAllMigrations(db: Database.Database): void {
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    db.exec(m.up);
  }
}

function insertSession(
  db: Database.Database,
  sessionId: string,
  workspaceId: string,
  status: 'active' | 'ended' = 'active',
  metadata: Record<string, unknown> | null = null,
): void {
  // The full migration chain creates `workspaces` + `users` with FKs,
  // so we provide the parent rows first. `auto_join_code` and other
  // optional columns are left null.
  db.prepare(
    `INSERT OR IGNORE INTO users (id, github_id, username, created_at, last_login_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
  ).run('user-test', 1, 'tester');
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(workspaceId, 'user-test', 'Workspace', `ws-${workspaceId}`, 'CODE-0000');
  db.prepare(
    `INSERT INTO sessions (id, workspace_id, name, status, started_at, metadata)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
  ).run(sessionId, workspaceId, 'Test Session', status, metadata ? JSON.stringify(metadata) : null);
}

describe('SessionAIStateRepository', () => {
  let db: Database.Database;
  let repo: SessionAIStateRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyAllMigrations(db);
    repo = new SessionAIStateRepository(db);
    insertSession(db, 'session-1', 'workspace-1');
  });

  describe('upsert', () => {
    test('inserts a new row and round-trips every field', () => {
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-abc',
        state: 'running',
        stateReason: null,
        rebindAttempts: [],
      });

      const row = repo.findBySessionId('session-1');
      expect(row).not.toBeNull();
      expect(row!.sessionId).toBe('session-1');
      expect(row!.conversationId).toBe('conv-abc');
      expect(row!.state).toBe('running');
      expect(row!.stateReason).toBeNull();
      expect(row!.rebindAttempts).toEqual([]);
      expect(row!.stateChangedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(row!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('overwrites an existing row (ON CONFLICT DO UPDATE)', () => {
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-1',
        state: 'running',
      });
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-2',
        state: 'degraded',
        stateReason: 'sandbox missing',
        rebindAttempts: [1000, 2000],
      });

      const row = repo.findBySessionId('session-1');
      expect(row!.conversationId).toBe('conv-2');
      expect(row!.state).toBe('degraded');
      expect(row!.stateReason).toBe('sandbox missing');
      expect(row!.rebindAttempts).toEqual([1000, 2000]);
    });

    test('rebindAttempts JSON round-trips a numeric array', () => {
      const attempts = [1700000000000, 1700000005000, 1700000010500];
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-x',
        state: 'running',
        rebindAttempts: attempts,
      });
      expect(repo.findBySessionId('session-1')!.rebindAttempts).toEqual(attempts);
    });

    test('CHECK constraint rejects invalid state values', () => {
      // The constraint lives on the column, not the repo. Casting to
      // bypass TS so we can prove the DB enforces the typo guard.
      expect(() =>
        repo.upsert({
          sessionId: 'session-1',
          conversationId: 'conv-1',
          state: 'oops' as SessionAIStateName,
        }),
      ).toThrow();
    });
  });

  describe('findBySessionId', () => {
    test('returns null for an unknown session', () => {
      expect(repo.findBySessionId('does-not-exist')).toBeNull();
    });

    test('returns the row when present', () => {
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-1',
        state: 'rebinding',
        stateReason: null,
      });
      const row = repo.findBySessionId('session-1');
      expect(row!.state).toBe('rebinding');
    });
  });

  describe('listByState', () => {
    test('returns only rows in the requested state', () => {
      insertSession(db, 'session-2', 'workspace-1');
      insertSession(db, 'session-3', 'workspace-1');

      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      repo.upsert({
        sessionId: 'session-2',
        conversationId: 'c2',
        state: 'degraded',
        stateReason: 'lost upstream',
      });
      repo.upsert({ sessionId: 'session-3', conversationId: 'c3', state: 'degraded' });

      const degraded = repo.listByState('degraded');
      expect(degraded.map((r) => r.sessionId).sort()).toEqual(['session-2', 'session-3']);

      expect(repo.listByState('rebinding')).toEqual([]);
    });
  });

  describe('listAll', () => {
    test('returns rows across every state for tracker seeding', () => {
      insertSession(db, 'session-2', 'workspace-1');
      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      repo.upsert({ sessionId: 'session-2', conversationId: 'c2', state: 'degraded' });
      const ids = repo.listAll().map((r) => r.sessionId).sort();
      expect(ids).toEqual(['session-1', 'session-2']);
    });
  });

  describe('transitionTo', () => {
    test('updates state + reason and bumps timestamps but preserves rebind attempts', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2025-06-01T00:00:00Z'));
        repo.upsert({
          sessionId: 'session-1',
          conversationId: 'conv-1',
          state: 'running',
          rebindAttempts: [1000, 2000],
        });
        vi.setSystemTime(new Date('2025-06-01T00:05:00Z'));
        repo.transitionTo('session-1', 'degraded', 'sandbox missing');

        const row = repo.findBySessionId('session-1')!;
        expect(row.state).toBe('degraded');
        expect(row.stateReason).toBe('sandbox missing');
        expect(row.rebindAttempts).toEqual([1000, 2000]); // preserved
        expect(row.stateChangedAt).toBe('2025-06-01T00:05:00.000Z');
        expect(row.updatedAt).toBe('2025-06-01T00:05:00.000Z');
      } finally {
        vi.useRealTimers();
      }
    });

    test('null reason is persisted as NULL', () => {
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-1',
        state: 'degraded',
        stateReason: 'old reason',
      });
      repo.transitionTo('session-1', 'running', null);
      expect(repo.findBySessionId('session-1')!.stateReason).toBeNull();
    });

    test('no-op when row is missing', () => {
      // No throw, no side effects: the row still doesn't exist after.
      repo.transitionTo('phantom', 'degraded', null);
      expect(repo.findBySessionId('phantom')).toBeNull();
    });
  });

  describe('setRebindAttempts', () => {
    test('replaces the JSON column and bumps updated_at', () => {
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-1',
        state: 'running',
        rebindAttempts: [1, 2, 3],
      });
      repo.setRebindAttempts('session-1', [10, 20]);
      expect(repo.findBySessionId('session-1')!.rebindAttempts).toEqual([10, 20]);
    });

    test('empty array clears the column to NULL', () => {
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-1',
        state: 'running',
        rebindAttempts: [1, 2, 3],
      });
      repo.setRebindAttempts('session-1', []);
      expect(repo.findBySessionId('session-1')!.rebindAttempts).toEqual([]);
      // Verify it's actually NULL, not an empty JSON array, by querying raw.
      const raw = db
        .prepare(`SELECT rebind_attempts_json FROM session_ai_state WHERE session_id = ?`)
        .get('session-1') as { rebind_attempts_json: string | null };
      expect(raw.rebind_attempts_json).toBeNull();
    });

    test('no-op when row is missing', () => {
      repo.setRebindAttempts('phantom', [1, 2]);
      expect(repo.findBySessionId('phantom')).toBeNull();
    });
  });

  describe('deleteBySessionId', () => {
    test('removes the row', () => {
      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      repo.deleteBySessionId('session-1');
      expect(repo.findBySessionId('session-1')).toBeNull();
    });

    test('no-op when row is missing', () => {
      expect(() => repo.deleteBySessionId('phantom')).not.toThrow();
    });
  });

  describe('FK cascade behaviour', () => {
    test('deleting the parent session removes the state row', () => {
      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run('session-1');
      expect(repo.findBySessionId('session-1')).toBeNull();
    });
  });

  describe('parseAttempts defensive handling', () => {
    test('corrupt JSON in the column reads as empty array', () => {
      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      db.prepare(
        `UPDATE session_ai_state SET rebind_attempts_json = ? WHERE session_id = ?`,
      ).run('this is not json', 'session-1');
      expect(repo.findBySessionId('session-1')!.rebindAttempts).toEqual([]);
    });

    test('non-array JSON reads as empty array', () => {
      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      db.prepare(
        `UPDATE session_ai_state SET rebind_attempts_json = ? WHERE session_id = ?`,
      ).run('{"foo":"bar"}', 'session-1');
      expect(repo.findBySessionId('session-1')!.rebindAttempts).toEqual([]);
    });

    test('non-numeric array entries are filtered out', () => {
      repo.upsert({ sessionId: 'session-1', conversationId: 'c1', state: 'running' });
      db.prepare(
        `UPDATE session_ai_state SET rebind_attempts_json = ? WHERE session_id = ?`,
      ).run('[1000,"bad",2000,null]', 'session-1');
      expect(repo.findBySessionId('session-1')!.rebindAttempts).toEqual([1000, 2000]);
    });
  });

  describe('migration backfill', () => {
    test('seeds running rows from sessions.metadata.aiConversationId', () => {
      // Fresh DB so we can prove the backfill runs.
      const freshDb = new Database(':memory:');
      freshDb.pragma('foreign_keys = ON');
      // Set up parent rows + sessions BEFORE applying migration 020.
      // Apply 001..019 first.
      for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
        if (m.version >= 20) continue;
        freshDb.exec(m.up);
      }
      // Insert a session with aiConversationId and one without.
      insertSession(freshDb, 'session-with-conv', 'workspace-1', 'active', {
        aiConversationId: 'conv-backfilled',
      });
      insertSession(freshDb, 'session-without-conv', 'workspace-1', 'active', {});
      insertSession(freshDb, 'session-ended', 'workspace-1', 'ended', {
        aiConversationId: 'conv-ended',
      });

      // Now apply migration 020 — the INSERT INTO ... SELECT runs as
      // part of `up`.
      const m020 = migrations.find((m) => m.version === 20)!;
      freshDb.exec(m020.up);

      const freshRepo = new SessionAIStateRepository(freshDb);
      expect(freshRepo.findBySessionId('session-with-conv')).toMatchObject({
        conversationId: 'conv-backfilled',
        state: 'running',
      });
      expect(freshRepo.findBySessionId('session-without-conv')).toBeNull();
      // Ended sessions are not backfilled — they shouldn't auto-rehydrate.
      expect(freshRepo.findBySessionId('session-ended')).toBeNull();
    });

    test('backfill is idempotent (INSERT OR IGNORE)', () => {
      // Pre-existing row should not be overwritten by a re-run of the up SQL.
      repo.upsert({
        sessionId: 'session-1',
        conversationId: 'conv-original',
        state: 'degraded',
        stateReason: 'kept across re-apply',
      });
      // Also give the session a (different) aiConversationId in metadata.
      db.prepare(`UPDATE sessions SET metadata = ? WHERE id = ?`).run(
        JSON.stringify({ aiConversationId: 'conv-from-metadata' }),
        'session-1',
      );
      const m020 = migrations.find((m) => m.version === 20)!;
      // Re-run the up sql (table already exists so CREATE TABLE IF NOT
      // EXISTS is a no-op, and INSERT OR IGNORE leaves the existing
      // row alone).
      db.exec(m020.up);
      const row = repo.findBySessionId('session-1')!;
      expect(row.conversationId).toBe('conv-original');
      expect(row.state).toBe('degraded');
    });
  });
});
