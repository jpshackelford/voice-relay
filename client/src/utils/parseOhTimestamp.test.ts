import { describe, it, expect } from 'vitest';
import { parseOhTimestamp } from './parseOhTimestamp';

describe('parseOhTimestamp', () => {
  describe('naive timestamps (the bug from issue #264)', () => {
    it('parses a naive OH event timestamp as UTC, not local time', () => {
      // This is the literal payload from the issue's evidence section.
      const naive = '2026-05-21T23:46:59.274606';
      const result = parseOhTimestamp(naive);
      expect(result).not.toBeNull();
      // UTC midnight-23:46:59 — confirmed regardless of test runner TZ.
      expect(result!.getUTCFullYear()).toBe(2026);
      expect(result!.getUTCMonth()).toBe(4); // May (0-indexed)
      expect(result!.getUTCDate()).toBe(21);
      expect(result!.getUTCHours()).toBe(23);
      expect(result!.getUTCMinutes()).toBe(46);
      expect(result!.getUTCSeconds()).toBe(59);
    });

    it('parses to the same instant as the equivalent Z-suffixed string', () => {
      const naive = parseOhTimestamp('2026-05-21T23:46:59.274');
      const explicit = new Date('2026-05-21T23:46:59.274Z');
      expect(naive!.getTime()).toBe(explicit.getTime());
    });

    it('does not interpret naive strings as local time (the bug)', () => {
      // Per ES2015+, `new Date('2026-05-21T23:46:59')` parses as local time.
      // In a non-UTC test runner, this asserts our helper avoids that trap.
      const naiveDirect = new Date('2026-05-21T23:46:59');
      const helperParsed = parseOhTimestamp('2026-05-21T23:46:59');
      // The two values agree only when the runner is UTC. We don't assert
      // disagreement (CI usually runs UTC) but we DO assert that the helper
      // always produces the UTC interpretation.
      expect(helperParsed!.toISOString()).toBe('2026-05-21T23:46:59.000Z');
      // Sanity check: if runner is not UTC, the naive parse differs.
      if (new Date().getTimezoneOffset() !== 0) {
        expect(helperParsed!.getTime()).not.toBe(naiveDirect.getTime());
      }
    });
  });

  describe('SQLite timestamp shape', () => {
    it('parses the SQLite space-separated naive shape', () => {
      const sqliteFmt = '2026-05-21 23:46:59';
      const result = parseOhTimestamp(sqliteFmt);
      expect(result!.toISOString()).toBe('2026-05-21T23:46:59.000Z');
    });
  });

  describe('already-zoned timestamps', () => {
    it('preserves Z-suffixed timestamps', () => {
      const result = parseOhTimestamp('2026-05-21T23:47:02.015127Z');
      expect(result!.toISOString()).toBe('2026-05-21T23:47:02.015Z');
    });

    it('preserves explicit offset timestamps', () => {
      // 19:46 EDT == 23:46 UTC
      const result = parseOhTimestamp('2026-05-21T19:46:59.274-04:00');
      expect(result!.toISOString()).toBe('2026-05-21T23:46:59.274Z');
    });

    it('preserves explicit offset timestamps without colon', () => {
      const result = parseOhTimestamp('2026-05-21T19:46:59-0400');
      expect(result!.toISOString()).toBe('2026-05-21T23:46:59.000Z');
    });
  });

  describe('edge cases', () => {
    it('returns null for undefined', () => {
      expect(parseOhTimestamp(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(parseOhTimestamp(null)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseOhTimestamp('')).toBeNull();
    });

    it('returns null for garbage input', () => {
      // Normalizes Invalid Date → null so callers' `??` and truthiness checks
      // behave as expected (an Invalid Date is truthy, which would silently
      // break timeline sort / fallback logic — see PR #268 review).
      expect(parseOhTimestamp('not-a-date')).toBeNull();
    });
  });
});
