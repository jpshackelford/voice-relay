import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';

// Mock deviceToken utility
vi.mock('../utils/deviceToken', () => ({
  storeDeviceToken: vi.fn(),
}));

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: 1000, reason: 'Normal closure' }));
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }));
    }
  }
}

describe('useWebSocket hook', () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    // Replace global WebSocket with mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  const defaultOptions = {
    deviceId: 'device-123',
    displayName: 'Test Device',
    mode: 'kiosk' as const,
    workspaceId: 'ws-456',
    sessionId: 'sess-789',
  };

  it('creates WebSocket connection on mount', () => {
    renderHook(() => useWebSocket(defaultOptions));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('/ws');
  });

  it('sends register message on open', () => {
    renderHook(() => useWebSocket(defaultOptions));

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    expect(ws.sentMessages).toHaveLength(1);
    const registerMsg = JSON.parse(ws.sentMessages[0]);
    expect(registerMsg.type).toBe('register');
    expect(registerMsg.deviceId).toBe('device-123');
    expect(registerMsg.displayName).toBe('Test Device');
    expect(registerMsg.mode).toBe('kiosk');
  });

  it('sets connected to true when WebSocket opens', async () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions));

    expect(result.current.connected).toBe(false);

    await act(async () => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.connected).toBe(true);
  });

  it('updates devices when device-list message is received', async () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions));

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.simulateOpen();
    });

    const devices = [
      { id: 'dev-1', displayName: 'Phone 1', mode: 'mobile' },
      { id: 'dev-2', displayName: 'Kiosk 1', mode: 'kiosk' },
    ];

    await act(async () => {
      ws.simulateMessage({ type: 'device-list', devices });
    });

    expect(result.current.devices).toHaveLength(2);
    expect(result.current.devices[0].displayName).toBe('Phone 1');
  });

  describe('device preservation during reconnection', () => {
    it('preserves devices when WebSocket reconnects due to dependency change', async () => {
      const { result, rerender } = renderHook(
        (props) => useWebSocket(props),
        { initialProps: defaultOptions }
      );

      // Open first connection and receive devices
      const ws1 = MockWebSocket.instances[0];
      await act(async () => {
        ws1.simulateOpen();
      });

      const devices = [
        { id: 'dev-1', displayName: 'Phone 1', mode: 'mobile' },
        { id: 'dev-2', displayName: 'Phone 2', mode: 'mobile' },
      ];

      await act(async () => {
        ws1.simulateMessage({ type: 'device-list', devices });
      });

      expect(result.current.devices).toHaveLength(2);

      // Change a dependency to trigger reconnection (e.g., sessionId changes)
      await act(async () => {
        rerender({ ...defaultOptions, sessionId: 'new-session-id' });
      });

      // A new WebSocket should be created
      expect(MockWebSocket.instances).toHaveLength(2);

      // Devices should be preserved immediately (before new connection opens)
      expect(result.current.devices).toHaveLength(2);
      expect(result.current.devices[0].displayName).toBe('Phone 1');
    });

    it('preserves devices when connection temporarily closes', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      // Receive devices
      const devices = [
        { id: 'dev-1', displayName: 'Phone', mode: 'mobile' },
      ];

      await act(async () => {
        ws.simulateMessage({ type: 'device-list', devices });
      });

      expect(result.current.devices).toHaveLength(1);

      // Connection closes
      await act(async () => {
        ws.simulateClose();
      });

      // Devices should still be preserved
      expect(result.current.devices).toHaveLength(1);
      expect(result.current.devices[0].displayName).toBe('Phone');
    });

    it('updates devices when new device-list arrives after reconnection', async () => {
      const { result, rerender } = renderHook(
        (props) => useWebSocket(props),
        { initialProps: defaultOptions }
      );

      // First connection with initial devices
      const ws1 = MockWebSocket.instances[0];
      await act(async () => {
        ws1.simulateOpen();
      });

      const initialDevices = [
        { id: 'dev-1', displayName: 'Phone 1', mode: 'mobile' },
      ];

      await act(async () => {
        ws1.simulateMessage({ type: 'device-list', devices: initialDevices });
      });

      expect(result.current.devices).toHaveLength(1);

      // Reconnect
      await act(async () => {
        rerender({ ...defaultOptions, sessionId: 'new-session' });
      });

      const ws2 = MockWebSocket.instances[1];
      await act(async () => {
        ws2.simulateOpen();
      });

      // New device list with different devices
      const newDevices = [
        { id: 'dev-2', displayName: 'Phone 2', mode: 'mobile' },
        { id: 'dev-3', displayName: 'Phone 3', mode: 'mobile' },
      ];

      await act(async () => {
        ws2.simulateMessage({ type: 'device-list', devices: newDevices });
      });

      // Should now have the new devices
      expect(result.current.devices).toHaveLength(2);
      expect(result.current.devices[0].displayName).toBe('Phone 2');
      expect(result.current.devices[1].displayName).toBe('Phone 3');
    });

    it('does not preserve devices for brand new connections (no history)', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      // New connection without any prior device-list
      expect(result.current.devices).toHaveLength(0);

      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      // Still empty until we receive device-list
      expect(result.current.devices).toHaveLength(0);
    });
  });

  it('sets connected to false when WebSocket closes', async () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions));

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.simulateOpen();
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      ws.simulateClose();
    });

    expect(result.current.connected).toBe(false);
  });

  it('updates currentSession on registered message', async () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions));

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.simulateOpen();
    });

    const session = { id: 'sess-123', name: 'Test Session' };
    await act(async () => {
      ws.simulateMessage({ type: 'registered', deviceId: 'device-123', session });
    });

    expect(result.current.currentSession).toEqual(session);
  });

  it('closes WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket(defaultOptions));

    const ws = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');

    unmount();

    expect(closeSpy).toHaveBeenCalled();
  });
});
