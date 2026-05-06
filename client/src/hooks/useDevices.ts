import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getStoredDeviceToken } from '../utils/deviceToken';

export interface DeviceInfo {
  id: string;
  name: string;
  mode: 'mobile' | 'kiosk';
  lastSeenAt: string | null;
  createdAt: string;
  isCurrentDevice: boolean;
}

interface UseDevicesReturn {
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  renameDevice: (deviceId: string, newName: string) => Promise<void>;
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
      
      // Sort devices: current device first, then by lastSeenAt
      devicesWithCurrentFlag.sort((a: DeviceInfo, b: DeviceInfo) => {
        if (a.isCurrentDevice) return -1;
        if (b.isCurrentDevice) return 1;
        const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
        const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
        return bTime - aTime;
      });
      
      setDevices(devicesWithCurrentFlag);
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

  return {
    devices,
    loading,
    error,
    refresh,
    renameDevice,
  };
}
