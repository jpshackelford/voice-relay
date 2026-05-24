/**
 * Tests for the test-only POST /auth/test-terminate-ws endpoint (issue #310).
 *
 * The endpoint is gated by:
 *   - TEST_AUTH_SECRET env var being set when the router is built
 *   - X-Test-Auth-Secret header matching it on every call
 *   - NODE_ENV !== 'production'
 *   - A DeviceRegistry being plumbed through createAuthRouter
 *
 * The happy path proves the endpoint calls ws.terminate() on the
 * registered device's WS — the same code path the production keepalive
 * uses for a frozen client (server/src/keepalive.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { createAuthRouter } from './router.js';
import { UserRepository } from './user-repository.js';
import { DeviceRegistry } from '../registry.js';
import type { AuthConfig } from './types.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as installationMigration } from '../storage/migrations/014_user_github_installation.js';

const TEST_SECRET = 'test-auth-secret-for-keepalive-spec';

interface TestEnv {
  app: Express;
  db: Database.Database;
  registry: DeviceRegistry;
  /** Fake WS for the registered device. terminate is a spy. */
  fakeWs: WebSocket & { terminate: ReturnType<typeof vi.fn> };
  /** Device id of the registered device. */
  deviceId: string;
}

function makeFakeWs(): TestEnv['fakeWs'] {
  // Minimal WS surface used by the endpoint (terminate) and DeviceRegistry
  // (which only stores the reference; it never calls methods on this fake).
  return {
    terminate: vi.fn(),
    // The registry doesn't call these, but we leave them defined so other
    // helpers that might inspect the object don't crash if the suite grows.
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    readyState: 1, // OPEN
  } as unknown as TestEnv['fakeWs'];
}

function setupTestEnv(options: { withRegistry?: boolean; withSecret?: boolean } = {}): TestEnv {
  const { withRegistry = true, withSecret = true } = options;

  // Set env BEFORE building the router — the secret is captured at construction time.
  if (withSecret) {
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
  } else {
    delete process.env.TEST_AUTH_SECRET;
  }

  const db = new Database(':memory:');
  db.exec(usersMigration.up);
  db.exec(installationMigration.up);

  const userRepository = new UserRepository(db);
  const registry = new DeviceRegistry();

  const config: AuthConfig = {
    githubClientId: 'test-client-id',
    githubClientSecret: 'test-client-secret',
    githubAppSlug: 'test-app',
    jwtSecret: 'test-jwt-secret',
    jwtExpiresIn: '1h',
    callbackUrl: 'http://localhost:3001/auth/github/callback',
  };

  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  const router = createAuthRouter({
    config,
    userRepository,
    deviceRegistry: withRegistry ? registry : undefined,
  });
  app.use('/auth', router);

  const fakeWs = makeFakeWs();
  const deviceId = 'device-310-keepalive';
  registry.register(deviceId, 'workspace-1', fakeWs, 'Test Kiosk', 'kiosk');

  return { app, db, registry, fakeWs, deviceId };
}

describe('POST /auth/test-terminate-ws (issue #310)', () => {
  let env: TestEnv;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (env?.db) env.db.close();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.TEST_AUTH_SECRET;
    vi.resetAllMocks();
  });

  it('terminates the WS for the requested deviceId and returns 200', async () => {
    env = setupTestEnv();

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', TEST_SECRET)
      .send({ deviceId: env.deviceId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, deviceId: env.deviceId });
    expect(env.fakeWs.terminate).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when the secret header is missing', async () => {
    env = setupTestEnv();

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .send({ deviceId: env.deviceId });

    expect(res.status).toBe(403);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });

  it('returns 403 when the secret header is wrong', async () => {
    env = setupTestEnv();

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', 'not-the-secret')
      .send({ deviceId: env.deviceId });

    expect(res.status).toBe(403);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });

  it('returns 400 when deviceId is missing', async () => {
    env = setupTestEnv();

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', TEST_SECRET)
      .send({});

    expect(res.status).toBe(400);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });

  it('returns 404 when the device is not in the registry', async () => {
    env = setupTestEnv();

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', TEST_SECRET)
      .send({ deviceId: 'no-such-device' });

    expect(res.status).toBe(404);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });

  it('returns 404 in production even with the correct secret', async () => {
    env = setupTestEnv();
    // Override AFTER setup so the router was built with the secret present,
    // proving the endpoint refuses to honour requests at call time too.
    process.env.NODE_ENV = 'production';

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', TEST_SECRET)
      .send({ deviceId: env.deviceId });

    expect(res.status).toBe(404);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });

  it('returns 503 when the registry is not wired through createAuthRouter', async () => {
    env = setupTestEnv({ withRegistry: false });

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', TEST_SECRET)
      .send({ deviceId: env.deviceId });

    expect(res.status).toBe(503);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });

  it('returns 404 when TEST_AUTH_SECRET is unset (endpoint not mounted)', async () => {
    env = setupTestEnv({ withSecret: false });

    const res = await request(env.app)
      .post('/auth/test-terminate-ws')
      .set('X-Test-Auth-Secret', 'anything')
      .send({ deviceId: env.deviceId });

    // When TEST_AUTH_SECRET is unset, the whole test endpoint block is
    // skipped during router construction, so Express returns 404.
    expect(res.status).toBe(404);
    expect(env.fakeWs.terminate).not.toHaveBeenCalled();
  });
});
