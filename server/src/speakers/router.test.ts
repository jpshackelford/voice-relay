/**
 * REST tests for the speakers router (#383). Drives the same migration
 * chain production uses and exercises auth (require auth, require
 * workspace access for reads, require workspace owner for writes),
 * input validation, and the happy paths for each verb.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createSpeakerRouter } from './router.js';
import { SpeakerRepository } from './speaker-repository.js';
import { WorkspaceRepository } from '../workspaces/index.js';
import { UserRepository } from '../auth/user-repository.js';
import { JWTService } from '../auth/jwt.js';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';
import type { User } from '../auth/types.js';

interface TestEnv {
  db: Database.Database;
  app: Express;
  owner: User;
  outsider: User;
  workspaceId: string;
  ownerToken: string;
  outsiderToken: string;
  jwt: JWTService;
  userRepo: UserRepository;
}

async function setup(): Promise<TestEnv> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const migrator = new Migrator({ db, migrations });
  await migrator.migrateUp();

  const userRepo = new UserRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const speakerRepo = new SpeakerRepository(db);
  const jwt = new JWTService({ secret: 'test-secret', expiresIn: '1h' });

  const owner = userRepo.create({
    githubId: 1,
    username: 'owner',
    displayName: 'Owner',
  });
  const outsider = userRepo.create({
    githubId: 2,
    username: 'outsider',
    displayName: 'Outsider',
  });
  const workspace = workspaceRepo.create(owner.id, { name: 'Workspace 1' });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/workspaces/:workspaceId/speakers',
    createSpeakerRouter({
      speakerRepository: speakerRepo,
      workspaceRepository: workspaceRepo,
      authConfig: { jwtService: jwt, userRepository: userRepo },
    })
  );

  return {
    db,
    app,
    owner,
    outsider,
    workspaceId: workspace.id,
    ownerToken: jwt.sign(owner),
    outsiderToken: jwt.sign(outsider),
    jwt,
    userRepo,
  };
}

describe('SpeakerRouter (#383)', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setup();
  });
  afterEach(() => {
    env.db.close();
  });

  describe('auth & authorization', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers`)
        .expect(401);
    });

    it('rejects non-member reads with 403', async () => {
      await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.outsiderToken}`)
        .expect(403);
    });

    it('rejects non-owner writes with 403', async () => {
      // Make the outsider a member (but not owner). They should still
      // be blocked from POST/PUT/DELETE.
      env.db
        .prepare(
          `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
           VALUES (?, ?, ?, datetime('now'))`
        )
        .run(env.workspaceId, env.outsider.id, 'member');

      // Member can read.
      await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.outsiderToken}`)
        .expect(200);

      // But cannot create.
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.outsiderToken}`)
        .send({ preferredName: 'New' })
        .expect(403);
    });
  });

  describe('GET /', () => {
    it('returns an empty array when no speakers exist', async () => {
      const res = await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .expect(200);
      expect(res.body).toEqual({ speakers: [] });
    });

    it('returns speakers most-recently-updated first', async () => {
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'Alpha' })
        .expect(201);
      await new Promise((r) => setTimeout(r, 10));
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'Beta' })
        .expect(201);

      const res = await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .expect(200);
      expect(res.body.speakers.map((s: { preferredName: string }) => s.preferredName)).toEqual([
        'Beta',
        'Alpha',
      ]);
    });
  });

  describe('GET /:speakerId', () => {
    it('returns 404 when not found', async () => {
      await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers/missing`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .expect(404);
    });

    it('returns the speaker when found', async () => {
      const created = await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'Sam' });
      const res = await request(env.app)
        .get(`/api/workspaces/${env.workspaceId}/speakers/${created.body.speaker.id}`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .expect(200);
      expect(res.body.speaker.preferredName).toBe('Sam');
    });
  });

  describe('POST /', () => {
    it('creates a speaker and trims input', async () => {
      const res = await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({
          preferredName: '  Sam  ',
          pronouns: 'they/them',
          notes: 'metric units',
        })
        .expect(201);
      expect(res.body.speaker.preferredName).toBe('Sam');
      expect(res.body.speaker.pronouns).toBe('they/them');
    });

    it('coerces blank strings to null', async () => {
      const res = await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: '   ' })
        .expect(201);
      expect(res.body.speaker.preferredName).toBeNull();
    });

    it('rejects non-string fields with 400', async () => {
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 42 })
        .expect(400);
    });

    it('rejects an over-long preferred name with 400', async () => {
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'x'.repeat(201) })
        .expect(400);
    });

    it('returns 409 when a speaker already exists for the user', async () => {
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ userId: env.owner.id, preferredName: 'A' })
        .expect(201);
      await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ userId: env.owner.id, preferredName: 'B' })
        .expect(409);
    });
  });

  describe('PUT /:speakerId', () => {
    it('updates only specified fields', async () => {
      const created = await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'Sam', pronouns: 'they/them' });
      const id = created.body.speaker.id;
      const res = await request(env.app)
        .put(`/api/workspaces/${env.workspaceId}/speakers/${id}`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ notes: 'metric units' })
        .expect(200);
      expect(res.body.speaker.preferredName).toBe('Sam');
      expect(res.body.speaker.notes).toBe('metric units');
    });

    it('explicit null clears the field', async () => {
      const created = await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'Sam', pronouns: 'they/them' });
      const id = created.body.speaker.id;
      const res = await request(env.app)
        .put(`/api/workspaces/${env.workspaceId}/speakers/${id}`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ pronouns: null })
        .expect(200);
      expect(res.body.speaker.pronouns).toBeNull();
    });

    it('returns 404 for unknown speaker', async () => {
      await request(env.app)
        .put(`/api/workspaces/${env.workspaceId}/speakers/missing`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ notes: 'x' })
        .expect(404);
    });
  });

  describe('DELETE /:speakerId', () => {
    it('204s on success', async () => {
      const created = await request(env.app)
        .post(`/api/workspaces/${env.workspaceId}/speakers`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .send({ preferredName: 'Sam' });
      await request(env.app)
        .delete(`/api/workspaces/${env.workspaceId}/speakers/${created.body.speaker.id}`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .expect(204);
    });

    it('404s when missing', async () => {
      await request(env.app)
        .delete(`/api/workspaces/${env.workspaceId}/speakers/missing`)
        .set('Authorization', `Bearer ${env.ownerToken}`)
        .expect(404);
    });
  });
});
