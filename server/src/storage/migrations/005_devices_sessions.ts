import type { Migration } from '../migrator.js';

/**
 * Migration 005: Devices and Sessions tables
 * 
 * Phase 5 introduces:
 * - Persistent device tokens for reconnection across page refreshes
 * - Session tracking within workspaces (multiple conversations)
 * 
 * Note: Existing messages table is left as-is for backward compatibility.
 * Sessions provide a new layer of organization without breaking existing data.
 */
export const migration: Migration = {
  version: 5,
  name: 'devices_sessions',
  
  up: `
    -- Devices table: persists device identity across page refreshes
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      device_token TEXT UNIQUE,
      device_token_hash TEXT,
      last_seen_at TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_devices_workspace ON devices(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(device_token_hash);

    -- Sessions table: conversation periods within a workspace
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      metadata TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

    -- Session devices: tracks which devices are viewing which session
    CREATE TABLE IF NOT EXISTS session_devices (
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, device_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- Add session_id column to messages table for session-scoped history
    -- Using ALTER TABLE to preserve existing data
    ALTER TABLE messages ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_messages_session;
    -- SQLite doesn't support DROP COLUMN directly in older versions
    -- We recreate the table without session_id
    CREATE TABLE messages_backup AS SELECT 
      id, utterance_id, workspace_id, sender_id, sender_name, text, partial, created_at
    FROM messages;
    DROP TABLE messages;
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utterance_id TEXT NOT NULL,
      workspace_id TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO messages (id, utterance_id, workspace_id, sender_id, sender_name, text, partial, created_at)
    SELECT id, utterance_id, workspace_id, sender_id, sender_name, text, partial, created_at FROM messages_backup;
    DROP TABLE messages_backup;

    DROP TABLE IF EXISTS session_devices;
    DROP INDEX IF EXISTS idx_sessions_status;
    DROP INDEX IF EXISTS idx_sessions_workspace;
    DROP TABLE IF EXISTS sessions;
    DROP INDEX IF EXISTS idx_devices_token_hash;
    DROP INDEX IF EXISTS idx_devices_workspace;
    DROP TABLE IF EXISTS devices;
  `,
};
