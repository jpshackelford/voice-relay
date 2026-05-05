import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  PersistedDevice,
  DeviceCreateInput,
  DeviceUpdateInput,
  DeviceMode,
} from './types.js';

interface DeviceRow {
  id: string;
  workspace_id: string;
  name: string;
  mode: string;
  device_token: string | null;
  device_token_hash: string | null;
  last_seen_at: string | null;
  config: string | null;
  created_at: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function rowToDevice(row: DeviceRow): PersistedDevice {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    mode: row.mode as DeviceMode,
    deviceToken: row.device_token,
    deviceTokenHash: row.device_token_hash,
    lastSeenAt: row.last_seen_at,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
  };
}

/**
 * Repository for persisted device records.
 * Handles device tokens for reconnection without re-authentication.
 */
export class DeviceRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): PersistedDevice | null {
    const stmt = this.db.prepare<[string], DeviceRow>(`
      SELECT id, workspace_id, name, mode, device_token, device_token_hash, 
             last_seen_at, config, created_at
      FROM devices WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToDevice(row) : null;
  }

  findByTokenHash(tokenHash: string): PersistedDevice | null {
    const stmt = this.db.prepare<[string], DeviceRow>(`
      SELECT id, workspace_id, name, mode, device_token, device_token_hash,
             last_seen_at, config, created_at
      FROM devices WHERE device_token_hash = ?
    `);
    const row = stmt.get(tokenHash);
    return row ? rowToDevice(row) : null;
  }

  /**
   * Validate a device token and return the device if valid.
   */
  validateToken(token: string): PersistedDevice | null {
    const hash = hashToken(token);
    return this.findByTokenHash(hash);
  }

  findByWorkspace(workspaceId: string): PersistedDevice[] {
    const stmt = this.db.prepare<[string], DeviceRow>(`
      SELECT id, workspace_id, name, mode, device_token, device_token_hash,
             last_seen_at, config, created_at
      FROM devices WHERE workspace_id = ? ORDER BY last_seen_at DESC
    `);
    const rows = stmt.all(workspaceId);
    return rows.map(rowToDevice);
  }

  /**
   * Create a new device with a unique token.
   * Returns the device with the plaintext token (only time it's returned).
   */
  create(input: DeviceCreateInput): { device: PersistedDevice; token: string } {
    const id = uuidv4();
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO devices (id, workspace_id, name, mode, device_token, device_token_hash, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.workspaceId, input.name, input.mode, token, tokenHash, now, now);

    const device = this.findById(id);
    if (!device) {
      throw new Error('Device not found after creation');
    }
    return { device, token };
  }

  /**
   * Register or update a device.
   * If deviceId exists, updates lastSeenAt and optional fields.
   * If not, creates a new device.
   */
  registerOrUpdate(
    deviceId: string,
    workspaceId: string,
    name: string,
    mode: DeviceMode
  ): { device: PersistedDevice; token: string | null; isNew: boolean } {
    const existing = this.findById(deviceId);

    if (existing) {
      // Update last seen and any changed fields
      this.update(deviceId, { name, mode });
      this.updateLastSeen(deviceId);
      const updated = this.findById(deviceId);
      return { device: updated!, token: null, isNew: false };
    }

    // Create new device
    const { device, token } = this.create({
      workspaceId,
      name,
      mode,
    });

    // Update ID if different (client may provide their own ID)
    if (device.id !== deviceId) {
      // For now, use the provided ID for new devices
      this.db.prepare('UPDATE devices SET id = ? WHERE id = ?').run(deviceId, device.id);
      const updated = this.findById(deviceId);
      return { device: updated!, token, isNew: true };
    }

    return { device, token, isNew: true };
  }

  update(id: string, input: DeviceUpdateInput): PersistedDevice | null {
    const device = this.findById(id);
    if (!device) return null;

    const stmt = this.db.prepare(`
      UPDATE devices
      SET name = COALESCE(?, name),
          mode = COALESCE(?, mode),
          config = COALESCE(?, config)
      WHERE id = ?
    `);
    stmt.run(
      input.name ?? null,
      input.mode ?? null,
      input.config ? JSON.stringify(input.config) : null,
      id
    );

    return this.findById(id);
  }

  updateLastSeen(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?');
    stmt.run(now, id);
  }

  /**
   * Regenerate a device token (invalidates old token).
   */
  regenerateToken(id: string): { device: PersistedDevice; token: string } | null {
    const device = this.findById(id);
    if (!device) return null;

    const token = generateToken();
    const tokenHash = hashToken(token);

    const stmt = this.db.prepare(`
      UPDATE devices SET device_token = ?, device_token_hash = ? WHERE id = ?
    `);
    stmt.run(token, tokenHash, id);

    const updated = this.findById(id);
    return { device: updated!, token };
  }

  /**
   * Revoke a device's token (for security purposes).
   */
  revokeToken(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE devices SET device_token = NULL, device_token_hash = NULL WHERE id = ?
    `);
    stmt.run(id);
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM devices WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Delete all devices in a workspace.
   */
  deleteByWorkspace(workspaceId: string): void {
    const stmt = this.db.prepare('DELETE FROM devices WHERE workspace_id = ?');
    stmt.run(workspaceId);
  }
}
