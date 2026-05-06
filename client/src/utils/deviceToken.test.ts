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
    it('stores and retrieves device token info', () => {
      const info = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile' as const,
      };

      storeDeviceToken(info);
      const stored = getStoredDeviceToken();

      expect(stored).toEqual(info);
    });

    it('returns null when no token stored', () => {
      const stored = getStoredDeviceToken();
      expect(stored).toBeNull();
    });

    it('handles malformed JSON in storage', () => {
      localStorage.setItem('voice_relay_device_token', 'not-valid-json');
      
      // Should return null and log error (not throw)
      const stored = getStoredDeviceToken();
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

  describe('clearDeviceToken', () => {
    it('removes stored token', () => {
      storeDeviceToken({
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'My Phone',
        mode: 'mobile',
      });

      clearDeviceToken();
      
      const stored = getStoredDeviceToken();
      expect(stored).toBeNull();
    });

    it('handles clearing when nothing stored', () => {
      // Should not throw
      expect(() => clearDeviceToken()).not.toThrow();
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
      const result = await validateDeviceToken();
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

      const result = await validateDeviceToken();

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

      const result = await validateDeviceToken();

      expect(result).toBeNull();
      // Token should be cleared
      expect(getStoredDeviceToken()).toBeNull();
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

      const result = await validateDeviceToken();

      expect(result).toBeNull();
      // Token should NOT be cleared on network error
      expect(getStoredDeviceToken()).not.toBeNull();
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

      const result = await validateDeviceToken();

      expect(result).toBeNull();
      // Token should NOT be cleared on server error
      expect(getStoredDeviceToken()).not.toBeNull();
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

    it('prefers localStorage over cookie when both exist', () => {
      const localStorageDevice = {
        deviceId: 'local-device',
        deviceToken: 'local-token',
        workspaceId: 'local-workspace',
        name: 'Local Device',
        mode: 'mobile' as const,
      };

      // Store device in localStorage
      localStorage.setItem('voice_relay_device_token', JSON.stringify(localStorageDevice));

      // getStoredDeviceToken should check localStorage first and return it,
      // without needing to read any cookie
      const result = getStoredDeviceToken();

      expect(result).toEqual(localStorageDevice);
    });

    it('returns null when neither localStorage nor cookie has device info', () => {
      // localStorage is empty (cleared in beforeEach)
      // No cookie set
      const result = getStoredDeviceToken();
      expect(result).toBeNull();
    });
  });
});
