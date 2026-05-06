/**
 * Device token storage and validation for reconnection support.
 * Uses localStorage for persistence across page refreshes.
 * Also checks for server-set cookies from auto-device creation.
 * 
 * SECURITY NOTE: Device cookies are NOT httpOnly - they are readable by JavaScript
 * to allow client-side device session restoration. This is acceptable because:
 * - Device tokens only identify a device within a workspace
 * - Auth tokens (which ARE httpOnly) are required for authenticated operations
 * - Device tokens cannot be used to impersonate users or access other workspaces
 */

const DEVICE_TOKEN_KEY = 'voice_relay_device_token';
const DEVICE_ID_KEY = 'voice_relay_device_id';
const DEVICE_TOKEN_COOKIE_NAME = 'voice_relay_device';

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
 * Read a cookie by name.
 */
function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    const cookieValue = parts.pop()?.split(';').shift();
    return cookieValue ? decodeURIComponent(cookieValue) : null;
  }
  return null;
}

/**
 * Read device info from server-set cookie (from auto-device creation).
 * Returns null if cookie doesn't exist or is invalid.
 */
export function getServerSetDeviceToken(): StoredDeviceInfo | null {
  try {
    const cookieData = getCookie(DEVICE_TOKEN_COOKIE_NAME);
    if (!cookieData) return null;
    
    const parsed = JSON.parse(cookieData);
    // Validate required fields
    if (!parsed.deviceId || !parsed.deviceToken || !parsed.workspaceId) {
      return null;
    }
    
    return {
      deviceId: parsed.deviceId,
      deviceToken: parsed.deviceToken,
      workspaceId: parsed.workspaceId,
      name: parsed.name || 'Device',
      mode: parsed.mode || 'mobile',
    };
  } catch (e) {
    console.error('[DeviceToken] Failed to read server-set device cookie:', e);
    return null;
  }
}

/**
 * Store device token after successful registration/login.
 * Returns true if storage succeeded, false otherwise.
 */
export function storeDeviceToken(info: StoredDeviceInfo): boolean {
  try {
    localStorage.setItem(DEVICE_TOKEN_KEY, JSON.stringify(info));
    // Verify the write succeeded by reading back
    const stored = localStorage.getItem(DEVICE_TOKEN_KEY);
    return stored !== null;
  } catch (e) {
    console.error('[DeviceToken] Failed to store device token:', e);
    return false;
  }
}

/**
 * Get stored device token info from localStorage.
 * Also checks for server-set cookie and migrates to localStorage if found.
 */
export function getStoredDeviceToken(): StoredDeviceInfo | null {
  try {
    // First check localStorage
    const stored = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (stored) {
      return JSON.parse(stored) as StoredDeviceInfo;
    }
    
    // Check for server-set cookie (from auto-device creation)
    const serverSetDevice = getServerSetDeviceToken();
    if (serverSetDevice) {
      // Migrate to localStorage for consistency
      console.log('[DeviceToken] Found server-set device cookie, migrating to localStorage');
      const migrationSucceeded = storeDeviceToken(serverSetDevice);
      if (migrationSucceeded) {
        // Only delete the cookie if localStorage migration succeeded
        // This ensures the cookie remains as a safety net if localStorage is disabled/full
        document.cookie = `${DEVICE_TOKEN_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      } else {
        console.warn('[DeviceToken] localStorage migration failed, keeping cookie as fallback');
      }
      return serverSetDevice;
    }
    
    return null;
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
