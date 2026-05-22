import type { Migration } from '../migrator.js';

/**
 * Add QR token support for signed, time-limited QR codes.
 * 
 * SECURITY ENHANCEMENT (Issue #18):
 * This migration adds infrastructure for QR-specific token verification
 * to ensure users actually scanned a QR code rather than
 * bookmarking/sharing session URLs.
 * 
 * NEW TABLE: qr_tokens
 * - Stores time-limited tokens generated when displaying QR codes
 * - Tokens expire after 5 minutes (configurable in application)
 * - Validated on auto-join to verify the user scanned the QR code
 * 
 * NEW SETTING: require_qr_token in workspace_settings
 * - Default: 0 (false) for backward compatibility
 * - When enabled, auto-join requires a valid QR token
 * - Workspace owners can opt-in for stricter security
 */
export const migration: Migration = {
  version: 8,
  name: 'qr_tokens',
  destructive: true,
  
  up: `
    -- Create qr_tokens table for time-limited QR code verification
    CREATE TABLE IF NOT EXISTS qr_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    
    -- Index for efficient token lookups
    CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_tokens(token);
    
    -- Index for cleanup of expired tokens
    CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires_at ON qr_tokens(expires_at);
    
    -- Add require_qr_token setting (default false for backward compatibility)
    ALTER TABLE workspace_settings ADD COLUMN require_qr_token INTEGER NOT NULL DEFAULT 0;
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_qr_tokens_expires_at;
    DROP INDEX IF EXISTS idx_qr_tokens_token;
    DROP TABLE IF EXISTS qr_tokens;
    -- Note: Cannot easily remove require_qr_token column in SQLite
  `,
};
