import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getStoredDeviceToken } from '../utils/deviceToken';

/**
 * Resolved primary speaker for a device (#384).
 *
 * Returned by `GET /api/workspaces/:id/devices` when the device row has
 * a `primary_user_id` set. `preferredName` is `null` when the workspace
 * speaker row exists but the agent has not curated a display name yet
 * (or when no speaker row exists at all). The client falls back to the
 * bare device name in both cases.
 */
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
  /**
   * #384: resolved speaker identity for this device. `null` when the
   * device has no `primary_user_id`. Older servers (pre-#384) omit the
   * field entirely; both shapes mean "fall back to the device name".
   */
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
  }, []);

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
