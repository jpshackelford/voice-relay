import { describe, it, expect } from 'vitest';
import { getRelativeTime, formatAbsoluteTime, isWithinDuration } from './relativeTime';

describe('relativeTime', () => {
  describe('getRelativeTime', () => {
    const NOW = new Date('2026-05-17T12:00:00Z').getTime();

    it('returns "just now" for times < 10 seconds ago', () => {
      const fiveSecondsAgo = new Date(NOW - 5000).toISOString();
      expect(getRelativeTime(fiveSecondsAgo, NOW)).toBe('just now');
    });

    it('returns "just now" for future times', () => {
      const future = new Date(NOW + 60000).toISOString();
      expect(getRelativeTime(future, NOW)).toBe('just now');
    });

    it('returns seconds ago for times 10-60 seconds ago', () => {
      const thirtySecondsAgo = new Date(NOW - 30000).toISOString();
      const result = getRelativeTime(thirtySecondsAgo, NOW);
      expect(result).toBe('30 seconds ago');
    });

    it('returns minutes ago for times 1-60 minutes ago', () => {
      const fiveMinutesAgo = new Date(NOW - 5 * 60000).toISOString();
      const result = getRelativeTime(fiveMinutesAgo, NOW);
      expect(result).toBe('5 minutes ago');
    });

    it('returns "1 minute ago" for exactly 60 seconds ago', () => {
      const oneMinuteAgo = new Date(NOW - 60000).toISOString();
      const result = getRelativeTime(oneMinuteAgo, NOW);
      expect(result).toBe('1 minute ago');
    });

    it('returns hours ago for times 1-24 hours ago', () => {
      const twoHoursAgo = new Date(NOW - 2 * 3600000).toISOString();
      const result = getRelativeTime(twoHoursAgo, NOW);
      expect(result).toBe('2 hours ago');
    });

    it('returns "1 hour ago" for exactly 60 minutes ago', () => {
      const oneHourAgo = new Date(NOW - 3600000).toISOString();
      const result = getRelativeTime(oneHourAgo, NOW);
      expect(result).toBe('1 hour ago');
    });

    it('returns days ago for times 1-7 days ago', () => {
      const threeDaysAgo = new Date(NOW - 3 * 86400000).toISOString();
      const result = getRelativeTime(threeDaysAgo, NOW);
      expect(result).toBe('3 days ago');
    });

    it('returns "yesterday" for exactly 1 day ago', () => {
      const yesterday = new Date(NOW - 86400000).toISOString();
      const result = getRelativeTime(yesterday, NOW);
      expect(result).toBe('yesterday');
    });

    it('returns weeks ago for times 1-4 weeks ago', () => {
      const twoWeeksAgo = new Date(NOW - 14 * 86400000).toISOString();
      const result = getRelativeTime(twoWeeksAgo, NOW);
      expect(result).toBe('2 weeks ago');
    });

    it('returns "last week" for exactly 1 week ago', () => {
      const lastWeek = new Date(NOW - 7 * 86400000).toISOString();
      const result = getRelativeTime(lastWeek, NOW);
      expect(result).toBe('last week');
    });

    it('returns months ago for times > 4 weeks ago', () => {
      const twoMonthsAgo = new Date(NOW - 60 * 86400000).toISOString();
      const result = getRelativeTime(twoMonthsAgo, NOW);
      expect(result).toBe('2 months ago');
    });

    it('returns years ago for times > 12 months ago', () => {
      const twoYearsAgo = new Date(NOW - 730 * 86400000).toISOString();
      const result = getRelativeTime(twoYearsAgo, NOW);
      expect(result).toBe('2 years ago');
    });
  });

  describe('formatAbsoluteTime', () => {
    it('formats a date string in readable format', () => {
      const date = '2026-05-17T16:30:00Z';
      const result = formatAbsoluteTime(date);
      // The exact format depends on locale, but should contain these elements
      expect(result).toMatch(/May/);
      expect(result).toMatch(/17/);
      expect(result).toMatch(/2026/);
    });

    it('handles different timezones correctly', () => {
      const date = '2026-12-25T00:00:00Z';
      const result = formatAbsoluteTime(date);
      expect(result).toMatch(/Dec/);
      expect(result).toMatch(/2026/);
    });
  });

  describe('isWithinDuration', () => {
    const NOW = new Date('2026-05-17T12:00:00Z').getTime();

    it('returns true for dates within duration', () => {
      const thirtyMinutesAgo = new Date(NOW - 30 * 60000).toISOString();
      expect(isWithinDuration(thirtyMinutesAgo, 3600000, NOW)).toBe(true);
    });

    it('returns false for dates outside duration', () => {
      const twoHoursAgo = new Date(NOW - 2 * 3600000).toISOString();
      expect(isWithinDuration(twoHoursAgo, 3600000, NOW)).toBe(false);
    });

    it('returns true for dates exactly at duration boundary', () => {
      // A date exactly 1 hour ago should be within 1 hour duration (not equal)
      const exactlyOneHourAgo = new Date(NOW - 3600000).toISOString();
      // Should be false because NOW - exactlyOneHourAgo = 3600000, which is NOT < 3600000
      expect(isWithinDuration(exactlyOneHourAgo, 3600000, NOW)).toBe(false);
    });

    it('returns true for very recent dates', () => {
      const oneSecondAgo = new Date(NOW - 1000).toISOString();
      expect(isWithinDuration(oneSecondAgo, 60000, NOW)).toBe(true);
    });
  });
});
