import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  PersistedDevice,
  DeviceCreateInput,
  DeviceUpdateInput,
  DeviceMode,
} from './types.js';

// Default token TTL: 90 days
const DEFAULT_TOKEN_TTL_DAYS = 90;

interface DeviceRow {
  id: string;
  workspace_id: string;
  name: string;
  mode: string;
  device_token_hash: string | null;
  token_expires_at: string | null;
  last_seen_at: string | null;
  config: string | null;
  created_at: string;
  primary_user_id: string | null;
}

const DEVICE_COLUMNS = `id, workspace_id, name, mode, device_token_hash,
       token_expires_at, last_seen_at, config, created_at, primary_user_id`;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function calculateExpiry(ttlDays: number = DEFAULT_TOKEN_TTL_DAYS): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + ttlDays);
  return expiry.toISOString();
}

function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function rowToDevice(row: DeviceRow): PersistedDevice {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    mode: row.mode as DeviceMode,
    deviceTokenHash: row.device_token_hash,
    tokenExpiresAt: row.token_expires_at,
    lastSeenAt: row.last_seen_at,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
    primaryUserId: row.primary_user_id,
  };
}

/**
 * Repository for persisted device records.
 * Handles device tokens for reconnection without re-authentication.
 * 
 * SECURITY: Device tokens are NEVER stored in plaintext.
 * Only SHA-256 hashes are persisted. The plaintext token is returned
 * once on creation/regeneration and never stored.
 */
export class DeviceRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): PersistedDevice | null {
    const stmt = this.db.prepare<[string], DeviceRow>(`
      SELECT id, workspace_id, name, mode, device_token_hash,
             token_expires_at, last_seen_at, config, created_at, primary_user_id
      FROM devices WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToDevice(row) : null;
  }

  findByTokenHash(tokenHash: string): PersistedDevice | null {
    const stmt = this.db.prepare<[string], DeviceRow>(`
      SELECT id, workspace_id, name, mode, device_token_hash,
             token_expires_at, last_seen_at, config, created_at, primary_user_id
      FROM devices WHERE device_token_hash = ?
    `);
    const row = stmt.get(tokenHash);
    return row ? rowToDevice(row) : null;
  }

  /**
   * Validate a device token and return the device if valid.
   * Returns null if token is invalid or expired.
   */
  validateToken(token: string): PersistedDevice | null {
    const hash = hashToken(token);
    const device = this.findByTokenHash(hash);
    
    // Check expiration
    if (device && isTokenExpired(device.tokenExpiresAt)) {
      return null;
    }
    
    return device;
  }

  /**
   * Check if a token is close to expiration (within 7 days).
   * Used to suggest token renewal to the client.
   */
  isTokenExpiringSoon(device: PersistedDevice): boolean {
    if (!device.tokenExpiresAt) return false;
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    return new Date(device.tokenExpiresAt) < sevenDaysFromNow;
  }

  findByWorkspace(workspaceId: string): PersistedDevice[] {
    const stmt = this.db.prepare<[string], DeviceRow>(`
      SELECT id, workspace_id, name, mode, device_token_hash,
             token_expires_at, last_seen_at, config, created_at, primary_user_id
      FROM devices WHERE workspace_id = ? ORDER BY last_seen_at DESC
    `);
    const rows = stmt.all(workspaceId);
    return rows.map(rowToDevice);
  }

  /**
   * Create a new device with a unique token.
   * Returns the device and plaintext token (token is returned ONCE only).
   * SECURITY: Only the hash is stored in the database.
   */
  create(input: DeviceCreateInput): { device: PersistedDevice; token: string; expiresAt: string } {
    const id = uuidv4();
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();
    const expiresAt = calculateExpiry();

    const stmt = this.db.prepare(`
      INSERT INTO devices (id, workspace_id, name, mode, device_token_hash, token_expires_at, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.workspaceId, input.name, input.mode, tokenHash, expiresAt, now, now);

    const device = this.findById(id);
    if (!device) {
      throw new Error('Device not found after creation');
    }
    return { device, token, expiresAt };
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
  ): { device: PersistedDevice; token: string | null; expiresAt: string | null; isNew: boolean } {
    const existing = this.findById(deviceId);

    if (existing) {
      // Update last seen and any changed fields
      this.update(deviceId, { name, mode });
      this.updateLastSeen(deviceId);
      const updated = this.findById(deviceId);
      return { device: updated!, token: null, expiresAt: null, isNew: false };
    }

    // Create new device
    const { device, token, expiresAt } = this.create({
      workspaceId,
      name,
      mode,
    });

    // Update ID if different (client may provide their own ID)
    if (device.id !== deviceId) {
      // For now, use the provided ID for new devices
      this.db.prepare('UPDATE devices SET id = ? WHERE id = ?').run(deviceId, device.id);
      const updated = this.findById(deviceId);
      return { device: updated!, token, expiresAt, isNew: true };
    }

    return { device, token, expiresAt, isNew: true };
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
   * Record the authenticated user who claimed this device. Called by
   * the QR-token / device-claim auth path (#383). Passing `null`
   * explicitly clears the link — useful for "log out of this kiosk".
   *
   * Returns the updated row (or `null` if no such device).
   */
  setPrimaryUser(id: string, userId: string | null): PersistedDevice | null {
    const stmt = this.db.prepare(
      `UPDATE devices SET primary_user_id = ? WHERE id = ?`
    );
    const result = stmt.run(userId, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  /**
   * Regenerate a device token (invalidates old token).
   * Also resets the expiration timer.
   * SECURITY: Only the hash is stored in the database.
   */
  regenerateToken(id: string): { device: PersistedDevice; token: string; expiresAt: string } | null {
    const device = this.findById(id);
    if (!device) return null;

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = calculateExpiry();

    const stmt = this.db.prepare(`
      UPDATE devices SET device_token_hash = ?, token_expires_at = ? WHERE id = ?
    `);
    stmt.run(tokenHash, expiresAt, id);

    const updated = this.findById(id);
    return { device: updated!, token, expiresAt };
  }

  /**
   * Renew a device token's expiration without changing the token.
   * Use when token is close to expiring but still valid.
   */
  renewTokenExpiry(id: string): PersistedDevice | null {
    const device = this.findById(id);
    if (!device) return null;

    const expiresAt = calculateExpiry();
    const stmt = this.db.prepare(`
      UPDATE devices SET token_expires_at = ? WHERE id = ?
    `);
    stmt.run(expiresAt, id);

    return this.findById(id);
  }

  /**
   * Revoke a device's token (for security purposes).
   */
  revokeToken(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE devices SET device_token_hash = NULL, token_expires_at = NULL WHERE id = ?
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
