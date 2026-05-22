import { describe, test, expect } from 'vitest';
import { normalizeOhTimestamp, normalizeSqliteTimestamp } from './timestamp.js';

describe('normalizeOhTimestamp', () => {
  test('appends Z to naive ISO string', () => {
    expect(normalizeOhTimestamp('2026-05-21T23:46:59.274606')).toBe(
      '2026-05-21T23:46:59.274606Z'
    );
  });

  test('preserves Z-suffixed strings unchanged', () => {
    const input = '2026-05-21T23:46:59.274606Z';
    expect(normalizeOhTimestamp(input)).toBe(input);
  });

  test('preserves explicit positive offset unchanged', () => {
    const input = '2026-05-21T23:46:59.274606+02:00';
    expect(normalizeOhTimestamp(input)).toBe(input);
  });

  test('preserves explicit negative offset unchanged', () => {
    const input = '2026-05-21T23:46:59-04:00';
    expect(normalizeOhTimestamp(input)).toBe(input);
  });

  test('preserves offset without colon', () => {
    const input = '2026-05-21T23:46:59-0400';
    expect(normalizeOhTimestamp(input)).toBe(input);
  });

  test('returns undefined for undefined', () => {
    expect(normalizeOhTimestamp(undefined)).toBeUndefined();
  });

  test('returns empty string for empty string (falsy)', () => {
    // Empty strings are falsy in JS; keep them unchanged so callers can
    // fall back to `value || new Date().toISOString()`.
    expect(normalizeOhTimestamp('')).toBe('');
  });

  test('handles bare seconds (no fractional)', () => {
    expect(normalizeOhTimestamp('2026-05-21T23:46:59')).toBe('2026-05-21T23:46:59Z');
  });

  // Regression test for the actual bug: under a non-UTC interpretation,
  // the normalized output must parse to the same UTC instant as if it had
  // come with `Z` originally.
  test('normalized output parses to UTC instant regardless of TZ', () => {
    const naive = '2026-05-21T23:46:59.274Z';
    const normalized = normalizeOhTimestamp('2026-05-21T23:46:59.274');
    expect(new Date(normalized).getTime()).toBe(new Date(naive).getTime());
  });
});

describe('normalizeSqliteTimestamp', () => {
  test('converts space-delimited SQLite default to ISO Zulu', () => {
    expect(normalizeSqliteTimestamp('2026-05-21 23:46:59')).toBe(
      '2026-05-21T23:46:59Z'
    );
  });

  test('preserves ISO-shaped input via normalizeOhTimestamp', () => {
    expect(normalizeSqliteTimestamp('2026-05-21T23:46:59.123')).toBe(
      '2026-05-21T23:46:59.123Z'
    );
  });

  test('preserves Z-suffixed ISO unchanged', () => {
    expect(normalizeSqliteTimestamp('2026-05-21T23:46:59Z')).toBe(
      '2026-05-21T23:46:59Z'
    );
  });

  test('returns undefined for null', () => {
    expect(normalizeSqliteTimestamp(null)).toBeUndefined();
  });

  test('returns undefined for undefined', () => {
    expect(normalizeSqliteTimestamp(undefined)).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(normalizeSqliteTimestamp('')).toBeUndefined();
  });
});
