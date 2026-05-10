import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDeviceRestoration } from './useDeviceRestoration';
import * as deviceTokenModule from '../utils/deviceToken';

// Mock the device token module
vi.mock('../utils/deviceToken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/deviceToken')>();
  return {
    ...actual,
    getStoredDeviceToken: vi.fn(),
    validateDeviceToken: vi.fn(),
    clearDeviceToken: vi.fn(),
    storeDeviceToken: vi.fn(() => true),
    storeSessionDeviceId: vi.fn(),
    getSessionDeviceId: vi.fn(() => null),
  };
});

// Mock generateDefaultDeviceName
vi.mock('../utils/deviceName', () => ({
  generateDefaultDeviceName: vi.fn(() => 'Device-abc123'),
}));

// Mock generateUUID
vi.mock('../utils/uuid', () => ({
  generateUUID: vi.fn(() => 'test-uuid-123'),
}));

describe('useDeviceRestoration', () => {
  beforeEach(() => {
    // Clear storage
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('generates a new device ID when no stored token exists', () => {
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(null);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-123'));

      expect(result.current.deviceId).toBe('test-uuid-123');
      expect(result.current.wasRestored).toBe(false);
      expect(result.current.deviceToken).toBeNull();
    });

    it('generates a default display name when none is stored', () => {
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(null);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-123'));

      expect(result.current.displayName).toBe('Device-abc123');
    });

    it('uses stored device ID from session storage', () => {
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue('session-device-id');
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-123'));

      expect(result.current.deviceId).toBe('session-device-id');
    });
  });

  describe('device token validation', () => {
    const storedDevice = {
      deviceId: 'device-123',
      deviceToken: 'token-abc',
      workspaceId: 'workspace-456',
      name: 'Old Name',
      mode: 'mobile' as const,
    };

    it('validates and restores session when stored token is valid', async () => {
      const validatedDevice = {
        id: 'device-123',
        workspaceId: 'workspace-456',
        name: 'Old Name',
        mode: 'mobile' as const,
      };

      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(storedDevice);
      vi.mocked(deviceTokenModule.validateDeviceToken).mockResolvedValue(validatedDevice);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-456'));

      await waitFor(() => {
        expect(result.current.wasRestored).toBe(true);
      });

      expect(result.current.deviceToken).toBe('token-abc');
      expect(result.current.restoredMode).toBe('mobile');
    });

    it('updates display name from server-authoritative name after validation', async () => {
      const serverName = 'Living Room Speaker';
      const validatedDevice = {
        id: 'device-123',
        workspaceId: 'workspace-456',
        name: serverName,
        mode: 'mobile' as const,
      };

      // Set stale name in session storage (simulates navigating from workspace to kiosk)
      sessionStorage.setItem('displayName', 'Old Stale Name');

      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue({
        ...storedDevice,
        name: 'Old Stale Name',
      });
      vi.mocked(deviceTokenModule.validateDeviceToken).mockResolvedValue(validatedDevice);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue('device-123');

      const { result } = renderHook(() => useDeviceRestoration('workspace-456'));

      await waitFor(() => {
        expect(result.current.wasRestored).toBe(true);
      });

      // Key assertion: displayName should be updated to server-authoritative name
      expect(result.current.displayName).toBe(serverName);
      
      // Also verify session storage was updated
      expect(sessionStorage.getItem('displayName')).toBe(serverName);
      
      // And localStorage was updated via storeDeviceToken
      expect(deviceTokenModule.storeDeviceToken).toHaveBeenCalledWith(
        expect.objectContaining({
          name: serverName,
        })
      );
    });

    it('syncs device name on navigation (reproduces issue #85 fix)', async () => {
      // Scenario: User renames device to "Living Room Speaker" on workspace page
      // Server has correct name, but localStorage/sessionStorage have old name
      // When navigating to kiosk view, name should be synced from server

      const serverName = 'Living Room Speaker';
      const staleName = 'Mac-a3f7c2b';

      const storedDeviceWithStaleName = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: staleName,
        mode: 'kiosk' as const,
      };

      const validatedDevice = {
        id: 'device-123',
        workspaceId: 'workspace-456',
        name: serverName,
        mode: 'kiosk' as const,
      };

      // Session storage has stale name (from before rename)
      sessionStorage.setItem('displayName', staleName);

      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(storedDeviceWithStaleName);
      vi.mocked(deviceTokenModule.validateDeviceToken).mockResolvedValue(validatedDevice);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue('device-123');

      const { result } = renderHook(() => useDeviceRestoration('workspace-456'));

      await waitFor(() => {
        expect(result.current.wasRestored).toBe(true);
      });

      // After validation, display name should match server's authoritative name
      expect(result.current.displayName).toBe(serverName);
      
      // Both session and local storage should be updated
      expect(sessionStorage.getItem('displayName')).toBe(serverName);
      expect(deviceTokenModule.storeDeviceToken).toHaveBeenCalledWith({
        ...storedDeviceWithStaleName,
        name: serverName,
      });
    });

    it('clears token when validation fails for wrong workspace', async () => {
      const validatedDevice = {
        id: 'device-123',
        workspaceId: 'different-workspace',
        name: 'Some Name',
        mode: 'mobile' as const,
      };

      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(storedDevice);
      vi.mocked(deviceTokenModule.validateDeviceToken).mockResolvedValue(validatedDevice);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-456'));

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false);
      });

      expect(deviceTokenModule.clearDeviceToken).toHaveBeenCalled();
      expect(result.current.wasRestored).toBe(false);
    });

    it('does not validate when workspace ID is not provided', () => {
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(storedDevice);

      renderHook(() => useDeviceRestoration(undefined));

      expect(deviceTokenModule.validateDeviceToken).not.toHaveBeenCalled();
    });

    it('does not validate when stored token is for different workspace', () => {
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue({
        ...storedDevice,
        workspaceId: 'different-workspace',
      });
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      renderHook(() => useDeviceRestoration('workspace-456'));

      expect(deviceTokenModule.validateDeviceToken).not.toHaveBeenCalled();
    });

    it('handles validation errors gracefully', async () => {
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(storedDevice);
      vi.mocked(deviceTokenModule.validateDeviceToken).mockRejectedValue(new Error('Network error'));
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-456'));

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false);
      });

      // Should not crash, just log error and continue
      expect(result.current.wasRestored).toBe(false);
    });
  });

  describe('setDisplayName', () => {
    it('updates display name and persists to session storage', () => {
      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(null);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-123'));

      act(() => {
        result.current.setDisplayName('My Custom Device');
      });

      expect(result.current.displayName).toBe('My Custom Device');
      expect(sessionStorage.getItem('displayName')).toBe('My Custom Device');
    });
  });

  describe('mode restoration', () => {
    it('restores mode from validated device', async () => {
      const storedDevice = {
        deviceId: 'device-123',
        deviceToken: 'token-abc',
        workspaceId: 'workspace-456',
        name: 'Test Device',
        mode: 'mobile' as const,
      };

      const validatedDevice = {
        id: 'device-123',
        workspaceId: 'workspace-456',
        name: 'Test Device',
        mode: 'kiosk' as const,
      };

      vi.mocked(deviceTokenModule.getStoredDeviceToken).mockReturnValue(storedDevice);
      vi.mocked(deviceTokenModule.validateDeviceToken).mockResolvedValue(validatedDevice);
      vi.mocked(deviceTokenModule.getSessionDeviceId).mockReturnValue(null);

      const { result } = renderHook(() => useDeviceRestoration('workspace-456'));

      await waitFor(() => {
        expect(result.current.wasRestored).toBe(true);
      });

      expect(result.current.restoredMode).toBe('kiosk');
    });
  });
});
