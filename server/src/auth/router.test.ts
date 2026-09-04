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
  // Migration 017 / #383: speaker identity. UserRepository.create
  // dual-writes to `auth_identities`, so the table must exist for the
  // GitHub OAuth callback test to succeed. Mirrors the subset of the
  // migration's `up` SQL that this test actually depends on.
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
  // Location is e.g. https://github.com/login/oauth/authorize?client_id=...&state=<hex>
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
    it('redirects to the GitHub identify endpoint with a CSRF state (#474)', async () => {
      const response = await request(app).get('/auth/github');

      expect(response.status).toBe(302);
      const location = response.headers.location as string;
      // Identify-first: returning already-installed users must NOT be routed
      // through installations/new.
      expect(location.startsWith('https://github.com/login/oauth/authorize?')).toBe(true);
      expect(location).not.toContain('installations/new');

      const url = new URL(location);
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      const state = url.searchParams.get('state');
      expect(state).toBeTruthy();
      // 32 random bytes hex-encoded → 64 chars.
      expect(state).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('GET /auth/github/callback', () => {
    // Fake GitHub's `POST /login/oauth/access_token`, `GET /user`, and
    // `GET /user/installations`. `installationCount` controls the
    // identify-path branch: > 0 means the App is already installed for the
    // user (returning user), 0 means not installed (first-time user).
    function stubGitHubFetch(
      githubUser = {
        id: 99,
        login: 'testuser',
        name: 'Test User',
        avatar_url: 'https://github.com/testuser.png',
        email: 'test@example.com',
      },
      installationCount = 1,
    ) {
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
        // Check the more specific installations endpoint before `/user`.
        if (url.includes('api.github.com/user/installations')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ total_count: installationCount, installations: [] }),
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

    it('completes identify-only sign-in for a returning already-installed user (#474)', async () => {
      // Seed an existing user with a previously-stored installation_id so we
      // can prove the returning callback (which omits installation_id) does
      // NOT clobber it.
      const existing = userRepository.upsertFromGitHub({
        githubId: 99,
        username: 'testuser',
      });
      userRepository.setGitHubInstallationId(existing.id, 11111);

      // App already installed for this user (total_count > 0).
      stubGitHubFetch(undefined, 1);

      const response = await callCallback(app, { code: 'auth-code-123' });

      expect(response.status).toBe(302);
      // Signs straight into the app, with no install/configure detour.
      expect(response.headers.location).toBe('/home');
      expect(response.headers.location).not.toContain('installations/new');

      // Auth cookie set → the user is actually logged in.
      const setCookie = response.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))).toBe(true);

      const reloaded = userRepository.findByGitHubId(99);
      expect(reloaded?.id).toBe(existing.id);
      // Preserved across returning identify-only sign-in.
      expect(reloaded?.githubInstallationId).toBe(11111);
    });

    it('redirects a first-time (not-installed) user to install, then completes after install (#474)', async () => {
      // Identify callback for a user with no App installation (total_count 0).
      stubGitHubFetch(undefined, 0);

      const first = await callCallback(app, { code: 'auth-code-123' });

      expect(first.status).toBe(302);
      const installLocation = first.headers.location as string;
      // Sent to the install page with a fresh CSRF state...
      expect(installLocation.startsWith(`https://github.com/apps/${APP_SLUG}/installations/new?`)).toBe(true);
      const installState = new URL(installLocation).searchParams.get('state');
      expect(installState).toMatch(/^[a-f0-9]{64}$/);
      // ...and NO auth cookie set yet.
      const firstCookies = (first.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(firstCookies.some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))).toBe(false);

      // The install round-trip re-enters the callback with the fresh state,
      // a code, and installation_id. Reuse the state GitHub echoes back.
      stubGitHubFetch();
      const params = new URLSearchParams({
        state: installState!,
        code: 'auth-code-456',
        installation_id: '585858',
        setup_action: 'install',
      });
      const second = await request(app).get(`/auth/github/callback?${params.toString()}`);

      expect(second.status).toBe(302);
      expect(second.headers.location).toBe('/home');
      const secondCookies = second.headers['set-cookie'] as unknown as string[];
      expect(secondCookies.some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))).toBe(true);

      const user = userRepository.findByGitHubId(99);
      expect(user?.githubInstallationId).toBe(585858);
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
