import type { Migration } from '../migrator.js';

export const migration: Migration = {
  version: 4,
  name: 'messages_workspace',
  
  up: `
    ALTER TABLE messages ADD COLUMN workspace_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON messages(workspace_id);
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_messages_workspace_id;
    -- SQLite doesn't support DROP COLUMN directly, but the column will be ignored
    -- In a real scenario, we'd need to recreate the table
  `,
};
