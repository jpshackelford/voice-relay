import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getStoredDeviceToken, storeDeviceToken } from '../utils/deviceToken';

/** Resolved primary speaker identity for a device. */
export interface DevicePrimaryUser {
  userId: string;
  preferredName: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  mode: 'mobile' | 'kiosk';
  lastSeenAt: string | null;
  createdAt: string;
  // Optional/null when unresolved; pre-#384 servers omit it entirely.
  primaryUser?: DevicePrimaryUser | null;
  isCurrentDevice: boolean;
}

/** Sort devices: current device first, then by most recently seen */
function sortDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return [...devices].sort((a, b) => {
    // Current device always first
    if (a.isCurrentDevice !== b.isCurrentDevice) {
      return a.isCurrentDevice ? -1 : 1;
    }
    // Then sort by lastSeenAt (most recent first)
    const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return bTime - aTime;
  });
}

interface UseDevicesReturn {
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  renameDevice: (deviceId: string, newName: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
}

export function useDevices(workspaceId: string | undefined): UseDevicesReturn {
  const { isAuthenticated } = useAuth();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get current device ID from stored token
  const storedDevice = getStoredDeviceToken();
  const currentDeviceId = storedDevice?.deviceId;

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !workspaceId) {
      setDevices([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/devices`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch devices');
      }
      
      const data = await res.json();
      const devicesWithCurrentFlag = (data.devices || []).map((d: DeviceInfo) => ({
        ...d,
        isCurrentDevice: d.id === currentDeviceId,
      }));
      
      setDevices(sortDevices(devicesWithCurrentFlag));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, workspaceId, currentDeviceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const renameDevice = useCallback(async (deviceId: string, newName: string): Promise<void> => {
    const res = await fetch(`/api/devices/${deviceId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename device');
    }

    // Update device in local state
    setDevices(prev => prev.map(d =>
      d.id === deviceId ? { ...d, name: newName } : d
    ));

    // Defense-in-depth for #459: if the user just renamed the *current* device
    // on this tab, flush the cached display name in sessionStorage and the
    // stored device token. Without this, navigating into a session view would
    // mount useWebSocket with the stale name and send it in the next
    // `register` message. The server-side fix (#459) makes this safe even on
    // legacy clients, but belt-and-suspenders avoids a transient UI flash on
    // the same tab and protects against any future server regressions.
    const stored = getStoredDeviceToken(workspaceId);
    if (stored && stored.deviceId === deviceId) {
      try {
        sessionStorage.setItem('displayName', newName);
      } catch {
        // sessionStorage may be unavailable (Safari private, quota, etc.).
        // The server fix is authoritative; this flush is best-effort.
      }
      storeDeviceToken({ ...stored, name: newName });
    }
  }, [workspaceId]);

  const removeDevice = useCallback(async (deviceId: string): Promise<void> => {
    if (!workspaceId) {
      throw new Error('Workspace ID is required');
    }

    const res = await fetch(`/api/workspaces/${workspaceId}/devices/${deviceId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to remove device');
    }

    // Remove from local state
    setDevices(prev => prev.filter(d => d.id !== deviceId));
  }, [workspaceId]);

  return {
    devices,
    loading,
    error,
    refresh,
    renameDevice,
    removeDevice,
  };
}
