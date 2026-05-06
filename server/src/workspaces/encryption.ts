import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedKey {
  encrypted: string;  // Base64 encoded
  iv: string;         // Base64 encoded
  tag: string;        // Base64 encoded
}

/**
 * Derive encryption key from secret using PBKDF2
 */
function deriveKey(secret: string): Buffer {
  // Use a fixed salt for deterministic key derivation
  // (The actual secret provides the entropy)
  const salt = 'voice-relay-api-key-salt';
  return crypto.pbkdf2Sync(secret, salt, 100000, KEY_LENGTH, 'sha256');
}

/**
 * Get the encryption secret from environment
 * Falls back to JWT_SECRET if ENCRYPTION_SECRET is not set
 */
function getEncryptionSecret(): string {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_SECRET or JWT_SECRET environment variable must be set');
  }
  return secret;
}

/**
 * Encrypt an API key for storage
 */
export function encryptApiKey(plainText: string): EncryptedKey {
  const secret = getEncryptionSecret();
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt an API key from storage
 */
export function decryptApiKey(encryptedKey: EncryptedKey): string {
  const secret = getEncryptionSecret();
  const key = deriveKey(secret);
  
  const encrypted = Buffer.from(encryptedKey.encrypted, 'base64');
  const iv = Buffer.from(encryptedKey.iv, 'base64');
  const tag = Buffer.from(encryptedKey.tag, 'base64');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  
  return decrypted.toString('utf8');
}

/**
 * Validate API key format
 * OpenHands API keys are typically 40+ character alphanumeric strings
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  // Minimum length check
  if (apiKey.length < 20) {
    return false;
  }
  // Reasonable maximum length
  if (apiKey.length > 200) {
    return false;
  }
  // Allow alphanumeric, hyphens, underscores (typical API key characters)
  return /^[a-zA-Z0-9_-]+$/.test(apiKey);
}
