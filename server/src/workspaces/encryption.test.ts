import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptApiKey, decryptApiKey, isValidApiKeyFormat } from './encryption.js';

describe('encryption', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-for-tests';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('encryptApiKey', () => {
    it('encrypts an API key and returns encrypted data', () => {
      const apiKey = 'oh_test_api_key_12345678901234567890';
      const encrypted = encryptApiKey(apiKey);

      expect(encrypted.encrypted).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      
      // Check they're base64 encoded
      expect(() => Buffer.from(encrypted.encrypted, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.iv, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.tag, 'base64')).not.toThrow();
    });

    it('produces different IVs for the same input', () => {
      const apiKey = 'oh_test_api_key_12345678901234567890';
      const encrypted1 = encryptApiKey(apiKey);
      const encrypted2 = encryptApiKey(apiKey);

      // IVs should be different (random)
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Encrypted values should also be different due to different IVs
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    });

    it('throws when no secret is configured', () => {
      delete process.env.ENCRYPTION_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => encryptApiKey('test')).toThrow('ENCRYPTION_SECRET or JWT_SECRET');
    });

    it('falls back to JWT_SECRET when ENCRYPTION_SECRET is not set', () => {
      delete process.env.ENCRYPTION_SECRET;
      process.env.JWT_SECRET = 'jwt-secret-fallback';

      const apiKey = 'oh_test_api_key_12345678901234567890';
      const encrypted = encryptApiKey(apiKey);
      
      expect(encrypted.encrypted).toBeDefined();
    });
  });

  describe('decryptApiKey', () => {
    it('decrypts an encrypted API key correctly', () => {
      const apiKey = 'oh_test_api_key_12345678901234567890';
      const encrypted = encryptApiKey(apiKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(apiKey);
    });

    it('handles special characters in API keys', () => {
      const apiKey = 'oh_test-api_key-with_special-chars_123';
      const encrypted = encryptApiKey(apiKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(apiKey);
    });

    it('throws on tampered data', () => {
      const apiKey = 'oh_test_api_key_12345678901234567890';
      const encrypted = encryptApiKey(apiKey);
      
      // Tamper with encrypted data
      const tamperedEncrypted = {
        ...encrypted,
        encrypted: 'dGFtcGVyZWQ=', // "tampered" in base64
      };

      expect(() => decryptApiKey(tamperedEncrypted)).toThrow();
    });

    it('throws on tampered tag', () => {
      const apiKey = 'oh_test_api_key_12345678901234567890';
      const encrypted = encryptApiKey(apiKey);
      
      // Tamper with auth tag
      const tamperedTag = {
        ...encrypted,
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==', // Different tag
      };

      expect(() => decryptApiKey(tamperedTag)).toThrow();
    });

    it('throws when using wrong secret', () => {
      const apiKey = 'oh_test_api_key_12345678901234567890';
      
      // Encrypt with one secret
      process.env.ENCRYPTION_SECRET = 'secret-one';
      const encrypted = encryptApiKey(apiKey);
      
      // Try to decrypt with different secret
      process.env.ENCRYPTION_SECRET = 'secret-two';
      expect(() => decryptApiKey(encrypted)).toThrow();
    });
  });

  describe('isValidApiKeyFormat', () => {
    it('accepts valid API key formats', () => {
      expect(isValidApiKeyFormat('oh_test_api_key_12345678901234567890')).toBe(true);
      expect(isValidApiKeyFormat('abcdefghijklmnopqrstuvwxyz')).toBe(true);
      expect(isValidApiKeyFormat('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true);
      expect(isValidApiKeyFormat('1234567890123456789012345678901234567890')).toBe(true);
      expect(isValidApiKeyFormat('api-key_with-mixed_chars123')).toBe(true);
    });

    it('rejects keys that are too short', () => {
      expect(isValidApiKeyFormat('short')).toBe(false);
      expect(isValidApiKeyFormat('1234567890')).toBe(false);
      expect(isValidApiKeyFormat('123456789012345678')).toBe(false); // 18 chars
      expect(isValidApiKeyFormat('12345678901234567890')).toBe(true); // 20 chars - boundary
    });

    it('rejects keys that are too long', () => {
      const longKey = 'a'.repeat(201);
      expect(isValidApiKeyFormat(longKey)).toBe(false);
      
      const maxKey = 'a'.repeat(200);
      expect(isValidApiKeyFormat(maxKey)).toBe(true);
    });

    it('rejects keys with invalid characters', () => {
      expect(isValidApiKeyFormat('key with spaces here!')).toBe(false);
      expect(isValidApiKeyFormat('key@with#special$chars')).toBe(false);
      expect(isValidApiKeyFormat('key.with.dots.here')).toBe(false);
      expect(isValidApiKeyFormat('key\nwith\nnewlines')).toBe(false);
    });
  });
});
