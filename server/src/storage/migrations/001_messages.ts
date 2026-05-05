import type { Migration } from '../migrator.js';

export const migration: Migration = {
  version: 1,
  name: 'messages',
  
  up: `
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utterance_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_messages_created_at;
    DROP TABLE IF EXISTS messages;
  `,
};
