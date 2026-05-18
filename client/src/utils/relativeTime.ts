/**
 * Relative time formatting utilities using Intl.RelativeTimeFormat.
 * Displays times like "5 mins ago", "2 hours ago", "3 days ago".
 */

type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

interface TimeThreshold {
  unit: TimeUnit;
  limit: number; // in seconds
  divisor: number; // to convert seconds to this unit
}

const TIME_THRESHOLDS: TimeThreshold[] = [
  { unit: 'second', limit: 60, divisor: 1 },
  { unit: 'minute', limit: 3600, divisor: 60 },
  { unit: 'hour', limit: 86400, divisor: 3600 },
  { unit: 'day', limit: 604800, divisor: 86400 },
  { unit: 'week', limit: 2592000, divisor: 604800 },
  { unit: 'month', limit: 31536000, divisor: 2592000 },
  { unit: 'year', limit: Infinity, divisor: 31536000 },
];

/**
 * Get a relative time string for a given ISO date string.
 * Uses Intl.RelativeTimeFormat for localized output.
 *
 * @param dateString - ISO 8601 date string (e.g., "2026-05-17T23:50:30Z")
 * @param now - Optional current time for testing (defaults to Date.now())
 * @returns Relative time string (e.g., "5 mins ago", "2 hours ago")
 */
export function getRelativeTime(dateString: string, now: number = Date.now()): string {
  const date = new Date(dateString);
  const diffSeconds = Math.floor((now - date.getTime()) / 1000);

  // Future dates (shouldn't happen for deployments, but handle gracefully)
  if (diffSeconds < 0) {
    return 'just now';
  }

  // Very recent (< 10 seconds)
  if (diffSeconds < 10) {
    return 'just now';
  }

  // Find the appropriate unit
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const threshold of TIME_THRESHOLDS) {
    if (diffSeconds < threshold.limit) {
      const value = Math.floor(diffSeconds / threshold.divisor);
      return formatter.format(-value, threshold.unit);
    }
  }

  // Fallback (shouldn't reach here due to Infinity limit on 'year')
  return formatter.format(-Math.floor(diffSeconds / 31536000), 'year');
}

/**
 * Format an ISO date string as a localized absolute date/time.
 * Uses Intl.DateTimeFormat with user's local timezone.
 *
 * @param dateString - ISO 8601 date string
 * @returns Localized date/time string (e.g., "May 17, 2026 at 4:30 PM")
 */
export function formatAbsoluteTime(dateString: string): string {
  const date = new Date(dateString);

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Check if a date is less than a given duration ago (for auto-refresh).
 *
 * @param dateString - ISO 8601 date string
 * @param durationMs - Duration in milliseconds
 * @param now - Optional current time for testing
 * @returns true if the date is within the duration
 */
export function isWithinDuration(
  dateString: string,
  durationMs: number,
  now: number = Date.now()
): boolean {
  const date = new Date(dateString);
  return now - date.getTime() < durationMs;
}
