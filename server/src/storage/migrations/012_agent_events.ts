import type { Migration } from '../migrator.js';

/**
 * Migration 012: Agent events
 *
 * Persistent storage for OpenHands agent-server event stream. Every event
 * arriving on the upstream WebSocket (or replayed via REST) is captured here,
 * so the client can re-render the agent activity stream after the live
 * conversation has ended.
 *
 * Notes:
 * - `event_id` is OH's event id; nullable because synthetic / unparseable
 *   events still need to be stored. The partial unique index gives natural-key
 *   dedup on the real ids and lets `INSERT OR IGNORE` work for both live ingest
 *   and REST rehydration.
 * - `hydrated_at` is when *we* wrote the row (TTL anchor). Read queries order
 *   by `event_timestamp` (OH's clock) instead, so out-of-order arrivals still
 *   render correctly.
 * - Schema is portable to Postgres modulo SERIAL / NOW() / ON CONFLICT
 *   translation.
 */
export const migration: Migration = {
  version: 12,
  name: 'agent_events',

  up: `
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      conversation_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT,
      event_timestamp TEXT,
      hydrated_at TEXT NOT NULL DEFAULT (datetime('now')),
      raw_event TEXT NOT NULL
    );

    -- Natural-key dedup for real OH ids (synthetic NULL ids can't dedup)
    CREATE UNIQUE INDEX IF NOT EXISTS agent_events_natural
      ON agent_events(conversation_id, event_id)
      WHERE event_id IS NOT NULL;

    -- Primary read path: sessionId + event_timestamp ASC
    CREATE INDEX IF NOT EXISTS agent_events_session_time
      ON agent_events(session_id, event_timestamp);

    -- TTL pruning scans by hydrated_at
    CREATE INDEX IF NOT EXISTS agent_events_hydrated_at
      ON agent_events(hydrated_at);
  `,

  down: `
    DROP INDEX IF EXISTS agent_events_hydrated_at;
    DROP INDEX IF EXISTS agent_events_session_time;
    DROP INDEX IF EXISTS agent_events_natural;
    DROP TABLE IF EXISTS agent_events;
  `,
};
