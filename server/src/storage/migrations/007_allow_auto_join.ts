import type { Migration } from '../migrator.js';

/**
 * Add allow_auto_join setting to workspace_settings.
 * 
 * Security improvement: Allow workspace owners to control whether
 * users can auto-join via QR code links without a join code.
 * 
 * Default is 1 (true) for backward compatibility with existing
 * workspaces and the QR code join flow.
 */
export const migration: Migration = {
  version: 7,
  name: 'allow_auto_join',
  
  up: `
    -- Add allow_auto_join column with default true for backward compatibility
    ALTER TABLE workspace_settings ADD COLUMN allow_auto_join INTEGER NOT NULL DEFAULT 1;
  `,
  
  down: `
    -- SQLite doesn't support DROP COLUMN directly, but this is rarely needed
    -- For rollback, would need to recreate table without this column
  `,
};
