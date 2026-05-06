import type { Migration } from '../migrator.js';

/**
 * Add allow_auto_join setting to workspace_settings.
 * 
 * Security improvement: Allow workspace owners to control whether
 * users can auto-join via QR code links without a join code.
 * 
 * SECURITY POSTURE:
 * This migration creates a deliberate security posture combined with
 * the application code:
 * 
 * - Existing workspaces WITH settings rows:
 *   → allow_auto_join=1 (DEFAULT 1 applies during ALTER TABLE)
 *   → Backward compatible: existing QR code flows continue to work
 * 
 * - Existing workspaces WITHOUT settings rows (edge case):
 *   → Router code falls back to FALSE (security-first)
 *   → These rare workspaces will deny auto-join until owner opts in
 * 
 * - New workspaces created after this migration:
 *   → WorkspaceRepository.create() automatically creates settings row
 *     with allow_auto_join=0
 *   → Security-first: owners must explicitly opt-in to auto-join
 * 
 * This design prioritizes not breaking existing deployments (production
 * workspaces with settings rows continue working) while adopting a 
 * secure-by-default posture for new workspaces and edge cases.
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
