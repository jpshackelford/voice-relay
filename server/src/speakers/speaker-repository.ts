import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  AnonymousSpeakerQuotaExceeded,
  type Speaker,
  type SpeakerCreateInput,
  type SpeakerUpdateInput,
} from './types.js';

interface SpeakerRow {
  id: string;
  workspace_id: string;
  user_id: string | null;
  preferred_name: string | null;
  pronouns: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSpeaker(row: SpeakerRow): Speaker {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    preferredName: row.preferred_name,
    pronouns: row.pronouns,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, workspace_id, user_id, preferred_name,
       pronouns, notes, created_at, updated_at`;

/**
 * Repository for the `speakers` table (#383).
 *
 * Workspace-scoping is enforced in every query (every read takes a
 * `workspaceId`) as defense-in-depth against cross-workspace data
 * leaks. The REST layer also enforces this via `requireWorkspaceOwner`
 * / `canAccess`, but a row-level filter on top costs almost nothing and
 * eliminates a class of bugs.
 *
 * `delete` is a hard delete by design: speakers carry agent-learned
 * free-text notes which a workspace owner may want to expunge cleanly.
 * Workspace deletion cascades (declared on the table); user deletion
 * leaves a speaker row with `userId = NULL` (also declared on the
 * table) so the agent's accumulated learning is not lost.
 */
export class SpeakerRepository {
  constructor(private readonly db: Database.Database) {}

  /** Every speaker in a workspace, most-recently-updated first. */
  listForWorkspace(workspaceId: string): Speaker[] {
    const rows = this.db
      .prepare<[string], SpeakerRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM speakers
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`
      )
      .all(workspaceId);
    return rows.map(rowToSpeaker);
  }

  /**
   * Look up a single speaker. Returns `null` if the row does not exist
   * OR if it belongs to a different workspace — the caller cannot
   * distinguish "wrong workspace" from "no such row", which is
   * intentional (avoids leaking the existence of speakers across
   * workspaces via 404-vs-403 timing).
   */
  findById(workspaceId: string, speakerId: string): Speaker | null {
    const row = this.db
      .prepare<[string, string], SpeakerRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM speakers
         WHERE id = ? AND workspace_id = ?`
      )
      .get(speakerId, workspaceId);
    return row ? rowToSpeaker(row) : null;
  }

  /**
   * Find the speaker row attached to `userId` within `workspaceId`.
   * Returns `null` if the user has never been recorded as a speaker
   * here. The partial unique index on `(workspace_id, user_id)`
   * guarantees at most one such row.
   */
  findByWorkspaceUser(
    workspaceId: string,
    userId: string
  ): Speaker | null {
    const row = this.db
      .prepare<[string, string], SpeakerRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM speakers
         WHERE workspace_id = ? AND user_id = ?`
      )
      .get(workspaceId, userId);
    return row ? rowToSpeaker(row) : null;
  }

  create(input: SpeakerCreateInput): Speaker {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO speakers (
           id, workspace_id, user_id, preferred_name, pronouns, notes,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.workspaceId,
        input.userId ?? null,
        input.preferredName ?? null,
        input.pronouns ?? null,
        input.notes ?? null,
        now,
        now
      );
    return {
      id,
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      preferredName: input.preferredName ?? null,
      pronouns: input.pronouns ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Partial update. `undefined` fields are left untouched; `null`
   * fields are written through (an explicit "I don't know" wins over
   * the previously-stored value). Returns `null` when no row matches
   * `(speakerId, workspaceId)`.
   */
  update(
    workspaceId: string,
    speakerId: string,
    input: SpeakerUpdateInput
  ): Speaker | null {
    const existing = this.findById(workspaceId, speakerId);
    if (!existing) return null;

    const merged = {
      preferredName:
        input.preferredName === undefined
          ? existing.preferredName
          : input.preferredName,
      pronouns:
        input.pronouns === undefined ? existing.pronouns : input.pronouns,
      notes: input.notes === undefined ? existing.notes : input.notes,
      userId: input.userId === undefined ? existing.userId : input.userId,
    };
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE speakers
         SET preferred_name = ?,
             pronouns = ?,
             notes = ?,
             user_id = ?,
             updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      )
      .run(
        merged.preferredName,
        merged.pronouns,
        merged.notes,
        merged.userId,
        now,
        speakerId,
        workspaceId
      );

    return this.findById(workspaceId, speakerId);
  }

  /**
   * Hard delete. Returns true if a row was removed.
   *
   * `messages.speaker_id` and `session_devices.active_speaker_id` are
   * declared `ON DELETE SET NULL`, so deleting a speaker leaves
   * historical messages and live session-device rows intact (with
   * their `speaker_id` / `active_speaker_id` nulled).
   */
  delete(workspaceId: string, speakerId: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM speakers WHERE id = ? AND workspace_id = ?`
      )
      .run(speakerId, workspaceId);
    return result.changes > 0;
  }

  /**
   * Idempotent upsert for the device-claim path (#383). If a speaker
   * row already exists for `(workspaceId, userId)`, leaves
   * `preferred_name` / `pronouns` / `notes` alone (agent learning
   * wins) but bumps `updated_at`; otherwise inserts a new row seeded
   * with the supplied `preferredName`.
   *
   * Returns the resolved row.
   */
  upsertForUser(
    workspaceId: string,
    userId: string,
    seed?: { preferredName?: string | null }
  ): Speaker {
    const existing = this.findByWorkspaceUser(workspaceId, userId);
    if (existing) {
      const now = new Date().toISOString();
      this.db
        .prepare(`UPDATE speakers SET updated_at = ? WHERE id = ?`)
        .run(now, existing.id);
      return { ...existing, updatedAt: now };
    }
    return this.create({
      workspaceId,
      userId,
      preferredName: seed?.preferredName ?? null,
    });
  }

  /**
   * Count of anonymous (user_id IS NULL) speaker rows in a workspace
   * (#443). Used by the quota check in `findOrCreateAnonymous`; also
   * exposed for tests and any future admin tooling that wants to
   * surface "how close is this workspace to its anonymous cap?".
   */
  countAnonymousInWorkspace(workspaceId: string): number {
    const row = this.db
      .prepare<[string], { c: number }>(
        `SELECT COUNT(*) AS c FROM speakers
         WHERE workspace_id = ? AND user_id IS NULL`
      )
      .get(workspaceId);
    return row?.c ?? 0;
  }

  /**
   * Dedup-aware insert for anonymous speakers (#443).
   *
   * For a given `(workspaceId, preferredName, pronouns)` triple,
   * returns an existing anonymous (`user_id IS NULL`) row whose
   * trimmed `preferred_name` matches case-insensitively (SQLite
   * `COLLATE NOCASE`, ASCII-only) and whose `pronouns` matches exactly
   * (`IS` handles `NULL` on both sides). Otherwise inserts a new row
   * and returns it.
   *
   * Two layers of growth-protection:
   *   - Dedup: stops the common-case "same human re-claims the kiosk
   *     a week later" from creating duplicate anonymous rows. The
   *     agent's learning stays consolidated on one row.
   *   - Workspace cap: once a workspace already has
   *     `maxAnonymousPerWorkspace` anonymous speakers and the request
   *     does NOT dedup against any of them, throws
   *     `AnonymousSpeakerQuotaExceeded`. The cap check happens AFTER
   *     the dedup query, so steady-state traffic from the same humans
   *     never hits the wall.
   *
   * Wrapped in `db.transaction(...)` so the select-then-(count-then-)
   * insert sequence is atomic against concurrent submissions with the
   * same arguments, and the count→insert window is closed against the
   * cap (better-sqlite3 transactions are synchronous — there is no
   * `await` inside the body, so the JS event loop cannot interleave).
   *
   * Callers MUST trim `preferredName` and normalize an empty
   * `pronouns` to `null` before calling — the active-speaker handler
   * already does this. We assert non-empty `preferredName` defensively.
   */
  findOrCreateAnonymous(input: {
    workspaceId: string;
    preferredName: string;
    pronouns: string | null;
    maxAnonymousPerWorkspace: number;
  }): Speaker {
    if (input.preferredName.length === 0) {
      throw new Error('preferredName must be non-empty');
    }
    const tx = this.db.transaction((): Speaker => {
      const existing = this.db
        .prepare<[string, string, string | null], SpeakerRow>(
          `SELECT ${SELECT_COLUMNS}
           FROM speakers
           WHERE workspace_id = ?
             AND user_id IS NULL
             AND preferred_name = ? COLLATE NOCASE
             AND pronouns IS ?
           ORDER BY created_at ASC
           LIMIT 1`
        )
        .get(input.workspaceId, input.preferredName, input.pronouns);
      if (existing) return rowToSpeaker(existing);

      const count = this.countAnonymousInWorkspace(input.workspaceId);
      if (count >= input.maxAnonymousPerWorkspace) {
        throw new AnonymousSpeakerQuotaExceeded(
          input.workspaceId,
          input.maxAnonymousPerWorkspace
        );
      }

      // Reuse create() to keep one INSERT codepath. Safe inside the
      // transaction — better-sqlite3's `db.transaction()` re-enters
      // the same connection rather than opening a nested one.
      return this.create({
        workspaceId: input.workspaceId,
        userId: null,
        preferredName: input.preferredName,
        pronouns: input.pronouns,
      });
    });
    return tx();
  }
}
