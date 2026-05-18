import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storeDeviceToken,
  getStoredDeviceToken,
  clearDeviceToken,
  validateDeviceToken,
  hasDeviceTokenForWorkspace,
  storeSessionDeviceId,
  getSessionDeviceId,
  getServerSetDeviceToken,
  parseDeviceCookieJson,
  migrateLegacyDeviceToken,
  // migrateServerSetDeviceCookie is tested via integration tests (Playwright)
  // as it requires cookie manipulation that jsdom doesn't fully support
} from './deviceToken';

describe('deviceToken utilities', () => {
  beforeEach(() => {
    // Clear storage before each test
    localStorage.clear();
    sessionStorage.clear();
    // Reset fetch mock
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('storeDeviceToken / getStoredDeviceToken', () => {
    it('stores and retrieves device token info with workspace-scoped key', () => {
      const info = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      storeDeviceToken(info);
      const stored = getStoredDeviceToken('workspace-456');

      expect(stored).toEqual(info);
    });

    it('uses workspace-scoped storage key', () => {
      const info = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      storeDeviceToken(info);
      
      // Should NOT use legacy key
      expect(localStorage.getItem('voice_relay_device_token')).toBeNull();
      // Should use workspace-scoped key
      expect(localStorage.getItem('voice_relay_device_token_workspace-456')).not.toBeNull();
    });

    it('stores tokens for multiple workspaces independently', () => {
      const workspace1Device = {
        deviceId: 'device-111',
        deviceToken: 'token-aaa',
        workspaceId: 'workspace-1',
        name: 'Phone 1',
        mode: 'mobile' as const,
      };

      const workspace2Device = {
        deviceId: 'device-222',
        deviceToken: 'token-bbb',
        workspaceId: 'workspace-2',
        name: 'Phone 2',
        mode: 'kiosk' as const,
      };

      storeDeviceToken(workspace1Device);
      storeDeviceToken(workspace2Device);

      // Each workspace should have its own stored device
      expect(getStoredDeviceToken('workspace-1')).toEqual(workspace1Device);
      expect(getStoredDeviceToken('workspace-2')).toEqual(workspace2Device);
    });

    it('returns null when no token stored for workspace', () => {
      const stored = getStoredDeviceToken('workspace-123');
      expect(stored).toBeNull();
    });

    it('returns null when workspace not provided and no legacy storage', () => {
      const stored = getStoredDeviceToken();
      expect(stored).toBeNull();
    });

    it('handles malformed JSON in storage', () => {
      localStorage.setItem('voice_relay_device_token_workspace-456', 'not-valid-json');
      
      // Should return null and log error (not throw)
      const stored = getStoredDeviceToken('workspace-456');
      expect(stored).toBeNull();
    });

    it('handles localStorage errors gracefully', () => {
      // Mock localStorage to throw
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('QuotaExceeded');
      });

      // Should not throw
      expect(() => {
        storeDeviceToken({
          deviceId: 'device-123',
          deviceToken: 'token-abc',
          workspaceId: 'workspace-456',
          name: 'My Phone',
          mode: 'mobile',
        });
      }).not.toThrow();

      localStorage.setItem = originalSetItem;
    });
  });

  describe('legacy storage migration', () => {
    it('getStoredDeviceToken reads legacy storage without migrating (pure read)', () => {
      const legacyDevice = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      // Store in legacy location
      localStorage.setItem('voice_relay_device_token', JSON.stringify(legacyDevice));

      // Retrieve should read but NOT migrate (pure read function)
      const stored = getStoredDeviceToken('workspace-456');

      expect(stored).toEqual(legacyDevice);
      // Legacy key should still exist (no migration in getter)
      expect(localStorage.getItem('voice_relay_device_token')).not.toBeNull();
    });

    it('migrateLegacyDeviceToken migrates to workspace-scoped storage', () => {
      const legacyDevice = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      // Store in legacy location
      localStorage.setItem('voice_relay_device_token', JSON.stringify(legacyDevice));

      // Explicit migration call
      const migrated = migrateLegacyDeviceToken('workspace-456');

      expect(migrated).toEqual(legacyDevice);
      // Legacy key should be removed after migration
      expect(localStorage.getItem('voice_relay_device_token')).toBeNull();
      // New workspace-scoped key should exist
      expect(localStorage.getItem('voice_relay_device_token_workspace-456')).not.toBeNull();
    });

    it('migrateLegacyDeviceToken does not migrate for different workspace', () => {
      const legacyDevice = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      // Store in legacy location
      localStorage.setItem('voice_relay_device_token', JSON.stringify(legacyDevice));

      // Try to migrate for different workspace
      const migrated = migrateLegacyDeviceToken('workspace-789');

      expect(migrated).toBeNull();
      // Legacy key should still exist (not migrated for wrong workspace)
      expect(localStorage.getItem('voice_relay_device_token')).not.toBeNull();
    });

    it('does not migrate legacy storage for different workspace on read', () => {
      const legacyDevice = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      // Store in legacy location
      localStorage.setItem('voice_relay_device_token', JSON.stringify(legacyDevice));

      // Try to retrieve for different workspace
      const stored = getStoredDeviceToken('workspace-789');

      expect(stored).toBeNull();
      // Legacy key should still exist (not migrated for wrong workspace)
      expect(localStorage.getItem('voice_relay_device_token')).not.toBeNull();
    });

    it('returns legacy device when no workspace provided (backward compatibility)', () => {
      const legacyDevice = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      // Store in legacy location
      localStorage.setItem('voice_relay_device_token', JSON.stringify(legacyDevice));

      // Retrieve without workspace ID should return legacy device
      const stored = getStoredDeviceToken();

      expect(stored).toEqual(legacyDevice);
    });
  });

  describe('clearDeviceToken', () => {
    it('removes stored token for workspace', () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      clearDeviceToken('workspace-456');
      
      const stored = getStoredDeviceToken('workspace-456');
      expect(stored).toBeNull();
    });

    it('only clears token for specified workspace', () => {
      storeDeviceToken({
        deviceId: 'device-111',
        deviceToken: 'token-aaa',
        workspaceId: 'workspace-1',
        name: 'Phone 1',
        mode: 'mobile',
      });
      storeDeviceToken({
        deviceId: 'device-222',
        deviceToken: 'token-bbb',
        workspaceId: 'workspace-2',
        name: 'Phone 2',
        mode: 'mobile',
      });

      clearDeviceToken('workspace-1');
      
      // workspace-1 should be cleared
      expect(getStoredDeviceToken('workspace-1')).toBeNull();
      // workspace-2 should still exist
      expect(getStoredDeviceToken('workspace-2')).not.toBeNull();
    });

    it('clears legacy storage when it belongs to the same workspace', () => {
      localStorage.setItem('voice_relay_device_token', JSON.stringify({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      }));

      clearDeviceToken('workspace-456');
      
      // Legacy key should be cleared because it belongs to the same workspace
      expect(localStorage.getItem('voice_relay_device_token')).toBeNull();
    });

    it('does NOT clear legacy storage when it belongs to a different workspace', () => {
      // Legacy storage has workspace-A device
      localStorage.setItem('voice_relay_device_token', JSON.stringify({
        deviceId: 'device-A',
        deviceToken: 'token-A',
        workspaceId: 'workspace-A',
        name: 'Phone A',
        mode: 'mobile',
      }));
      
      // Workspace-scoped storage has workspace-B device
      storeDeviceToken({
        deviceId: 'device-B',
        deviceToken: 'token-B',
        workspaceId: 'workspace-B',
        name: 'Phone B',
        mode: 'mobile',
      });
      
      // Clear workspace-B
      clearDeviceToken('workspace-B');
      
      // workspace-B should be cleared
      expect(getStoredDeviceToken('workspace-B')).toBeNull();
      // Legacy (workspace-A) should STILL exist - isolation preserved
      expect(localStorage.getItem('voice_relay_device_token')).not.toBeNull();
    });

    it('clears legacy storage when JSON is malformed', () => {
      localStorage.setItem('voice_relay_device_token', 'invalid-json');

      clearDeviceToken('workspace-456');
      
      // Invalid JSON should be cleared as it can't be used
      expect(localStorage.getItem('voice_relay_device_token')).toBeNull();
    });

    it('handles clearing when nothing stored', () => {
      // Should not throw
      expect(() => clearDeviceToken('workspace-456')).not.toThrow();
    });
  });

  describe('hasDeviceTokenForWorkspace', () => {
    it('returns true when token exists for workspace', () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      expect(hasDeviceTokenForWorkspace('workspace-456')).toBe(true);
    });

    it('returns false when token exists for different workspace', () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      expect(hasDeviceTokenForWorkspace('workspace-other')).toBe(false);
    });

    it('returns false when no token stored', () => {
      expect(hasDeviceTokenForWorkspace('workspace-456')).toBe(false);
    });
  });

  describe('storeSessionDeviceId / getSessionDeviceId', () => {
    it('stores and retrieves device ID from session storage', () => {
      storeSessionDeviceId('device-123');
      
      const id = getSessionDeviceId();
      expect(id).toBe('device-123');
    });

    it('returns null when no device ID stored', () => {
      const id = getSessionDeviceId();
      expect(id).toBeNull();
    });

    it('handles sessionStorage errors gracefully', () => {
      const originalSetItem = sessionStorage.setItem;
      sessionStorage.setItem = vi.fn(() => {
        throw new Error('QuotaExceeded');
      });

      // Should not throw
      expect(() => storeSessionDeviceId('device-123')).not.toThrow();

      sessionStorage.setItem = originalSetItem;
    });
  });

  describe('validateDeviceToken', () => {
    it('returns null when no token stored', async () => {
      const result = await validateDeviceToken('workspace-456');
      expect(result).toBeNull();
    });

    it('validates token with server and returns device', async () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      const mockDevice = {
        id: 'device-123',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ device: mockDevice }),
      });

      const result = await validateDeviceToken('workspace-456');

      expect(result).toEqual(mockDevice);
      expect(fetch).toHaveBeenCalledWith('/api/devices/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceToken: 'token-abc' }),
      });
    });

    it('clears token and returns null on 401', async () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await validateDeviceToken('workspace-456');

      expect(result).toBeNull();
      // Token should be cleared
      expect(getStoredDeviceToken('workspace-456')).toBeNull();
    });

    it('returns null on network error without clearing token', async () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await validateDeviceToken('workspace-456');

      expect(result).toBeNull();
      // Token should NOT be cleared on network error
      expect(getStoredDeviceToken('workspace-456')).not.toBeNull();
    });

    it('returns null on non-401 error without clearing token', async () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await validateDeviceToken('workspace-456');

      expect(result).toBeNull();
      // Token should NOT be cleared on server error
      expect(getStoredDeviceToken('workspace-456')).not.toBeNull();
    });
  });

  describe('parseDeviceCookieJson', () => {
    // This function is extracted to enable thorough testing of the parsing/validation
    // logic without relying on jsdom cookie mocking.

    it('parses valid JSON with all required fields', () => {
      const json = JSON.stringify({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My iPhone',
        mode: 'mobile',
      });

      const result = parseDeviceCookieJson(json);

      expect(result).toEqual({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My iPhone',
        mode: 'mobile',
      });
    });

    it('provides default name when not specified', () => {
      const json = JSON.stringify({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
      });

      const result = parseDeviceCookieJson(json);

      expect(result?.name).toBe('Device');
    });

    it('provides default mode when not specified', () => {
      const json = JSON.stringify({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
      });

      const result = parseDeviceCookieJson(json);

      expect(result?.mode).toBe('mobile');
    });

    it('returns null when deviceId is missing', () => {
      const json = JSON.stringify({
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
      });

      const result = parseDeviceCookieJson(json);

      expect(result).toBeNull();
    });

    it('returns null when deviceToken is missing', () => {
      const json = JSON.stringify({
        deviceId: 'device-123',
        workspaceId: 'workspace-456',
      });

      const result = parseDeviceCookieJson(json);

      expect(result).toBeNull();
    });

    it('returns null when workspaceId is missing', () => {
      const json = JSON.stringify({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
      });

      const result = parseDeviceCookieJson(json);

      expect(result).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      const result = parseDeviceCookieJson('not-valid-json');

      expect(result).toBeNull();
    });

    it('returns null for empty JSON object', () => {
      const result = parseDeviceCookieJson('{}');

      expect(result).toBeNull();
    });

    it('returns null for JSON array', () => {
      const result = parseDeviceCookieJson('[]');

      expect(result).toBeNull();
    });

    it('returns null for empty string values in required fields', () => {
      const json = JSON.stringify({
        deviceId: '',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
      });

      const result = parseDeviceCookieJson(json);

      expect(result).toBeNull();
    });

    it('preserves kiosk mode when specified', () => {
      const json = JSON.stringify({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        mode: 'kiosk',
      });

      const result = parseDeviceCookieJson(json);

      expect(result?.mode).toBe('kiosk');
    });
  });

  describe('getServerSetDeviceToken', () => {
    // Cookie reading is tested via the parseDeviceCookieJson tests above.
    // Here we test the integration behavior (cookie lookup returning null).

    it('returns null when no cookie is set (jsdom default state)', () => {
      // In jsdom, document.cookie starts empty
      const result = getServerSetDeviceToken();
      expect(result).toBeNull();
    });
  });

  describe('cookie migration in getStoredDeviceToken', () => {
    // The migration flow (read cookie -> write localStorage -> delete cookie)
    // is tested via parseDeviceCookieJson tests (parsing) and storeDeviceToken tests
    // (localStorage write). Full integration testing requires real browser (Playwright).

    it('prefers workspace-scoped localStorage over legacy when both exist', () => {
      const workspaceScopedDevice = {
        deviceId: 'scoped-device',
        deviceToken: 'scoped-token',
        workspaceId: 'test-workspace',
        name: 'Scoped Device',
        mode: 'mobile' as const,
      };

      const legacyDevice = {
        deviceId: 'legacy-device',
        deviceToken: 'legacy-token',
        workspaceId: 'test-workspace',
        name: 'Legacy Device',
        mode: 'mobile' as const,
      };

      // Store device in workspace-scoped location
      localStorage.setItem('voice_relay_device_token_test-workspace', JSON.stringify(workspaceScopedDevice));
      // Also store in legacy location
      localStorage.setItem('voice_relay_device_token', JSON.stringify(legacyDevice));

      // getStoredDeviceToken should prefer workspace-scoped storage
      const result = getStoredDeviceToken('test-workspace');

      expect(result).toEqual(workspaceScopedDevice);
    });

    it('returns null when neither localStorage nor cookie has device info', () => {
      // localStorage is empty (cleared in beforeEach)
      // No cookie set
      const result = getStoredDeviceToken('workspace-456');
      expect(result).toBeNull();
    });
  });
});
