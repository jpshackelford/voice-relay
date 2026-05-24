import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDevices, type DeviceInfo } from './useDevices';

let mockAuthState = { isAuthenticated: false };
let mockStoredDevice: { deviceId: string } | null = null;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('../utils/deviceToken', () => ({
  getStoredDeviceToken: () => mockStoredDevice,
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

type RawDevice = Omit<DeviceInfo, 'isCurrentDevice'>;

const deviceA: RawDevice = {
  id: 'dev-a',
  name: 'Kiosk A',
  mode: 'kiosk',
  lastSeenAt: '2025-01-02T00:00:00Z',
  createdAt: '2025-01-01T00:00:00Z',
};

const deviceB: RawDevice = {
  id: 'dev-b',
  name: 'Mobile B',
  mode: 'mobile',
  lastSeenAt: '2025-01-03T00:00:00Z',
  createdAt: '2025-01-01T00:00:00Z',
};

const deviceC: RawDevice = {
  id: 'dev-c',
  name: 'Old C',
  mode: 'kiosk',
  lastSeenAt: null,
  createdAt: '2025-01-01T00:00:00Z',
};

describe('useDevices hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthState = { isAuthenticated: true };
    mockStoredDevice = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch when workspaceId is undefined', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch when not authenticated', async () => {
    mockAuthState = { isAuthenticated: false };
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches devices and sorts current device first', async () => {
    mockStoredDevice = { deviceId: 'dev-b' };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ devices: [deviceA, deviceB, deviceC] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // dev-b is current and must come first
    expect(result.current.devices[0].id).toBe('dev-b');
    expect(result.current.devices[0].isCurrentDevice).toBe(true);
    // Among non-current devices, the one with the more recent lastSeenAt wins
    expect(result.current.devices[1].id).toBe('dev-a');
    // null lastSeenAt sorts last
    expect(result.current.devices[2].id).toBe('dev-c');
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/devices',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('marks no device as current when no stored device token', async () => {
    mockStoredDevice = null;
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ devices: [deviceA, deviceB] })) as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices.every(d => !d.isCurrentDevice)).toBe(true);
    // Sorted by lastSeenAt desc, so deviceB (newer) first
    expect(result.current.devices[0].id).toBe('dev-b');
  });

  it('handles response with no devices field', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices).toEqual([]);
  });

  it('surfaces an error on non-ok fetch response', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, false, 401)) as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch devices'));
    expect(result.current.devices).toEqual([]);
  });

  it('surfaces network errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));

    await waitFor(() => expect(result.current.error).toBe('offline'));
  });

  it('refresh refetches and replaces stale data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ devices: [deviceA] }))
      .mockResolvedValueOnce(jsonResponse({ devices: [deviceA, deviceB] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDevices('ws-1'));
    await waitFor(() => expect(result.current.devices).toHaveLength(1));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.devices).toHaveLength(2);
  });

  describe('renameDevice', () => {
    it('PATCHes and updates the device name in local state', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ devices: [deviceA] }))
        .mockResolvedValueOnce(jsonResponse({}, true));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useDevices('ws-1'));
      await waitFor(() => expect(result.current.devices).toHaveLength(1));

      await act(async () => {
        await result.current.renameDevice('dev-a', 'Renamed Kiosk');
      });

      expect(result.current.devices[0].name).toBe('Renamed Kiosk');
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/devices/dev-a',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Renamed Kiosk' }),
        }),
      );
    });

    it('throws with API error message on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ devices: [deviceA] }))
        .mockResolvedValueOnce(jsonResponse({ error: 'name in use' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useDevices('ws-1'));
      await waitFor(() => expect(result.current.devices).toHaveLength(1));

      await expect(
        act(async () => {
          await result.current.renameDevice('dev-a', 'X');
        }),
      ).rejects.toThrow('name in use');
    });

    it('throws default message when error body has no error field', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ devices: [deviceA] }))
        .mockResolvedValueOnce(jsonResponse({}, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useDevices('ws-1'));
      await waitFor(() => expect(result.current.devices).toHaveLength(1));

      await expect(
        act(async () => {
          await result.current.renameDevice('dev-a', 'X');
        }),
      ).rejects.toThrow('Failed to rename device');
    });
  });

  describe('removeDevice', () => {
    it('DELETEs and removes the device from local state', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ devices: [deviceA, deviceB] }))
        .mockResolvedValueOnce(jsonResponse({}, true));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useDevices('ws-1'));
      await waitFor(() => expect(result.current.devices).toHaveLength(2));

      await act(async () => {
        await result.current.removeDevice('dev-a');
      });

      expect(result.current.devices.map(d => d.id)).toEqual(['dev-b']);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/workspaces/ws-1/devices/dev-a',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('rejects when workspaceId is undefined', async () => {
      const { result } = renderHook(() => useDevices(undefined));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.removeDevice('dev-a');
        }),
      ).rejects.toThrow('Workspace ID is required');
    });

    it('throws with API error message on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ devices: [deviceA] }))
        .mockResolvedValueOnce(jsonResponse({ error: 'cannot remove last' }, false));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useDevices('ws-1'));
      await waitFor(() => expect(result.current.devices).toHaveLength(1));

      await expect(
        act(async () => {
          await result.current.removeDevice('dev-a');
        }),
      ).rejects.toThrow('cannot remove last');
    });

    it('tolerates non-JSON error bodies and falls back to default message', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ devices: [deviceA] }))
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('not json')),
        } as unknown as Response);
      global.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useDevices('ws-1'));
      await waitFor(() => expect(result.current.devices).toHaveLength(1));

      await expect(
        act(async () => {
          await result.current.removeDevice('dev-a');
        }),
      ).rejects.toThrow('Failed to remove device');
    });
  });
});
