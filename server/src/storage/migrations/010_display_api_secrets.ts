import type { Migration } from '../migrator.js';

/**
 * Migration 010: Display API secrets for sessions
 * 
 * Adds per-session encrypted secrets for authenticating display API calls.
 * This prevents unauthorized content injection into kiosk displays.
 * 
 * Security notes:
 * - Secrets are 32 bytes (256 bits) of cryptographic randomness
 * - Encrypted at rest using AES-256-GCM (same as workspace API keys)
 * - Per-session scope limits blast radius of any compromise
 * - Secret automatically invalidated when session ends
 */
export const migration: Migration = {
  version: 10,
  name: 'display_api_secrets',
  
  up: `
    -- Add encrypted display API secret columns to sessions table
    ALTER TABLE sessions ADD COLUMN display_api_secret_encrypted TEXT;
    ALTER TABLE sessions ADD COLUMN display_api_secret_iv TEXT;
    ALTER TABLE sessions ADD COLUMN display_api_secret_tag TEXT;
  `,
  
  down: `
    -- SQLite doesn't support DROP COLUMN in older versions, so we recreate the table
    CREATE TABLE sessions_backup AS SELECT 
      id, workspace_id, name, status, started_at, ended_at, metadata
    FROM sessions;
    DROP TABLE sessions;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      metadata TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    INSERT INTO sessions (id, workspace_id, name, status, started_at, ended_at, metadata)
    SELECT id, workspace_id, name, status, started_at, ended_at, metadata FROM sessions_backup;
    DROP TABLE sessions_backup;
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `,
};
