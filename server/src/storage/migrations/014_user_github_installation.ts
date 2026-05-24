import type { Migration } from '../migrator.js';

/**
 * Migration 014: GitHub App installation tracking on users
 *
 * Adds a nullable `github_installation_id` column on the `users` table so we
 * can persist the installation ID that GitHub returns on the App's install +
 * identify callback (`?installation_id=...&setup_action=install`).
 *
 * Notes:
 * - Additive `ADD COLUMN`, nullable, no default. Safe on a populated
 *   production database. Pre-existing users keep `NULL` until their next
 *   sign-in, which is the documented backfill strategy in #282.
 * - Marked `destructive: true` because the `down` direction drops the column
 *   and would permanently lose every user's installation linkage.
 */
export const migration: Migration = {
  version: 14,
  name: 'user_github_installation',
  destructive: true,

  up: `
    ALTER TABLE users ADD COLUMN github_installation_id INTEGER;
  `,

  down: `
    ALTER TABLE users DROP COLUMN github_installation_id;
  `,
};
