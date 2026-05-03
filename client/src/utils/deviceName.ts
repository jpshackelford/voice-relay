/**
 * Generate a short hash similar to a git SHA (7 hex characters)
 */
function generateShortHash(): string {
  const array = new Uint8Array(4);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 7);
}

/**
 * Detect device type from user agent string
 */
function getDeviceType(): string {
  const ua = navigator.userAgent;
  
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPod/.test(ua)) return 'iPod';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  
  return 'Device';
}

/**
 * Generate a default device name like "iPhone-a3f7c2b" or "Mac-9e1d4f0"
 */
export function generateDefaultDeviceName(): string {
  return `${getDeviceType()}-${generateShortHash()}`;
}
