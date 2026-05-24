import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createDeviceAuthRouter } from './device-auth-router.js';
import { DeviceAuthManager } from './device-auth.js';
import { JWTService } from './jwt.js';
import { UserRepository } from './user-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';

// Helper to set up test environment
function setupTestEnv() {
  const db = new Database(':memory:');
  db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);

  const userRepository = new UserRepository(db);
  const jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });
  const deviceAuthManager = new DeviceAuthManager({
    baseUrl: 'https://example.com',
    codeExpirySeconds: 300,
    pollingIntervalSeconds: 5,
  });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  
  const router = createDeviceAuthRouter({
    deviceAuthManager,
    jwtService,
    userRepository,
  });
  app.use('/auth/device', router);

  return { db, app, deviceAuthManager, jwtService, userRepository };
}

describe('Device Auth Router', () => {
  let app: Express;
  let db: Database.Database;
  let deviceAuthManager: DeviceAuthManager;
  let jwtService: JWTService;
  let userRepository: UserRepository;

  beforeEach(() => {
    const env = setupTestEnv();
    db = env.db;
    app = env.app;
    deviceAuthManager = env.deviceAuthManager;
    jwtService = env.jwtService;
    userRepository = env.userRepository;
  });

  afterEach(() => {
    deviceAuthManager.shutdown();
    db.close();
  });

  describe('POST /auth/device/code', () => {
    it('should return device and user codes', async () => {
      const response = await request(app)
        .post('/auth/device/code')
        .expect(200);

      expect(response.body).toHaveProperty('device_code');
      expect(response.body).toHaveProperty('user_code');
      expect(response.body).toHaveProperty('verification_uri');
      expect(response.body).toHaveProperty('verification_uri_complete');
      expect(response.body).toHaveProperty('expires_in');
      expect(response.body).toHaveProperty('interval');
      
      // User code format should be XXXX-XXXX
      expect(response.body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });
  });

  describe('POST /auth/device/token', () => {
    it('should return authorization_pending for new request', async () => {
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      const response = await request(app)
        .post('/auth/device/token')
        .send({ device_code: codeResponse.body.device_code })
        .expect(400);

      expect(response.body.error).toBe('authorization_pending');
    });

    it('should return invalid_request when device_code is missing', async () => {
      const response = await request(app)
        .post('/auth/device/token')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('invalid_request');
    });

    it('should return invalid_grant for unknown device_code', async () => {
      const response = await request(app)
        .post('/auth/device/token')
        .send({ device_code: 'invalid-code' })
        .expect(400);

      expect(response.body.error).toBe('invalid_grant');
    });

    it('should return slow_down when polling too fast', async () => {
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      // First poll
      await request(app)
        .post('/auth/device/token')
        .send({ device_code: codeResponse.body.device_code })
        .expect(400);

      // Immediate second poll - should get slow_down
      const response = await request(app)
        .post('/auth/device/token')
        .send({ device_code: codeResponse.body.device_code })
        .expect(400);

      expect(response.body.error).toBe('slow_down');
    });

    it('should return tokens when authorization is completed', async () => {
      // Create user
      const userId = 'user-123';
      db.prepare(`
        INSERT INTO users (id, github_id, username, created_at, last_login_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(userId, 12345, 'testuser');

      // Create device code
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      // Complete authorization
      deviceAuthManager.completeRequest(codeResponse.body.user_code, userId);

      // Poll for token - should succeed
      const response = await request(app)
        .post('/auth/device/token')
        .send({ device_code: codeResponse.body.device_code })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body.token_type).toBe('Bearer');
    });

    it('should return expired_token for expired request', async () => {
      vi.useFakeTimers();
      
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      // Advance time past expiration
      vi.advanceTimersByTime(301 * 1000);

      const response = await request(app)
        .post('/auth/device/token')
        .send({ device_code: codeResponse.body.device_code })
        .expect(400);

      expect(response.body.error).toBe('expired_token');
      
      vi.useRealTimers();
    });
  });

  describe('GET /auth/device/verify', () => {
    it('should return HTML verification page', async () => {
      const response = await request(app)
        .get('/auth/device/verify')
        .expect(200)
        .expect('Content-Type', /html/);

      expect(response.text).toContain('Connect Your Device');
      expect(response.text).toContain('form');
    });

    it('should prefill code from query parameter', async () => {
      const response = await request(app)
        .get('/auth/device/verify?code=ABCD-1234')
        .expect(200);

      expect(response.text).toContain('value="ABCD-1234"');
    });

    it('should display error from query parameter', async () => {
      const response = await request(app)
        .get('/auth/device/verify?error=Invalid+code')
        .expect(200);

      expect(response.text).toContain('Invalid code');
    });

    it('should escape XSS in error parameter', async () => {
      const response = await request(app)
        .get('/auth/device/verify?error=<script>alert("xss")</script>')
        .expect(200);

      // Should not contain raw script tag
      expect(response.text).not.toContain('<script>alert("xss")</script>');
      // Should contain escaped version
      expect(response.text).toContain('&lt;script&gt;');
    });

    it('should escape XSS in code parameter', async () => {
      const response = await request(app)
        .get('/auth/device/verify?code="><script>alert("xss")</script>')
        .expect(200);

      // Should not contain raw script tag
      expect(response.text).not.toContain('<script>alert("xss")</script>');
      // Should contain escaped version
      expect(response.text).toContain('&lt;script&gt;');
    });
  });

  describe('POST /auth/device/verify', () => {
    it('should redirect with error for missing code', async () => {
      const response = await request(app)
        .post('/auth/device/verify')
        .send({})
        .expect(302);

      expect(response.headers.location).toContain('/auth/device/verify?error=');
    });

    it('should redirect with error for invalid code', async () => {
      const response = await request(app)
        .post('/auth/device/verify')
        .send({ user_code: 'INVALID' })
        .expect(302);

      expect(response.headers.location).toContain('error=Invalid');
    });

    it('should redirect to GitHub OAuth for valid code', async () => {
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      const response = await request(app)
        .post('/auth/device/verify')
        .send({ user_code: codeResponse.body.user_code })
        .expect(302);

      expect(response.headers.location).toContain('/auth/github');
      expect(response.headers.location).toContain('returnTo=');
    });

    it('should redirect with error for already used code', async () => {
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      // Complete the request
      deviceAuthManager.completeRequest(codeResponse.body.user_code, 'user-123');

      const response = await request(app)
        .post('/auth/device/verify')
        .send({ user_code: codeResponse.body.user_code })
        .expect(302);

      expect(response.headers.location).toContain('error=');
      expect(response.headers.location).toContain('already');
    });
  });

  describe('GET /auth/device/complete', () => {
    it('should return error without authentication', async () => {
      const response = await request(app)
        .get('/auth/device/complete?user_code=ABCD-1234')
        .expect(401);
    });

    it('should complete authorization for authenticated user with valid code', async () => {
      // Create user
      const userId = 'user-456';
      db.prepare(`
        INSERT INTO users (id, github_id, username, created_at, last_login_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(userId, 67890, 'authuser');

      const user = userRepository.findById(userId)!;
      const token = jwtService.sign(user);

      // Create device code
      const codeResponse = await request(app)
        .post('/auth/device/code')
        .expect(200);

      // Complete authorization (using correct cookie name: voice_relay_auth)
      const response = await request(app)
        .get(`/auth/device/complete?user_code=${codeResponse.body.user_code}`)
        .set('Cookie', `voice_relay_auth=${token}`)
        .expect(200);

      expect(response.text).toContain('Device Authorized');
      
      // Verify the request was completed
      const authRequest = deviceAuthManager.findByUserCode(codeResponse.body.user_code);
      expect(authRequest?.completed).toBe(true);
      expect(authRequest?.userId).toBe(userId);
    });
  });
});
