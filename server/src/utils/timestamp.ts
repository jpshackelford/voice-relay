/**
 * Timestamp normalization helpers.
 *
 * Background: the OpenHands agent server emits ISO 8601 strings without a
 * timezone designator (e.g. `2026-05-21T23:46:59.274606`). Per ES2015+,
 * JavaScript parses such strings as *local* time, which means non-UTC
 * browsers shift every agent event by `getTimezoneOffset()` ms. SQLite's
 * `datetime('now')` default emits a similar shape but with a space delimiter
 * (`2026-05-21 23:46:59`).
 *
 * These helpers coerce both shapes into tz-aware UTC ISO strings so any
 * downstream `new Date(s)` parses consistently regardless of host TZ.
 *
 * See issue #264.
 */

const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Normalize an OpenHands event timestamp to a tz-aware UTC ISO string.
 *
 * - Returns the input unchanged when it already has a `Z` or `±HH:MM` suffix.
 * - Appends `Z` to naive ISO strings (treating them as UTC, which is what
 *   the OH agent server actually means).
 * - Passes through `undefined` / empty strings unchanged so callers can use
 *   `event.timestamp || new Date().toISOString()` patterns.
 */
export function normalizeOhTimestamp(value: string): string;
export function normalizeOhTimestamp(value: string | undefined): string | undefined;
export function normalizeOhTimestamp(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  if (HAS_TZ.test(value)) {
    return value;
  }
  return value + 'Z';
}

/**
 * Normalize a SQLite-default-style timestamp to a tz-aware UTC ISO string.
 *
 * SQLite's `datetime('now')` emits `YYYY-MM-DD HH:MM:SS` (space delimiter,
 * no fractional seconds, no zone). This converts that into the canonical
 * `YYYY-MM-DDTHH:MM:SSZ` shape that `new Date(...)` parses as UTC.
 *
 * Inputs that already look ISO-shaped (have a `T`) are passed through
 * `normalizeOhTimestamp` for the `Z`-append behavior.
 */
export function normalizeSqliteTimestamp(value: string): string;
export function normalizeSqliteTimestamp(value: string | null | undefined): string | undefined;
export function normalizeSqliteTimestamp(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  // Already ISO-shaped (has `T` separator): just ensure Z suffix.
  if (value.includes('T')) {
    return normalizeOhTimestamp(value);
  }
  // SQLite shape: replace first space with `T`, then append Z if missing.
  const iso = value.replace(' ', 'T');
  return normalizeOhTimestamp(iso);
}
