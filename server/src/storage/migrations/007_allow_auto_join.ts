import type { Migration } from '../migrator.js';

/**
 * Add allow_auto_join setting to workspace_settings.
 * 
 * Security improvement: Allow workspace owners to control whether
 * users can auto-join via QR code links without a join code.
 * 
 * SECURITY POSTURE:
 * This migration creates a complex but deliberate security posture when
 * combined with the application code defaults:
 * 
 * - Existing workspaces with settings rows:
 *   → allow_auto_join=1 (DEFAULT 1 applies during ALTER TABLE)
 *   → Backward compatible: existing QR code flows continue to work
 * 
 * - Existing workspaces without settings rows (edge case):
 *   → Router code falls back to true (allowAutoJoin ?? true)
 *   → Backward compatible: these rare workspaces still work
 * 
 * - New workspaces created after this migration:
 *   → App code explicitly sets allow_auto_join=0 on workspace creation
 *   → Security-first: owners must opt-in to auto-join
 * 
 * This design prioritizes not breaking existing deployments while
 * adopting a secure-by-default posture for new workspaces.
 */
export const migration: Migration = {
  version: 7,
  name: 'allow_auto_join',
  
  up: `
    -- Add allow_auto_join column with default true for backward compatibility
    -- See JSDoc above for full security posture documentation
    ALTER TABLE workspace_settings ADD COLUMN allow_auto_join INTEGER NOT NULL DEFAULT 1;
  `,
  
  down: `
    -- SQLite doesn't support DROP COLUMN directly, but this is rarely needed
    -- For rollback, would need to recreate table without this column
  `,
};
