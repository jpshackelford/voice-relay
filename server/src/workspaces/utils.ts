import { randomBytes } from 'crypto';

/**
 * Generate a URL-friendly slug from a workspace name.
 * Converts to lowercase, replaces spaces with hyphens, removes special chars.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars except spaces/hyphens
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-')      // Collapse multiple hyphens
    .replace(/^-|-$/g, '');   // Remove leading/trailing hyphens
}

/**
 * Make a slug unique by appending a random suffix.
 */
export function makeSlugUnique(slug: string): string {
  const suffix = randomBytes(3).toString('hex'); // 6 chars
  return `${slug}-${suffix}`;
}

/**
 * Generate a short, memorable join code.
 * Format: XXXX-XXXX (8 chars, easy to type)
 */
export function generateJoinCode(): string {
  // Use only easily distinguishable characters (no 0/O, 1/I/l confusion)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  
  return code;
}

/**
 * Validate a slug format.
 * Must be 1-100 chars, lowercase, alphanumeric with hyphens.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

/**
 * Validate a workspace name.
 * Must be 1-255 chars, not just whitespace.
 */
export function isValidWorkspaceName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 255;
}
