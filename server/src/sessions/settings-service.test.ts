import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionRepository } from './session-repository.js';
import { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import {
  applyPatch,
  buildSettingsDto,
  mergePatchIntoMetadata,
  resolveSessionSystemPrompt,
  validatePatch,
  AGENT_PROMPT_MAX_LENGTH,
} from './settings-service.js';
import type { DeviceRegistry } from '../registry.js';
import type { SessionMetadata } from './types.js';
import { Migrator } from '../storage/migrator.js';
import { migrations } from '../storage/migrations/index.js';

function makeRegistry(): DeviceRegistry {
  return {
    broadcastMessageToSession: vi.fn(),
  } as unknown as DeviceRegistry;
}

describe('settings-service', () => {
  describe('validatePatch', () => {
    it('rejects non-object input', () => {
      expect(validatePatch(null)).toEqual({ ok: false, error: expect.any(String) });
      expect(validatePatch('hello')).toEqual({ ok: false, error: expect.any(String) });
      expect(validatePatch([])).toEqual({ ok: false, error: expect.any(String) });
    });

    it('accepts empty object (no-op patch)', () => {
      expect(validatePatch({})).toEqual({ ok: true });
    });

    it('rejects unknown top-level keys', () => {
      const result = validatePatch({ flairColor: 'red' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unknown field: flairColor');
      }
    });

    it('rejects unknown tts sub-keys', () => {
      const result = validatePatch({ tts: { volume: 11 } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unknown tts field: volume');
      }
    });

    it('rejects invalid inputMode enum', () => {
      const result = validatePatch({ inputMode: 'megamode' });
      expect(result.ok).toBe(false);
    });

    it('accepts each inputMode option', () => {
      for (const mode of ['voice', 'unified', 'visualizer']) {
        expect(validatePatch({ inputMode: mode })).toEqual({ ok: true });
      }
    });

    it('rejects non-boolean autoSubmit', () => {
      expect(validatePatch({ autoSubmit: 'yes' }).ok).toBe(false);
    });

    it('rejects oversize agentPrompt', () => {
      const big = 'x'.repeat(AGENT_PROMPT_MAX_LENGTH + 1);
      const result = validatePatch({ agentPrompt: big });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(`${AGENT_PROMPT_MAX_LENGTH}`);
      }
    });

    it('rejects empty string agentPrompt (must use null)', () => {
      const result = validatePatch({ agentPrompt: '' });
      expect(result.ok).toBe(false);
    });

    it('accepts null agentPrompt (clear override)', () => {
      expect(validatePatch({ agentPrompt: null })).toEqual({ ok: true });
    });

    it('rejects non-string non-null agentPrompt', () => {
      expect(validatePatch({ agentPrompt: 42 }).ok).toBe(false);
    });

    it('rejects non-boolean tts.enabled', () => {
      expect(validatePatch({ tts: { enabled: 'true' } }).ok).toBe(false);
    });

    it('rejects non-string non-null tts.outputDeviceId', () => {
      expect(validatePatch({ tts: { outputDeviceId: 0 } }).ok).toBe(false);
    });

    it('accepts a full valid patch', () => {
      expect(
        validatePatch({
          tts: { enabled: true, outputDeviceId: null },
          inputMode: 'unified',
          autoSubmit: false,
          agentPrompt: 'Be terse.',
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('mergePatchIntoMetadata', () => {
    it('preserves unrelated metadata fields on partial patch', () => {
      const existing: SessionMetadata = {
        aiConversationId: 'conv-1',
        displayContent: { type: 'markdown', content: '# Hi' },
      };
      const { metadata } = mergePatchIntoMetadata(existing, {
        inputMode: 'voice',
      });
      expect(metadata.aiConversationId).toBe('conv-1');
      expect(metadata.displayContent).toEqual({ type: 'markdown', content: '# Hi' });
      expect(metadata.inputMode).toBe('voice');
    });

    it('sets ttsChanged only when tts patch present', () => {
      expect(
        mergePatchIntoMetadata(null, { inputMode: 'voice' }).ttsChanged,
      ).toBe(false);
      expect(
        mergePatchIntoMetadata(null, { tts: { enabled: true } }).ttsChanged,
      ).toBe(true);
    });

    it('partial tts patch merges with existing tts', () => {
      const { metadata } = mergePatchIntoMetadata(
        { ttsSettings: { enabled: true, outputDeviceId: 'dev-1' } },
        { tts: { enabled: false } },
      );
      expect(metadata.ttsSettings).toEqual({
        enabled: false,
        outputDeviceId: 'dev-1',
      });
    });

    it('null agentPrompt deletes the override', () => {
      const { metadata } = mergePatchIntoMetadata(
        { agentPrompt: 'old' },
        { agentPrompt: null },
      );
      expect(metadata.agentPrompt).toBeUndefined();
    });
  });

  describe('buildSettingsDto', () => {
    it('reports source=session when override is set', () => {
      const dto = buildSettingsDto('s1', 'w1', { agentPrompt: 'sess' }, 'ws-default');
      expect(dto.agentPrompt).toEqual({ effective: 'sess', source: 'session' });
    });

    it('reports source=workspace-default when only workspace prompt set', () => {
      const dto = buildSettingsDto('s1', 'w1', {}, 'ws-default');
      expect(dto.agentPrompt).toEqual({
        effective: 'ws-default',
        source: 'workspace-default',
      });
    });

    it('reports source=builtin when neither is set', () => {
      const dto = buildSettingsDto('s1', 'w1', {}, null);
      expect(dto.agentPrompt).toEqual({ effective: null, source: 'builtin' });
    });

    it('exposes tts default {enabled:false, outputDeviceId:null} when unset', () => {
      const dto = buildSettingsDto('s1', 'w1', null, null);
      expect(dto.tts).toEqual({ enabled: false, outputDeviceId: null });
      expect(dto.inputMode).toBeNull();
      expect(dto.autoSubmit).toBeNull();
    });
  });

  describe('applyPatch — integration with real repos', () => {
    let db: Database.Database;
    let sessionRepository: SessionRepository;
    let workspaceRepository: WorkspaceRepository;
    let registry: DeviceRegistry;
    let workspaceId: string;
    let sessionId: string;

    beforeEach(async () => {
      db = new Database(':memory:');
      const migrator = new Migrator({ db, migrations });
      await migrator.migrateUp();

      sessionRepository = new SessionRepository(db);
      workspaceRepository = new WorkspaceRepository(db);

      db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
        .run('u1', 1, 'alice');
      workspaceId = 'ws-1';
      db.prepare(`INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`)
        .run(workspaceId, 'u1', 'WS', 'ws-1');
      sessionId = sessionRepository.create({ workspaceId, name: 's1' }).id;

      registry = makeRegistry();
    });

    afterEach(() => {
      db.close();
    });

    it('returns 404 when session does not exist', () => {
      const result = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        'no-such-session',
        { tts: { enabled: true } },
      );
      expect(result).toEqual({ ok: false, status: 404, error: 'Session not found' });
    });

    it('returns 400 on validation error', () => {
      const result = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        sessionId,
        { tts: { enabled: 'yes' } },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }
    });

    it('persists TTS update and broadcasts both legacy and snapshot messages', () => {
      const result = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        sessionId,
        { tts: { enabled: true, outputDeviceId: 'dev-A' } },
      );
      expect(result.ok).toBe(true);

      const session = sessionRepository.findById(sessionId);
      expect(session?.metadata?.ttsSettings).toEqual({
        enabled: true,
        outputDeviceId: 'dev-A',
      });

      const broadcast = registry.broadcastMessageToSession as ReturnType<typeof vi.fn>;
      const types = broadcast.mock.calls.map(
        (c) => (c[1] as { type?: string }).type,
      );
      expect(types).toContain('session-tts-settings-changed');
      expect(types).toContain('session-settings-changed');
    });

    it('non-tts patch broadcasts only session-settings-changed', () => {
      const result = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        sessionId,
        { inputMode: 'voice' },
      );
      expect(result.ok).toBe(true);

      const broadcast = registry.broadcastMessageToSession as ReturnType<typeof vi.fn>;
      const types = broadcast.mock.calls.map(
        (c) => (c[1] as { type?: string }).type,
      );
      expect(types).not.toContain('session-tts-settings-changed');
      expect(types).toContain('session-settings-changed');
    });

    it('writing then clearing agentPrompt round-trips through GET shape', () => {
      const set = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        sessionId,
        { agentPrompt: 'Custom prompt.' },
      );
      expect(set.ok).toBe(true);
      if (set.ok) {
        expect(set.settings.agentPrompt).toEqual({
          effective: 'Custom prompt.',
          source: 'session',
        });
      }

      const clear = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        sessionId,
        { agentPrompt: null },
      );
      expect(clear.ok).toBe(true);
      if (clear.ok) {
        // Workspace default not set; expect builtin source.
        expect(clear.settings.agentPrompt.source).toBe('builtin');
      }
    });

    it('falls back to workspace default when session override is null', () => {
      workspaceRepository.updateSettings(workspaceId, {
        defaultAgentPrompt: 'WS default prompt',
      });

      const result = applyPatch(
        { sessionRepository, workspaceRepository, registry },
        sessionId,
        { agentPrompt: null },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.agentPrompt).toEqual({
          effective: 'WS default prompt',
          source: 'workspace-default',
        });
      }
    });

    it('does not throw when registry broadcast fails', () => {
      const failingRegistry = {
        broadcastMessageToSession: vi.fn(() => {
          throw new Error('socket dead');
        }),
      } as unknown as DeviceRegistry;

      const result = applyPatch(
        { sessionRepository, workspaceRepository, registry: failingRegistry },
        sessionId,
        { tts: { enabled: true } },
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('resolveSessionSystemPrompt', () => {
    let db: Database.Database;
    let sessionRepository: SessionRepository;
    let workspaceRepository: WorkspaceRepository;
    let workspaceId: string;
    let sessionId: string;
    const applySub = vi.fn(
      (body: string) => `[subs]${body}`,
    );
    const loadBuiltin = vi.fn(() => '[builtin]');

    beforeEach(async () => {
      db = new Database(':memory:');
      const migrator = new Migrator({ db, migrations });
      await migrator.migrateUp();
      sessionRepository = new SessionRepository(db);
      workspaceRepository = new WorkspaceRepository(db);

      db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
        .run('u1', 1, 'alice');
      workspaceId = 'ws-r';
      db.prepare(`INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`)
        .run(workspaceId, 'u1', 'WS', 'ws-r');
      sessionId = sessionRepository.create({ workspaceId }).id;

      applySub.mockClear();
      loadBuiltin.mockClear();
    });

    afterEach(() => db.close());

    it('precedence: session override wins', () => {
      sessionRepository.updateMetadata(sessionId, { agentPrompt: 'sess body' });
      workspaceRepository.updateSettings(workspaceId, {
        defaultAgentPrompt: 'ws body',
      });
      const result = resolveSessionSystemPrompt({
        sessionRepository,
        workspaceRepository,
        sessionId,
        workspaceId,
        displayLines: undefined,
        applySubstitutions: applySub,
        loadBuiltinPrompt: loadBuiltin,
      });
      expect(result.source).toBe('session');
      expect(result.body).toBe('[subs]sess body');
      expect(loadBuiltin).not.toHaveBeenCalled();
    });

    it('precedence: workspace default when no session override', () => {
      workspaceRepository.updateSettings(workspaceId, {
        defaultAgentPrompt: 'ws body',
      });
      const result = resolveSessionSystemPrompt({
        sessionRepository,
        workspaceRepository,
        sessionId,
        workspaceId,
        displayLines: undefined,
        applySubstitutions: applySub,
        loadBuiltinPrompt: loadBuiltin,
      });
      expect(result.source).toBe('workspace-default');
      expect(result.body).toBe('[subs]ws body');
    });

    it('precedence: builtin when neither is set', () => {
      const result = resolveSessionSystemPrompt({
        sessionRepository,
        workspaceRepository,
        sessionId,
        workspaceId,
        displayLines: 8,
        applySubstitutions: applySub,
        loadBuiltinPrompt: loadBuiltin,
      });
      expect(result.source).toBe('builtin');
      expect(result.body).toBe('[builtin]');
      expect(loadBuiltin).toHaveBeenCalledWith(8, workspaceId, sessionId);
    });
  });
});
