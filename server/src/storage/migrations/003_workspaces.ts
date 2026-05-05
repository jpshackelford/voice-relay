import type { Migration } from '../migrator.js';

export const migration: Migration = {
  version: 3,
  name: 'workspaces',
  
  up: `
    -- Workspaces table
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      join_code TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
    CREATE INDEX IF NOT EXISTS idx_workspaces_join_code ON workspaces(join_code);

    -- Workspace settings (sensitive data)
    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      openhands_api_key_encrypted TEXT,
      openhands_api_key_iv TEXT,
      openhands_api_key_tag TEXT,
      tts_voice TEXT,
      stt_language TEXT,
      updated_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    -- Workspace members (for future multi-user support)
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_workspace_members_user;
    DROP TABLE IF EXISTS workspace_members;
    DROP TABLE IF EXISTS workspace_settings;
    DROP INDEX IF EXISTS idx_workspaces_join_code;
    DROP INDEX IF EXISTS idx_workspaces_slug;
    DROP INDEX IF EXISTS idx_workspaces_owner;
    DROP TABLE IF EXISTS workspaces;
  `,
};
