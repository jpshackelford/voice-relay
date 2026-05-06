/**
 * Device detection and naming utilities for auto-registration.
 */

/**
 * Detect device type from User-Agent string.
 * Returns a human-friendly device name.
 * Note: Order matters! Check more specific patterns before general ones.
 */
export function detectDeviceType(userAgent: string): string {
  // iPod must come before iPhone (iPod UA contains "iPhone")
  if (/iPod/.test(userAgent)) return 'iPod';
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  // Android must come before Linux (Android UA contains "Linux")
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Device';
}

/**
 * Generate a personalized device name using the user's display name and detected device type.
 * Example: "John's iPhone", "Sarah's Mac"
 */
export function generateDeviceName(userDisplayName: string, userAgent: string): string {
  const deviceType = detectDeviceType(userAgent);
  // Use first name (or full username if no spaces) for personalized naming
  const firstName = userDisplayName.split(' ')[0];
  return `${firstName}'s ${deviceType}`;
}
