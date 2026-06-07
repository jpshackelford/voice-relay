import type { Migration } from '../migrator.js';

/**
 * Migration 020: Persist the operational AISession state (issue #363).
 *
 * Voice Relay holds every AI session's runtime state — `degraded`,
 * `degradedReason`, `rebinding`, the per-conversation `RebindWindowTracker`
 * budget — in `AISessionManager.sessionAI: Map<string, AISession>` (see
 * `server/src/openhands.ts:1782` and `server/src/agent-driver/rebind.ts`).
 * That map evaporates on every process restart, which means a session
 * we decided to give up on at 02:00 is cheerfully re-auto-connected
 * fifteen minutes later by the next auto-deploy hook. The rebind
 * window-cap (max 3 rebinds in 5 min, #296) is similarly defeated by
 * any restart that lands inside the window.
 *
 * This migration introduces the durable home for that state. The
 * in-memory `AISession` becomes a cache of this row plus the live
 * `WebSocket` and callbacks; the single chokepoint
 * `AISessionManager.transitionTo()` writes through to this table on
 * every state change (`running` / `degraded` / `rebinding` / `ended`).
 *
 * Columns:
 *
 *   - session_id           — PK, FK to sessions(id) ON DELETE CASCADE.
 *   - conversation_id      — upstream OpenHands conversation_id; also
 *                            kept in `sessions.metadata.aiConversationId`
 *                            (existing column is left untouched).
 *   - state                — recovery-lifecycle state, NOT the
 *                            driver-emitted `AgentSessionState`
 *                            (absent / starting / ready / thinking /
 *                            reconnecting / degraded). This column
 *                            answers "what should startup rehydration
 *                            do with this session?". Constrained to
 *                            ('running','degraded','rebinding','ended').
 *                            `paused` is intentionally absent here; #360
 *                            extends the CHECK constraint when that
 *                            lands.
 *   - state_reason         — human-readable reason for the current
 *                            state (populated for `degraded`; null
 *                            elsewhere).
 *   - state_changed_at     — ISO timestamp of the last transition.
 *   - rebind_attempts_json — serialized `RebindWindowTracker` history:
 *                            JSON array of epoch-ms timestamps for
 *                            successful rebinds in the rolling window.
 *                            Pruned to the window on read by the
 *                            tracker.
 *   - updated_at           — ISO timestamp of last DB write.
 *
 * Backfill: one-shot, idempotent. Every currently-active session with a
 * persisted `aiConversationId` gets a `running` row. Best-guess —
 * those that fail rehydrate will transition to `degraded` on the first
 * pass.
 *
 * The existing `sessions.metadata.aiConversationId` column is left
 * untouched. The new table augments it; it doesn't replace it. Rollback
 * = drop the new table (the metadata JSON keeps working).
 *
 * FK-safety: only references `sessions` and uses `ON DELETE CASCADE`,
 * so deleting a session cleans up its state row automatically.
 *
 * Rollback strategy: `DROP INDEX` then `DROP TABLE`. Marked
 * `destructive: true` because the down deletes durable state.
 */
export const migration: Migration = {
  version: 20,
  name: 'session_ai_state',
  destructive: true,

  up: `
    CREATE TABLE IF NOT EXISTS session_ai_state (
      session_id           TEXT PRIMARY KEY
                           REFERENCES sessions(id) ON DELETE CASCADE,
      conversation_id      TEXT NOT NULL,
      state                TEXT NOT NULL
                           CHECK (state IN ('running','degraded','rebinding','ended')),
      state_reason         TEXT,
      state_changed_at     TEXT NOT NULL,
      rebind_attempts_json TEXT,
      updated_at           TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_ai_state_by_state
      ON session_ai_state(state);

    -- One-shot backfill: every currently-active session with a persisted
    -- aiConversationId gets a 'running' row. INSERT OR IGNORE keeps this
    -- idempotent: if the migration is re-applied to a DB that already
    -- has rows (shouldn't happen, but defensive), existing rows are
    -- preserved.
    INSERT OR IGNORE INTO session_ai_state
      (session_id, conversation_id, state, state_reason,
       state_changed_at, rebind_attempts_json, updated_at)
    SELECT id,
           json_extract(metadata, '$.aiConversationId'),
           'running',
           NULL,
           datetime('now'),
           NULL,
           datetime('now')
    FROM sessions
    WHERE status = 'active'
      AND metadata IS NOT NULL
      AND json_extract(metadata, '$.aiConversationId') IS NOT NULL;
  `,

  down: `
    DROP INDEX IF EXISTS idx_session_ai_state_by_state;
    DROP TABLE IF EXISTS session_ai_state;
  `,
};
