import { describe, it, expect } from 'vitest';
import { normalizeOhTimestamp } from './timestamp.js';

describe('normalizeOhTimestamp', () => {
  describe('naive timestamps', () => {
    it('appends Z to a naive UTC ISO string from OpenHands events endpoint', () => {
      expect(normalizeOhTimestamp('2026-05-21T23:46:59.274606')).toBe(
        '2026-05-21T23:46:59.274606Z'
      );
    });

    it('appends Z to a second-precision naive ISO string', () => {
      expect(normalizeOhTimestamp('2026-05-21T23:46:59')).toBe('2026-05-21T23:46:59Z');
    });

    it('converts the SQLite space-separated naive shape to ISO Zulu', () => {
      expect(normalizeOhTimestamp('2026-05-21 23:46:59')).toBe('2026-05-21T23:46:59Z');
    });
  });

  describe('timezone-aware timestamps', () => {
    it('preserves a Z-suffixed timestamp unchanged', () => {
      expect(normalizeOhTimestamp('2026-05-21T23:47:02.015127Z')).toBe(
        '2026-05-21T23:47:02.015127Z'
      );
    });

    it('preserves a lowercase z-suffixed timestamp unchanged', () => {
      expect(normalizeOhTimestamp('2026-05-21T23:47:02z')).toBe('2026-05-21T23:47:02z');
    });

    it('preserves an explicit positive offset (HH:MM)', () => {
      expect(normalizeOhTimestamp('2026-05-21T19:46:59.274606-04:00')).toBe(
        '2026-05-21T19:46:59.274606-04:00'
      );
    });

    it('preserves an explicit positive offset (HHMM, no colon)', () => {
      expect(normalizeOhTimestamp('2026-05-22T01:16:59+0130')).toBe(
        '2026-05-22T01:16:59+0130'
      );
    });
  });

  describe('parses correctly in non-UTC timezones', () => {
    // These assertions document the actual TZ bug repro from issue #264.
    // We can't change process.env.TZ from inside vitest reliably, but we can
    // assert that the normalized form parses to the same instant regardless
    // of how the JS engine interprets the naive form.

    it('normalized form parses to the same instant as a Z-suffixed input', () => {
      const naive = '2026-05-21T23:46:59.274';
      const normalized = normalizeOhTimestamp(naive);
      expect(new Date(normalized).getTime()).toBe(
        new Date('2026-05-21T23:46:59.274Z').getTime()
      );
    });

    it('handles the literal V8 repro case from the issue body', () => {
      // From issue #264 evidence section.
      const event = {
        timestamp: '2026-05-21T23:46:59.274606',
      };
      const normalized = normalizeOhTimestamp(event.timestamp);
      expect(normalized).toBe('2026-05-21T23:46:59.274606Z');
      expect(new Date(normalized).getUTCHours()).toBe(23);
      expect(new Date(normalized).getUTCDate()).toBe(21);
    });
  });

  describe('edge cases', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeOhTimestamp(undefined)).toBeUndefined();
    });

    it('returns empty string unchanged', () => {
      expect(normalizeOhTimestamp('')).toBe('');
    });

    it('does not append Z to a date-only string', () => {
      // Without a `T`, this isn't an OH event timestamp shape; date-only
      // strings are already parsed as UTC by ES2015+, so leave alone rather
      // than risk producing `2026-05-21Z` (invalid).
      expect(normalizeOhTimestamp('2026-05-21')).toBe('2026-05-21');
    });
  });
});
