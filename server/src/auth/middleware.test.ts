import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { requireAuth, optionalAuth } from './middleware.js';
import { JWTService } from './jwt.js';
import { UserRepository } from './user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import type { User } from './types.js';

describe('Auth Middleware', () => {
  let db: Database.Database;
  let jwtService: JWTService;
  let userRepository: UserRepository;
  let mockUser: User;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    // Migration 017 / #383: UserRepository.create dual-writes to
    // auth_identities; the table must exist for user creation below.
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        provider_username TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, provider_user_id)
      );
    `);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });
    userRepository = new UserRepository(db);

    // Create a test user
    mockUser = userRepository.create({
      githubId: 12345,
      username: 'testuser',
      displayName: 'Test User',
    });
  });

  function createMockRequest(authHeader?: string): Partial<Request> {
    return {
      headers: authHeader ? { authorization: authHeader } : {},
    };
  }

  function createMockResponse(): {
    res: Partial<Response>;
    getStatusCode: () => number | null;
    getJsonBody: () => unknown;
  } {
    let statusCode: number | null = null;
    let jsonBody: unknown = null;

    const res: Partial<Response> = {};
    res.status = vi.fn((code: number) => {
      statusCode = code;
      return res as Response;
    });
    res.json = vi.fn((body: unknown) => {
      jsonBody = body;
      return res as Response;
    });

    return { res, getStatusCode: () => statusCode, getJsonBody: () => jsonBody };
  }

  describe('requireAuth', () => {
    it('passes with valid token', async () => {
      const token = jwtService.sign(mockUser);
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const { res } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = requireAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(mockUser);
      expect(req.jwtPayload).toBeDefined();
      expect(req.jwtPayload?.sub).toBe(mockUser.id);
    });

    it('rejects without Authorization header', async () => {
      const req = createMockRequest() as Request;
      const { res, getStatusCode, getJsonBody } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = requireAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(401);
      expect(getJsonBody()).toEqual({ error: 'Authentication required' });
    });

    it('rejects with invalid token', async () => {
      const req = createMockRequest('Bearer invalid-token') as Request;
      const { res, getStatusCode, getJsonBody } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = requireAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(401);
      expect(getJsonBody()).toEqual({ error: 'Invalid or expired token' });
    });

    it('rejects if user not found', async () => {
      // Create token for a user that doesn't exist
      const fakeUser: User = { ...mockUser, id: 'non-existent-id' };
      const token = jwtService.sign(fakeUser);
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const { res, getStatusCode, getJsonBody } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = requireAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(401);
      expect(getJsonBody()).toEqual({ error: 'User not found' });
    });

    it('rejects without Bearer prefix', async () => {
      const token = jwtService.sign(mockUser);
      const req = createMockRequest(token) as Request;
      const { res, getStatusCode, getJsonBody } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = requireAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatusCode()).toBe(401);
      expect(getJsonBody()).toEqual({ error: 'Authentication required' });
    });
  });

  describe('optionalAuth', () => {
    it('sets user with valid token', async () => {
      const token = jwtService.sign(mockUser);
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const { res } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = optionalAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(mockUser);
      expect(req.jwtPayload).toBeDefined();
    });

    it('passes without Authorization header', async () => {
      const req = createMockRequest() as Request;
      const { res } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = optionalAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('passes with invalid token but does not set user', async () => {
      const req = createMockRequest('Bearer invalid-token') as Request;
      const { res } = createMockResponse();
      const next = vi.fn() as NextFunction;

      const middleware = optionalAuth({ jwtService, userRepository });
      await middleware(req, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });
  });
});
