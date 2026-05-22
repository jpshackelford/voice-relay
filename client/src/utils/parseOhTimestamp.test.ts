import { describe, it, expect } from 'vitest';
import { parseOhTimestamp, parseOhTimestampMs } from './parseOhTimestamp';

describe('parseOhTimestamp', () => {
  it('parses naive OH-style strings as UTC, not local time', () => {
    // Regression for the actual bug in issue #264: under a non-UTC host,
    // `new Date('2026-05-21T23:46:59.274606')` would shift by the TZ offset.
    // The helper must yield the same instant regardless of host TZ.
    const naive = '2026-05-21T23:46:59.274606';
    const parsed = parseOhTimestamp(naive);
    const explicit = new Date('2026-05-21T23:46:59.274606Z');
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(explicit.getTime());
  });

  it('passes Z-suffixed strings through unchanged', () => {
    const iso = '2026-05-21T23:46:59.274Z';
    expect(parseOhTimestamp(iso)!.toISOString()).toBe(iso);
  });

  it('respects explicit offset', () => {
    // 2026-05-21T23:46:59-04:00 == 2026-05-22T03:46:59Z
    const offset = '2026-05-21T23:46:59-04:00';
    expect(parseOhTimestamp(offset)!.toISOString()).toBe('2026-05-22T03:46:59.000Z');
  });

  it('returns null for empty / undefined / null', () => {
    expect(parseOhTimestamp(undefined)).toBeNull();
    expect(parseOhTimestamp(null)).toBeNull();
    expect(parseOhTimestamp('')).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    expect(parseOhTimestamp('not-a-date')).toBeNull();
  });
});

describe('parseOhTimestampMs', () => {
  it('returns ms-since-epoch for valid input', () => {
    expect(parseOhTimestampMs('2026-05-21T23:46:59Z')).toBe(
      Date.UTC(2026, 4, 21, 23, 46, 59)
    );
  });

  it('parses naive string at UTC (not local)', () => {
    const naiveMs = parseOhTimestampMs('2026-05-21T23:46:59');
    const explicitMs = parseOhTimestampMs('2026-05-21T23:46:59Z');
    expect(naiveMs).toBe(explicitMs);
  });

  it('returns NaN for unparseable / missing input', () => {
    expect(parseOhTimestampMs(undefined)).toBeNaN();
    expect(parseOhTimestampMs('garbage')).toBeNaN();
  });
});
