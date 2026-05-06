import { describe, it, expect } from 'vitest';
import { detectDeviceType, generateDeviceName } from './device-utils.js';

describe('detectDeviceType', () => {
  it('detects iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    expect(detectDeviceType(ua)).toBe('iPhone');
  });

  it('detects iPad', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    expect(detectDeviceType(ua)).toBe('iPad');
  });

  it('detects iPod', () => {
    const ua = 'Mozilla/5.0 (iPod; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    expect(detectDeviceType(ua)).toBe('iPod');
  });

  it('detects Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    expect(detectDeviceType(ua)).toBe('Mac');
  });

  it('detects Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36';
    expect(detectDeviceType(ua)).toBe('Android');
  });

  it('detects Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    expect(detectDeviceType(ua)).toBe('Windows');
  });

  it('detects Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
    expect(detectDeviceType(ua)).toBe('Linux');
  });

  it('returns Device for unknown user agents', () => {
    expect(detectDeviceType('')).toBe('Device');
    expect(detectDeviceType('unknown-browser')).toBe('Device');
    expect(detectDeviceType('curl/7.64.1')).toBe('Device');
  });

  it('prioritizes mobile device over desktop in combined UA', () => {
    // Some Android devices include Linux in UA
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36';
    expect(detectDeviceType(ua)).toBe('Android');
  });
});

describe('generateDeviceName', () => {
  it('generates name with first name and device type', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(generateDeviceName('John Smith', ua)).toBe("John's iPhone");
  });

  it('uses full username when no spaces', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
    expect(generateDeviceName('johndoe', ua)).toBe("johndoe's Mac");
  });

  it('handles Windows devices', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
    expect(generateDeviceName('Sarah Jones', ua)).toBe("Sarah's Windows");
  });

  it('handles unknown devices', () => {
    expect(generateDeviceName('Test User', '')).toBe("Test's Device");
  });

  it('handles empty display name', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(generateDeviceName('', ua)).toBe("'s iPhone");
  });
});
