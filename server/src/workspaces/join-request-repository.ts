import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export type JoinRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface JoinRequest {
  id: string;
  workspaceId: string;
  userId: string;
  status: JoinRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface JoinRequestWithUser extends JoinRequest {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

interface JoinRequestRow {
  id: string;
  workspace_id: string;
  user_id: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface JoinRequestWithUserRow extends JoinRequestRow {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

function rowToJoinRequest(row: JoinRequestRow): JoinRequest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status as JoinRequestStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

function rowToJoinRequestWithUser(row: JoinRequestWithUserRow): JoinRequestWithUser {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status as JoinRequestStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
  };
}

/** Default expiration time for pending requests: 5 minutes */
const DEFAULT_EXPIRATION_MINUTES = 5;

export class JoinRequestRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Create a new join request. Returns existing pending request if one exists.
   */
  create(workspaceId: string, userId: string): JoinRequest {
    // Check for existing pending request
    const existing = this.findPendingByUserAndWorkspace(userId, workspaceId);
    if (existing) {
      return existing;
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO workspace_join_requests (id, workspace_id, user_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    stmt.run(id, workspaceId, userId, now);

    return {
      id,
      workspaceId,
      userId,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      resolvedBy: null,
    };
  }

  /**
   * Find a join request by ID.
   */
  findById(id: string): JoinRequest | null {
    const stmt = this.db.prepare<[string], JoinRequestRow>(`
      SELECT id, workspace_id, user_id, status, created_at, resolved_at, resolved_by
      FROM workspace_join_requests WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToJoinRequest(row) : null;
  }

  /**
   * Find a pending join request by user and workspace.
   */
  findPendingByUserAndWorkspace(userId: string, workspaceId: string): JoinRequest | null {
    const stmt = this.db.prepare<[string, string], JoinRequestRow>(`
      SELECT id, workspace_id, user_id, status, created_at, resolved_at, resolved_by
      FROM workspace_join_requests 
      WHERE user_id = ? AND workspace_id = ? AND status = 'pending'
    `);
    const row = stmt.get(userId, workspaceId);
    return row ? rowToJoinRequest(row) : null;
  }

  /**
   * Get all pending requests for a workspace (with user info).
   * Automatically marks expired requests as expired.
   */
  findPendingByWorkspace(workspaceId: string): JoinRequestWithUser[] {
    // First, expire any old pending requests
    this.expireOldRequests(workspaceId);

    const stmt = this.db.prepare<[string], JoinRequestWithUserRow>(`
      SELECT 
        jr.id, jr.workspace_id, jr.user_id, jr.status, jr.created_at, jr.resolved_at, jr.resolved_by,
        u.username, u.display_name, u.avatar_url
      FROM workspace_join_requests jr
      JOIN users u ON jr.user_id = u.id
      WHERE jr.workspace_id = ? AND jr.status = 'pending'
      ORDER BY jr.created_at ASC
    `);
    const rows = stmt.all(workspaceId);
    return rows.map(rowToJoinRequestWithUser);
  }

  /**
   * Approve a join request.
   */
  approve(requestId: string, resolvedByUserId: string): JoinRequest | null {
    const request = this.findById(requestId);
    if (!request || request.status !== 'pending') {
      return null;
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workspace_join_requests 
      SET status = 'approved', resolved_at = ?, resolved_by = ?
      WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(now, resolvedByUserId, requestId);

    if (result.changes === 0) {
      return null;
    }

    // Audit log
    console.log('[JoinRequest] Approved:', {
      requestId,
      workspaceId: request.workspaceId,
      userId: request.userId,
      resolvedBy: resolvedByUserId,
      timestamp: now,
    });

    return this.findById(requestId);
  }

  /**
   * Deny a join request.
   */
  deny(requestId: string, resolvedByUserId: string): JoinRequest | null {
    const request = this.findById(requestId);
    if (!request || request.status !== 'pending') {
      return null;
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workspace_join_requests 
      SET status = 'denied', resolved_at = ?, resolved_by = ?
      WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(now, resolvedByUserId, requestId);

    if (result.changes === 0) {
      return null;
    }

    // Audit log
    console.log('[JoinRequest] Denied:', {
      requestId,
      workspaceId: request.workspaceId,
      userId: request.userId,
      resolvedBy: resolvedByUserId,
      timestamp: now,
    });

    return this.findById(requestId);
  }

  /**
   * Cancel a pending join request (by the requesting user).
   */
  cancel(requestId: string, userId: string): boolean {
    const request = this.findById(requestId);
    if (!request || request.status !== 'pending' || request.userId !== userId) {
      return false;
    }

    const stmt = this.db.prepare(`
      DELETE FROM workspace_join_requests WHERE id = ? AND user_id = ? AND status = 'pending'
    `);
    const result = stmt.run(requestId, userId);

    if (result.changes > 0) {
      console.log('[JoinRequest] Cancelled:', {
        requestId,
        workspaceId: request.workspaceId,
        userId,
        timestamp: new Date().toISOString(),
      });
    }

    return result.changes > 0;
  }

  /**
   * Mark a request as expired.
   */
  expire(requestId: string): JoinRequest | null {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workspace_join_requests 
      SET status = 'expired', resolved_at = ?
      WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(now, requestId);

    if (result.changes === 0) {
      return null;
    }

    return this.findById(requestId);
  }

  /**
   * Expire old pending requests for a workspace (lazy cleanup).
   * Called automatically when querying pending requests.
   */
  expireOldRequests(workspaceId?: string, expirationMinutes = DEFAULT_EXPIRATION_MINUTES): number {
    const cutoff = new Date(Date.now() - expirationMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    let stmt;
    let result;

    if (workspaceId) {
      stmt = this.db.prepare(`
        UPDATE workspace_join_requests 
        SET status = 'expired', resolved_at = ?
        WHERE workspace_id = ? AND status = 'pending' AND created_at < ?
      `);
      result = stmt.run(now, workspaceId, cutoff);
    } else {
      stmt = this.db.prepare(`
        UPDATE workspace_join_requests 
        SET status = 'expired', resolved_at = ?
        WHERE status = 'pending' AND created_at < ?
      `);
      result = stmt.run(now, cutoff);
    }

    if (result.changes > 0) {
      console.log('[JoinRequest] Expired old requests:', {
        workspaceId: workspaceId || 'all',
        count: result.changes,
        cutoff,
      });
    }

    return result.changes;
  }

  /**
   * Check if a request is expired (based on creation time, not status).
   * Useful for checking before sending WebSocket notifications.
   */
  isExpired(request: JoinRequest, expirationMinutes = DEFAULT_EXPIRATION_MINUTES): boolean {
    const createdAt = new Date(request.createdAt).getTime();
    const expirationTime = createdAt + expirationMinutes * 60 * 1000;
    return Date.now() > expirationTime;
  }
}
