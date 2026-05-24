import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateDefaultDeviceName } from './deviceName';

/**
 * Tests rely on overriding navigator.userAgent and stubbing crypto.getRandomValues
 * to make the generated short hash deterministic.
 */
function withUserAgent<T>(ua: string, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(navigator, 'userAgent', descriptor);
    }
  }
}

describe('generateDefaultDeviceName', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Note: the prefix probe is order-sensitive (iPhone before iPad before iPod
  // before Mac), so we use UAs that only match the intended token.
  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU OS 17_0)'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0)'],
    ['iPod', 'Mozilla/5.0 (iPod; CPU OS 13_3)'],
    ['Mac', 'Mozilla/5.0 (Macintosh; Intel)'],
    ['Android', 'Mozilla/5.0 (Linux; Android 13; Pixel 7)'],
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64)'],
  ])('uses %s prefix based on user agent', (expectedType, ua) => {
    const name = withUserAgent(ua, () => generateDefaultDeviceName());
    expect(name.startsWith(`${expectedType}-`)).toBe(true);
  });

  it('falls back to "Device" prefix for unrecognized user agents', () => {
    const name = withUserAgent('SomeUnknownBrowser/1.0', () => generateDefaultDeviceName());
    expect(name.startsWith('Device-')).toBe(true);
  });

  it('appends a 7-character lowercase hex hash', () => {
    const name = withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', () =>
      generateDefaultDeviceName()
    );
    const hash = name.split('-')[1];
    expect(hash).toHaveLength(7);
    expect(hash).toMatch(/^[0-9a-f]{7}$/);
  });

  it('produces deterministic hash when crypto.getRandomValues is stubbed', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: ArrayBufferView) => {
      const view = array as Uint8Array;
      for (let i = 0; i < view.length; i++) {
        view[i] = 0xab;
      }
      return array;
    }) as typeof crypto.getRandomValues);

    const name = withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', () =>
      generateDefaultDeviceName()
    );
    // 4 bytes of 0xab -> 8 hex chars 'abababab' sliced to 7 chars.
    expect(name).toBe('Mac-abababa');
  });

  it('produces unique hashes across calls with real randomness', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
    const names = new Set<string>();
    withUserAgent(ua, () => {
      for (let i = 0; i < 5; i++) {
        names.add(generateDefaultDeviceName());
      }
    });
    // Highly unlikely to collide; require at least 2 distinct values.
    expect(names.size).toBeGreaterThan(1);
  });
});
