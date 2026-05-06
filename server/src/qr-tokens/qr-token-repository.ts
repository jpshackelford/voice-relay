import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'crypto';
import type { QrToken, QrTokenCreateInput, QrTokenValidation } from './types.js';
import { DEFAULT_QR_TOKEN_TTL_MS } from './types.js';

interface QrTokenRow {
  id: string;
  token: string;
  workspace_id: string;
  session_id: string;
  expires_at: string;
  created_at: string;
}

function rowToQrToken(row: QrTokenRow): QrToken {
  return {
    id: row.id,
    token: row.token,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Repository for managing time-limited QR tokens.
 * 
 * QR tokens provide an additional layer of security for workspaces
 * that have enabled requireQrToken. When enabled, users must scan
 * a QR code with a valid, unexpired token to auto-join a session.
 * This prevents URL sharing/bookmarking from bypassing workspace security.
 */
export class QrTokenRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Generate a cryptographically secure token string.
   * Returns a 32-character hex string (128 bits of entropy).
   */
  private generateToken(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Create a new QR token for a workspace session.
   * Automatically cleans up expired tokens on creation.
   */
  create(input: QrTokenCreateInput): QrToken {
    // Clean up expired tokens (lazy cleanup)
    this.cleanupExpired();

    const id = randomUUID();
    const token = this.generateToken();
    const ttlMs = input.ttlMs ?? DEFAULT_QR_TOKEN_TTL_MS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const stmt = this.db.prepare(`
      INSERT INTO qr_tokens (id, token, workspace_id, session_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      token,
      input.workspaceId,
      input.sessionId,
      expiresAt.toISOString(),
      now.toISOString()
    );

    return {
      id,
      token,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    };
  }

  /**
   * Find a QR token by its token string.
   */
  findByToken(token: string): QrToken | null {
    const stmt = this.db.prepare<[string], QrTokenRow>(`
      SELECT id, token, workspace_id, session_id, expires_at, created_at
      FROM qr_tokens WHERE token = ?
    `);
    const row = stmt.get(token);
    return row ? rowToQrToken(row) : null;
  }

  /**
   * Validate a QR token for auto-join.
   * Checks that the token exists, hasn't expired, and matches
   * the workspace/session being joined.
   * 
   * @param token - The token string to validate
   * @param workspaceId - The workspace being joined
   * @param sessionId - Optional session ID to validate against
   */
  validate(token: string, workspaceId: string, sessionId?: string): QrTokenValidation {
    const qrToken = this.findByToken(token);

    if (!qrToken) {
      return { valid: false, error: 'NOT_FOUND' };
    }

    // Check expiration
    const now = new Date();
    const expiresAt = new Date(qrToken.expiresAt);
    if (now > expiresAt) {
      return { valid: false, error: 'EXPIRED', token: qrToken };
    }

    // Check workspace match
    if (qrToken.workspaceId !== workspaceId) {
      return { valid: false, error: 'WORKSPACE_MISMATCH', token: qrToken };
    }

    // Check session match if provided
    if (sessionId && qrToken.sessionId !== sessionId) {
      return { valid: false, error: 'SESSION_MISMATCH', token: qrToken };
    }

    return { valid: true, token: qrToken };
  }

  /**
   * Delete expired tokens from the database.
   * Called automatically during token creation (lazy cleanup).
   */
  cleanupExpired(): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM qr_tokens WHERE expires_at < ?
    `);
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Delete all tokens for a specific session.
   * Useful when a session ends or is archived.
   */
  deleteBySession(sessionId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM qr_tokens WHERE session_id = ?
    `);
    const result = stmt.run(sessionId);
    return result.changes;
  }

  /**
   * Delete all tokens for a specific workspace.
   * Useful when a workspace is deleted.
   */
  deleteByWorkspace(workspaceId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM qr_tokens WHERE workspace_id = ?
    `);
    const result = stmt.run(workspaceId);
    return result.changes;
  }

  /**
   * Get the count of active (non-expired) tokens.
   * Useful for monitoring/debugging.
   */
  getActiveCount(): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare<[string], { count: number }>(`
      SELECT COUNT(*) as count FROM qr_tokens WHERE expires_at > ?
    `);
    const row = stmt.get(now);
    return row?.count ?? 0;
  }
}
