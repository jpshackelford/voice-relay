/**
 * Tests for `createClientErrorsRouter` (issue #455).
 *
 * Exercises the matrix from the issue:
 *  - Auth happy path → 204 + structured log
 *  - Missing / invalid bearer → 401
 *  - Body deviceId mismatch → 401
 *  - workspaceId mismatch → 403
 *  - sessionId belongs to another workspace → 403
 *  - Rate-limit (11th request) → 429
 *  - Oversize body → 413
 *  - Missing required field → 400
 *  - Oversize `context` blob is truncated in the log
 *  - `msg`/`ua` containing newlines and quotes are escaped/quoted
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createClientErrorsRouter } from './router.js';
import { DeviceRepository } from '../devices/device-repository.js';
import { SessionRepository } from '../sessions/session-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';

describe('Client Errors Router (issue #455)', () => {
  let app: Express;
  let db: Database.Database;
  let deviceRepository: DeviceRepository;
  let sessionRepository: SessionRepository;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let sessionId: string;
  let otherSessionId: string;
  let deviceId: string;
  let otherDeviceId: string;
  let deviceToken: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.ENCRYPTION_SECRET ||= 'test-encryption-secret-1234567890abcdef';
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        device_token_hash TEXT UNIQUE,
        token_expires_at TEXT,
        last_seen_at TEXT,
        config TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        primary_user_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        metadata TEXT,
        display_api_secret_encrypted TEXT,
        display_api_secret_iv TEXT,
        display_api_secret_tag TEXT,
        target_kiosk_device_id TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);

    deviceRepository = new DeviceRepository(db);
    sessionRepository = new SessionRepository(db);

    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-owner', 1, 'owner');

    workspaceId = 'ws-1';
    otherWorkspaceId = 'ws-2';
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(workspaceId, 'user-owner', 'WS One', 'ws-one', 'WS-ONE-1');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(otherWorkspaceId, 'user-owner', 'WS Two', 'ws-two', 'WS-TWO-1');

    const created = deviceRepository.create({
      workspaceId,
      name: 'Mobile',
      mode: 'mobile',
    });
    deviceId = created.device.id;
    deviceToken = created.token;

    const other = deviceRepository.create({
      workspaceId: otherWorkspaceId,
      name: 'Mobile2',
      mode: 'mobile',
    });
    otherDeviceId = other.device.id;

    sessionId = sessionRepository.create({ workspaceId }).id;
    otherSessionId = sessionRepository.create({ workspaceId: otherWorkspaceId }).id;

    app = express();
    app.use(
      '/api/client-errors',
      createClientErrorsRouter({
        deviceRepository,
        sessionRepository,
        // Small limit so the rate-limit test runs fast.
        rateLimit: { maxRequests: 3, windowMs: 60_000 },
      }),
    );

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    db.close();
  });

  function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sessionId,
      workspaceId,
      deviceId,
      source: 'useSpeechRecognition',
      errorCode: 'aborted',
      message: 'Speech recognition error',
      userAgent: 'Mozilla/5.0 iPhone Safari',
      ...overrides,
    };
  }

  it('returns 204 and emits a structured [ClientError] log on a valid request', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody())
      .expect(204);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toMatch(/^\[ClientError]/);
    expect(line).toContain(`session=${sessionId}`);
    expect(line).toContain(`workspace=${workspaceId}`);
    expect(line).toContain(`device=${deviceId}`);
    expect(line).toContain('source="useSpeechRecognition"');
    expect(line).toContain('code="aborted"');
    expect(line).toContain('msg="Speech recognition error"');
    expect(line).toContain('ua="Mozilla/5.0 iPhone Safari"');
  });

  it('returns 401 when the Authorization header is missing', async () => {
    await request(app).post('/api/client-errors').send(validBody()).expect(401);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token is invalid', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(validBody())
      .expect(401);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when body deviceId does not match the token device', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ deviceId: otherDeviceId }))
      .expect(401);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when body workspaceId does not match the token device', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ workspaceId: otherWorkspaceId }))
      .expect(403);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when sessionId belongs to a different workspace', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ sessionId: otherSessionId }))
      .expect(403);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when sessionId does not exist', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ sessionId: 'does-not-exist' }))
      .expect(403);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when a required field is missing', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ message: undefined }))
      .expect(400);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when a required field is an empty string', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ source: '   ' }))
      .expect(400);
  });

  it('rate-limits per sessionId after the configured threshold (429 with Retry-After)', async () => {
    // The fixture sets maxRequests=3. The first 3 succeed, the 4th 429.
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/client-errors')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send(validBody())
        .expect(204);
    }
    const limited = await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody())
      .expect(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.body.retryAfter).toBe(60);
  });

  it('returns 413 when the body exceeds the 4kb limit', async () => {
    // 5kb of payload guarantees we trip the parser cap even before
    // shape validation runs.
    const huge = 'x'.repeat(5 * 1024);
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ context: { blob: huge } }))
      .expect(413);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('truncates an oversize `context` blob in the log line', async () => {
    // Build a context that fits under the 4kb body cap but exceeds
    // the 2kb log-line context cap.
    const nested = { details: 'y'.repeat(2_500) };
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ context: nested }))
      .expect(204);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain('context=');
    expect(line).toContain('…(truncated)');
  });

  it('escapes control characters and quotes in msg/ua fields', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(
        validBody({
          message: 'line one\nline "two"',
          userAgent: 'UA\twith\rcontrol\nchars',
        }),
      )
      .expect(204);
    const line = String(logSpy.mock.calls[0][0]);
    // Single-line: no embedded newlines from user input.
    expect(line.split('\n')).toHaveLength(1);
    // Quotes inside `msg` are escaped by JSON.stringify.
    expect(line).toContain('msg="line one line \\"two\\""');
  });

  it('omits the context field from the log line when not provided', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ context: undefined }))
      .expect(204);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).not.toContain('context=');
  });

  it('accepts a payload with no errorCode or userAgent', async () => {
    await request(app)
      .post('/api/client-errors')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send(validBody({ errorCode: undefined, userAgent: undefined }))
      .expect(204);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain('code=""');
    expect(line).toContain('ua=""');
  });
});
