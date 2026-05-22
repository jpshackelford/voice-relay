/**
 * Defensive parser for OpenHands-emitted timestamps.
 *
 * The upstream OH agent server emits some ISO strings *without* a timezone
 * designator (e.g. `2026-05-21T23:46:59.274606`). Per ES2015+, JavaScript
 * parses such strings as *local* time, so in non-UTC browsers every agent
 * event is shifted by `Date#getTimezoneOffset()` ms — typically several
 * hours — which then sorts to the wrong end of the kiosk timeline.
 *
 * The server now normalizes these at the boundary (see
 * `normalizeOhTimestamp` in server/src/utils/timestamp.ts), but we keep
 * this helper as belt-and-suspenders for mid-deploy clients talking to a
 * not-yet-normalized server, or for any code path that touches OH
 * timestamps directly.
 *
 * See issue #264.
 */

const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse an OH-emitted ISO timestamp string into a `Date`, treating naive
 * strings as UTC instead of local time.
 *
 * Returns `null` for empty / undefined / unparseable inputs so callers can
 * gracefully fall back.
 */
export function parseOhTimestamp(value: string | undefined | null): Date | null {
  if (!value) return null;
  const normalized = HAS_TZ.test(value) ? value : value + 'Z';
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Same as {@link parseOhTimestamp} but returns the parsed timestamp as a
 * number of ms since epoch. Returns `NaN` for unparseable inputs so it can
 * be used directly as a sort key with consistent positioning at the end.
 */
export function parseOhTimestampMs(value: string | undefined | null): number {
  const d = parseOhTimestamp(value);
  return d === null ? NaN : d.getTime();
}
