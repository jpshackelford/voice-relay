/**
 * Repository for the durable operational state of an AI session
 * (issue #363).
 *
 * Backs the `session_ai_state` table introduced in migration 020. The
 * in-memory `AISession` (see `server/src/openhands.ts`) becomes a
 * cache of this row plus the live `WebSocket` and callbacks; every
 * state transition (`running` → `degraded`, `rebinding`, `ended`, etc.)
 * flows through `AISessionManager.transitionTo()` and lands here, so
 * the give-up decision survives a process restart.
 *
 * This repo mirrors the constructor-injection pattern of
 * `SessionRepository` so wiring in `server/src/index.ts` follows the
 * existing template. All methods are synchronous (better-sqlite3
 * `prepare`/`run`/`get`/`all`), atomic at the row level, and never
 * throw on missing rows — `findBySessionId` returns `null`,
 * `transitionTo` / `setRebindAttempts` / `deleteBySessionId` are
 * no-ops if the row doesn't exist.
 *
 * `rebind_attempts_json` is serialized as a JSON array of epoch-ms
 * timestamps. The `RebindWindowTracker` (see
 * `server/src/agent-driver/rebind.ts`) is storage-agnostic: this repo
 * persists/restores the array, and the tracker prunes it to the
 * rolling window on read.
 */

import type Database from 'better-sqlite3';

export type SessionAIStateName = 'running' | 'degraded' | 'rebinding' | 'ended';

/** Domain row returned by the repository (camelCase). */
export interface SessionAIStateRow {
  sessionId: string;
  conversationId: string;
  state: SessionAIStateName;
  stateReason: string | null;
  /** ISO timestamp of the last `transitionTo`. */
  stateChangedAt: string;
  /** Epoch-ms timestamps of recent successful rebinds (parsed from JSON). */
  rebindAttempts: number[];
  /** ISO timestamp of the last DB write. */
  updatedAt: string;
}

interface SessionAIStateDbRow {
  session_id: string;
  conversation_id: string;
  state: string;
  state_reason: string | null;
  state_changed_at: string;
  rebind_attempts_json: string | null;
  updated_at: string;
}

const SELECT_COLUMNS = `session_id, conversation_id, state, state_reason,
       state_changed_at, rebind_attempts_json, updated_at`;

function parseAttempts(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: drop any non-numeric entries that may have slipped in.
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  } catch {
    // Corrupt JSON should not crash the rehydrate pass. Treat as empty
    // history and let the next `setRebindAttempts` overwrite it.
    return [];
  }
}

function rowToDomain(row: SessionAIStateDbRow): SessionAIStateRow {
  return {
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    state: row.state as SessionAIStateName,
    stateReason: row.state_reason,
    stateChangedAt: row.state_changed_at,
    rebindAttempts: parseAttempts(row.rebind_attempts_json),
    updatedAt: row.updated_at,
  };
}

export interface SessionAIStateUpsertInput {
  sessionId: string;
  conversationId: string;
  state: SessionAIStateName;
  stateReason?: string | null;
  stateChangedAt?: string;
  rebindAttempts?: number[];
}

export class SessionAIStateRepository {
  constructor(private readonly db: Database.Database) {}

  /** Read the durable state row for a session, or `null` if there is none. */
  findBySessionId(sessionId: string): SessionAIStateRow | null {
    const stmt = this.db.prepare<[string], SessionAIStateDbRow>(`
      SELECT ${SELECT_COLUMNS}
      FROM session_ai_state
      WHERE session_id = ?
    `);
    const row = stmt.get(sessionId);
    return row ? rowToDomain(row) : null;
  }

  /** Read every row currently in a given lifecycle state. */
  listByState(state: SessionAIStateName): SessionAIStateRow[] {
    const stmt = this.db.prepare<[string], SessionAIStateDbRow>(`
      SELECT ${SELECT_COLUMNS}
      FROM session_ai_state
      WHERE state = ?
      ORDER BY state_changed_at DESC
    `);
    return stmt.all(state).map(rowToDomain);
  }

  /** Read every row regardless of state — for tracker seeding on boot. */
  listAll(): SessionAIStateRow[] {
    const stmt = this.db.prepare<[], SessionAIStateDbRow>(`
      SELECT ${SELECT_COLUMNS}
      FROM session_ai_state
      ORDER BY state_changed_at DESC
    `);
    return stmt.all().map(rowToDomain);
  }

  /**
   * Insert or replace the full row. Used when a fresh `AISession` is
   * created (initial `running` row) and as a fallback when callers want
   * to write every column atomically.
   */
  upsert(input: SessionAIStateUpsertInput): void {
    const now = new Date().toISOString();
    const stateChangedAt = input.stateChangedAt ?? now;
    const attemptsJson =
      input.rebindAttempts && input.rebindAttempts.length > 0
        ? JSON.stringify(input.rebindAttempts)
        : null;
    const stmt = this.db.prepare(`
      INSERT INTO session_ai_state
        (session_id, conversation_id, state, state_reason,
         state_changed_at, rebind_attempts_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        state = excluded.state,
        state_reason = excluded.state_reason,
        state_changed_at = excluded.state_changed_at,
        rebind_attempts_json = excluded.rebind_attempts_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      input.sessionId,
      input.conversationId,
      input.state,
      input.stateReason ?? null,
      stateChangedAt,
      attemptsJson,
      now,
    );
  }

  /**
   * Update only the lifecycle state, reason, and timestamps. Leaves
   * `conversation_id` and `rebind_attempts_json` untouched so a
   * `running` → `degraded` transition does not lose the rebind history
   * (the budget must still apply if the user restarts the session
   * within the window).
   *
   * No-op when no row exists.
   */
  transitionTo(
    sessionId: string,
    state: SessionAIStateName,
    reason: string | null,
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE session_ai_state
      SET state = ?,
          state_reason = ?,
          state_changed_at = ?,
          updated_at = ?
      WHERE session_id = ?
    `);
    stmt.run(state, reason, now, now, sessionId);
  }

  /**
   * Replace the rebind-attempts JSON for a session. Called by
   * `AISessionManager` after `RebindWindowTracker.recordSuccess` so
   * the per-conversation budget survives a restart.
   *
   * Passing an empty array clears the column (stored as NULL).
   * No-op when no row exists.
   */
  setRebindAttempts(sessionId: string, attempts: number[]): void {
    const now = new Date().toISOString();
    const attemptsJson = attempts.length > 0 ? JSON.stringify(attempts) : null;
    const stmt = this.db.prepare(`
      UPDATE session_ai_state
      SET rebind_attempts_json = ?,
          updated_at = ?
      WHERE session_id = ?
    `);
    stmt.run(attemptsJson, now, sessionId);
  }

  /** Remove the row for a session. Called from `endSessionAI`. */
  deleteBySessionId(sessionId: string): void {
    const stmt = this.db.prepare(`DELETE FROM session_ai_state WHERE session_id = ?`);
    stmt.run(sessionId);
  }
}
