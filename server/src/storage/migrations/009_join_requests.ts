import type { Migration } from '../migrator.js';

/**
 * Add workspace join request support for approval-based workspace access.
 * 
 * FEATURE (Issue #40):
 * This migration adds infrastructure for pending join requests when
 * workspace.allowAutoJoin is false. Users scanning QR codes will
 * create pending requests that workspace owners can approve/deny.
 * 
 * NEW TABLE: workspace_join_requests
 * - Stores pending/resolved join requests
 * - Status: pending, approved, denied, expired
 * - One pending request per user/workspace at a time
 * - Requests expire after 5 minutes (handled in application)
 * 
 * SECURITY CONSIDERATIONS:
 * - Only workspace owners can approve/deny requests
 * - Expired requests are cleaned up lazily or via background task
 * - Rate limiting on request-join endpoint prevents spam
 */
export const migration: Migration = {
  version: 9,
  name: 'join_requests',
  destructive: true,
  
  up: `
    -- Create workspace_join_requests table for approval-based workspace access
    CREATE TABLE IF NOT EXISTS workspace_join_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolved_by TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    );
    
    -- Index for efficient lookup of pending requests by workspace (owner view)
    CREATE INDEX IF NOT EXISTS idx_join_requests_workspace_status 
      ON workspace_join_requests(workspace_id, status);
    
    -- Index for efficient lookup of user's pending requests
    CREATE INDEX IF NOT EXISTS idx_join_requests_user_status 
      ON workspace_join_requests(user_id, status);
    
    -- Index for cleanup of expired pending requests
    CREATE INDEX IF NOT EXISTS idx_join_requests_created_at 
      ON workspace_join_requests(created_at) WHERE status = 'pending';
    
    -- Unique constraint: one pending request per user/workspace
    CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_unique_pending 
      ON workspace_join_requests(workspace_id, user_id) WHERE status = 'pending';
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_join_requests_unique_pending;
    DROP INDEX IF EXISTS idx_join_requests_created_at;
    DROP INDEX IF EXISTS idx_join_requests_user_status;
    DROP INDEX IF EXISTS idx_join_requests_workspace_status;
    DROP TABLE IF EXISTS workspace_join_requests;
  `,
};
