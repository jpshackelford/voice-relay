/**
 * Unit tests for {@link createSessionSettingsService} (issue #378).
 *
 * Uses an in-memory SQLite with the real migrations + repositories so the
 * service runs against true persistence. The registry is a thin spy that
 * captures broadcasts and verifies wire shapes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionRepository } from './session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import {
  createSessionSettingsService,
  SessionNotFoundError,
  SettingsValidationError,
  type SessionSettingsService,
} from './settings-service.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as allowAutoJoinMigration } from '../storage/migrations/007_allow_auto_join.js';
import { migration as qrTokensMigration } from '../storage/migrations/008_qr_tokens.js';
import { migration as elevenlabsMigration } from '../storage/migrations/011_elevenlabs.js';
import { migration as kioskTickersMigration } from '../storage/migrations/015_kiosk_footer_tickers.js';
import { migration as defaultAgentPromptMigration } from '../storage/migrations/016_default_agent_prompt.js';
import { migration as hostedSttMigration } from '../storage/migrations/019_hosted_stt.js';
import type { DeviceRegistry } from '../registry.js';
import { MAX_AGENT_PROMPT_LENGTH } from '../constants.js';

interface BroadcastCall {
  sessionId: string;
  message: { type: string; sessionId: string; [k: string]: unknown };
}

function makeRegistry(): { registry: DeviceRegistry; calls: BroadcastCall[] } {
  const calls: BroadcastCall[] = [];
  const registry = {
    broadcastMessageToSession: vi.fn(
      (sessionId: string, message: { type: string; sessionId: string }) => {
        calls.push({ sessionId, message });
      },
    ),
  } as unknown as DeviceRegistry;
  return { registry, calls };
}

describe('SessionSettingsService', () => {
  let db: Database.Database;
  let sessionRepo: SessionRepository;
  let workspaceRepo: WorkspaceRepository;
  let service: SessionSettingsService;
  let registryCalls: BroadcastCall[];
  let registry: DeviceRegistry;
  let sessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(allowAutoJoinMigration.up);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        display_api_secret_encrypted TEXT,
        display_api_secret_iv TEXT,
        display_api_secret_tag TEXT,
        target_kiosk_device_id TEXT,
        metadata TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, device_id)
      );
    `);
    db.exec(qrTokensMigration.up);
    db.exec(elevenlabsMigration.up);
    db.exec(kioskTickersMigration.up);
    db.exec(defaultAgentPromptMigration.up);
    db.exec(hostedSttMigration.up);

    sessionRepo = new SessionRepository(db);
    workspaceRepo = new WorkspaceRepository(db);

    db.prepare(
      `INSERT INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('owner-1', 1, 'owner');
    workspaceId = 'ws-1';
    db.prepare(
      `INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(workspaceId, 'owner-1', 'Test', 'test', 'JC-1');

    const sess = sessionRepo.create({ workspaceId, name: 'sess-1' });
    sessionId = sess.id;

    const r = makeRegistry();
    registry = r.registry;
    registryCalls = r.calls;
    service = createSessionSettingsService({
      sessionRepository: sessionRepo,
      workspaceRepository: workspaceRepo,
      registry,
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('readSettings', () => {
    it('returns built-in prompt source and defaults when no metadata or workspace prompt is set', () => {
      const dto = service.readSettings(sessionId);
      expect(dto.sessionId).toBe(sessionId);
      expect(dto.workspaceId).toBe(workspaceId);
      expect(dto.tts).toEqual({ enabled: true, outputDeviceId: null });
      expect(dto.inputMode).toBe('unified');
      expect(dto.autoSubmit).toBe(true);
      expect(dto.verboseSttLogging).toBe(false);
      expect(dto.agentPrompt.source).toBe('builtin');
      expect(typeof dto.agentPrompt.effective).toBe('string');
      expect(dto.agentPrompt.effective.length).toBeGreaterThan(0);
    });

    it('returns workspace-default source when default_agent_prompt is set', () => {
      workspaceRepo.updateSettings(workspaceId, { defaultAgentPrompt: 'WS PROMPT' });
      const dto = service.readSettings(sessionId);
      expect(dto.agentPrompt.source).toBe('workspace-default');
      expect(dto.agentPrompt.effective).toBe('WS PROMPT');
    });

    it('throws SessionNotFoundError for unknown id', () => {
      expect(() => service.readSettings('nope')).toThrow(SessionNotFoundError);
    });
  });

  describe('applyPatch — TTS', () => {
    it('persists and broadcasts both legacy and snapshot messages', () => {
      const dto = service.applyPatch(sessionId, {
        tts: { enabled: false, outputDeviceId: 'kiosk-a' },
      });
      expect(dto.tts).toEqual({ enabled: false, outputDeviceId: 'kiosk-a' });

      const persisted = sessionRepo.findById(sessionId);
      expect(persisted?.metadata?.ttsSettings).toEqual({ enabled: false, outputDeviceId: 'kiosk-a' });

      expect(registryCalls).toHaveLength(2);
      expect(registryCalls[0].message.type).toBe('session-tts-settings-changed');
      expect(registryCalls[1].message.type).toBe('session-settings-changed');
      expect(registryCalls[1].message.sessionId).toBe(sessionId);
    });

    it('allows partial TTS updates (enabled only) preserving outputDeviceId', () => {
      service.applyPatch(sessionId, { tts: { enabled: false, outputDeviceId: 'kiosk-a' } });
      const dto = service.applyPatch(sessionId, { tts: { enabled: true } });
      expect(dto.tts).toEqual({ enabled: true, outputDeviceId: 'kiosk-a' });
    });

    it('rejects non-boolean tts.enabled', () => {
      expect(() =>
        service.applyPatch(sessionId, { tts: { enabled: 'yes' as unknown as boolean } }),
      ).toThrow(SettingsValidationError);
    });

    it('rejects non-string non-null tts.outputDeviceId', () => {
      expect(() =>
        service.applyPatch(sessionId, {
          tts: { outputDeviceId: 42 as unknown as string },
        }),
      ).toThrow(SettingsValidationError);
    });
  });

  describe('applyPatch — inputMode / autoSubmit', () => {
    it('persists inputMode', () => {
      const dto = service.applyPatch(sessionId, { inputMode: 'voice' });
      expect(dto.inputMode).toBe('voice');
      expect(sessionRepo.findById(sessionId)?.metadata?.inputMode).toBe('voice');
    });

    it('rejects unknown inputMode value', () => {
      expect(() =>
        service.applyPatch(sessionId, {
          inputMode: 'bogus' as unknown as 'voice',
        }),
      ).toThrow(SettingsValidationError);
    });

    it('persists autoSubmit', () => {
      const dto = service.applyPatch(sessionId, { autoSubmit: false });
      expect(dto.autoSubmit).toBe(false);
      expect(sessionRepo.findById(sessionId)?.metadata?.autoSubmit).toBe(false);
    });

    it('rejects non-boolean autoSubmit', () => {
      expect(() =>
        service.applyPatch(sessionId, { autoSubmit: 1 as unknown as boolean }),
      ).toThrow(SettingsValidationError);
    });
  });

  describe('applyPatch — verboseSttLogging (#470)', () => {
    it('defaults to false on a fresh session', () => {
      const dto = service.readSettings(sessionId);
      expect(dto.verboseSttLogging).toBe(false);
    });

    it('persists true and surfaces it on the DTO', () => {
      const dto = service.applyPatch(sessionId, { verboseSttLogging: true });
      expect(dto.verboseSttLogging).toBe(true);
      expect(sessionRepo.findById(sessionId)?.metadata?.verboseSttLogging).toBe(true);
    });

    it('persists false (operator turning the firehose off)', () => {
      service.applyPatch(sessionId, { verboseSttLogging: true });
      const dto = service.applyPatch(sessionId, { verboseSttLogging: false });
      expect(dto.verboseSttLogging).toBe(false);
      expect(sessionRepo.findById(sessionId)?.metadata?.verboseSttLogging).toBe(false);
    });

    it('leaves the value untouched when the field is absent from a patch', () => {
      service.applyPatch(sessionId, { verboseSttLogging: true });
      const dto = service.applyPatch(sessionId, { autoSubmit: false });
      expect(dto.verboseSttLogging).toBe(true);
      expect(dto.autoSubmit).toBe(false);
    });

    it('rejects non-boolean verboseSttLogging', () => {
      expect(() =>
        service.applyPatch(sessionId, {
          verboseSttLogging: 'yes' as unknown as boolean,
        }),
      ).toThrow(SettingsValidationError);
    });

    it('rejects null verboseSttLogging', () => {
      expect(() =>
        service.applyPatch(sessionId, {
          verboseSttLogging: null as unknown as boolean,
        }),
      ).toThrow(SettingsValidationError);
    });

    it('broadcasts the snapshot message with the new field included', () => {
      service.applyPatch(sessionId, { verboseSttLogging: true });
      // Only the snapshot message fires for non-TTS patches (the legacy
      // `session-tts-settings-changed` is TTS-only).
      const snapshots = registryCalls.filter(
        (c) => c.message.type === 'session-settings-changed',
      );
      expect(snapshots).toHaveLength(1);
      const settings = snapshots[0].message.settings as {
        verboseSttLogging: boolean;
      };
      expect(settings.verboseSttLogging).toBe(true);
    });
  });

  describe('applyPatch — agentPrompt', () => {
    it('stores per-session override and reports source=session', () => {
      const dto = service.applyPatch(sessionId, { agentPrompt: 'SESS PROMPT' });
      expect(dto.agentPrompt.source).toBe('session');
      expect(dto.agentPrompt.effective).toBe('SESS PROMPT');
      expect(sessionRepo.findById(sessionId)?.metadata?.agentPrompt).toBe('SESS PROMPT');
    });

    it('overrides the workspace default when both are set', () => {
      workspaceRepo.updateSettings(workspaceId, { defaultAgentPrompt: 'WS PROMPT' });
      const dto = service.applyPatch(sessionId, { agentPrompt: 'SESS PROMPT' });
      expect(dto.agentPrompt.source).toBe('session');
      expect(dto.agentPrompt.effective).toBe('SESS PROMPT');
    });

    it('clearing with null falls back to workspace default', () => {
      workspaceRepo.updateSettings(workspaceId, { defaultAgentPrompt: 'WS PROMPT' });
      service.applyPatch(sessionId, { agentPrompt: 'OVERRIDE' });
      const dto = service.applyPatch(sessionId, { agentPrompt: null });
      expect(dto.agentPrompt.source).toBe('workspace-default');
      expect(dto.agentPrompt.effective).toBe('WS PROMPT');
      expect(sessionRepo.findById(sessionId)?.metadata?.agentPrompt).toBeUndefined();
    });

    it('rejects non-string non-null agentPrompt', () => {
      expect(() =>
        service.applyPatch(sessionId, { agentPrompt: 42 as unknown as string }),
      ).toThrow(SettingsValidationError);
    });

    it('rejects agentPrompt over the size limit', () => {
      const tooLong = 'a'.repeat(MAX_AGENT_PROMPT_LENGTH + 1);
      expect(() => service.applyPatch(sessionId, { agentPrompt: tooLong })).toThrow(
        SettingsValidationError,
      );
    });
  });

  describe('applyPatch — unknown fields / shape', () => {
    it('rejects unknown top-level keys', () => {
      expect(() =>
        service.applyPatch(
          sessionId,
          { foo: 'bar' } as unknown as Parameters<SessionSettingsService['applyPatch']>[1],
        ),
      ).toThrow(SettingsValidationError);
    });

    it('does not broadcast legacy TTS message when only inputMode changes', () => {
      service.applyPatch(sessionId, { inputMode: 'voice' });
      // Only the new snapshot message should fire, not the legacy one.
      expect(registryCalls.find((c) => c.message.type === 'session-tts-settings-changed'))
        .toBeUndefined();
      expect(registryCalls.some((c) => c.message.type === 'session-settings-changed'))
        .toBe(true);
    });

    it('preserves unrelated metadata fields (aiConversationId)', () => {
      sessionRepo.update(sessionId, {
        metadata: { aiConversationId: 'oh-conv-abc' },
      });
      service.applyPatch(sessionId, { inputMode: 'voice' });
      const meta = sessionRepo.findById(sessionId)?.metadata;
      expect(meta?.aiConversationId).toBe('oh-conv-abc');
      expect(meta?.inputMode).toBe('voice');
    });

    it('throws SessionNotFoundError for unknown id', () => {
      expect(() => service.applyPatch('nope', { autoSubmit: false })).toThrow(
        SessionNotFoundError,
      );
    });
  });

  describe('headless mode (no registry)', () => {
    it('still persists when no registry is supplied', () => {
      const headless = createSessionSettingsService({
        sessionRepository: sessionRepo,
        workspaceRepository: workspaceRepo,
      });
      const dto = headless.applyPatch(sessionId, { autoSubmit: false });
      expect(dto.autoSubmit).toBe(false);
      expect(sessionRepo.findById(sessionId)?.metadata?.autoSubmit).toBe(false);
    });
  });
});
