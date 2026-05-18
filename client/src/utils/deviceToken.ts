/**
 * Device token storage and validation for reconnection support.
 * Uses localStorage for persistence across page refreshes.
 * Also checks for server-set cookies from auto-device creation.
 * 
 * STORAGE STRATEGY:
 * Device tokens are stored per-workspace to support multiple workspaces from
 * the same browser. The storage key format is: voice_relay_device_token_{workspaceId}
 * 
 * Migration: Legacy single-key storage is automatically migrated to workspace-scoped
 * storage when the device token is accessed.
 * 
 * SECURITY NOTE: Device cookies are NOT httpOnly - they are readable by JavaScript
 * to allow client-side device session restoration. This is acceptable because:
 * - Device tokens only identify a device within a workspace
 * - Auth tokens (which ARE httpOnly) are required for authenticated operations
 * - Device tokens cannot be used to impersonate users or access other workspaces
 */

const LEGACY_DEVICE_TOKEN_KEY = 'voice_relay_device_token';
const DEVICE_TOKEN_KEY_PREFIX = 'voice_relay_device_token_';
const DEVICE_ID_KEY = 'voice_relay_device_id';
const DEVICE_TOKEN_COOKIE_NAME = 'voice_relay_device';

/**
 * Get workspace-scoped storage key for device token.
 */
function getDeviceTokenKey(workspaceId: string): string {
  return `${DEVICE_TOKEN_KEY_PREFIX}${workspaceId}`;
}

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
 * Parse and validate device cookie JSON string.
 * Extracted as a pure function for easier testing.
 * Returns null if JSON is invalid or required fields are missing.
 */
export function parseDeviceCookieJson(json: string): StoredDeviceInfo | null {
  try {
    const parsed = JSON.parse(json);
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
  } catch {
    return null;
  }
}

/**
 * Read device info from server-set cookie (from auto-device creation).
 * Returns null if cookie doesn't exist or is invalid.
 */
export function getServerSetDeviceToken(): StoredDeviceInfo | null {
  try {
    const cookieData = getCookie(DEVICE_TOKEN_COOKIE_NAME);
    if (!cookieData) return null;
    
    return parseDeviceCookieJson(cookieData);
  } catch (e) {
    console.error('[DeviceToken] Failed to read server-set device cookie:', e);
    return null;
  }
}

/**
 * Store device token after successful registration/login.
 * Uses workspace-scoped storage key.
 * Returns true if storage succeeded, false otherwise.
 */
export function storeDeviceToken(info: StoredDeviceInfo): boolean {
  try {
    const key = getDeviceTokenKey(info.workspaceId);
    localStorage.setItem(key, JSON.stringify(info));
    // Verify the write succeeded by reading back
    const stored = localStorage.getItem(key);
    return stored !== null;
  } catch (e) {
    console.error('[DeviceToken] Failed to store device token:', e);
    return false;
  }
}

/**
 * Migrate legacy single-key storage to workspace-scoped storage.
 * This is a separate function to avoid side effects in getter functions.
 * 
 * @param workspaceId - The workspace ID to migrate for.
 * @returns The migrated device info if migration occurred, null otherwise.
 */
export function migrateLegacyDeviceToken(workspaceId: string): StoredDeviceInfo | null {
  try {
    // Check legacy storage and migrate if it matches this workspace
    const legacyStored = localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY);
    if (legacyStored) {
      const legacyDevice = JSON.parse(legacyStored) as StoredDeviceInfo;
      if (legacyDevice.workspaceId === workspaceId) {
        console.log('[DeviceToken] Migrating legacy storage to workspace-scoped storage');
        storeDeviceToken(legacyDevice); // Store in new location
        localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY); // Remove legacy
        return legacyDevice;
      }
    }
    return null;
  } catch (e) {
    console.error('[DeviceToken] Failed to migrate legacy storage:', e);
    return null;
  }
}

/**
 * Migrate server-set device cookie to localStorage.
 * This is a separate function to avoid side effects in getter functions.
 * 
 * @param workspaceId - The workspace ID to migrate for (optional).
 * @returns The migrated device info if migration occurred, null otherwise.
 */
export function migrateServerSetDeviceCookie(workspaceId?: string): StoredDeviceInfo | null {
  try {
    const serverSetDevice = getServerSetDeviceToken();
    if (!serverSetDevice) return null;
    
    // Only migrate if workspace matches or we don't know the workspace yet
    if (workspaceId && serverSetDevice.workspaceId !== workspaceId) {
      return null;
    }
    
    console.log('[DeviceToken] Found server-set device cookie, migrating to localStorage');
    const migrationSucceeded = storeDeviceToken(serverSetDevice);
    if (migrationSucceeded) {
      // Only delete the cookie if localStorage migration succeeded
      // Include secure flag on HTTPS to ensure proper cookie deletion
      const isSecure = window.location.protocol === 'https:';
      const secureFlag = isSecure ? ' secure;' : '';
      document.cookie = `${DEVICE_TOKEN_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;${secureFlag}`;
    } else {
      console.warn('[DeviceToken] localStorage migration failed, keeping cookie as fallback');
    }
    return serverSetDevice;
  } catch (e) {
    console.error('[DeviceToken] Failed to migrate server cookie:', e);
    return null;
  }
}

/**
 * Get stored device token info from localStorage for a specific workspace.
 * Pure read function - no side effects.
 * 
 * Note: Call migrateLegacyDeviceToken() and migrateServerSetDeviceCookie()
 * explicitly during initialization if migration is needed.
 * 
 * @param workspaceId - The workspace ID to get the device token for. 
 *                      If not provided, falls back to legacy single-key storage.
 */
export function getStoredDeviceToken(workspaceId?: string): StoredDeviceInfo | null {
  try {
    // If workspaceId provided, check workspace-scoped storage first
    if (workspaceId) {
      const key = getDeviceTokenKey(workspaceId);
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as StoredDeviceInfo;
      }
      
      // Check legacy storage (read-only, no migration here)
      const legacyStored = localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY);
      if (legacyStored) {
        const legacyDevice = JSON.parse(legacyStored) as StoredDeviceInfo;
        if (legacyDevice.workspaceId === workspaceId) {
          return legacyDevice;
        }
      }
    } else {
      // Fallback: check legacy storage for backward compatibility
      const legacyStored = localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY);
      if (legacyStored) {
        return JSON.parse(legacyStored) as StoredDeviceInfo;
      }
    }
    
    // Check for server-set cookie (read-only, no migration here)
    const serverSetDevice = getServerSetDeviceToken();
    if (serverSetDevice) {
      if (!workspaceId || serverSetDevice.workspaceId === workspaceId) {
        return serverSetDevice;
      }
    }
    
    return null;
  } catch (e) {
    console.error('[DeviceToken] Failed to read device token:', e);
    return null;
  }
}

/**
 * Clear stored device token (on logout or error).
 * 
 * @param workspaceId - The workspace ID to clear the device token for.
 *                      If not provided, clears legacy storage and session device ID.
 */
export function clearDeviceToken(workspaceId?: string): void {
  try {
    if (workspaceId) {
      const key = getDeviceTokenKey(workspaceId);
      localStorage.removeItem(key);
      
      // Only clear legacy storage if it belongs to this workspace
      const legacyStored = localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY);
      if (legacyStored) {
        try {
          const legacyDevice = JSON.parse(legacyStored) as StoredDeviceInfo;
          if (legacyDevice.workspaceId === workspaceId) {
            localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);
          }
        } catch {
          // If we can't parse it, safe to remove (invalid data)
          localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);
        }
      }
    } else {
      // No workspace specified, clear legacy storage
      localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);
    }
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch (e) {
    console.error('[DeviceToken] Failed to clear device token:', e);
  }
}

/**
 * Validate stored device token against server.
 * Returns device info if valid, null if invalid.
 * 
 * @param workspaceId - The workspace ID to validate the device token for.
 */
export async function validateDeviceToken(workspaceId?: string): Promise<ValidatedDevice | null> {
  const stored = getStoredDeviceToken(workspaceId);
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
      clearDeviceToken(workspaceId);
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
  const stored = getStoredDeviceToken(workspaceId);
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
