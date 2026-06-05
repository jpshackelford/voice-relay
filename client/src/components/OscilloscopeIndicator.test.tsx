/**
 * Unit tests for the pure `deriveIndicatorState` helper that powers the
 * kiosk's three-state mic indicator (issue #388).
 *
 * The aggregation rule (from the issue's acceptance criteria):
 *   - 'listening' if any device with sttSupported=true has listening=true.
 *   - 'muted'     if at least one device has sttSupported=true and none of
 *                 the mic-capable devices are listening.
 *   - 'no-mic'    if zero devices have sttSupported=true.
 *
 * `sttSupported`/`listening` may be `undefined` on legacy device-list
 * payloads — the aggregator must treat those rows as not-mic-capable so
 * old clients don't accidentally show "muted" forever.
 */
import { describe, it, expect } from 'vitest';
import { deriveIndicatorState } from './OscilloscopeIndicator';
import type { DeviceInfo } from '../types';

const dev = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  id: over.id ?? 'd1',
  mode: over.mode ?? 'mobile',
  displayName: over.displayName ?? 'Phone',
  ...over,
});

describe('deriveIndicatorState (issue #388)', () => {
  it('returns no-mic when the device list is empty', () => {
    expect(deriveIndicatorState([])).toBe('no-mic');
  });

  it('returns no-mic when no device reports sttSupported', () => {
    expect(deriveIndicatorState([dev(), dev({ id: 'd2', mode: 'kiosk' })])).toBe('no-mic');
  });

  it('returns no-mic when sttSupported is explicitly false', () => {
    expect(
      deriveIndicatorState([
        dev({ sttSupported: false, listening: false }),
        dev({ id: 'd2', sttSupported: false, listening: true }),
      ]),
    ).toBe('no-mic');
  });

  it('returns muted when at least one peer is mic-capable but none are listening', () => {
    expect(
      deriveIndicatorState([
        dev({ sttSupported: true, listening: false }),
        dev({ id: 'd2', sttSupported: true, listening: false }),
      ]),
    ).toBe('muted');
  });

  it('returns listening when any mic-capable peer is listening', () => {
    expect(
      deriveIndicatorState([
        dev({ sttSupported: true, listening: false }),
        dev({ id: 'd2', sttSupported: true, listening: true }),
      ]),
    ).toBe('listening');
  });

  it('ignores listening:true on devices that are NOT mic-capable', () => {
    // A misbehaving legacy client claiming listening=true without
    // sttSupported must not flip the indicator into 'listening'.
    expect(
      deriveIndicatorState([
        dev({ sttSupported: false, listening: true }),
        dev({ id: 'd2', sttSupported: true, listening: false }),
      ]),
    ).toBe('muted');
  });

  it('treats undefined listening as "muted" for a mic-capable device', () => {
    // sttSupported=true, listening=undefined → mic is registered but
    // hasn't reported activity → muted is the safer default.
    expect(deriveIndicatorState([dev({ sttSupported: true })])).toBe('muted');
  });
});
