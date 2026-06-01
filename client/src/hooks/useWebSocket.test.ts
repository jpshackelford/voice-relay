import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket, computeReconnectDelay } from './useWebSocket';
import type { DeviceMode } from '../types';

// Mock deviceToken utility
vi.mock('../utils/deviceToken', () => ({
  storeDeviceToken: vi.fn(),
  clearDeviceToken: vi.fn(),
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

  const defaultOptions: {
    deviceId: string;
    displayName: string;
    mode: DeviceMode;
    workspaceId: string;
    sessionId: string;
  } = {
    deviceId: 'device-123',
    displayName: 'Test Device',
    mode: 'kiosk',
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

  describe('sendDisplayResult', () => {
    it('sends display-result message with success=true', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      // Clear the register message
      ws.sentMessages = [];

      act(() => {
        result.current.sendDisplayResult({
          success: true,
          displayType: 'image',
        });
      });

      expect(ws.sentMessages).toHaveLength(1);
      const msg = JSON.parse(ws.sentMessages[0]);
      expect(msg.type).toBe('display-result');
      expect(msg.success).toBe(true);
      expect(msg.displayType).toBe('image');
      expect(msg.error).toBeUndefined();
    });

    it('sends display-result message with success=false and error', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      // Clear the register message
      ws.sentMessages = [];

      act(() => {
        result.current.sendDisplayResult({
          success: false,
          error: 'load-failed',
          displayType: 'image',
        });
      });

      expect(ws.sentMessages).toHaveLength(1);
      const msg = JSON.parse(ws.sentMessages[0]);
      expect(msg.type).toBe('display-result');
      expect(msg.success).toBe(false);
      expect(msg.error).toBe('load-failed');
      expect(msg.displayType).toBe('image');
    });

    it('sends display-result message with timeout error', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      // Clear the register message
      ws.sentMessages = [];

      act(() => {
        result.current.sendDisplayResult({
          success: false,
          error: 'timeout',
          displayType: 'image',
        });
      });

      const msg = JSON.parse(ws.sentMessages[0]);
      expect(msg.error).toBe('timeout');
    });

    it('does not send when WebSocket is closed', () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));

      const ws = MockWebSocket.instances[0];
      // Don't open the WebSocket

      act(() => {
        result.current.sendDisplayResult({
          success: true,
          displayType: 'image',
        });
      });

      expect(ws.sentMessages).toHaveLength(0);
    });
  });

  describe('computeReconnectDelay', () => {
    // Lock jitter to 1.0 (middle of the [0.75, 1.25) range) for predictable
    // expected values. Math.random() = 0.5 → 0.75 + 0.5 * 0.5 = 1.0.
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    it('uses 250 ms base on first attempt', () => {
      expect(computeReconnectDelay(0)).toBe(250);
    });

    it('doubles exponentially per attempt', () => {
      expect(computeReconnectDelay(0)).toBe(250);
      expect(computeReconnectDelay(1)).toBe(500);
      expect(computeReconnectDelay(2)).toBe(1000);
      expect(computeReconnectDelay(3)).toBe(2000);
      expect(computeReconnectDelay(4)).toBe(4000);
    });

    it('caps at 30 000 ms', () => {
      // 250 * 2^7 = 32 000 → capped to 30 000 (with jitter 1.0)
      expect(computeReconnectDelay(7)).toBe(30_000);
      expect(computeReconnectDelay(10)).toBe(30_000);
      expect(computeReconnectDelay(100)).toBe(30_000);
    });

    it('applies jitter in the [0.75, 1.25) range', () => {
      vi.spyOn(Math, 'random').mockReturnValueOnce(0); // jitter = 0.75
      expect(computeReconnectDelay(0)).toBeCloseTo(250 * 0.75, 5);

      vi.spyOn(Math, 'random').mockReturnValueOnce(0.9999); // jitter ≈ 1.25
      expect(computeReconnectDelay(0)).toBeLessThan(250 * 1.25);
      expect(computeReconnectDelay(0)).toBeGreaterThanOrEqual(250 * 0.75);
    });
  });

  describe('auto-reconnect (issue #285)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Deterministic jitter: 1.0× exactly.
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('schedules a reconnect after a transient close (code 1006)', async () => {
      renderHook(() => useWebSocket(defaultOptions));
      expect(MockWebSocket.instances).toHaveLength(1);

      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      // Abnormal close (proxy idle timeout, network blip).
      await act(async () => {
        ws.simulateClose(1006, 'Abnormal closure');
      });

      // No new WS yet — reconnect runs after backoff delay.
      expect(MockWebSocket.instances).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1].url).toContain('/ws');
    });

    it('does not reconnect on 4xxx application-layer close codes', async () => {
      renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      await act(async () => {
        ws.simulateClose(4001, 'app-deliberate-close');
      });

      // No reconnect should be scheduled.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect after unmount (deliberate close)', async () => {
      const { unmount } = renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      unmount();
      // The cleanup function fires close() which the mock emits as code 1000.
      // intentionallyClosedRef is set first, so onclose must not schedule.

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect after device-removed server message', async () => {
      renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      await act(async () => {
        ws.simulateMessage({ type: 'device-removed', deviceId: 'device-123' });
      });

      await act(async () => {
        ws.simulateClose(1006);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect after workspace-deleted server message', async () => {
      renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });

      await act(async () => {
        ws.simulateMessage({ type: 'workspace-deleted', reason: 'admin-delete' });
      });

      await act(async () => {
        ws.simulateClose(1006);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('backoff sequence grows exponentially across repeated failures', async () => {
      renderHook(() => useWebSocket(defaultOptions));

      // Cycle: open → close 1006 → wait delay → next WS appears.
      // With Math.random = 0.5, jitter is exactly 1.0, so delays are
      // 250, 500, 1000, 2000.
      const expectedDelays = [250, 500, 1000, 2000];

      for (let i = 0; i < expectedDelays.length; i++) {
        const ws = MockWebSocket.instances[i];
        await act(async () => {
          ws.simulateOpen();
        });
        await act(async () => {
          ws.simulateClose(1006);
        });

        // Just before the expected delay, no new socket exists yet.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(expectedDelays[i] - 1);
        });
        expect(MockWebSocket.instances).toHaveLength(i + 1);

        // Tick the final 1 ms — the reconnect fires.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(MockWebSocket.instances).toHaveLength(i + 2);
      }
    });

    it('backoff caps at 30 s after many consecutive failures', async () => {
      renderHook(() => useWebSocket(defaultOptions));

      // Drive 10 consecutive failures so the unclamped curve would be
      // 250 * 2^10 = 256 000 ms — confirm the cap holds.
      for (let i = 0; i < 10; i++) {
        const ws = MockWebSocket.instances[i];
        await act(async () => {
          ws.simulateOpen();
        });
        await act(async () => {
          ws.simulateClose(1006);
        });
        // Jump well past the largest possible delay so the timer fires.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(40_000);
        });
      }

      const lastWs = MockWebSocket.instances.at(-1)!;
      await act(async () => {
        lastWs.simulateOpen();
      });
      await act(async () => {
        lastWs.simulateClose(1006);
      });

      // At 30 s minus 1 ms, the reconnect must not yet have fired.
      const countBefore = MockWebSocket.instances.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_999);
      });
      expect(MockWebSocket.instances).toHaveLength(countBefore);

      // One more ms takes us to exactly 30 000 ms — the cap.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(MockWebSocket.instances).toHaveLength(countBefore + 1);
    });

    it('resets backoff after a successful registered round-trip', async () => {
      renderHook(() => useWebSocket(defaultOptions));

      // Three failures: close after open, never register.
      for (let i = 0; i < 3; i++) {
        const ws = MockWebSocket.instances[i];
        await act(async () => {
          ws.simulateOpen();
        });
        await act(async () => {
          ws.simulateClose(1006);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
      }
      expect(MockWebSocket.instances).toHaveLength(4);

      // Now complete a registered cycle on this connection.
      const ws4 = MockWebSocket.instances[3];
      await act(async () => {
        ws4.simulateOpen();
      });
      await act(async () => {
        ws4.simulateMessage({
          type: 'registered',
          deviceId: 'device-123',
          session: { id: 's', name: 's' },
        });
      });

      // Close again — the next delay must be base (250 ms), not 2000 ms.
      await act(async () => {
        ws4.simulateClose(1006);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(249);
      });
      expect(MockWebSocket.instances).toHaveLength(4);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(MockWebSocket.instances).toHaveLength(5);
    });

    it('does NOT reset backoff if open fires without a registered message', async () => {
      renderHook(() => useWebSocket(defaultOptions));

      // Three failures with onopen but no registered.
      for (let i = 0; i < 3; i++) {
        const ws = MockWebSocket.instances[i];
        await act(async () => {
          ws.simulateOpen();
        });
        await act(async () => {
          ws.simulateClose(1006);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
      }

      // Fourth socket: open only, no register, then close.
      const ws4 = MockWebSocket.instances[3];
      await act(async () => {
        ws4.simulateOpen();
      });
      await act(async () => {
        ws4.simulateClose(1006);
      });

      // Next delay is the 4th attempt: 250 * 2^3 = 2000 ms (not reset to 250).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1999);
      });
      expect(MockWebSocket.instances).toHaveLength(4);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(MockWebSocket.instances).toHaveLength(5);
    });

    it('preserves lastKnownDevices across a reconnect cycle', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));
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

      await act(async () => {
        ws1.simulateClose(1006);
      });

      // After close but before reconnect, devices stay visible.
      expect(result.current.devices).toHaveLength(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      const ws2 = MockWebSocket.instances[1];
      expect(ws2).toBeDefined();
      await act(async () => {
        ws2.simulateOpen();
      });

      // UI state survives the gap.
      expect(result.current.devices).toHaveLength(2);
      expect(result.current.devices[0].displayName).toBe('Phone 1');
    });

    it('unmount clears any pending reconnect timer', async () => {
      const { unmount } = renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];
      await act(async () => {
        ws.simulateOpen();
      });
      await act(async () => {
        ws.simulateClose(1006);
      });

      // A reconnect timer is now pending. Unmount before it fires.
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      // Still just the original socket — pending timer was cleared.
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('re-reads latest mode on each reconnect via the mode ref', async () => {
      const { rerender } = renderHook(
        (props) => useWebSocket(props),
        { initialProps: defaultOptions }
      );
      const ws1 = MockWebSocket.instances[0];
      await act(async () => {
        ws1.simulateOpen();
      });
      expect(JSON.parse(ws1.sentMessages[0]).mode).toBe('kiosk');

      // Update mode prop — the secondary effect mirrors it into the ref.
      await act(async () => {
        rerender({ ...defaultOptions, mode: 'mobile' });
      });

      // Now trigger a transient close to force a reconnect.
      await act(async () => {
        ws1.simulateClose(1006);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      const ws2 = MockWebSocket.instances[1];
      await act(async () => {
        ws2.simulateOpen();
      });

      // The new register message must carry the updated mode.
      const newRegister = JSON.parse(ws2.sentMessages[0]);
      expect(newRegister.type).toBe('register');
      expect(newRegister.mode).toBe('mobile');
    });

    it('survives rapid close/reconnect churn without leaking sockets', async () => {
      renderHook(() => useWebSocket(defaultOptions));

      for (let i = 0; i < 5; i++) {
        const ws = MockWebSocket.instances[i];
        await act(async () => {
          ws.simulateOpen();
        });
        await act(async () => {
          ws.simulateMessage({
            type: 'registered',
            deviceId: 'device-123',
            session: { id: 's', name: 's' },
          });
        });
        await act(async () => {
          ws.simulateClose(1006);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250);
        });
      }

      // Five churn cycles → six sockets total (initial + five reconnects).
      // Each cycle reset backoff via registered, so each delay was 250 ms.
      expect(MockWebSocket.instances).toHaveLength(6);
    });

    it('preserves connected state when reconnect succeeds', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));
      const ws1 = MockWebSocket.instances[0];
      await act(async () => {
        ws1.simulateOpen();
      });
      expect(result.current.connected).toBe(true);

      await act(async () => {
        ws1.simulateClose(1006);
      });
      expect(result.current.connected).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      const ws2 = MockWebSocket.instances[1];
      await act(async () => {
        ws2.simulateOpen();
      });
      // Status indicator returns to green.
      expect(result.current.connected).toBe(true);
    });
  });

  // Pairs with server/src/keepalive.ts (issue #286). The server pings every
  // 25 s at the WebSocket protocol layer; browsers handle the pong response
  // transparently — there is no JS-visible event for it. These tests pin
  // the *client-visible* contract: the hook must not proactively close or
  // re-create the socket during a long idle window, so the protocol-level
  // heartbeat can do its job uninterrupted.
  describe('keepalive heartbeat (issue #286)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the same WebSocket instance alive across a 5-minute idle period', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateOpen();
        ws.simulateMessage({
          type: 'registered',
          deviceId: 'device-123',
          session: { id: 's', name: 's' },
        });
      });
      expect(result.current.connected).toBe(true);
      expect(MockWebSocket.instances).toHaveLength(1);

      // Advance well past the 60 s proxy threshold. If the client closed
      // or re-created the socket, the instance count would change and
      // `connected` would flip false.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0]).toBe(ws);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(result.current.connected).toBe(true);
    });

    it('stays connected if the server only sends keepalive pings (no app messages)', async () => {
      const { result } = renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateOpen();
        ws.simulateMessage({
          type: 'registered',
          deviceId: 'device-123',
          session: { id: 's', name: 's' },
        });
      });

      // Simulate three full server heartbeat cycles with no application
      // traffic in between. Protocol-level pings/pongs are invisible to
      // the WebSocket JS API, so from the hook's perspective these are
      // genuinely silent windows. The connection must survive.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(25_000);
        });
      }

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(result.current.connected).toBe(true);
    });

    it('a server-side terminate (1006 close) triggers the existing reconnect path', async () => {
      // When the server's keepalive sweep terminates a frozen client, the
      // socket emits an abnormal close (code 1006). This is the same
      // transport-layer signal #285 already handles, so we should NOT
      // need any new reconnect logic for keepalive — just verify the
      // existing path still fires cleanly.
      const { result } = renderHook(() => useWebSocket(defaultOptions));
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateOpen();
        ws.simulateMessage({
          type: 'registered',
          deviceId: 'device-123',
          session: { id: 's', name: 's' },
        });
      });

      // Server gives up on us and tears down the socket.
      await act(async () => {
        ws.simulateClose(1006, 'keepalive timeout');
      });
      expect(result.current.connected).toBe(false);

      // Reconnect logic from #285 schedules a fresh attempt. Backoff
      // resets on a successful `registered`, so this first delay is the
      // 250 ms base × jitter — advance generously to cover the spread.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
      const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      await act(async () => {
        ws2.simulateOpen();
      });
      expect(result.current.connected).toBe(true);
    });
  });
});

describe('useWebSocket - server message dispatching', () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  const baseOpts: {
    deviceId: string;
    displayName: string;
    mode: DeviceMode;
    workspaceId: string;
    sessionId: string;
  } = {
    deviceId: 'd1',
    displayName: 'N',
    mode: 'kiosk',
    workspaceId: 'w1',
    sessionId: 's1',
  };

  function openConnection(opts: Parameters<typeof useWebSocket>[0]) {
    const hook = renderHook(() => useWebSocket(opts));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage({
        type: 'registered',
        deviceId: opts.deviceId,
        session: { id: 's1', name: 'main' },
      });
    });
    return { hook, ws };
  }

  it('dispatches text message to onTextMessage', () => {
    const onTextMessage = vi.fn();
    const { ws } = openConnection({ ...baseOpts, onTextMessage });

    act(() => {
      ws.simulateMessage({ type: 'text', utteranceId: 'u1', text: 'hi', partial: false });
    });

    expect(onTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text', text: 'hi', partial: false })
    );
  });

  it('dispatches history message to onHistoryMessage', () => {
    const onHistoryMessage = vi.fn();
    const { ws } = openConnection({ ...baseOpts, onHistoryMessage });

    act(() => {
      ws.simulateMessage({ type: 'history', messages: [] });
    });

    expect(onHistoryMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'history' })
    );
  });

  it('dispatches display message to onDisplayMessage', () => {
    const onDisplayMessage = vi.fn();
    const { ws } = openConnection({ ...baseOpts, onDisplayMessage });

    act(() => {
      ws.simulateMessage({
        type: 'display',
        displayType: 'image',
        content: 'http://x',
      });
    });

    expect(onDisplayMessage).toHaveBeenCalled();
  });

  it('dispatches ai-status, ai-thinking, session-ai-status', () => {
    const onAIStatusMessage = vi.fn();
    const onAIThinkingMessage = vi.fn();
    const onSessionAIStatusMessage = vi.fn();
    const { ws } = openConnection({
      ...baseOpts,
      onAIStatusMessage,
      onAIThinkingMessage,
      onSessionAIStatusMessage,
    });

    act(() => {
      ws.simulateMessage({ type: 'ai-status', status: 'idle' });
      ws.simulateMessage({ type: 'ai-thinking', thinking: true });
      ws.simulateMessage({ type: 'session-ai-status', status: 'busy' });
    });

    expect(onAIStatusMessage).toHaveBeenCalledTimes(1);
    expect(onAIThinkingMessage).toHaveBeenCalledTimes(1);
    expect(onSessionAIStatusMessage).toHaveBeenCalledTimes(1);
  });

  it('dispatches agent-action message', () => {
    const onAgentActionMessage = vi.fn();
    const { ws } = openConnection({ ...baseOpts, onAgentActionMessage });

    act(() => {
      ws.simulateMessage({
        type: 'agent-action',
        action: { type: 'message', content: 'hi' },
      });
    });
    expect(onAgentActionMessage).toHaveBeenCalled();
  });

  it('dispatches join-request and join-resolved', () => {
    const onJoinRequestMessage = vi.fn();
    const onJoinResolvedMessage = vi.fn();
    const { ws } = openConnection({
      ...baseOpts,
      onJoinRequestMessage,
      onJoinResolvedMessage,
    });

    act(() => {
      ws.simulateMessage({
        type: 'join-request',
        request: {
          id: 'r1',
          workspaceId: 'w1',
          user: { id: 'u1', username: 'x', displayName: null, avatarUrl: null },
          createdAt: '2026-01-01T00:00:00Z',
        },
      });
      ws.simulateMessage({
        type: 'join-resolved',
        requestId: 'r1',
        approved: true,
      });
    });

    expect(onJoinRequestMessage).toHaveBeenCalledTimes(1);
    expect(onJoinResolvedMessage).toHaveBeenCalledTimes(1);
  });

  it('device-removed marks wasRemoved and clears connection', () => {
    const onDeviceRemovedMessage = vi.fn();
    const { hook, ws } = openConnection({
      ...baseOpts,
      onDeviceRemovedMessage,
    });

    act(() => {
      ws.simulateMessage({
        type: 'device-removed',
        deviceId: 'd1',
        reason: 'removed-from-workspace',
      });
    });

    expect(hook.result.current.wasRemoved).toBe(true);
    expect(hook.result.current.connected).toBe(false);
    expect(onDeviceRemovedMessage).toHaveBeenCalled();
  });

  it('workspace-deleted clears devices and connection', () => {
    const onWorkspaceDeletedMessage = vi.fn();
    const { hook, ws } = openConnection({
      ...baseOpts,
      onWorkspaceDeletedMessage,
    });

    act(() => {
      ws.simulateMessage({
        type: 'device-list',
        devices: [{ id: 'a', displayName: 'A', mode: 'kiosk' }],
      });
    });
    expect(hook.result.current.devices).toHaveLength(1);

    act(() => {
      ws.simulateMessage({
        type: 'workspace-deleted',
        workspaceId: 'w1',
        reason: 'owner-deleted',
      });
    });

    expect(hook.result.current.devices).toHaveLength(0);
    expect(hook.result.current.connected).toBe(false);
    expect(onWorkspaceDeletedMessage).toHaveBeenCalled();
  });

  it('dispatches audio-chunk and audio-end', () => {
    const onAudioChunkMessage = vi.fn();
    const onAudioEndMessage = vi.fn();
    const { ws } = openConnection({
      ...baseOpts,
      onAudioChunkMessage,
      onAudioEndMessage,
    });

    act(() => {
      ws.simulateMessage({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: 'abc',
        format: 'mp3',
      });
      ws.simulateMessage({ type: 'audio-end', sessionId: 's1', utteranceId: 'u1' });
    });

    expect(onAudioChunkMessage).toHaveBeenCalled();
    expect(onAudioEndMessage).toHaveBeenCalled();
  });

  it('session-tts-settings-changed updates sessionTtsSettings state', () => {
    const onSessionTtsSettingsChanged = vi.fn();
    const { hook, ws } = openConnection({
      ...baseOpts,
      onSessionTtsSettingsChanged,
    });

    act(() => {
      ws.simulateMessage({
        type: 'session-tts-settings-changed',
        sessionId: 's1',
        enabled: true,
        outputDeviceId: 'speaker-1',
      });
    });

    expect(hook.result.current.sessionTtsSettings).toEqual({
      enabled: true,
      outputDeviceId: 'speaker-1',
    });
    expect(onSessionTtsSettingsChanged).toHaveBeenCalled();
  });

  it('dispatches transcription-result and transcription-error', () => {
    const onTranscriptionResultMessage = vi.fn();
    const onTranscriptionErrorMessage = vi.fn();
    const { ws } = openConnection({
      ...baseOpts,
      onTranscriptionResultMessage,
      onTranscriptionErrorMessage,
    });

    act(() => {
      ws.simulateMessage({
        type: 'transcription-result',
        text: 'hello',
        isFinal: true,
      });
      ws.simulateMessage({
        type: 'transcription-error',
        error: 'stt failed',
      });
    });

    expect(onTranscriptionResultMessage).toHaveBeenCalled();
    expect(onTranscriptionErrorMessage).toHaveBeenCalled();
  });

  it('stores device token on first registration when workspaceId is set', async () => {
    const { storeDeviceToken } = await import('../utils/deviceToken');
    (storeDeviceToken as unknown as ReturnType<typeof vi.fn>).mockClear();
    const hook = renderHook(() =>
      useWebSocket({ ...baseOpts, displayName: 'TokenDevice' })
    );
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage({
        type: 'registered',
        deviceId: 'd1',
        session: { id: 's1', name: 'main' },
        deviceToken: 'tok-xyz',
        tokenExpiresAt: '2099-01-01',
      });
    });

    expect(storeDeviceToken).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'd1',
        deviceToken: 'tok-xyz',
        workspaceId: 'w1',
        name: 'TokenDevice',
      })
    );
    hook.unmount();
  });

  it('logs parse errors for malformed JSON without throwing', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ws } = openConnection({ ...baseOpts });

    act(() => {
      // Send a message with malformed JSON
      ws.onmessage?.(new MessageEvent('message', { data: '{not-json' }));
    });

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing message'),
      expect.anything()
    );
  });

  it('ignores unknown message types silently', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ws } = openConnection({ ...baseOpts });

    act(() => {
      ws.simulateMessage({ type: 'never-heard-of-it' });
    });

    // No errors logged for unknown message types - just silently ignored
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Error parsing message'),
      expect.anything()
    );
  });
});

describe('useWebSocket - client-to-server sends', () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  const baseOpts: {
    deviceId: string;
    displayName: string;
    mode: DeviceMode;
    workspaceId: string;
    sessionId: string;
  } = {
    deviceId: 'd1',
    displayName: 'N',
    mode: 'kiosk',
    workspaceId: 'w1',
    sessionId: 's1',
  };

  function openSocket() {
    const hook = renderHook(() => useWebSocket(baseOpts));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage({
        type: 'registered',
        deviceId: baseOpts.deviceId,
        session: { id: 's1', name: 'main' },
      });
    });
    // Clear the register message
    ws.sentMessages = [];
    return { hook, ws };
  }

  it('sendText sends a text message', () => {
    const { hook, ws } = openSocket();

    act(() => {
      hook.result.current.sendText('u1', 'hello world', true);
    });

    expect(ws.sentMessages).toHaveLength(1);
    const parsed = JSON.parse(ws.sentMessages[0]);
    // Issue #375: each text frame carries a client-supplied UTC clock
    // for the per-turn header. We don't want to pin the test to a
    // specific instant, but we do want to assert the shape.
    expect(parsed).toMatchObject({
      type: 'text',
      utteranceId: 'u1',
      text: 'hello world',
      partial: true,
    });
    expect(parsed.clientTimestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    );
  });

  it('register message includes timezone and offset (#375)', () => {
    // Mirrors `openSocket` but inspects the *first* sent frame, which is
    // the register payload itself.
    const hook = renderHook(() => useWebSocket(baseOpts));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
    });

    expect(ws.sentMessages).toHaveLength(1);
    const parsed = JSON.parse(ws.sentMessages[0]);
    expect(parsed.type).toBe('register');
    // jsdom's Intl resolves to something — assert it's present and
    // looks reasonable rather than pinning to a specific value.
    expect(typeof parsed.timezone).toBe('string');
    expect(parsed.timezone.length).toBeGreaterThan(0);
    expect(typeof parsed.tzOffsetMinutes).toBe('number');
    hook.unmount();
  });

  it('updateDevice sends an update-device message', () => {
    const { hook, ws } = openSocket();

    act(() => {
      hook.result.current.updateDevice({ displayName: 'NewName' });
    });

    expect(ws.sentMessages).toHaveLength(1);
    const parsed = JSON.parse(ws.sentMessages[0]);
    expect(parsed.type).toBe('update-device');
    expect(parsed.displayName).toBe('NewName');
  });

  it('sendJoinResponse forwards the message to the socket', () => {
    const { hook, ws } = openSocket();

    act(() => {
      hook.result.current.sendJoinResponse({
        type: 'join-response',
        requestId: 'r1',
        approved: false,
      });
    });

    expect(JSON.parse(ws.sentMessages[0])).toEqual({
      type: 'join-response',
      requestId: 'r1',
      approved: false,
    });
  });

  it('updateSessionTtsSettings sends a session-tts-settings message', () => {
    const { hook, ws } = openSocket();

    act(() => {
      hook.result.current.updateSessionTtsSettings({
        enabled: true,
        outputDeviceId: null,
      });
    });

    expect(JSON.parse(ws.sentMessages[0])).toEqual({
      type: 'session-tts-settings',
      enabled: true,
      outputDeviceId: null,
    });
  });

  it('sendAudioInputChunk/sendAudioInputEnd send proper messages', () => {
    const { hook, ws } = openSocket();

    act(() => {
      hook.result.current.sendAudioInputChunk(0, 'AAAA', 16000);
      hook.result.current.sendAudioInputEnd(1);
    });

    expect(ws.sentMessages).toHaveLength(2);
    expect(JSON.parse(ws.sentMessages[0])).toEqual({
      type: 'audio-input-chunk',
      chunkIndex: 0,
      audio: 'AAAA',
      sampleRate: 16000,
    });
    expect(JSON.parse(ws.sentMessages[1])).toEqual({
      type: 'audio-input-end',
      totalChunks: 1,
    });
  });

  it('send functions are no-ops when WebSocket is not open', () => {
    const hook = renderHook(() => useWebSocket(baseOpts));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    // Do NOT simulate open. ws.readyState stays CONNECTING.

    act(() => {
      hook.result.current.sendText('u1', 't', false);
      hook.result.current.updateDevice({ mode: 'mobile' });
      hook.result.current.sendJoinResponse({
        type: 'join-response',
        requestId: 'r1',
        approved: true,
      });
      hook.result.current.updateSessionTtsSettings({ enabled: false, outputDeviceId: null });
      hook.result.current.sendAudioInputChunk(0, 'A', 16000);
      hook.result.current.sendAudioInputEnd(1);
    });

    expect(ws.sentMessages).toHaveLength(0);
  });

  it('mode change after registration sends update-device without reconnecting', () => {
    const hook = renderHook(
      ({ mode }: { mode: DeviceMode }) =>
        useWebSocket({ ...baseOpts, mode }),
      { initialProps: { mode: 'kiosk' as DeviceMode } }
    );
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage({
        type: 'registered',
        deviceId: baseOpts.deviceId,
        session: { id: 's1', name: 'main' },
      });
    });
    ws.sentMessages = [];

    hook.rerender({ mode: 'mobile' as DeviceMode });

    // No new socket created
    expect(MockWebSocket.instances).toHaveLength(1);
    // update-device message sent on the existing socket
    expect(ws.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws.sentMessages[0])).toMatchObject({
      type: 'update-device',
      mode: 'mobile',
    });
  });
});
