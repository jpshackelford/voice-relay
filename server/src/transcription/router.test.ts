/**
 * Tests for the hosted-STT token broker (#386).
 *
 * Runs against an in-memory SQLite with all migrations applied, stubs
 * Deepgram's HTTP surface with a vi-mock fetch, and exercises the full
 * 4xx / 5xx matrix described in the issue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import request from 'supertest';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import { DeviceRepository } from '../devices/device-repository.js';
import { JWTService } from '../auth/jwt.js';
import { UserRepository } from '../auth/user-repository.js';
import { encryptApiKey } from '../workspaces/encryption.js';
import {
  createTranscriptionRouter,
  _clearProjectIdCacheForTests,
} from './router.js';
import { StttUsageRepository } from './usage-repository.js';

function makeFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('Transcription router (POST /api/stt/token)', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepo: WorkspaceRepository;
  let deviceRepo: DeviceRepository;
  let usageRepo: StttUsageRepository;
  let jwtService: JWTService;
  let userRepo: UserRepository;
  let memberToken: string;
  let outsiderToken: string;
  let workspaceId: string;
  let deviceId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.ENCRYPTION_SECRET ||= 'test-encryption-secret-1234567890abcdef';
    _clearProjectIdCacheForTests();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    await new Migrator({ db, migrations }).migrateUp();

    workspaceRepo = new WorkspaceRepository(db);
    deviceRepo = new DeviceRepository(db);
    usageRepo = new StttUsageRepository(db);
    userRepo = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-owner', 1, 'owner');
    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-outsider', 2, 'outsider');

    const ws = workspaceRepo.create('user-owner', { name: 'WS', slug: 'ws-1' });
    workspaceId = ws.id;
    const { device } = deviceRepo.create({
      workspaceId,
      name: 'Kiosk',
      mode: 'kiosk',
    });
    deviceId = device.id;

    const memberUser = userRepo.findById('user-owner')!;
    const outsiderUser = userRepo.findById('user-outsider')!;
    memberToken = jwtService.sign(memberUser);
    outsiderToken = jwtService.sign(outsiderUser);

    fetchMock = vi.fn();
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(
      '/api/stt',
      createTranscriptionRouter({
        workspaceRepository: workspaceRepo,
        deviceRepository: deviceRepo,
        usageRepository: usageRepo,
        authConfig: { jwtService, userRepository: userRepo },
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Helper: configure the workspace as Deepgram-enabled with a stored
   * encrypted key. Stubs Deepgram's project + key-mint endpoints so
   * the happy path returns a token.
   */
  function enableDeepgram(opts?: { cap?: number | null }): void {
    const enc = encryptApiKey('long-lived-deepgram-key');
    workspaceRepo.updateSettings(workspaceId, {
      sttEngine: 'deepgram',
      deepgramApiKeyEncrypted: enc.encrypted,
      deepgramApiKeyIv: enc.iv,
      deepgramApiKeyTag: enc.tag,
      ...(opts && 'cap' in opts ? { sttMonthlyMinuteCap: opts.cap } : {}),
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/v1/projects')) {
        return Promise.resolve(
          makeFetchResponse({ projects: [{ project_id: 'proj-xyz' }] }),
        );
      }
      if (url.includes('/keys')) {
        return Promise.resolve(
          makeFetchResponse({ key: 'short-lived-token' }),
        );
      }
      throw new Error(`unexpected fetch URL: ${url}`);
    });
  }

  it('401 when no JWT cookie / header is sent', async () => {
    const res = await request(app)
      .post('/api/stt/token')
      .send({ deviceId });
    expect(res.status).toBe(401);
  });

  it('403 when the JWT user is not a workspace member', async () => {
    enableDeepgram();
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ deviceId });
    expect(res.status).toBe(403);
  });

  it('404 when deviceId is unknown', async () => {
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId: 'no-such-device' });
    expect(res.status).toBe(404);
  });

  it('400 when deviceId is missing', async () => {
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('403 when the resolved engine is web-speech (workspace default)', async () => {
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(403);
    expect(res.body.engine).toBe('web-speech');
  });

  it('503 when the engine is deepgram but no key is configured', async () => {
    workspaceRepo.updateSettings(workspaceId, { sttEngine: 'deepgram' });
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(503);
  });

  it('402 when the workspace monthly cap is reached', async () => {
    enableDeepgram({ cap: 10 });
    usageRepo.incrementMinutes(workspaceId, 10);
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(402);
    expect(res.body.cap).toBe(10);
    expect(res.body.minutesUsed).toBeCloseTo(10);
  });

  it('200 with a short-lived token on the happy path', async () => {
    enableDeepgram({ cap: 100 });
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('short-lived-token');
    expect(res.body.engine).toBe('deepgram');
    expect(typeof res.body.expiresAt).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.expiresAt))).toBe(false);
    // Confirm Deepgram was actually called with the expected request body.
    const mintCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/keys'),
    );
    expect(mintCall).toBeDefined();
    const body = JSON.parse((mintCall![1] as RequestInit).body as string);
    expect(body.time_to_live_in_seconds).toBeLessThanOrEqual(60);
    expect(body.scopes).toContain('usage:write');
  });

  it('per-device override "web-speech" beats the workspace default', async () => {
    enableDeepgram();
    deviceRepo.update(deviceId, { config: { stt_engine: 'web-speech' } });
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(403);
  });

  it('per-device override "deepgram" wins over a web-speech workspace default', async () => {
    const enc = encryptApiKey('long-lived-deepgram-key');
    workspaceRepo.updateSettings(workspaceId, {
      sttEngine: 'web-speech',
      deepgramApiKeyEncrypted: enc.encrypted,
      deepgramApiKeyIv: enc.iv,
      deepgramApiKeyTag: enc.tag,
    });
    deviceRepo.update(deviceId, { config: { stt_engine: 'deepgram' } });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/v1/projects')) {
        return Promise.resolve(
          makeFetchResponse({ projects: [{ project_id: 'proj-xyz' }] }),
        );
      }
      return Promise.resolve(makeFetchResponse({ key: 'short-lived' }));
    });
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(200);
  });

  it('502 when Deepgram returns a non-2xx upstream', async () => {
    workspaceRepo.updateSettings(workspaceId, { sttEngine: 'deepgram' });
    const enc = encryptApiKey('long-lived-deepgram-key');
    workspaceRepo.updateSettings(workspaceId, {
      deepgramApiKeyEncrypted: enc.encrypted,
      deepgramApiKeyIv: enc.iv,
      deepgramApiKeyTag: enc.tag,
    });
    fetchMock.mockResolvedValue(
      makeFetchResponse({ error: 'unauthorised' }, 401),
    );
    const res = await request(app)
      .post('/api/stt/token')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId });
    expect(res.status).toBe(502);
    expect(res.body.upstreamStatus).toBe(401);
  });
});

describe('Transcription router (usage tracking)', () => {
  let app: Express;
  let db: Database.Database;
  let workspaceRepo: WorkspaceRepository;
  let deviceRepo: DeviceRepository;
  let usageRepo: StttUsageRepository;
  let jwtService: JWTService;
  let userRepo: UserRepository;
  let memberToken: string;
  let workspaceId: string;
  let deviceId: string;

  beforeEach(async () => {
    process.env.ENCRYPTION_SECRET ||= 'test-encryption-secret-1234567890abcdef';
    _clearProjectIdCacheForTests();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    await new Migrator({ db, migrations }).migrateUp();

    workspaceRepo = new WorkspaceRepository(db);
    deviceRepo = new DeviceRepository(db);
    usageRepo = new StttUsageRepository(db);
    userRepo = new UserRepository(db);
    jwtService = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-owner', 1, 'owner');
    const ws = workspaceRepo.create('user-owner', { name: 'WS', slug: 'ws-2' });
    workspaceId = ws.id;
    const { device } = deviceRepo.create({
      workspaceId,
      name: 'Kiosk',
      mode: 'kiosk',
    });
    deviceId = device.id;
    memberToken = jwtService.sign(userRepo.findById('user-owner')!);

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(
      '/api/stt',
      createTranscriptionRouter({
        workspaceRepository: workspaceRepo,
        deviceRepository: deviceRepo,
        usageRepository: usageRepo,
        authConfig: { jwtService, userRepository: userRepo },
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    );
  });

  afterEach(() => {
    db.close();
  });

  it('POST /api/stt/usage increments the monthly counter', async () => {
    const res = await request(app)
      .post('/api/stt/usage')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId, minutes: 2.5 });
    expect(res.status).toBe(200);
    expect(res.body.minutesUsedThisMonth).toBeCloseTo(2.5);
    expect(usageRepo.getCurrentMonthMinutes(workspaceId)).toBeCloseTo(2.5);
  });

  it('POST /api/stt/usage rejects negative minutes', async () => {
    const res = await request(app)
      .post('/api/stt/usage')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ deviceId, minutes: -1 });
    expect(res.status).toBe(400);
  });

  it('GET /api/stt/usage returns current month usage + cap + engine', async () => {
    workspaceRepo.updateSettings(workspaceId, {
      sttEngine: 'deepgram',
      sttMonthlyMinuteCap: 50,
    });
    usageRepo.incrementMinutes(workspaceId, 7);
    const res = await request(app)
      .get('/api/stt/usage')
      .set('Authorization', `Bearer ${memberToken}`)
      .query({ workspaceId });
    expect(res.status).toBe(200);
    expect(res.body.minutesUsedThisMonth).toBeCloseTo(7);
    expect(res.body.cap).toBe(50);
    expect(res.body.engine).toBe('deepgram');
  });

  it('GET /api/stt/usage 400 without workspaceId', async () => {
    const res = await request(app)
      .get('/api/stt/usage')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(400);
  });
});
