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
  };
}

export class UserRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): User | null {
    const stmt = this.db.prepare<[string], UserRow>(`
      SELECT id, github_id, username, display_name, avatar_url, email, created_at, last_login_at
      FROM users WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToUser(row) : null;
  }

  findByGitHubId(githubId: number): User | null {
    const stmt = this.db.prepare<[number], UserRow>(`
      SELECT id, github_id, username, display_name, avatar_url, email, created_at, last_login_at
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
   */
  upsertFromGitHub(input: UserCreateInput): User {
    const existing = this.findByGitHubId(input.githubId);
    
    if (existing) {
      return this.updateOnLogin(existing.id, input);
    }
    
    return this.create(input);
  }
}
