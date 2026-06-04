import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { AuthIdentity, AuthIdentityCreateInput } from './types.js';

interface AuthIdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  provider_username: string | null;
  created_at: string;
}

function rowToIdentity(row: AuthIdentityRow): AuthIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    providerUsername: row.provider_username,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `id, user_id, provider, provider_user_id, provider_username, created_at`;

/**
 * Repository for `auth_identities` — the provider-agnostic join table
 * introduced by migration 017 (#383). One row per (user, provider) pair;
 * the global `UNIQUE(provider, provider_user_id)` index prevents
 * collisions across users.
 *
 * `UserRepository` is the public-facing interface for "look up a user
 * by their GitHub login"; this repository is the lower-level surface
 * used by upcoming non-GitHub auth flows (Google, magic link, …) and by
 * code that needs to enumerate or revoke a user's identities.
 */
export class AuthIdentityRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Look up an identity by provider + provider-side id. Returns `null`
   * when no row matches.
   */
  findByProvider(
    provider: string,
    providerUserId: string
  ): AuthIdentity | null {
    const row = this.db
      .prepare<[string, string], AuthIdentityRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM auth_identities
         WHERE provider = ? AND provider_user_id = ?`
      )
      .get(provider, providerUserId);
    return row ? rowToIdentity(row) : null;
  }

  /** List every identity attached to a user, oldest-first. */
  listForUser(userId: string): AuthIdentity[] {
    const rows = this.db
      .prepare<[string], AuthIdentityRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM auth_identities
         WHERE user_id = ?
         ORDER BY created_at ASC`
      )
      .all(userId);
    return rows.map(rowToIdentity);
  }

  /**
   * Insert a new identity row for `userId`. Throws when
   * `(provider, providerUserId)` is already attached to a different
   * user — the caller should treat that as "this identity belongs to
   * someone else" and refuse the link.
   */
  create(userId: string, input: AuthIdentityCreateInput): AuthIdentity {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_identities (
           id, user_id, provider, provider_user_id, provider_username, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.provider,
        input.providerUserId,
        input.providerUsername ?? null,
        now
      );
    return {
      id,
      userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      providerUsername: input.providerUsername ?? null,
      createdAt: now,
    };
  }

  /**
   * Idempotent upsert. If `(provider, providerUserId)` is already
   * present, updates the `provider_username` shadow (provider profiles
   * change names) and returns the existing row; otherwise inserts.
   */
  upsert(userId: string, input: AuthIdentityCreateInput): AuthIdentity {
    const existing = this.findByProvider(input.provider, input.providerUserId);
    if (existing) {
      if (existing.userId !== userId) {
        throw new Error(
          `auth identity ${input.provider}:${input.providerUserId} already ` +
            `belongs to user ${existing.userId}; refusing to reassign`
        );
      }
      if (
        input.providerUsername !== undefined &&
        input.providerUsername !== existing.providerUsername
      ) {
        this.db
          .prepare(
            `UPDATE auth_identities SET provider_username = ? WHERE id = ?`
          )
          .run(input.providerUsername, existing.id);
        return { ...existing, providerUsername: input.providerUsername };
      }
      return existing;
    }
    return this.create(userId, input);
  }
}
