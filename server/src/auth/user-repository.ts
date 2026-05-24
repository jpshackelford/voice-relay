import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { User, UserCreateInput } from './types.js';

interface UserRow {
  id: string;
  github_id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  created_at: string;
  last_login_at: string | null;
  github_installation_id: number | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.github_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    email: row.email,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    githubInstallationId: row.github_installation_id,
  };
}

const SELECT_USER_COLUMNS = `
  id, github_id, username, display_name, avatar_url, email,
  created_at, last_login_at, github_installation_id
`;

export class UserRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): User | null {
    const stmt = this.db.prepare<[string], UserRow>(`
      SELECT ${SELECT_USER_COLUMNS}
      FROM users WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToUser(row) : null;
  }

  findByGitHubId(githubId: number): User | null {
    const stmt = this.db.prepare<[number], UserRow>(`
      SELECT ${SELECT_USER_COLUMNS}
      FROM users WHERE github_id = ?
    `);
    const row = stmt.get(githubId);
    return row ? rowToUser(row) : null;
  }

  create(input: UserCreateInput): User {
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO users (id, github_id, username, display_name, avatar_url, email, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.githubId,
      input.username,
      input.displayName ?? null,
      input.avatarUrl ?? null,
      input.email ?? null,
      now,
      now
    );

    return {
      id,
      githubId: input.githubId,
      username: input.username,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      email: input.email ?? null,
      createdAt: now,
      lastLoginAt: now,
      githubInstallationId: null,
    };
  }

  updateOnLogin(id: string, updates: Partial<UserCreateInput>): User {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE users
      SET username = COALESCE(?, username),
          display_name = COALESCE(?, display_name),
          avatar_url = COALESCE(?, avatar_url),
          email = COALESCE(?, email),
          last_login_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updates.username ?? null,
      updates.displayName ?? null,
      updates.avatarUrl ?? null,
      updates.email ?? null,
      now,
      id
    );

    const user = this.findById(id);
    if (!user) {
      throw new Error(`User ${id} not found after update`);
    }
    return user;
  }

  /**
   * Find or create a user from GitHub OAuth data.
   * If user exists, update their profile and last login.
   * If user doesn't exist, create them.
   *
   * Intentionally does NOT touch `github_installation_id`. That column is
   * managed separately by {@link setGitHubInstallationId} so a returning
   * sign-in (which has no `installation_id` in its callback) never clobbers
   * the previously-stored value.
   */
  upsertFromGitHub(input: UserCreateInput): User {
    const existing = this.findByGitHubId(input.githubId);

    if (existing) {
      return this.updateOnLogin(existing.id, input);
    }

    return this.create(input);
  }

  /**
   * Persist the GitHub App installation ID for a user.
   *
   * Called from the `/auth/github/callback` handler when GitHub returns
   * `installation_id` (which happens on the first install + identify
   * round-trip). Passing `null` explicitly clears the column, which is only
   * useful in tests; production code should only call this with a finite
   * integer.
   *
   * @returns true if a row was updated, false otherwise (no such user).
   */
  setGitHubInstallationId(userId: string, installationId: number | null): boolean {
    const stmt = this.db.prepare(`
      UPDATE users
      SET github_installation_id = ?
      WHERE id = ?
    `);
    const result = stmt.run(installationId, userId);
    return result.changes > 0;
  }
}
