import type Database from 'better-sqlite3';

/**
 * Raw OpenHands event as it arrives on the WebSocket / REST event stream.
 *
 * We only care about a handful of fields for indexing; everything else is
 * preserved as-is in `raw_event`.
 */
export interface RawAgentEvent {
  id?: string;
  kind?: string;
  source?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Stored agent event row.
 */
export interface StoredAgentEvent {
  /** Internal autoincrement id */
  id: number;
  /** OH event id (null for synthetic / unparseable events) */
  eventId: string | null;
  conversationId: string;
  sessionId: string;
  workspaceId: string;
  /** Raw `event.kind` (e.g. `ActionEvent`, `MessageEvent`) */
  kind: string;
  /** `agent` | `environment` | `user` | `hook` | null */
  source: string | null;
  /** OH-supplied event timestamp (ISO). May be null for synthetic events. */
  eventTimestamp: string | null;
  /** When we wrote the row. TTL anchors here. */
  hydratedAt: string;
  /** The original event, JSON-encoded. */
  rawEvent: RawAgentEvent;
}

/** Insert payload — caller supplies the raw event and provenance. */
export interface AgentEventInsert {
  conversationId: string;
  sessionId: string;
  workspaceId: string;
  rawEvent: RawAgentEvent;
}

export interface AgentEventQuery {
  sessionId: string;
  /** Max rows returned. */
  limit?: number;
  /** Only events with `event_timestamp > after` (ISO). */
  after?: string;
  /** Restrict to specific event kinds. */
  kinds?: string[];
}

interface AgentEventRow {
  id: number;
  event_id: string | null;
  conversation_id: string;
  session_id: string;
  workspace_id: string;
  kind: string;
  source: string | null;
  event_timestamp: string | null;
  hydrated_at: string;
  raw_event: string;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

function rowToEvent(row: AgentEventRow): StoredAgentEvent {
  let parsed: RawAgentEvent;
  try {
    parsed = JSON.parse(row.raw_event) as RawAgentEvent;
  } catch {
    // Should never happen — we always store JSON — but don't blow up reads.
    parsed = { _parseError: true, _raw: row.raw_event };
  }
  return {
    id: row.id,
    eventId: row.event_id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    source: row.source,
    eventTimestamp: row.event_timestamp,
    hydratedAt: row.hydrated_at,
    rawEvent: parsed,
  };
}

/**
 * Concrete sqlite-only repository for agent_events.
 *
 * Live ingest and REST rehydration both go through `insert()`, which uses
 * `INSERT OR IGNORE` against the partial unique index on
 * `(conversation_id, event_id)` so duplicate events arriving from both
 * sources don't double-write.
 */
export class AgentEventRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert a single event. Returns the row id, or null if the event was a
   * duplicate (matched the natural-key unique index).
   */
  insert(input: AgentEventInsert): number | null {
    const ev = input.rawEvent ?? {};
    const eventId = typeof ev.id === 'string' && ev.id ? ev.id : null;
    const kind = typeof ev.kind === 'string' && ev.kind ? ev.kind : 'unknown';
    const source = typeof ev.source === 'string' && ev.source ? ev.source : null;
    const eventTimestamp =
      typeof ev.timestamp === 'string' && ev.timestamp ? ev.timestamp : null;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO agent_events
        (event_id, conversation_id, session_id, workspace_id, kind, source, event_timestamp, raw_event)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      eventId,
      input.conversationId,
      input.sessionId,
      input.workspaceId,
      kind,
      source,
      eventTimestamp,
      JSON.stringify(ev)
    );
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  }

  /**
   * Bulk insert helper used by rehydration. Returns number of inserted rows.
   */
  insertMany(inputs: AgentEventInsert[]): number {
    if (inputs.length === 0) return 0;
    const tx = this.db.transaction((rows: AgentEventInsert[]) => {
      let inserted = 0;
      for (const row of rows) {
        if (this.insert(row) !== null) inserted++;
      }
      return inserted;
    });
    return tx(inputs);
  }

  /**
   * Count rows for a session. Used to decide whether to trigger rehydration.
   */
  countBySession(sessionId: string): number {
    const row = this.db
      .prepare<[string], { c: number }>(
        `SELECT COUNT(*) AS c FROM agent_events WHERE session_id = ?`
      )
      .get(sessionId);
    return row?.c ?? 0;
  }

  /**
   * Query events for a session, ordered by `event_timestamp` ASC. NULLs (no
   * OH timestamp) sort first via the standard SQLite ordering of NULLs.
   */
  findBySession(query: AgentEventQuery): StoredAgentEvent[] {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const clauses: string[] = ['session_id = ?'];
    const params: unknown[] = [query.sessionId];

    if (query.after) {
      clauses.push('event_timestamp > ?');
      params.push(query.after);
    }

    if (query.kinds && query.kinds.length > 0) {
      const placeholders = query.kinds.map(() => '?').join(', ');
      clauses.push(`kind IN (${placeholders})`);
      params.push(...query.kinds);
    }

    const sql = `
      SELECT id, event_id, conversation_id, session_id, workspace_id,
             kind, source, event_timestamp, hydrated_at, raw_event
      FROM agent_events
      WHERE ${clauses.join(' AND ')}
      ORDER BY event_timestamp ASC, id ASC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as AgentEventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * Hydration-window summary used by the read endpoint to surface oldest /
   * newest `hydrated_at` to clients.
   */
  getHydrationWindow(sessionId: string): {
    total: number;
    oldest: string | null;
    newest: string | null;
  } {
    const row = this.db
      .prepare<[string], { c: number; oldest: string | null; newest: string | null }>(
        `SELECT COUNT(*) AS c,
                MIN(hydrated_at) AS oldest,
                MAX(hydrated_at) AS newest
         FROM agent_events WHERE session_id = ?`
      )
      .get(sessionId);
    return {
      total: row?.c ?? 0,
      oldest: row?.oldest ?? null,
      newest: row?.newest ?? null,
    };
  }

  /**
   * Delete rows older than the given ISO cutoff (based on `hydrated_at`).
   * Returns rows deleted. Pass a date in the past; pruning is monotonic.
   */
  deleteOlderThan(cutoffIso: string): number {
    const result = this.db
      .prepare('DELETE FROM agent_events WHERE hydrated_at < ?')
      .run(cutoffIso);
    return Number(result.changes);
  }

  /** Test helper — wipe all agent events. */
  deleteAll(): number {
    const result = this.db.prepare('DELETE FROM agent_events').run();
    return Number(result.changes);
  }

  /** Test helper — wipe events for a session. */
  deleteBySession(sessionId: string): number {
    const result = this.db
      .prepare('DELETE FROM agent_events WHERE session_id = ?')
      .run(sessionId);
    return Number(result.changes);
  }
}
