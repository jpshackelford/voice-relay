/**
 * Normalize ISO-8601 timestamps that may be emitted as naive UTC.
 *
 * Background (issue #264): OpenHands' agent server emits `event.timestamp`
 * as a naive ISO string with no `Z` and no offset (e.g.
 * `"2026-05-21T23:46:59.274606"`). Per ES2015+, JavaScript's `new Date()`
 * interprets such strings as **local time**, not UTC. In any non-UTC browser,
 * agent events end up shifted forward by the local UTC offset, so they sort
 * after every utterance.
 *
 * SQLite's `datetime('now')` default emits a different naive shape with a
 * space separator (`"2026-05-21 23:46:59"`) instead of a `T`.
 *
 * This helper converts both shapes into a canonical ISO-8601 string with
 * `Z` appended when no offset is present, so consumers can safely call
 * `new Date(value)` regardless of their local timezone.
 *
 * Inputs that already carry a `Z` or `±HH:MM`/`±HHMM` offset are returned
 * unchanged. `undefined` / empty inputs are returned as-is so callers can
 * pass through optional fields.
 */
export function normalizeOhTimestamp(value: string): string;
export function normalizeOhTimestamp(value: undefined): undefined;
export function normalizeOhTimestamp(value: string | undefined): string | undefined;
export function normalizeOhTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || value === null || value === '') {
    return value;
  }

  // Replace space separator (SQLite default) with `T` for ISO compliance.
  const s = value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;

  // Only append `Z` when there's a time portion. Bare date-only strings
  // (e.g. `2026-05-21`) are already parsed as UTC by ES2015+ and appending
  // `Z` would produce an invalid form.
  if (!s.includes('T')) {
    return s;
  }

  if (hasTimezone(s)) {
    return s;
  }

  return `${s}Z`;
}

/**
 * Whether the trailing portion of an ISO date string already encodes a
 * timezone (either `Z` / `z` or an explicit `±HH[:]MM` offset on the time
 * portion, not on a date-only string).
 */
function hasTimezone(s: string): boolean {
  if (s.endsWith('Z') || s.endsWith('z')) {
    return true;
  }
  // We only consider offsets on the time portion (after `T`).
  // Match `+HH:MM`, `-HH:MM`, `+HHMM`, `-HHMM` at the end.
  const t = s.indexOf('T');
  if (t === -1) {
    return false;
  }
  const timePart = s.slice(t);
  return /[+-]\d{2}:?\d{2}$/.test(timePart);
}
