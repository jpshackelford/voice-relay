import { useState, useEffect, useRef } from 'react';
import { 
  getStoredDeviceToken, 
  validateDeviceToken,
  clearDeviceToken,
  storeSessionDeviceId,
  getSessionDeviceId,
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
  /** Update display name */
  setDisplayName: (name: string) => void;
}

/**
 * Get device ID, preferring session storage but falling back to stored token.
 */
function getOrCreateDeviceId(): string {
  // First check session storage (for current tab)
  let id = getSessionDeviceId();
  if (id) return id;
  
  // Check if we have a stored device token
  const storedDevice = getStoredDeviceToken();
  if (storedDevice?.deviceId) {
    storeSessionDeviceId(storedDevice.deviceId);
    return storedDevice.deviceId;
  }
  
  // Generate new ID
  id = generateUUID();
  storeSessionDeviceId(id);
  return id;
}

/**
 * Get display name, preferring session storage, then stored device.
 */
function getInitialDisplayName(): string {
  let name = sessionStorage.getItem('displayName');
  if (!name) {
    const storedDevice = getStoredDeviceToken();
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
 */
function getStoredMode(): DeviceMode | null {
  const storedDevice = getStoredDeviceToken();
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
 * 
 * @param workspaceId - Current workspace ID for token validation
 */
export function useDeviceRestoration(workspaceId: string | undefined): DeviceRestorationResult {
  // Initialize state with stored/generated values (runs once)
  const [deviceId] = useState(getOrCreateDeviceId);
  const [displayName, setDisplayName] = useState(getInitialDisplayName);
  const [restoredMode, setRestoredMode] = useState<DeviceMode | null>(getStoredMode);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [wasRestored, setWasRestored] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  
  // Prevent double validation in React strict mode
  const validationAttempted = useRef(false);

  // Validate stored device token on mount
  useEffect(() => {
    if (!workspaceId) return;
    if (validationAttempted.current) return;
    
    const storedDevice = getStoredDeviceToken();
    if (!storedDevice?.deviceToken || storedDevice.workspaceId !== workspaceId) {
      return;
    }

    validationAttempted.current = true;
    setIsValidating(true);

    validateDeviceToken()
      .then((validatedDevice) => {
        if (validatedDevice && validatedDevice.workspaceId === workspaceId) {
          console.log('[useDeviceRestoration] Device token validated, restoring session');
          setDeviceToken(storedDevice.deviceToken);
          setWasRestored(true);
          
          // Restore mode from validated device if available and not already set
          if (validatedDevice.mode) {
            setRestoredMode(validatedDevice.mode);
          }
        } else {
          // Token invalid for this workspace
          clearDeviceToken();
        }
      })
      .catch((err) => {
        console.error('[useDeviceRestoration] Device token validation failed:', err);
      })
      .finally(() => {
        setIsValidating(false);
      });
  }, [workspaceId]);

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
    setDisplayName,
  };
}
