import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  Session,
  SessionCreateInput,
  SessionUpdateInput,
  SessionStatus,
  SessionDevice,
  SessionMetadata,
  SessionSummary,
} from './types.js';
import { encryptApiKey, decryptApiKey, type EncryptedKey } from '../workspaces/encryption.js';

/** Length of display API secret in bytes (256 bits) */
const DISPLAY_API_SECRET_LENGTH = 32;

interface SessionRow {
  id: string;
  workspace_id: string;
  name: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  metadata: string | null;
  display_api_secret_encrypted: string | null;
  display_api_secret_iv: string | null;
  display_api_secret_tag: string | null;
  target_kiosk_device_id: string | null;
}

interface SessionDeviceRow {
  session_id: string;
  device_id: string;
  joined_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    displayApiSecretEncrypted: row.display_api_secret_encrypted,
    displayApiSecretIv: row.display_api_secret_iv,
    displayApiSecretTag: row.display_api_secret_tag,
    targetKioskDeviceId: row.target_kiosk_device_id,
  };
}

/** Columns selected for `rowToSession`. Kept in one place so adding a
 *  new column is a single-file change. */
const SESSION_COLUMNS = `id, workspace_id, name, status, started_at, ended_at, metadata,
       display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag,
       target_kiosk_device_id`;

function rowToSessionDevice(row: SessionDeviceRow): SessionDevice {
  return {
    sessionId: row.session_id,
    deviceId: row.device_id,
    joinedAt: row.joined_at,
  };
}

/**
 * Repository for session management.
 * Sessions are conversation periods within a workspace.
 */
export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): Session | null {
    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT id, workspace_id, name, status, started_at, ended_at, metadata,
             display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag, target_kiosk_device_id
      FROM sessions WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToSession(row) : null;
  }

  findByWorkspace(workspaceId: string, status?: SessionStatus): Session[] {
    if (status) {
      const stmt = this.db.prepare<[string, string], SessionRow>(`
        SELECT id, workspace_id, name, status, started_at, ended_at, metadata,
               display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag, target_kiosk_device_id
        FROM sessions WHERE workspace_id = ? AND status = ?
        ORDER BY started_at DESC
      `);
      return stmt.all(workspaceId, status).map(rowToSession);
    }

    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT id, workspace_id, name, status, started_at, ended_at, metadata,
             display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag, target_kiosk_device_id
      FROM sessions WHERE workspace_id = ?
      ORDER BY started_at DESC
    `);
    return stmt.all(workspaceId).map(rowToSession);
  }

  /**
   * Get active sessions in a workspace.
   */
  getActiveSessions(workspaceId: string): Session[] {
    return this.findByWorkspace(workspaceId, 'active');
  }

  /**
   * List all `status='active'` sessions across all workspaces that have a
   * non-null `metadata.aiConversationId`.
   *
   * Used by the startup `rehydrateAgentSessions` pass (issue #341) to
   * re-attach the agent driver to OpenHands conversations whose live WS
   * bindings died with the previous process. The in-memory binding is
   * lost on restart; the DB is the only durable home for the conversation
   * id.
   *
   * Uses `json_extract` so the filter pushes down into SQLite rather than
   * loading every active session into memory and parsing JSON on each row.
   */
  listActiveWithAiConversation(): Session[] {
    const stmt = this.db.prepare<[], SessionRow>(`
      SELECT id, workspace_id, name, status, started_at, ended_at, metadata,
             display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag, target_kiosk_device_id
      FROM sessions
      WHERE status = 'active'
        AND metadata IS NOT NULL
        AND json_extract(metadata, '$.aiConversationId') IS NOT NULL
      ORDER BY started_at DESC
    `);
    return stmt.all().map(rowToSession);
  }

  /**
   * Get the most recent active session in a workspace, or create one if none exists.
   */
  getOrCreateActiveSession(workspaceId: string): Session {
    const active = this.getActiveSessions(workspaceId);
    if (active.length > 0) {
      return active[0];
    }
    return this.create({ workspaceId });
  }

  /**
   * Get session summaries with device counts and last activity time for a workspace.
   */
  getSessionSummaries(workspaceId: string, status?: SessionStatus): SessionSummary[] {
    const statusFilter = status ? 'AND s.status = ?' : '';
    const stmt = this.db.prepare<string[], { 
      id: string;
      workspace_id: string;
      name: string | null;
      status: string;
      started_at: string;
      device_count: number;
      last_active_at: string | null;
    }>(`
      SELECT s.id, s.workspace_id, s.name, s.status, s.started_at,
             COUNT(DISTINCT sd.device_id) as device_count,
             MAX(m.created_at) as last_active_at
      FROM sessions s
      LEFT JOIN session_devices sd ON s.id = sd.session_id
      LEFT JOIN messages m ON s.id = m.session_id
      WHERE s.workspace_id = ? ${statusFilter}
      GROUP BY s.id
      ORDER BY COALESCE(MAX(m.created_at), s.started_at) DESC
    `);

    const rows = status 
      ? stmt.all(workspaceId, status)
      : stmt.all(workspaceId);

    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      status: row.status as SessionStatus,
      startedAt: row.started_at,
      deviceCount: row.device_count,
      lastActiveAt: row.last_active_at || row.started_at,
    }));
  }

  create(input: SessionCreateInput): Session {
    const id = uuidv4();
    const now = new Date().toISOString();
    const name = input.name || `Session ${now.split('T')[0]}`;

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, workspace_id, name, status, started_at, target_kiosk_device_id)
      VALUES (?, ?, ?, 'active', ?, ?)
    `);
    stmt.run(id, input.workspaceId, name, now, input.targetKioskDeviceId ?? null);

    const session = this.findById(id);
    if (!session) {
      throw new Error('Session not found after creation');
    }
    return session;
  }

  /**
   * Create a session with a display API secret for authenticating display API calls.
   * @returns Object containing the session and the plaintext secret (to pass to OpenHands)
   */
  createWithDisplaySecret(input: SessionCreateInput): { session: Session; displayApiSecret: string } {
    const id = uuidv4();
    const now = new Date().toISOString();
    const name = input.name || `Session ${now.split('T')[0]}`;

    // Generate cryptographically secure random secret
    const secretBytes = crypto.randomBytes(DISPLAY_API_SECRET_LENGTH);
    const displayApiSecret = secretBytes.toString('base64url');

    // Encrypt the secret for storage
    const encrypted = encryptApiKey(displayApiSecret);

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, workspace_id, name, status, started_at,
        display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag,
        target_kiosk_device_id
      )
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      input.workspaceId,
      name,
      now,
      encrypted.encrypted,
      encrypted.iv,
      encrypted.tag,
      input.targetKioskDeviceId ?? null
    );

    const session = this.findById(id);
    if (!session) {
      throw new Error('Session not found after creation');
    }

    return { session, displayApiSecret };
  }

  /**
   * Get the decrypted display API secret for a session.
   * @returns The plaintext secret, or null if not set
   */
  getDisplaySecret(sessionId: string): string | null {
    const session = this.findById(sessionId);
    if (!session) return null;

    if (!session.displayApiSecretEncrypted || 
        !session.displayApiSecretIv || 
        !session.displayApiSecretTag) {
      return null;
    }

    try {
      return decryptApiKey({
        encrypted: session.displayApiSecretEncrypted,
        iv: session.displayApiSecretIv,
        tag: session.displayApiSecretTag,
      });
    } catch (err) {
      console.error('[Session] Failed to decrypt display API secret:', err);
      return null;
    }
  }

  /**
   * Update an existing session to add a display API secret.
   * Used for migrating existing sessions that don't have a secret.
   * @returns The plaintext secret, or null if session not found
   */
  setDisplaySecret(sessionId: string): string | null {
    const session = this.findById(sessionId);
    if (!session) return null;

    // Generate cryptographically secure random secret
    const secretBytes = crypto.randomBytes(DISPLAY_API_SECRET_LENGTH);
    const displayApiSecret = secretBytes.toString('base64url');

    // Encrypt the secret for storage
    const encrypted = encryptApiKey(displayApiSecret);

    const stmt = this.db.prepare(`
      UPDATE sessions
      SET display_api_secret_encrypted = ?,
          display_api_secret_iv = ?,
          display_api_secret_tag = ?
      WHERE id = ?
    `);
    stmt.run(encrypted.encrypted, encrypted.iv, encrypted.tag, sessionId);

    return displayApiSecret;
  }

  update(id: string, input: SessionUpdateInput): Session | null {
    const session = this.findById(id);
    if (!session) return null;

    const stmt = this.db.prepare(`
      UPDATE sessions
      SET name = COALESCE(?, name),
          status = COALESCE(?, status),
          metadata = COALESCE(?, metadata),
          ended_at = CASE WHEN ? = 'ended' OR ? = 'archived' THEN datetime('now') ELSE ended_at END
      WHERE id = ?
    `);
    stmt.run(
      input.name ?? null,
      input.status ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.status ?? null,
      input.status ?? null,
      id
    );

    return this.findById(id);
  }

  /**
   * End a session (set status to 'ended').
   */
  endSession(id: string): Session | null {
    return this.update(id, { status: 'ended' });
  }

  /**
   * Archive a session (set status to 'archived').
   */
  archiveSession(id: string): Session | null {
    return this.update(id, { status: 'archived' });
  }

  /**
   * Update session metadata (e.g., AI conversation ID, display content).
   */
  updateMetadata(id: string, metadata: Partial<SessionMetadata>): Session | null {
    const session = this.findById(id);
    if (!session) return null;

    const existingMetadata = session.metadata || {};
    const newMetadata = { ...existingMetadata, ...metadata };

    return this.update(id, { metadata: newMetadata });
  }

  /**
   * Remove the `displayContent` key from a session's metadata while
   * preserving all other metadata fields (e.g. `ttsSettings`,
   * `aiConversationId`).
   *
   * Used by `POST /api/display` with `type: 'clear'` to give explicit
   * "delete this key" semantics without generalizing `updateMetadata`'s
   * spread/patch contract into a null-as-delete protocol that every other
   * caller would have to learn. See issue #338.
   *
   * @returns The updated session, or `null` if no session matches `id`.
   */
  clearDisplayContent(id: string): Session | null {
    const session = this.findById(id);
    if (!session) return null;

    const { displayContent: _omit, ...rest } = session.metadata ?? {};
    return this.update(id, { metadata: rest });
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  // --- Device membership ---

  /**
   * Add a device to a session.
   */
  addDevice(sessionId: string, deviceId: string): SessionDevice {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_devices (session_id, device_id, joined_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(sessionId, deviceId, now);

    return { sessionId, deviceId, joinedAt: now };
  }

  /**
   * Remove a device from a session.
   */
  removeDevice(sessionId: string, deviceId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM session_devices WHERE session_id = ? AND device_id = ?
    `);
    stmt.run(sessionId, deviceId);
  }

  /**
   * Get all devices in a session.
   */
  getDevices(sessionId: string): SessionDevice[] {
    const stmt = this.db.prepare<[string], SessionDeviceRow>(`
      SELECT session_id, device_id, joined_at
      FROM session_devices WHERE session_id = ?
    `);
    return stmt.all(sessionId).map(rowToSessionDevice);
  }

  /**
   * Get the session a device is currently in.
   */
  getDeviceSession(deviceId: string): Session | null {
    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT s.id, s.workspace_id, s.name, s.status, s.started_at, s.ended_at, s.metadata,
             s.display_api_secret_encrypted, s.display_api_secret_iv, s.display_api_secret_tag,
             s.target_kiosk_device_id
      FROM sessions s
      JOIN session_devices sd ON s.id = sd.session_id
      WHERE sd.device_id = ? AND s.status = 'active'
      ORDER BY sd.joined_at DESC
      LIMIT 1
    `);
    const row = stmt.get(deviceId);
    return row ? rowToSession(row) : null;
  }

  /**
   * Get the active session anchored to a specific kiosk device (#393).
   *
   * Returns `null` when no active session has been bound to this kiosk
   * yet — callers fall back to either `getOrCreateActiveSession` (legacy
   * workspace-wide single-active) or to creating a new session with
   * `targetKioskDeviceId` set.
   */
  getActiveSessionForKiosk(kioskDeviceId: string): Session | null {
    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT id, workspace_id, name, status, started_at, ended_at, metadata,
             display_api_secret_encrypted, display_api_secret_iv, display_api_secret_tag,
             target_kiosk_device_id
      FROM sessions
      WHERE target_kiosk_device_id = ? AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(kioskDeviceId);
    return row ? rowToSession(row) : null;
  }

  /**
   * Build the per-kiosk picker enrichment for a workspace (#393).
   *
   * One round-trip returns, for every kiosk in `workspaceId`, the
   * active-session anchor (`activeSessionId`) and the most recent
   * `session_devices.joined_at` (`lastUsedAt`). The registry's
   * `broadcastDeviceList` calls this so mobile picker cards have the
   * status pill and the "last used N hours ago" line on first render
   * without an extra REST round-trip.
   */
  getKioskPickerEnrichment(
    workspaceId: string
  ): Map<string, { activeSessionId: string | null; lastUsedAt: string | null }> {
    const stmt = this.db.prepare<[string], {
      device_id: string;
      active_session_id: string | null;
      last_used_at: string | null;
    }>(`
      SELECT d.id AS device_id,
             active_s.id AS active_session_id,
             (
               SELECT MAX(sd.joined_at)
               FROM session_devices sd
               WHERE sd.device_id = d.id
             ) AS last_used_at
      FROM devices d
      LEFT JOIN sessions active_s
        ON active_s.target_kiosk_device_id = d.id
        AND active_s.status = 'active'
      WHERE d.workspace_id = ? AND d.mode = 'kiosk'
    `);
    const rows = stmt.all(workspaceId);
    const result = new Map<string, { activeSessionId: string | null; lastUsedAt: string | null }>();
    for (const row of rows) {
      result.set(row.device_id, {
        activeSessionId: row.active_session_id,
        lastUsedAt: row.last_used_at,
      });
    }
    return result;
  }

  /**
   * Get or create the active session anchored to a specific kiosk (#393).
   *
   * `workspaceId` is verified against the kiosk's existing binding when
   * one is found — a stale or cross-workspace binding is ignored and a
   * fresh session is created in the requested workspace.
   */
  getOrCreateActiveSessionForKiosk(
    workspaceId: string,
    kioskDeviceId: string
  ): Session {
    const existing = this.getActiveSessionForKiosk(kioskDeviceId);
    if (existing && existing.workspaceId === workspaceId) {
      return existing;
    }
    return this.create({ workspaceId, targetKioskDeviceId: kioskDeviceId });
  }

  /**
   * Move a device to a different session.
   */
  moveDevice(deviceId: string, fromSessionId: string, toSessionId: string): void {
    this.removeDevice(fromSessionId, deviceId);
    this.addDevice(toSessionId, deviceId);
  }

  /**
   * Remove a device from all sessions.
   */
  removeDeviceFromAll(deviceId: string): void {
    const stmt = this.db.prepare('DELETE FROM session_devices WHERE device_id = ?');
    stmt.run(deviceId);
  }
}
