import { useState, useEffect, useRef } from 'react';
import { 
  getStoredDeviceToken, 
  validateDeviceToken,
  clearDeviceToken,
  storeSessionDeviceId,
  getSessionDeviceId,
  storeDeviceToken,
  migrateLegacyDeviceToken,
  migrateServerSetDeviceCookie,
} from '../utils/deviceToken';
import { generateUUID } from '../utils/uuid';
import { generateDefaultDeviceName } from '../utils/deviceName';
import type { DeviceMode } from '../types';

interface DeviceRestorationResult {
  /** Unique device ID (from storage or newly generated) */
  deviceId: string;
  /** Device display name */
  displayName: string;
  /** Device mode (if restored from token) */
  restoredMode: DeviceMode | null;
  /** Device token (if validated successfully) */
  deviceToken: string | null;
  /** Whether device was restored from a stored token */
  wasRestored: boolean;
  /** Whether token validation is in progress */
  isValidating: boolean;
  /** Whether workspaceId was available during initialization */
  isInitialized: boolean;
  /** Update display name */
  setDisplayName: (name: string) => void;
}

/**
 * Get device ID, preferring session storage but falling back to stored token.
 * 
 * @param workspaceId - The workspace ID to look up the device token for.
 *                      If undefined, only checks session storage (defers workspace-scoped lookup).
 */
function getOrCreateDeviceId(workspaceId: string | undefined): string {
  // First check session storage (for current tab)
  let id = getSessionDeviceId();
  if (id) return id;
  
  // Only check workspace-scoped storage if workspaceId is available
  // This prevents generating an orphan ID when workspaceId is still loading
  if (workspaceId) {
    const storedDevice = getStoredDeviceToken(workspaceId);
    if (storedDevice?.deviceId) {
      storeSessionDeviceId(storedDevice.deviceId);
      return storedDevice.deviceId;
    }
  }
  
  // Generate new ID only if workspaceId is available
  // If workspaceId is undefined, we'll re-initialize when it becomes available
  if (workspaceId) {
    id = generateUUID();
    storeSessionDeviceId(id);
    return id;
  }
  
  // Return empty string when workspaceId is undefined - will re-initialize via useEffect
  return '';
}

/**
 * Get display name, preferring session storage, then stored device.
 * 
 * @param workspaceId - The workspace ID to look up the device token for.
 */
function getInitialDisplayName(workspaceId?: string): string {
  let name = sessionStorage.getItem('displayName');
  if (!name) {
    const storedDevice = getStoredDeviceToken(workspaceId);
    if (storedDevice?.name) {
      name = storedDevice.name;
    } else {
      name = generateDefaultDeviceName();
    }
    sessionStorage.setItem('displayName', name);
  }
  return name;
}

/**
 * Get mode from stored device token.
 * 
 * @param workspaceId - The workspace ID to look up the device token for.
 */
function getStoredMode(workspaceId?: string): DeviceMode | null {
  const storedDevice = getStoredDeviceToken(workspaceId);
  return storedDevice?.mode ?? null;
}

/**
 * Custom hook for device token validation and session restoration.
 * 
 * Handles:
 * - Loading device ID from storage or generating new one
 * - Validating stored device tokens against the server
 * - Restoring device name and mode from validated tokens
 * - Managing display name with session persistence
 * - Re-initializing when workspaceId becomes available (handles async workspace loading)
 * 
 * @param workspaceId - Current workspace ID for token validation
 */
export function useDeviceRestoration(workspaceId: string | undefined): DeviceRestorationResult {
  // Track whether we have a valid workspaceId for initialization
  const initialWorkspaceId = useRef(workspaceId);
  
  // Initialize state with stored/generated values (runs once)
  // Pass workspaceId to helper functions for workspace-scoped storage
  const [deviceId, setDeviceId] = useState(() => getOrCreateDeviceId(workspaceId));
  const [displayName, setDisplayName] = useState(() => getInitialDisplayName(workspaceId));
  const [restoredMode, setRestoredMode] = useState<DeviceMode | null>(() => getStoredMode(workspaceId));
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [wasRestored, setWasRestored] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isInitialized, setIsInitialized] = useState(!!workspaceId);
  
  // Prevent double validation in React strict mode
  const validationAttempted = useRef(false);

  // Re-initialize when workspaceId becomes available (handles async workspace loading)
  // This fixes the race condition where workspaceId is undefined at mount
  useEffect(() => {
    // Only re-initialize if we mounted without a workspaceId and now have one
    if (!initialWorkspaceId.current && workspaceId && !isInitialized) {
      console.log('[useDeviceRestoration] workspaceId now available, re-initializing');
      
      // Perform migrations explicitly during initialization
      migrateLegacyDeviceToken(workspaceId);
      migrateServerSetDeviceCookie(workspaceId);
      
      const newDeviceId = getOrCreateDeviceId(workspaceId);
      setDeviceId(newDeviceId);
      setDisplayName(getInitialDisplayName(workspaceId));
      setRestoredMode(getStoredMode(workspaceId));
      setIsInitialized(true);
    }
  }, [workspaceId, isInitialized]);
  
  // Perform migrations on mount if we have a workspaceId
  const migrationPerformed = useRef(false);
  useEffect(() => {
    if (workspaceId && !migrationPerformed.current) {
      migrationPerformed.current = true;
      migrateLegacyDeviceToken(workspaceId);
      migrateServerSetDeviceCookie(workspaceId);
    }
  }, [workspaceId]);

  // Validate stored device token when workspaceId is available
  useEffect(() => {
    if (!workspaceId) return;
    if (!isInitialized) return;
    if (validationAttempted.current) return;
    
    // Use workspace-scoped storage
    const storedDevice = getStoredDeviceToken(workspaceId);
    if (!storedDevice?.deviceToken || storedDevice.workspaceId !== workspaceId) {
      return;
    }

    validationAttempted.current = true;
    setIsValidating(true);

    validateDeviceToken(workspaceId)
      .then((validatedDevice) => {
        if (validatedDevice && validatedDevice.workspaceId === workspaceId) {
          console.log('[useDeviceRestoration] Device token validated, restoring session');
          setDeviceToken(storedDevice.deviceToken);
          setWasRestored(true);

          // Use server-authoritative name (fixes name sync on navigation)
          // Server always returns name (required NOT NULL in DB, enforced by API types)
          setDisplayName(validatedDevice.name);
          sessionStorage.setItem('displayName', validatedDevice.name);

          // Update localStorage with server-authoritative name
          storeDeviceToken({
            ...storedDevice,
            name: validatedDevice.name,
          });
          
          // Restore mode from validated device if available
          if (validatedDevice.mode) {
            setRestoredMode(validatedDevice.mode);
          }
        } else {
          // Token invalid for this workspace
          clearDeviceToken(workspaceId);
        }
      })
      .catch((err) => {
        console.error('[useDeviceRestoration] Device token validation failed:', err);
      })
      .finally(() => {
        setIsValidating(false);
      });
  }, [workspaceId, isInitialized]);

  // Persist display name to session storage
  useEffect(() => {
    if (displayName) {
      sessionStorage.setItem('displayName', displayName);
    }
  }, [displayName]);

  return {
    deviceId,
    displayName,
    restoredMode,
    deviceToken,
    wasRestored,
    isValidating,
    isInitialized,
    setDisplayName,
  };
}
