/**
 * Tests for the timezone + UTC-timestamp validators used by the WS
 * `register` and `text` handlers (issue #375).
 */

import { describe, test, expect } from 'vitest';
import { isIsoZuluTimestamp, isValidIanaTimezone } from './timezone.js';

describe('isIsoZuluTimestamp', () => {
  test.each([
    '2026-06-01T17:23:45Z',
    '2026-06-01T17:23:45.123Z',
    '2026-12-31T23:59:59.999Z',
  ])('accepts well-formed Zulu timestamp %s', (s) => {
    expect(isIsoZuluTimestamp(s)).toBe(true);
  });

  test.each([
    '2026-06-01T17:23:45+00:00', // numeric offset, not Z
    '2026-06-01T17:23:45',       // no Z
    '2026-06-01 17:23:45Z',      // space instead of T
    '2026-06-01T17:23Z',         // missing seconds
    '',
    'not-a-date',
  ])('rejects malformed string %s', (s) => {
    expect(isIsoZuluTimestamp(s)).toBe(false);
  });

  test.each([null, undefined, 0, 1718292225000, {}, []])(
    'rejects non-string %s',
    (v) => {
      expect(isIsoZuluTimestamp(v as unknown)).toBe(false);
    },
  );

  test('rejects a syntactically-valid but unparseable date', () => {
    // Date.parse on '2026-13-01T...' yields NaN.
    expect(isIsoZuluTimestamp('2026-13-01T17:23:45Z')).toBe(false);
  });
});

describe('isValidIanaTimezone', () => {
  test.each([
    'America/Los_Angeles',
    'UTC',
    'Europe/London',
    'Asia/Tokyo',
    'America/Argentina/Buenos_Aires',
  ])('accepts %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(true);
  });

  test.each([
    'Not_A_Zone',
    'America/Atlantis',
    '',
    'a'.repeat(101), // over the length cap
    'Europe/London]',
    'Europe/London;rm -rf /',
    '../../etc/passwd',
  ])('rejects %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(false);
  });

  test.each([null, undefined, 0, {}, []])('rejects non-string %s', (v) => {
    expect(isValidIanaTimezone(v as unknown)).toBe(false);
  });
});
