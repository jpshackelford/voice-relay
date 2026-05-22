/**
 * Parse a timestamp emitted by the OpenHands agent server (or stored by the
 * voice-relay backend) as a Date, accounting for OH's habit of emitting
 * naive UTC ISO strings without a `Z` or offset.
 *
 * See issue #264. The server normalizes timestamps before forwarding so this
 * client-side helper is defense-in-depth: in case a stray naive string sneaks
 * through (e.g. a client talks to an older server mid-deploy, or a future code
 * path consumes raw OH data), this guarantees the parsed Date represents the
 * correct UTC instant regardless of the browser's local timezone.
 *
 * Accepts:
 *   - `'2026-05-21T23:46:59.274606'`     → treated as UTC (Z appended)
 *   - `'2026-05-21 23:46:59'`            → SQLite default; T-converted, Z appended
 *   - `'2026-05-21T23:46:59.274606Z'`    → returned as-is
 *   - `'2026-05-21T19:46:59.274606-04:00'` → returned as-is
 *
 * Returns `null` for empty / undefined input, or for garbage strings that
 * fail to parse. Callers can substitute their own fallback (e.g. `new Date()`)
 * using `?? fallback` or `parsed ? ... : fallback`.
 */
export function parseOhTimestamp(value: string | undefined | null): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  // Replace space separator (SQLite default) with `T` for ISO compliance.
  const s = value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;

  const date = (!s.includes('T') || hasTimezone(s)) ? new Date(s) : new Date(`${s}Z`);

  // Normalize Invalid Date to `null` so callers' truthiness and `??` checks
  // both behave as expected. Without this, an Invalid Date is truthy but its
  // `.getTime()` returns NaN, silently breaking sort/fallback logic.
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasTimezone(s: string): boolean {
  if (s.endsWith('Z') || s.endsWith('z')) {
    return true;
  }
  const t = s.indexOf('T');
  if (t === -1) {
    return false;
  }
  const timePart = s.slice(t);
  return /[+-]\d{2}:?\d{2}$/.test(timePart);
}
