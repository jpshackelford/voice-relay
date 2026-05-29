/**
 * Tests for the shared `persistAiConversationId` helper (issue #347).
 *
 * The helper is the single place where both auto-connect and the
 * user-driven `/ai/restart` handler write `status.conversationId` back to
 * `session.metadata.aiConversationId`. Sibling issues #348 and #349 will
 * reuse it, so the three behaviours below define its contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionRepository } from './session-repository.js';
import { persistAiConversationId } from './persist-ai-conversation-id.js';
import type { AgentSessionStatus } from '../agent-driver/index.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

function readPersistedConversationId(
  db: Database.Database,
  sessionId: string,
): string | null {
  const row = db
    .prepare(`SELECT metadata FROM sessions WHERE id = ?`)
    .get(sessionId) as { metadata: string | null } | undefined;
  if (!row?.metadata) return null;
  const parsed = JSON.parse(row.metadata) as { aiConversationId?: string };
  return parsed.aiConversationId ?? null;
}

describe('persistAiConversationId', () => {
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let sessionId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        display_api_secret_encrypted TEXT,
        display_api_secret_iv TEXT,
        display_api_secret_tag TEXT,
        metadata TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);

    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run('user-1', 1, 'u');
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('ws-1', 'user-1', 'W', 'w', 'CODE-1');

    sessionRepository = new SessionRepository(db);
    sessionId = sessionRepository.create({ workspaceId: 'ws-1', name: 's' }).id;
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('persists conversationId to session.metadata when present', () => {
    // Seed the row with a prior conversation id so we can prove the helper
    // overwrites it with the new value (this is the issue #347 scenario:
    // restart returns a new id, DB should reflect it).
    sessionRepository.updateMetadata(sessionId, { aiConversationId: 'old-id' });
    expect(readPersistedConversationId(db, sessionId)).toBe('old-id');

    const status: Pick<AgentSessionStatus, 'conversationId'> = {
      conversationId: 'new-id',
    };
    persistAiConversationId(sessionRepository, sessionId, status);

    expect(readPersistedConversationId(db, sessionId)).toBe('new-id');
  });

  it('is a no-op when conversationId is null (does not stomp existing row)', () => {
    // A `degraded` restart returns `conversationId: null`. We must not
    // overwrite the previously-persisted id with null, or we'd lose the
    // pointer entirely and have nothing to rehydrate against.
    sessionRepository.updateMetadata(sessionId, { aiConversationId: 'keep-me' });

    const updateSpy = vi.spyOn(sessionRepository, 'updateMetadata');
    persistAiConversationId(sessionRepository, sessionId, {
      conversationId: null,
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(readPersistedConversationId(db, sessionId)).toBe('keep-me');
  });

  it('swallows and logs errors when updateMetadata throws', () => {
    // Persistence is non-fatal: the broadcast chain in both call sites
    // must keep progressing. The helper must NOT propagate the error.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(sessionRepository, 'updateMetadata').mockImplementation(() => {
      throw new Error('db locked');
    });

    expect(() =>
      persistAiConversationId(sessionRepository, sessionId, {
        conversationId: 'new-id',
      }),
    ).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      expect.any(Error),
    );
  });
});
