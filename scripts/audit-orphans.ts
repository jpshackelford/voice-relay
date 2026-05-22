#!/usr/bin/env node
/**
 * Foreign-key orphan auditor CLI for the voice-relay SQLite database.
 *
 * Issue #262. Opens the database read-only (no PRAGMA, no migrations) and
 * delegates to `server/src/storage/audit-orphans.ts` to count rows whose
 * declared FK target does not exist. Designed to be run against a copy of
 * the production database, or read-only against production, BEFORE deploying
 * the `foreign_keys = ON` startup PRAGMA and the orphan-cleanup migration
 * (013), so an operator can sanity-check what would be deleted.
 *
 * Usage:
 *   npx tsx scripts/audit-orphans.ts <path-to-messages.db>
 *
 * Exit codes:
 *   0  no orphans found
 *   1  orphans found (operator should inspect output)
 *   2  invocation / IO error
 */

import Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { auditOrphans, formatOrphanReport } from '../server/src/storage/audit-orphans';

function main(): number {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx scripts/audit-orphans.ts <path-to-messages.db>');
    return 2;
  }
  const dbPath = resolve(arg);
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    console.error(`audit-orphans: not a file: ${dbPath}`);
    return 2;
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error(`audit-orphans: failed to open ${dbPath}: ${(e as Error).message}`);
    return 2;
  }

  try {
    const report = auditOrphans(db);
    process.stdout.write(formatOrphanReport(dbPath, report) + '\n');
    return report.totalOrphans === 0 ? 0 : 1;
  } finally {
    db.close();
  }
}

process.exit(main());
