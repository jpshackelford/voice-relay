/**
 * Unit tests for `buildRelayedTextMessage` (issue #446 / #433 third-bullet AC).
 *
 * The helper owns the `senderName` substitution rule that PR #438 left
 * unimplemented: when the per-session active-speaker (or primary-user
 * fallback) resolved a speaker with a non-null `preferredName`, the
 * outbound `RelayedTextMessage.senderName` carries that name; otherwise
 * it carries the device alias. These tests pin the full truth-table the
 * issue's analysis lays out.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildRelayedTextMessage,
  type BuilderDevice,
  type BuilderInboundText,
  type UtteranceSpeaker,
} from './build-relayed-text-message.js';
import { SQLiteStore } from './storage/sqlite.js';

const baseDevice: BuilderDevice = {
  id: 'device-A',
  displayName: 'Linux-bda2',
  workspaceId: 'workspace-1',
  sessionId: 'session-S',
};

const baseMessage: BuilderInboundText = {
  utteranceId: 'utterance-1',
  text: 'hi peer',
  partial: false,
};

const clientTimestamp = '2026-06-07T15:00:00.000Z';

describe('buildRelayedTextMessage — senderName substitution (#446)', () => {
  /**
   * AC #1 (happy path): per-session active-speaker resolved with a
   * non-null preferredName → `senderName` substitutes the speaker name.
   * The same object would be persisted by `store.append`, so this single
   * assertion also pins AC #2 (`messages.sender_name = 'JP'`).
   */
  it('substitutes senderName with utteranceSpeaker.preferredName when one resolved', () => {
    const utteranceSpeaker: UtteranceSpeaker = {
      id: 'speaker-row-1',
      preferredName: 'JP',
      pronouns: null,
    };

    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker,
      finalSpeakerId: 'speaker-row-1',
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect(result).toEqual({
      type: 'text',
      utteranceId: 'utterance-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-S',
      senderId: 'device-A',
      senderName: 'JP', // ← substituted; was 'Linux-bda2' before #446
      text: 'hi peer',
      partial: false,
      clientTimestamp,
      speakerId: 'speaker-row-1',
    });
    expect(result.senderName).not.toBe(baseDevice.displayName);
    expect(result.speakerId).toBe(utteranceSpeaker.id);
  });

  /**
   * AC #4 (unclaimed device): no override AND no primary-user-derived
   * speaker → `senderName` stays as the device alias. Also: no `speakerId`
   * field on the wire.
   */
  it('keeps senderName as device.displayName when no speaker resolved (unclaimed device)', () => {
    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker: null,
      finalSpeakerId: undefined,
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect(result.senderName).toBe('Linux-bda2');
    expect(result).not.toHaveProperty('speakerId');
    expect(result).not.toHaveProperty('engineSpeakerLabel');
  });

  /**
   * AC #3 (engine-label-only): `resolvedFromEngineMapping` won the
   * `finalSpeakerId`, but `utteranceSpeaker` is null (no per-session
   * override, no primary-user speaker) → `senderName` keeps the device
   * alias. Engine labels like `S1`/`S2` are opaque bucket ids, not human
   * names, so they must NOT leak as the displayed sender.
   *
   * The engine label itself rides the wire on `engineSpeakerLabel` and
   * the resolved id rides on `speakerId` (both already populated by
   * upstream resolution in index.ts).
   */
  it('keeps senderName as device alias on the engine-label-only path', () => {
    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker: null, // no per-session override, no primary-user
      finalSpeakerId: 'speaker-row-from-engine-map',
      engineSpeakerLabel: 'S1',
      clientTimestamp,
    });

    expect(result.senderName).toBe('Linux-bda2');
    expect(result.speakerId).toBe('speaker-row-from-engine-map');
    expect(result.engineSpeakerLabel).toBe('S1');
  });

  /**
   * Edge case: per-session override points at a speaker row whose
   * `preferredName` is null (e.g. legacy row, anonymous-but-tracked
   * speaker). The `??` fallback must yield the device alias, not the
   * literal string "null".
   */
  it('falls back to device.displayName when utteranceSpeaker.preferredName is null', () => {
    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker: {
        id: 'speaker-no-name',
        preferredName: null,
        pronouns: null,
      },
      finalSpeakerId: 'speaker-no-name',
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect(result.senderName).toBe('Linux-bda2');
    expect(result.senderName).not.toBe('null');
    expect(result.speakerId).toBe('speaker-no-name');
  });

  /**
   * Edge case: per-session speaker has an empty-string `preferredName`.
   * The `??` coalescing operator only short-circuits on null/undefined,
   * so an empty string would NOT trigger the fallback. We assert that
   * behavior explicitly so future authors don't accidentally change it
   * to `||` (which would mask blank-name bugs). If product later wants
   * empty strings treated as missing, the validation belongs at the
   * write endpoint (`POST /api/devices/:id/sessions/:sid/active-speaker`),
   * not the builder.
   */
  it('passes through an empty-string preferredName (?? only short-circuits on null/undefined)', () => {
    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker: {
        id: 'speaker-blank',
        preferredName: '',
        pronouns: null,
      },
      finalSpeakerId: 'speaker-blank',
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect(result.senderName).toBe('');
  });

  /**
   * AC #1 corollary: substitution happens for partial frames too. The
   * relay broadcasts each partial independently and the kiosk renders
   * `senderName` on the ticker; a mid-utterance flip from device alias
   * to speaker name would be visible to peers. We pin the contract on
   * partials so this doesn't silently regress.
   */
  it('substitutes senderName for partial frames as well', () => {
    const result = buildRelayedTextMessage({
      message: { ...baseMessage, partial: true },
      device: baseDevice,
      utteranceSpeaker: {
        id: 'speaker-row-1',
        preferredName: 'JP',
        pronouns: null,
      },
      finalSpeakerId: 'speaker-row-1',
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect(result.partial).toBe(true);
    expect(result.senderName).toBe('JP');
  });

  /**
   * Pass-through contract: optional fields land on the wire only when
   * the caller supplies them. Important for kiosk compatibility — older
   * clients ignore unknown fields but explicit `undefined` values do
   * show up as enumerable own properties under `JSON.stringify`. Use
   * `hasOwnProperty` (via `in`) to confirm we omit, not just leave
   * `undefined`.
   */
  it('omits speakerId / engineSpeakerLabel / senderTimezone fields when their inputs are falsy', () => {
    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: { ...baseDevice, timezone: undefined },
      utteranceSpeaker: null,
      finalSpeakerId: undefined,
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect('speakerId' in result).toBe(false);
    expect('engineSpeakerLabel' in result).toBe(false);
    expect('senderTimezone' in result).toBe(false);
  });

  /**
   * Pass-through: when timezone is set, it lands on `senderTimezone`.
   * Independent of the substitution rule but pinned here because the
   * builder owns the wire-shape contract end-to-end.
   */
  it('passes through senderTimezone when device.timezone is set', () => {
    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: { ...baseDevice, timezone: 'America/New_York' },
      utteranceSpeaker: null,
      finalSpeakerId: undefined,
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    expect(result.senderTimezone).toBe('America/New_York');
  });
});

/**
 * AC #2 — persisted-row contract: the same `relayMessage` object the WS
 * handler hands to `store.append` carries the substituted `senderName`, so
 * `messages.sender_name` lands as the speaker name and not the device
 * alias. We pin it against a real `SQLiteStore` to catch any future drift
 * in the storage layer's column mapping (the WS handler hands the builder
 * output straight to `store.append`, so this assertion is the source of
 * truth for the storage half of the AC).
 */
describe('buildRelayedTextMessage — persisted-row contract (#446 AC #2)', () => {
  let store: SQLiteStore;
  let testDir: string;
  let testDbPath: string;

  /**
   * Seed the FK chain `users → workspaces → sessions → speakers` so that
   * `messages.session_id` and `messages.speaker_id` (both FKs added in
   * migration 17) can land without `FOREIGN KEY constraint failed`.
   */
  function seedFkChain(
    workspaceId: string,
    sessionId: string,
    speakerId: string | null
  ): void {
    const db = store.getDatabase()!;
    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username, created_at, last_login_at)
       VALUES ('owner-446', 446, 'owner446', datetime('now'), datetime('now'))`
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, 'owner-446', 'WS-446', ?, 'JC-446X', datetime('now'), datetime('now'))`
    ).run(workspaceId, `ws-${workspaceId}`);
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, workspace_id, name, status, started_at)
       VALUES (?, ?, 'S-446', 'active', datetime('now'))`
    ).run(sessionId, workspaceId);
    if (speakerId) {
      // `speakers` (migration 17) columns: id, workspace_id, user_id (nullable),
      // preferred_name, pronouns, created_at, updated_at.
      db.prepare(
        `INSERT OR IGNORE INTO speakers (id, workspace_id, user_id, preferred_name, pronouns, created_at, updated_at)
         VALUES (?, ?, NULL, 'JP', NULL, datetime('now'), datetime('now'))`
      ).run(speakerId, workspaceId);
    }
  }

  beforeEach(async () => {
    testDir = join(tmpdir(), `voice-relay-446-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, 'test.db');
    store = new SQLiteStore({ path: testDbPath });
    await store.connect();
  });

  afterEach(async () => {
    await store.disconnect();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('persists messages.sender_name as the substituted speaker preferredName', async () => {
    seedFkChain(baseDevice.workspaceId, baseDevice.sessionId!, 'speaker-row-1');

    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker: {
        id: 'speaker-row-1',
        preferredName: 'JP',
        pronouns: null,
      },
      finalSpeakerId: 'speaker-row-1',
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    await store.append(result);

    const db = store.getDatabase();
    const row = db!
      .prepare(
        `SELECT sender_id, sender_name, speaker_id FROM messages WHERE utterance_id = ?`
      )
      .get(baseMessage.utteranceId) as {
      sender_id: string;
      sender_name: string;
      speaker_id: string | null;
    };

    expect(row).toBeDefined();
    expect(row.sender_id).toBe('device-A'); // device id rides unchanged
    expect(row.sender_name).toBe('JP'); // ← substituted, was 'Linux-bda2' pre-#446
    expect(row.speaker_id).toBe('speaker-row-1');
  });

  it('persists messages.sender_name as the device alias when no speaker resolved', async () => {
    seedFkChain(baseDevice.workspaceId, baseDevice.sessionId!, null);

    const result = buildRelayedTextMessage({
      message: baseMessage,
      device: baseDevice,
      utteranceSpeaker: null,
      finalSpeakerId: undefined,
      engineSpeakerLabel: undefined,
      clientTimestamp,
    });

    await store.append(result);

    const db = store.getDatabase();
    const row = db!
      .prepare(
        `SELECT sender_name, speaker_id FROM messages WHERE utterance_id = ?`
      )
      .get(baseMessage.utteranceId) as {
      sender_name: string;
      speaker_id: string | null;
    };

    expect(row.sender_name).toBe('Linux-bda2'); // unclaimed → alias
    expect(row.speaker_id).toBeNull();
  });
});
