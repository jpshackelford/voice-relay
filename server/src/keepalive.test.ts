import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WebSocket } from 'ws';
import {
  attachKeepalive,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from './keepalive.js';

/**
 * Minimal fake WebSocket sufficient to exercise the keepalive helper.
 * Covers only the `on`/`off`/`ping`/`terminate` surface that the helper
 * actually touches — we deliberately avoid spinning up a real `ws` server
 * here so the tests are fast and synchronous under fake timers.
 */
function createFakeWs() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const ws = {
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return ws;
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(fn);
      return ws;
    }),
    /** Test helper to fire registered listeners. */
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    /** Test helper to read the number of listeners on an event. */
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
  return ws;
}

type FakeWs = ReturnType<typeof createFakeWs>;
const asWs = (fake: FakeWs) => fake as unknown as WebSocket;

describe('attachKeepalive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends a ping after each heartbeat interval when the peer responds', () => {
    const ws = createFakeWs();
    attachKeepalive(asWs(ws));

    // First tick: connection was presumed alive at attach time, so the
    // helper should ping (and not terminate) on the first interval.
    vi.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();

    // Simulate the peer's pong and run another full interval — should
    // ping again, still no terminate.
    ws.emit('pong');
    vi.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS);
    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('respects a custom intervalMs', () => {
    const ws = createFakeWs();
    attachKeepalive(asWs(ws), { intervalMs: 1000 });

    vi.advanceTimersByTime(999);
    expect(ws.ping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    ws.emit('pong');
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(2);
  });

  it('terminates a peer that misses a pong between ticks', () => {
    const ws = createFakeWs();
    const onTerminate = vi.fn();
    attachKeepalive(asWs(ws), { intervalMs: 1000, onTerminate });

    // First tick → ping sent; pong NOT delivered.
    vi.advanceTimersByTime(1000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();

    // Second tick with no pong in between → connection considered dead.
    vi.advanceTimersByTime(1000);
    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('keeps a responsive peer alive across many cycles', () => {
    const ws = createFakeWs();
    attachKeepalive(asWs(ws), { intervalMs: 1000 });

    // Ten heartbeat cycles, peer always pongs.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      ws.emit('pong');
    }

    expect(ws.ping).toHaveBeenCalledTimes(10);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('stops pinging once the WS emits close', () => {
    const ws = createFakeWs();
    attachKeepalive(asWs(ws), { intervalMs: 1000 });

    // One healthy cycle to prove the loop is running.
    vi.advanceTimersByTime(1000);
    ws.emit('pong');
    expect(ws.ping).toHaveBeenCalledTimes(1);

    // Socket closes — interval should be torn down.
    ws.emit('close');

    vi.advanceTimersByTime(60_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('teardown function clears the interval and removes the pong listener', () => {
    const ws = createFakeWs();
    expect(ws.listenerCount('pong')).toBe(0);

    const teardown = attachKeepalive(asWs(ws), { intervalMs: 1000 });
    expect(ws.listenerCount('pong')).toBe(1);

    teardown();
    expect(ws.listenerCount('pong')).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it('teardown is idempotent', () => {
    const ws = createFakeWs();
    const teardown = attachKeepalive(asWs(ws), { intervalMs: 1000 });

    teardown();
    // Second call should be a no-op (covers the `torn` short-circuit).
    expect(() => teardown()).not.toThrow();
    // close-driven cleanup after manual teardown is also a no-op.
    expect(() => ws.emit('close')).not.toThrow();
  });

  it('treats a throwing ws.ping() as a dead connection', () => {
    const ws = createFakeWs();
    ws.ping.mockImplementation(() => {
      throw new Error('socket half-closed');
    });
    const onTerminate = vi.fn();
    attachKeepalive(asWs(ws), { intervalMs: 1000, onTerminate });

    vi.advanceTimersByTime(1000);

    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(ws.terminate).toHaveBeenCalledTimes(1);

    // No further ticks should run.
    vi.advanceTimersByTime(60_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from terminate() during the dead-peer path', () => {
    const ws = createFakeWs();
    ws.terminate.mockImplementation(() => {
      throw new Error('already terminated');
    });
    attachKeepalive(asWs(ws), { intervalMs: 1000 });

    // First tick pings; peer never pongs. Second tick tries to terminate
    // and our mock throws — helper should swallow it and clean up.
    vi.advanceTimersByTime(1000);
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('uses injected scheduler when provided', () => {
    const ws = createFakeWs();
    const captured: { fn: (() => void) | null } = { fn: null };
    const setIntervalFn = vi.fn(((fn: () => void) => {
      captured.fn = fn;
      return 'handle' as unknown as ReturnType<typeof setInterval>;
    }) as (fn: () => void, ms: number) => ReturnType<typeof setInterval>);
    const clearIntervalFn = vi.fn();

    const teardown = attachKeepalive(asWs(ws), {
      intervalMs: 5000,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(captured.fn).toBeTruthy();

    // Drive a healthy tick manually through the injected callback.
    captured.fn?.();
    expect(ws.ping).toHaveBeenCalledTimes(1);

    teardown();
    expect(clearIntervalFn).toHaveBeenCalledWith('handle');
  });

  it('calls unref on the timer handle to avoid blocking shutdown', () => {
    const ws = createFakeWs();
    const unref = vi.fn();
    const fakeHandle = { unref } as unknown as ReturnType<typeof setInterval>;
    const setIntervalFn = vi.fn(() => fakeHandle) as unknown as (
      fn: () => void,
      ms: number
    ) => ReturnType<typeof setInterval>;
    const clearIntervalFn = vi.fn();

    attachKeepalive(asWs(ws), {
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    expect(unref).toHaveBeenCalledTimes(1);
  });
});
