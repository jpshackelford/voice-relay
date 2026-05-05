import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storeDeviceToken,
  getStoredDeviceToken,
  clearDeviceToken,
  validateDeviceToken,
  hasDeviceTokenForWorkspace,
  storeSessionDeviceId,
  getSessionDeviceId,
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
});
