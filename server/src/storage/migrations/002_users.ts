import type { Migration } from '../migrator.js';

export const migration: Migration = {
  version: 2,
  name: 'users',
  destructive: true,
  
  up: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id INTEGER UNIQUE NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
  `,
  
  down: `
    DROP INDEX IF EXISTS idx_users_github_id;
    DROP TABLE IF EXISTS users;
  `,
};
