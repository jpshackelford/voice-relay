/**
 * Timezone + UTC-timestamp validation helpers (issue #375).
 *
 * Validation is intentionally cheap and ICU-backed: we ask the host's
 * `Intl.DateTimeFormat` to use the timezone and rely on it to throw a
 * `RangeError` for unrecognized values. The validation is best-effort —
 * a permissive ICU build may accept things the agent doesn't recognize.
 * Downstream consumers (e.g. the OpenHands header builder) must continue
 * to treat the value as untrusted display text.
 */

/**
 * Cheap shape check for an ISO-8601 Zulu timestamp string of the form
 * `YYYY-MM-DDTHH:MM:SS[.sss]Z`. Used to reject malformed
 * `clientTimestamp` values before they end up in the per-turn header
 * (issue #375). Returns false for non-strings, empty strings, and any
 * value `Date` cannot parse.
 */
export function isIsoZuluTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Quick lexical guard so a Date with non-Z offset doesn't sneak past.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * Returns true if `tz` is a string that the host's ICU library accepts
 * as a recognizable IANA timezone identifier.
 *
 * Sanity-bounded:
 * - Length cap: 100 chars. Real IANA names are well under 60.
 * - Character set: alphanumerics, `/`, `+`, `-`, `_`. This drops
 *   bracket characters that would break the per-turn header grammar.
 */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  if (tz.length === 0 || tz.length > 100) return false;
  if (!/^[A-Za-z0-9/+\-_]+$/.test(tz)) return false;
  try {
    // ICU throws RangeError on unknown timezones.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
