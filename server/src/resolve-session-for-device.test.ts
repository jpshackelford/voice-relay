import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { resolveSessionForDevice } from './index.js';
import { SessionRepository } from './sessions/session-repository.js';
import { Migrator } from './storage/migrator.js';
import { migrations } from './storage/migrations/index.js';

// Encryption mocks so SessionRepository's display-secret path doesn't
// need ENCRYPTION_SECRET set in this unit test environment.
vi.mock('./workspaces/encryption.js', () => ({
  encryptApiKey: vi.fn((secret: string) => ({
    encrypted: Buffer.from(secret).toString('base64'),
    iv: 'test-iv',
    tag: 'test-tag',
  })),
  decryptApiKey: vi.fn((encrypted: { encrypted: string }) => {
    return Buffer.from(encrypted.encrypted, 'base64').toString('utf-8');
  }),
}));

/**
 * Unit tests for the kiosk-bound session resolution path of
 * `resolveSessionForDevice` (issue #393).
 *
 * The function powers the mobile kiosk picker by making the mapping
 * device → session per-kiosk. We verify the four documented branches
 * (explicit id, kiosk-self, mobile-with-target, legacy fallback) plus
 * the cross-workspace safety check on stale bindings.
 */
describe('resolveSessionForDevice (issue #393)', () => {
  let db: Database.Database;
  let repo: SessionRepository;

  const wsId = 'ws-1';
  const userId = 'u-1';
  const mobileId = 'mobile-1';
  const kioskA = 'kiosk-a';
  const kioskB = 'kiosk-b';

  beforeEach(async () => {
    db = new Database(':memory:');
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();

    repo = new SessionRepository(db);

    db.prepare(
      `INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`,
    ).run(userId, 1, 'tester');
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`,
    ).run(wsId, userId, 'WS', 'ws-1');
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
    ).run(mobileId, wsId, 'Mobile', 'mobile');
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
    ).run(kioskA, wsId, 'Kiosk A', 'kiosk');
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
    ).run(kioskB, wsId, 'Kiosk B', 'kiosk');
  });

  afterEach(() => {
    db.close();
  });

  it('honors an explicit, valid clientSessionId in the same workspace', () => {
    const existing = repo.create({ workspaceId: wsId, name: 'Hand-picked' });

    const resolved = resolveSessionForDevice(
      repo,
      existing.id,
      wsId,
      mobileId,
      'mobile',
      undefined,
    );

    expect(resolved.id).toBe(existing.id);
    expect(resolved.name).toBe('Hand-picked');
  });

  it('kiosk anchors to its own per-kiosk session (branch 2)', () => {
    const resolved = resolveSessionForDevice(
      repo, undefined, wsId, kioskA, 'kiosk', undefined,
    );

    const stored = repo.findById(resolved.id);
    expect(stored?.targetKioskDeviceId).toBe(kioskA);
    // Reconnect: same kiosk → same session id.
    const second = resolveSessionForDevice(
      repo, undefined, wsId, kioskA, 'kiosk', undefined,
    );
    expect(second.id).toBe(resolved.id);
  });

  it('mobile with targetKioskDeviceId joins the kiosk\'s session (branch 3)', () => {
    // Kiosk A has already established its session.
    const kioskSession = resolveSessionForDevice(
      repo, undefined, wsId, kioskA, 'kiosk', undefined,
    );

    const resolved = resolveSessionForDevice(
      repo, undefined, wsId, mobileId, 'mobile', kioskA,
    );
    expect(resolved.id).toBe(kioskSession.id);
  });

  it('mobile with a brand-new targetKioskDeviceId creates the kiosk\'s session', () => {
    // No prior session exists for kiosk B.
    const resolved = resolveSessionForDevice(
      repo, undefined, wsId, mobileId, 'mobile', kioskB,
    );
    const stored = repo.findById(resolved.id);
    expect(stored?.targetKioskDeviceId).toBe(kioskB);
    expect(stored?.status).toBe('active');
  });

  it('mobile without targetKioskDeviceId falls back to workspace-wide single-active (branch 4)', () => {
    // Seed a legacy workspace-wide active session (no binding).
    const legacy = repo.create({ workspaceId: wsId, name: 'Legacy' });

    const resolved = resolveSessionForDevice(
      repo, undefined, wsId, mobileId, 'mobile', undefined,
    );
    expect(resolved.id).toBe(legacy.id);
  });

  it('two mobiles targeting the same kiosk share one session', () => {
    const mobile2 = 'mobile-2';
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
    ).run(mobile2, wsId, 'Mobile 2', 'mobile');

    const first = resolveSessionForDevice(
      repo, undefined, wsId, mobileId, 'mobile', kioskA,
    );
    const second = resolveSessionForDevice(
      repo, undefined, wsId, mobile2, 'mobile', kioskA,
    );
    expect(second.id).toBe(first.id);
  });

  it('two mobiles targeting different kiosks land in separate sessions', () => {
    const mobile2 = 'mobile-2';
    db.prepare(
      `INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`,
    ).run(mobile2, wsId, 'Mobile 2', 'mobile');

    const a = resolveSessionForDevice(
      repo, undefined, wsId, mobileId, 'mobile', kioskA,
    );
    const b = resolveSessionForDevice(
      repo, undefined, wsId, mobile2, 'mobile', kioskB,
    );
    expect(a.id).not.toBe(b.id);
  });

  it('invalid clientSessionId falls through to kiosk-bound resolution', () => {
    const resolved = resolveSessionForDevice(
      repo, 'bogus-id', wsId, kioskA, 'kiosk', undefined,
    );
    // Falls through to branch 2 — creates the kiosk's own session.
    const stored = repo.findById(resolved.id);
    expect(stored?.targetKioskDeviceId).toBe(kioskA);
  });

  it('cross-workspace clientSessionId is ignored', () => {
    // Active session in a different workspace.
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`,
    ).run('ws-2', userId, 'Other WS', 'ws-2');
    const other = repo.create({ workspaceId: 'ws-2' });

    const resolved = resolveSessionForDevice(
      repo, other.id, wsId, mobileId, 'mobile', undefined,
    );
    expect(resolved.id).not.toBe(other.id);
  });
});
