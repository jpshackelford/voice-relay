/**
 * Foreign-key orphan auditor for the voice-relay SQLite schema.
 *
 * Issue #262. This module enumerates every declared FK in migrations 001–011
 * and counts rows whose declared parent does not exist. It is read-only.
 *
 * A thin CLI wrapper lives at `scripts/audit-orphans.ts` and exits non-zero
 * if any orphans are found, so operators can run it on a copy of the
 * production database before deploying the `foreign_keys = ON` PRAGMA + the
 * orphan-cleanup migration (013).
 */

import type Database from 'better-sqlite3';

export interface OrphanCheck {
  /** Human-readable check label, used in logs and reports. */
  label: string;
  /** Child table name (the one with the FK column). */
  childTable: string;
  /** FK column on the child table. */
  childColumn: string;
  /** Parent table the FK references. */
  parentTable: string;
  /** Parent column the FK references (almost always `id`). */
  parentColumn: string;
  /**
   * `cascade`  – ON DELETE CASCADE, cleanup is `DELETE FROM child WHERE …`
   * `set-null` – ON DELETE SET NULL, cleanup is `UPDATE child SET col = NULL`
   * `restrict` – no ON DELETE clause; cleanup must be manual
   */
  action: 'cascade' | 'set-null' | 'restrict';
}

export interface OrphanResult extends OrphanCheck {
  count: number;
  skipped: boolean;
  skipReason?: string;
}

/** Every FK declared across migrations 001–011. */
export const ORPHAN_CHECKS: OrphanCheck[] = [
  {
    label: 'workspaces.owner_id -> users.id (RESTRICT)',
    childTable: 'workspaces',
    childColumn: 'owner_id',
    parentTable: 'users',
    parentColumn: 'id',
    action: 'restrict',
  },
  {
    label: 'workspace_settings.workspace_id -> workspaces.id',
    childTable: 'workspace_settings',
    childColumn: 'workspace_id',
    parentTable: 'workspaces',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'workspace_members.workspace_id -> workspaces.id',
    childTable: 'workspace_members',
    childColumn: 'workspace_id',
    parentTable: 'workspaces',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'workspace_members.user_id -> users.id',
    childTable: 'workspace_members',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'devices.workspace_id -> workspaces.id',
    childTable: 'devices',
    childColumn: 'workspace_id',
    parentTable: 'workspaces',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'sessions.workspace_id -> workspaces.id',
    childTable: 'sessions',
    childColumn: 'workspace_id',
    parentTable: 'workspaces',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'session_devices.session_id -> sessions.id',
    childTable: 'session_devices',
    childColumn: 'session_id',
    parentTable: 'sessions',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'session_devices.device_id -> devices.id',
    childTable: 'session_devices',
    childColumn: 'device_id',
    parentTable: 'devices',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'messages.session_id -> sessions.id (SET NULL)',
    childTable: 'messages',
    childColumn: 'session_id',
    parentTable: 'sessions',
    parentColumn: 'id',
    action: 'set-null',
  },
  {
    label: 'qr_tokens.workspace_id -> workspaces.id',
    childTable: 'qr_tokens',
    childColumn: 'workspace_id',
    parentTable: 'workspaces',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'qr_tokens.session_id -> sessions.id',
    childTable: 'qr_tokens',
    childColumn: 'session_id',
    parentTable: 'sessions',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'workspace_join_requests.workspace_id -> workspaces.id',
    childTable: 'workspace_join_requests',
    childColumn: 'workspace_id',
    parentTable: 'workspaces',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'workspace_join_requests.user_id -> users.id',
    childTable: 'workspace_join_requests',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
    action: 'cascade',
  },
  {
    label: 'workspace_join_requests.resolved_by -> users.id (SET NULL)',
    childTable: 'workspace_join_requests',
    childColumn: 'resolved_by',
    parentTable: 'users',
    parentColumn: 'id',
    action: 'set-null',
  },
];

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { x: number } | undefined;
  return row !== undefined;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some(r => r.name === column);
}

/**
 * Run the FK orphan audit against an already-open database.
 *
 * Caller owns the connection lifecycle (and is responsible for opening it
 * read-only when auditing production). The audit issues only SELECT
 * statements; it never modifies data.
 */
export function auditOrphans(db: Database.Database): {
  results: OrphanResult[];
  totalOrphans: number;
} {
  const results: OrphanResult[] = [];
  let totalOrphans = 0;

  for (const check of ORPHAN_CHECKS) {
    if (!tableExists(db, check.childTable) || !tableExists(db, check.parentTable)) {
      results.push({
        ...check,
        count: 0,
        skipped: true,
        skipReason: `table missing (child=${check.childTable}, parent=${check.parentTable})`,
      });
      continue;
    }
    if (!columnExists(db, check.childTable, check.childColumn)) {
      results.push({
        ...check,
        count: 0,
        skipped: true,
        skipReason: `column missing (${check.childTable}.${check.childColumn})`,
      });
      continue;
    }

    const sql = `
      SELECT COUNT(*) AS cnt
      FROM ${check.childTable} c
      WHERE c.${check.childColumn} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${check.parentTable} p
          WHERE p.${check.parentColumn} = c.${check.childColumn}
        )
    `;
    const row = db.prepare(sql).get() as { cnt: number };
    totalOrphans += row.cnt;
    results.push({ ...check, count: row.cnt, skipped: false });
  }

  return { results, totalOrphans };
}

/**
 * Format an audit report as a plain-text table suitable for stdout.
 */
export function formatOrphanReport(
  dbPath: string,
  { results, totalOrphans }: { results: OrphanResult[]; totalOrphans: number }
): string {
  const lines: string[] = [];
  lines.push(`# voice-relay orphan audit`);
  lines.push(`# database: ${dbPath}`);
  lines.push(`# generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('check                                                              | action   | orphan_rows');
  lines.push('-------------------------------------------------------------------+----------+------------');
  for (const r of results) {
    const action = r.skipped ? 'skipped' : r.action;
    const count = r.skipped ? `(${r.skipReason})` : String(r.count);
    lines.push(`${r.label.padEnd(66)} | ${action.padEnd(8)} | ${count}`);
  }
  lines.push('');
  lines.push(`total orphans: ${totalOrphans}`);
  return lines.join('\n');
}
