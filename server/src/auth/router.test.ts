import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createAuthRouter, AUTH_COOKIE_NAME } from './router.js';
import { UserRepository } from './user-repository.js';
import type { AuthConfig } from './types.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as installationMigration } from '../storage/migrations/014_user_github_installation.js';

const APP_SLUG = 'test-app-slug';

function setupTestEnv() {
  const db = new Database(':memory:');
  db.exec(usersMigration.up);
  db.exec(installationMigration.up);

  const userRepository = new UserRepository(db);

  const config: AuthConfig = {
    githubClientId: 'test-client-id',
    githubClientSecret: 'test-client-secret',
    githubAppSlug: APP_SLUG,
    jwtSecret: 'test-jwt-secret',
    jwtExpiresIn: '1h',
    callbackUrl: 'http://localhost:3001/auth/github/callback',
  };

  const app = express();
  app.use(cookieParser());

  const router = createAuthRouter({
    config,
    userRepository,
    successRedirect: '/home',
    errorRedirect: '/login?error=1',
  });
  app.use('/auth', router);

  return { db, app, userRepository, config };
}

/**
 * Drive a callback request: first `GET /auth/github` to register a CSRF
 * state, then `GET /auth/github/callback` with that state plus the supplied
 * extras. Returns the second response.
 *
 * Uses a single supertest agent so the redirect URL from /auth/github
 * gives us the real state to echo back.
 */
async function callCallback(
  app: Express,
  extras: Record<string, string>,
): Promise<request.Response> {
  const initial = await request(app).get('/auth/github');
  // Location is e.g. https://github.com/apps/<slug>/installations/new?state=<hex>
  const location = initial.headers.location as string;
  const state = new URL(location).searchParams.get('state')!;

  const params = new URLSearchParams({ state, ...extras });
  return request(app).get(`/auth/github/callback?${params.toString()}`);
}

describe('Auth Router (GitHub App flow)', () => {
  let app: Express;
  let db: Database.Database;
  let userRepository: UserRepository;

  beforeEach(() => {
    const env = setupTestEnv();
    db = env.db;
    app = env.app;
    userRepository = env.userRepository;
  });

  afterEach(() => {
    db.close();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe('GET /auth/github', () => {
    it('redirects to the GitHub App install URL with a CSRF state', async () => {
      const response = await request(app).get('/auth/github');

      expect(response.status).toBe(302);
      const location = response.headers.location as string;
      expect(location.startsWith(`https://github.com/apps/${APP_SLUG}/installations/new?`)).toBe(true);

      const state = new URL(location).searchParams.get('state');
      expect(state).toBeTruthy();
      // 32 random bytes hex-encoded → 64 chars.
      expect(state).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('GET /auth/github/callback', () => {
    // Fake GitHub's `POST /login/oauth/access_token` + `GET /user`.
    function stubGitHubFetch(githubUser = {
      id: 99,
      login: 'testuser',
      name: 'Test User',
      avatar_url: 'https://github.com/testuser.png',
      email: 'test@example.com',
    }) {
      const mockFetch = vi.fn(async (input: string | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('login/oauth/access_token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'gho_test_token',
              token_type: 'bearer',
              scope: '',
            }),
          } as Response;
        }
        if (url.includes('api.github.com/user')) {
          return {
            ok: true,
            status: 200,
            json: async () => githubUser,
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    }

    it('persists installation_id on a fresh install (setup_action=install)', async () => {
      stubGitHubFetch();

      const response = await callCallback(app, {
        code: 'auth-code-123',
        installation_id: '424242',
        setup_action: 'install',
      });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/home');
      // Auth cookie set
      const setCookie = response.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))).toBe(true);

      const user = userRepository.findByGitHubId(99);
      expect(user).not.toBeNull();
      expect(user?.githubInstallationId).toBe(424242);
    });

    it('completes sign-in for a returning user with no installation_id', async () => {
      // Seed an existing user with a previously-stored installation_id so we
      // can prove the returning callback (which omits installation_id) does
      // NOT clobber it.
      const existing = userRepository.upsertFromGitHub({
        githubId: 99,
        username: 'testuser',
      });
      userRepository.setGitHubInstallationId(existing.id, 11111);

      stubGitHubFetch();

      const response = await callCallback(app, { code: 'auth-code-123' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/home');

      const reloaded = userRepository.findByGitHubId(99);
      expect(reloaded?.id).toBe(existing.id);
      // Preserved across returning sign-in.
      expect(reloaded?.githubInstallationId).toBe(11111);
    });

    it('redirects with error=install_pending when org owner must approve (setup_action=request)', async () => {
      stubGitHubFetch();

      // GitHub sends no `code` when setup_action=request.
      const response = await callCallback(app, { setup_action: 'request' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?error=1&error=install_pending');

      // No user created, no cookie set.
      const setCookie = (response.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))).toBe(false);
    });

    it('ignores invalid installation_id values', async () => {
      stubGitHubFetch();

      const response = await callCallback(app, {
        code: 'auth-code-123',
        installation_id: 'not-a-number',
        setup_action: 'install',
      });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/home');
      const user = userRepository.findByGitHubId(99);
      expect(user).not.toBeNull();
      expect(user?.githubInstallationId).toBeNull();
    });

    it('redirects to errorRedirect on missing state', async () => {
      const response = await request(app).get('/auth/github/callback?code=x');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?error=1');
    });

    it('redirects to errorRedirect on missing code (returning-user path)', async () => {
      // Register a state but supply no code and no setup_action=request.
      const initial = await request(app).get('/auth/github');
      const state = new URL(initial.headers.location as string).searchParams.get('state')!;
      const response = await request(app).get(`/auth/github/callback?state=${state}`);
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?error=1');
    });

    it('redirects to errorRedirect on invalid state', async () => {
      const response = await request(app).get('/auth/github/callback?code=x&state=bogus-state');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?error=1');
    });
  });
});
