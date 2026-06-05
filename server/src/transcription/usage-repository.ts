import type Database from 'better-sqlite3';

/**
 * Repository for the `workspace_stt_usage` table (#386).
 *
 * Per-workspace, per-month minute counter that the token broker checks
 * before minting new Deepgram tokens. The schema lives in migration
 * 019. `minutes_used` is REAL so partial-minute sessions (the common
 * case for kiosk Q&A) don't round to zero.
 */

export interface StttUsageRow {
  workspaceId: string;
  /** `YYYY-MM`, UTC. */
  month: string;
  minutesUsed: number;
}

/**
 * Format a JS `Date` (or "now") as the `YYYY-MM` key we use for the
 * monthly bucket. Always UTC so workspaces in different timezones don't
 * see their cap reset at midnight local time.
 */
export function currentUtcMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export class StttUsageRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Return current-month minutes used for a workspace, defaulting to 0
   * when no row exists yet (workspaces that haven't streamed this
   * month).
   */
  getCurrentMonthMinutes(
    workspaceId: string,
    now: Date = new Date(),
  ): number {
    const month = currentUtcMonth(now);
    const stmt = this.db.prepare<
      [string, string],
      { minutes_used: number } | undefined
    >(`
      SELECT minutes_used FROM workspace_stt_usage
      WHERE workspace_id = ? AND month = ?
    `);
    const row = stmt.get(workspaceId, month);
    return row?.minutes_used ?? 0;
  }

  /**
   * Increment the current-month counter by `minutes`. Negative or zero
   * values are clamped to zero so the counter only ever moves forward.
   * Uses an UPSERT so the first session of the month materialises the
   * row implicitly.
   */
  incrementMinutes(
    workspaceId: string,
    minutes: number,
    now: Date = new Date(),
  ): number {
    // `Math.max(0, NaN)` is NaN, which SQLite rejects against the
    // NOT NULL constraint. Coerce non-finite + negative values to 0.
    const delta =
      Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    const month = currentUtcMonth(now);
    const nowIso = now.toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO workspace_stt_usage (workspace_id, month, minutes_used, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (workspace_id, month) DO UPDATE
        SET minutes_used = minutes_used + excluded.minutes_used,
            updated_at = excluded.updated_at
    `);
    stmt.run(workspaceId, month, delta, nowIso);
    return this.getCurrentMonthMinutes(workspaceId, now);
  }
}
