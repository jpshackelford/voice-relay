/**
 * Device token storage and validation for reconnection support.
 * Uses localStorage for persistence across page refreshes.
 */

const DEVICE_TOKEN_KEY = 'voice_relay_device_token';
const DEVICE_ID_KEY = 'voice_relay_device_id';

interface StoredDeviceInfo {
  deviceId: string;
  deviceToken: string;
  workspaceId: string;
  name: string;
  mode: 'mobile' | 'kiosk';
}

interface ValidatedDevice {
  id: string;
  workspaceId: string;
  name: string;
  mode: 'mobile' | 'kiosk';
}

/**
 * Store device token after successful registration/login.
 */
export function storeDeviceToken(info: StoredDeviceInfo): void {
  try {
    localStorage.setItem(DEVICE_TOKEN_KEY, JSON.stringify(info));
  } catch (e) {
    console.error('[DeviceToken] Failed to store device token:', e);
  }
}

/**
 * Get stored device token info.
 */
export function getStoredDeviceToken(): StoredDeviceInfo | null {
  try {
    const stored = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as StoredDeviceInfo;
  } catch (e) {
    console.error('[DeviceToken] Failed to read device token:', e);
    return null;
  }
}

/**
 * Clear stored device token (on logout or error).
 */
export function clearDeviceToken(): void {
  try {
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch (e) {
    console.error('[DeviceToken] Failed to clear device token:', e);
  }
}

/**
 * Validate stored device token against server.
 * Returns device info if valid, null if invalid.
 */
export async function validateDeviceToken(): Promise<ValidatedDevice | null> {
  const stored = getStoredDeviceToken();
  if (!stored?.deviceToken) {
    return null;
  }

  try {
    const response = await fetch('/api/devices/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: stored.deviceToken }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.device as ValidatedDevice;
    }

    // Token invalid, clear it
    if (response.status === 401) {
      console.log('[DeviceToken] Token invalid, clearing');
      clearDeviceToken();
    }
    return null;
  } catch (e) {
    console.error('[DeviceToken] Validation request failed:', e);
    return null;
  }
}

/**
 * Check if we have a stored device token for a specific workspace.
 */
export function hasDeviceTokenForWorkspace(workspaceId: string): boolean {
  const stored = getStoredDeviceToken();
  return stored?.workspaceId === workspaceId;
}

/**
 * Store the device ID in session storage for session continuity.
 * Session storage is used so that each tab has its own device ID.
 */
export function storeSessionDeviceId(deviceId: string): void {
  try {
    sessionStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.error('[DeviceToken] Failed to store session device ID:', e);
  }
}

/**
 * Get the device ID from session storage.
 */
export function getSessionDeviceId(): string | null {
  try {
    return sessionStorage.getItem(DEVICE_ID_KEY);
  } catch (e) {
    console.error('[DeviceToken] Failed to get session device ID:', e);
    return null;
  }
}
