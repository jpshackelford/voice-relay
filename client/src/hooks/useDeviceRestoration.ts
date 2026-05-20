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
  getPreservedDeviceId,
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
 * Get device ID, preferring session storage but falling back to stored token
 * or preserved device ID.
 * 
 * The order of precedence is:
 * 1. Session storage (current tab)
 * 2. Stored device token (localStorage)
 * 3. Preserved device ID (from previous token clear - prevents duplicate devices)
 * 4. Generate new UUID (only if workspaceId is available)
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
    
    // Check for preserved deviceId (from previous token clear)
    // This prevents duplicate devices when a token expires and is cleared
    const preservedId = getPreservedDeviceId(workspaceId);
    if (preservedId) {
      console.log('[useDeviceRestoration] Restored preserved deviceId for workspace:', workspaceId);
      storeSessionDeviceId(preservedId);
      return preservedId;
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
 * **Important:** This hook does NOT support changing workspaceId after initialization.
 * Workspace switching should be handled by remounting the component (e.g., via route change).
 * If workspaceId changes from one valid value to another, this hook will log a warning
 * but will not re-initialize state for the new workspace.
 * 
 * @param workspaceId - Current workspace ID for token validation
 */
export function useDeviceRestoration(workspaceId: string | undefined): DeviceRestorationResult {
  // Track the workspaceId we initialized with for detecting unsupported workspace changes
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
  
  // Track if migration has been performed (to prevent duplicate calls)
  const migrationPerformed = useRef(false);

  // Single useEffect to handle both mount and re-initialization scenarios
  // Consolidates migration logic to prevent duplicate execution
  useEffect(() => {
    // Warn if workspaceId changes to a different valid value (unsupported)
    if (initialWorkspaceId.current && workspaceId && workspaceId !== initialWorkspaceId.current) {
      console.warn(
        '[useDeviceRestoration] Workspace changed from',
        initialWorkspaceId.current,
        'to',
        workspaceId,
        '- this is not supported. Component should remount on workspace change.'
      );
      return;
    }
    
    // Skip if no workspaceId available yet or already migrated
    if (!workspaceId || migrationPerformed.current) return;
    
    // Mark migration as done before executing (prevents double execution in strict mode)
    migrationPerformed.current = true;
    
    // Perform migrations explicitly
    migrateLegacyDeviceToken(workspaceId);
    migrateServerSetDeviceCookie(workspaceId);
    
    // If we mounted without a workspaceId, re-initialize state now that we have one
    if (!initialWorkspaceId.current && !isInitialized) {
      console.log('[useDeviceRestoration] workspaceId now available, re-initializing');
      setDeviceId(getOrCreateDeviceId(workspaceId));
      setDisplayName(getInitialDisplayName(workspaceId));
      setRestoredMode(getStoredMode(workspaceId));
      setIsInitialized(true);
    }
  }, [workspaceId, isInitialized]);

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
