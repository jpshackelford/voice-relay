import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DeviceRepository } from './device-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';

describe('DeviceRepository', () => {
  let db: Database.Database;
  let repo: DeviceRepository;
  let testWorkspaceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    // Apply migrations
    db.exec(usersMigration.up);
    db.exec(workspacesMigration.up);
    // Create devices table with new secure schema (no plaintext token)
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        device_token_hash TEXT UNIQUE,
        token_expires_at TEXT,
        last_seen_at TEXT,
        config TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_devices_workspace ON devices(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(device_token_hash);
      CREATE INDEX IF NOT EXISTS idx_devices_expires ON devices(token_expires_at);
    `);
    
    repo = new DeviceRepository(db);

    // Create a test workspace
    testWorkspaceId = 'workspace-123';
    const testUserId = 'user-123';
    
    db.prepare(`
      INSERT INTO users (id, github_id, username, created_at, last_login_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(testUserId, 12345, 'testuser');
    
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(testWorkspaceId, testUserId, 'Test Workspace', 'test-workspace', 'ABCD-1234');
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a device with generated token and expiration', () => {
      const { device, token, expiresAt } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Test Phone',
        mode: 'mobile',
      });

      expect(device.id).toBeDefined();
      expect(device.workspaceId).toBe(testWorkspaceId);
      expect(device.name).toBe('Test Phone');
      expect(device.mode).toBe('mobile');
      // SECURITY: Token is NOT stored in device - only hash
      expect(device.deviceTokenHash).toBeDefined();
      expect(device.tokenExpiresAt).toBeDefined();
      expect(device.createdAt).toBeDefined();
      // Token is returned for client storage
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(20);
      // Expiration should be ~90 days in the future
      expect(expiresAt).toBeDefined();
      const expiryDate = new Date(expiresAt);
      const now = new Date();
      const daysDiff = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(85);
      expect(daysDiff).toBeLessThan(95);
    });

    it('creates kiosk mode device', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Living Room Display',
        mode: 'kiosk',
      });

      expect(device.mode).toBe('kiosk');
    });
  });

  describe('findById', () => {
    it('finds an existing device', () => {
      const { device: created } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const found = repo.findById(created.id);
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Test Device');
    });

    it('returns null for non-existent device', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('validateToken', () => {
    it('validates a correct token', () => {
      const { device, token } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const validated = repo.validateToken(token);
      expect(validated).not.toBeNull();
      expect(validated?.id).toBe(device.id);
    });

    it('returns null for invalid token', () => {
      repo.create({
        workspaceId: testWorkspaceId,
        name: 'Test Device',
        mode: 'mobile',
      });

      const validated = repo.validateToken('invalid-token');
      expect(validated).toBeNull();
    });
  });

  describe('findByWorkspace', () => {
    it('finds all devices in a workspace', () => {
      repo.create({ workspaceId: testWorkspaceId, name: 'Device 1', mode: 'mobile' });
      repo.create({ workspaceId: testWorkspaceId, name: 'Device 2', mode: 'kiosk' });
      repo.create({ workspaceId: testWorkspaceId, name: 'Device 3', mode: 'mobile' });

      const devices = repo.findByWorkspace(testWorkspaceId);
      expect(devices).toHaveLength(3);
    });

    it('returns empty array for workspace with no devices', () => {
      const devices = repo.findByWorkspace('other-workspace');
      expect(devices).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('updates device name', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Old Name',
        mode: 'mobile',
      });

      const updated = repo.update(device.id, { name: 'New Name' });
      expect(updated?.name).toBe('New Name');
      expect(updated?.mode).toBe('mobile');
    });

    it('updates device mode', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      const updated = repo.update(device.id, { mode: 'kiosk' });
      expect(updated?.mode).toBe('kiosk');
    });

    it('updates device config', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      const updated = repo.update(device.id, { 
        config: { displayLines: 10, theme: 'dark' } 
      });
      expect(updated?.config).toEqual({ displayLines: 10, theme: 'dark' });
    });

    it('returns null for non-existent device', () => {
      const updated = repo.update('non-existent', { name: 'Test' });
      expect(updated).toBeNull();
    });
  });

  describe('updateLastSeen', () => {
    it('updates last seen timestamp', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      const initialLastSeen = device.lastSeenAt;
      
      // Wait a bit to ensure timestamp changes
      repo.updateLastSeen(device.id);
      
      const updated = repo.findById(device.id);
      expect(updated?.lastSeenAt).toBeDefined();
      // Should be same or later than initial
      if (initialLastSeen) {
        expect(new Date(updated!.lastSeenAt!).getTime())
          .toBeGreaterThanOrEqual(new Date(initialLastSeen).getTime());
      }
    });
  });

  describe('regenerateToken', () => {
    it('generates a new token with fresh expiration', () => {
      const { device, token: oldToken } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      const result = repo.regenerateToken(device.id);
      expect(result).not.toBeNull();
      expect(result!.token).not.toBe(oldToken);
      expect(result!.expiresAt).toBeDefined();
      
      // Old token should no longer work
      expect(repo.validateToken(oldToken)).toBeNull();
      
      // New token should work
      const validated = repo.validateToken(result!.token);
      expect(validated?.id).toBe(device.id);
    });

    it('returns null for non-existent device', () => {
      const result = repo.regenerateToken('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('token expiration', () => {
    it('rejects expired tokens', () => {
      const { device, token } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      // Manually set token as expired
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      db.prepare('UPDATE devices SET token_expires_at = ? WHERE id = ?')
        .run(pastDate.toISOString(), device.id);

      // Token should now be invalid
      expect(repo.validateToken(token)).toBeNull();
    });

    it('detects tokens expiring soon', () => {
      const { device, token } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      // Token with 90 days should not be expiring soon
      const validated = repo.validateToken(token);
      expect(validated).not.toBeNull();
      expect(repo.isTokenExpiringSoon(validated!)).toBe(false);

      // Set expiration to 3 days from now (within 7 day threshold)
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      db.prepare('UPDATE devices SET token_expires_at = ? WHERE id = ?')
        .run(soonDate.toISOString(), device.id);

      const updatedDevice = repo.findById(device.id);
      expect(repo.isTokenExpiringSoon(updatedDevice!)).toBe(true);
    });

    it('renews token expiration', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      // Set expiration to 3 days from now
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      db.prepare('UPDATE devices SET token_expires_at = ? WHERE id = ?')
        .run(soonDate.toISOString(), device.id);

      // Renew should extend to ~90 days
      const renewed = repo.renewTokenExpiry(device.id);
      expect(renewed).not.toBeNull();
      
      const expiryDate = new Date(renewed!.tokenExpiresAt!);
      const now = new Date();
      const daysDiff = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(85);
    });
  });

  describe('revokeToken', () => {
    it('revokes device token', () => {
      const { device, token } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      repo.revokeToken(device.id);
      
      // Token should no longer validate
      expect(repo.validateToken(token)).toBeNull();
      
      // Device should still exist but with null hash
      const found = repo.findById(device.id);
      expect(found).not.toBeNull();
      expect(found!.deviceTokenHash).toBeNull();
      expect(found!.tokenExpiresAt).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a device', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Device',
        mode: 'mobile',
      });

      repo.delete(device.id);
      
      expect(repo.findById(device.id)).toBeNull();
    });
  });

  describe('deleteByWorkspace', () => {
    it('deletes all devices in a workspace', () => {
      repo.create({ workspaceId: testWorkspaceId, name: 'Device 1', mode: 'mobile' });
      repo.create({ workspaceId: testWorkspaceId, name: 'Device 2', mode: 'kiosk' });

      expect(repo.findByWorkspace(testWorkspaceId)).toHaveLength(2);

      repo.deleteByWorkspace(testWorkspaceId);
      
      expect(repo.findByWorkspace(testWorkspaceId)).toHaveLength(0);
    });
  });

  describe('registerOrUpdate', () => {
    it('creates new device if ID not found', () => {
      const result = repo.registerOrUpdate(
        'new-device-id',
        testWorkspaceId,
        'New Device',
        'mobile'
      );

      expect(result.isNew).toBe(true);
      expect(result.token).not.toBeNull();
      expect(result.expiresAt).not.toBeNull();
      expect(result.device.name).toBe('New Device');
    });

    it('updates existing device without generating new token', () => {
      const { device } = repo.create({
        workspaceId: testWorkspaceId,
        name: 'Old Name',
        mode: 'mobile',
      });

      const result = repo.registerOrUpdate(
        device.id,
        testWorkspaceId,
        'Updated Name',
        'kiosk'
      );

      expect(result.isNew).toBe(false);
      expect(result.token).toBeNull(); // No new token for existing device
      expect(result.expiresAt).toBeNull(); // No new expiry for existing device
      expect(result.device.name).toBe('Updated Name');
      expect(result.device.mode).toBe('kiosk');
    });
  });
});
