import { describe, it, expect } from 'vitest';
import { JWTService } from './jwt.js';
import type { User } from './types.js';

describe('JWTService', () => {
  const secret = 'test-secret-key-for-testing-only';
  const jwtService = new JWTService({ secret, expiresIn: '1h' });

  const mockUser: User = {
    id: 'user-123',
    githubId: 12345,
    username: 'testuser',
    displayName: 'Test User',
    avatarUrl: 'https://github.com/testuser.png',
    email: 'test@example.com',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastLoginAt: '2024-01-01T00:00:00.000Z',
    githubInstallationId: null,
  };

  describe('sign', () => {
    it('creates a valid JWT token', () => {
      const token = jwtService.sign(mockUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });
  });

  describe('verify', () => {
    it('verifies a valid token', () => {
      const token = jwtService.sign(mockUser);
      const payload = jwtService.verify(token);
      
      expect(payload).toBeDefined();
      expect(payload?.sub).toBe('user-123');
      expect(payload?.username).toBe('testuser');
      expect(payload?.iat).toBeDefined();
      expect(payload?.exp).toBeDefined();
    });

    it('returns null for invalid token', () => {
      const payload = jwtService.verify('invalid-token');
      expect(payload).toBeNull();
    });

    it('returns null for tampered token', () => {
      const token = jwtService.sign(mockUser);
      const tamperedToken = token.slice(0, -5) + 'XXXXX'; // modify signature
      const payload = jwtService.verify(tamperedToken);
      expect(payload).toBeNull();
    });

    it('returns null for token signed with different secret', () => {
      const otherService = new JWTService({ secret: 'different-secret', expiresIn: '1h' });
      const token = otherService.sign(mockUser);
      const payload = jwtService.verify(token);
      expect(payload).toBeNull();
    });
  });

  describe('decode', () => {
    it('decodes a valid token without verification', () => {
      const token = jwtService.sign(mockUser);
      const payload = jwtService.decode(token);
      
      expect(payload).toBeDefined();
      expect(payload?.sub).toBe('user-123');
    });

    it('returns null for invalid token', () => {
      const payload = jwtService.decode('invalid-token');
      expect(payload).toBeNull();
    });
  });

  describe('expiration', () => {
    it('creates token with proper expiration', () => {
      const shortLivedService = new JWTService({ secret, expiresIn: '1s' });
      const token = shortLivedService.sign(mockUser);
      const payload = shortLivedService.decode(token);
      
      expect(payload?.exp).toBeDefined();
      expect(payload?.iat).toBeDefined();
      expect(payload!.exp - payload!.iat).toBe(1); // 1 second
    });
  });
});
