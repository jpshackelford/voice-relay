import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceRegistry, calculateDisplayLines } from './registry.js';
import type { WebSocket } from 'ws';

/**
 * Issue #340: when the workspace footer-ticker setting is on, the kiosk
 * sacrifices one display line to the ticker strip. The OpenHands system
 * prompt is built from `device.displayLines`, so calculation must take the
 * setting into account.
 */
describe('calculateDisplayLines (issue #340)', () => {
  it('returns at least 1 line for any non-zero viewport', () => {
    expect(calculateDisplayLines(800, 600)).toBeGreaterThanOrEqual(1);
  });

  it('reserves one fewer line when tickersEnabled is true', () => {
    const without = calculateDisplayLines(1920, 1080, false);
    const withTickers = calculateDisplayLines(1920, 1080, true);
    expect(withTickers).toBeLessThan(without);
    expect(without - withTickers).toBe(1);
  });

  it('never drops below 1 line even on a tiny viewport with tickers on', () => {
    expect(calculateDisplayLines(320, 80, true)).toBeGreaterThanOrEqual(1);
  });
});

describe('DeviceRegistry.register tickersEnabled propagation (issue #340)', () => {
  let registry: DeviceRegistry;

  beforeEach(() => {
    registry = new DeviceRegistry();
  });

  function makeWs(): WebSocket {
    return {
      readyState: 1,
      OPEN: 1,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
  }

  it('uses fewer displayLines when tickersEnabled=true at registration', () => {
    const noTickers = registry.register(
      'kiosk-a', 'ws-1', makeWs(), 'A', 'kiosk', 1920, 1080, undefined, undefined, false
    );
    // Use a different device id so we don't overwrite the first row.
    const withTickers = registry.register(
      'kiosk-b', 'ws-1', makeWs(), 'B', 'kiosk', 1920, 1080, undefined, undefined, true
    );
    expect(withTickers.displayLines).toBeDefined();
    expect(noTickers.displayLines).toBeDefined();
    expect(withTickers.displayLines!).toBeLessThan(noTickers.displayLines!);
  });

  it('recomputes displayLines on reconnection when tickersEnabled changes', () => {
    const first = registry.register(
      'kiosk-c', 'ws-1', makeWs(), 'C', 'kiosk', 1920, 1080, undefined, undefined, false
    );
    // `register` returns the same device object on reconnect, so snapshot
    // the value before re-registering.
    const firstLines = first.displayLines!;
    const second = registry.register(
      'kiosk-c', 'ws-1', makeWs(), 'C', 'kiosk', 1920, 1080, undefined, undefined, true
    );
    expect(second.displayLines).toBeLessThan(firstLines);
  });

  it('defaults to no-ticker behavior when the parameter is omitted', () => {
    const a = registry.register('kiosk-d', 'ws-1', makeWs(), 'D', 'kiosk', 1920, 1080);
    const b = registry.register(
      'kiosk-e', 'ws-1', makeWs(), 'E', 'kiosk', 1920, 1080, undefined, undefined, false
    );
    expect(a.displayLines).toBe(b.displayLines);
  });
});
