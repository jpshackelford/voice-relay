import type Database from 'better-sqlite3';

/**
 * Repository for the `session_engine_speakers` table (#386).
 *
 * Maps a per-session, per-device, engine-emitted speaker label (e.g.
 * Deepgram's opaque `S1`/`S2`/...) to a workspace-scoped `speakers.id`
 * (#383) once a real person has been identified — by the agent, the UI,
 * or some explicit "this is JP" affordance.
 *
 * The table is purely an *override* layer: rows are only inserted when
 * a mapping has been resolved. The relay treats absence as "no
 * mapping known, render the raw engine label" rather than as an error.
 */

export interface EngineSpeakerMapping {
  sessionId: string;
  deviceId: string;
  engineLabel: string;
  /** Resolved `speakers.id`; `null` while the mapping is still unknown. */
  speakerId: string | null;
  createdAt: string;
}

interface Row {
  session_id: string;
  device_id: string;
  engine_label: string;
  speaker_id: string | null;
  created_at: string;
}

function rowToMapping(r: Row): EngineSpeakerMapping {
  return {
    sessionId: r.session_id,
    deviceId: r.device_id,
    engineLabel: r.engine_label,
    speakerId: r.speaker_id,
    createdAt: r.created_at,
  };
}

export class SessionEngineSpeakersRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Upsert a mapping. Replaces any prior speaker_id for the same
   * (session, device, label) triple — the most recent claim wins. Used
   * both by the agent (resolved from context) and by manual UI overrides.
   */
  upsert(
    sessionId: string,
    deviceId: string,
    engineLabel: string,
    speakerId: string | null,
  ): EngineSpeakerMapping {
    const stmt = this.db.prepare(`
      INSERT INTO session_engine_speakers
        (session_id, device_id, engine_label, speaker_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id, device_id, engine_label)
      DO UPDATE SET speaker_id = excluded.speaker_id
    `);
    stmt.run(sessionId, deviceId, engineLabel, speakerId);

    const found = this.find(sessionId, deviceId, engineLabel);
    if (!found) {
      // Should be impossible — we just inserted/updated this row.
      throw new Error(
        'session_engine_speakers upsert did not produce a readable row',
      );
    }
    return found;
  }

  find(
    sessionId: string,
    deviceId: string,
    engineLabel: string,
  ): EngineSpeakerMapping | null {
    const stmt = this.db.prepare<[string, string, string], Row>(`
      SELECT session_id, device_id, engine_label, speaker_id, created_at
      FROM session_engine_speakers
      WHERE session_id = ? AND device_id = ? AND engine_label = ?
    `);
    const row = stmt.get(sessionId, deviceId, engineLabel);
    return row ? rowToMapping(row) : null;
  }

  /**
   * Fast-path used by the WS text handler on every inbound utterance:
   * return the mapped `speakers.id` for `(session, device, label)` or
   * `null` if no mapping exists / the mapping has a null speaker_id.
   *
   * Performance note: this runs on the hot path of every utterance with
   * an engine label. The composite PRIMARY KEY makes this lookup an
   * index seek, but if profiling shows it's still too hot the result
   * can be memoised in the in-memory device registry under the same
   * (session, device, label) key.
   */
  resolveSpeakerId(
    sessionId: string,
    deviceId: string,
    engineLabel: string,
  ): string | null {
    const stmt = this.db.prepare<[string, string, string], { speaker_id: string | null }>(`
      SELECT speaker_id FROM session_engine_speakers
      WHERE session_id = ? AND device_id = ? AND engine_label = ?
    `);
    const row = stmt.get(sessionId, deviceId, engineLabel);
    return row?.speaker_id ?? null;
  }

  listForSession(sessionId: string): EngineSpeakerMapping[] {
    const stmt = this.db.prepare<[string], Row>(`
      SELECT session_id, device_id, engine_label, speaker_id, created_at
      FROM session_engine_speakers
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(sessionId).map(rowToMapping);
  }
}
