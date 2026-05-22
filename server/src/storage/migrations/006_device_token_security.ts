import type { Migration } from '../migrator.js';

/**
 * Migration 006: Device Token Security Improvements
 * 
 * SECURITY FIX: Remove plaintext device tokens from database.
 * Only store hashed tokens - plaintext tokens are returned once on creation.
 * 
 * Also adds:
 * - token_expires_at: Token expiration for automatic invalidation
 * - UNIQUE constraint on device_token_hash
 * 
 * Note: SQLite doesn't support DROP COLUMN in older versions (pre-3.35.0).
 * We recreate the table to ensure compatibility with production SQLite.
 */
export const migration: Migration = {
  version: 6,
  name: 'device_token_security',
  destructive: true,
  
  up: `
    -- SQLite compatibility: recreate devices table without device_token column
    -- Add token_expires_at for token expiration support
    CREATE TABLE devices_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      device_token_hash TEXT UNIQUE,
      token_expires_at TEXT,
      last_seen_at TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    
    -- Copy existing data (without plaintext token)
    INSERT INTO devices_new (id, workspace_id, name, mode, device_token_hash, last_seen_at, config, created_at)
    SELECT id, workspace_id, name, mode, device_token_hash, last_seen_at, config, created_at
    FROM devices;
    
    -- Drop old table and indexes
    DROP INDEX IF EXISTS idx_devices_workspace;
    DROP INDEX IF EXISTS idx_devices_token_hash;
    DROP TABLE devices;
    
    -- Rename new table
    ALTER TABLE devices_new RENAME TO devices;
    
    -- Recreate indexes
    CREATE INDEX idx_devices_workspace ON devices(workspace_id);
    CREATE INDEX idx_devices_token_hash ON devices(device_token_hash);
    CREATE INDEX idx_devices_expires ON devices(token_expires_at);
  `,
  
  down: `
    -- Reverse: add back device_token column (for rollback only)
    CREATE TABLE devices_old (
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
    
    INSERT INTO devices_old (id, workspace_id, name, mode, device_token_hash, last_seen_at, config, created_at)
    SELECT id, workspace_id, name, mode, device_token_hash, last_seen_at, config, created_at
    FROM devices;
    
    DROP INDEX IF EXISTS idx_devices_workspace;
    DROP INDEX IF EXISTS idx_devices_token_hash;
    DROP INDEX IF EXISTS idx_devices_expires;
    DROP TABLE devices;
    
    ALTER TABLE devices_old RENAME TO devices;
    
    CREATE INDEX idx_devices_workspace ON devices(workspace_id);
    CREATE INDEX idx_devices_token_hash ON devices(device_token_hash);
  `,
};
