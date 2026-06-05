/**
 * Tests for the per-session system-prompt resolver (issue #378).
 *
 * Verifies the precedence ladder: per-session > workspace-default >
 * built-in `system-prompt.md`. Also verifies the prompt substitutions
 * (`{{workspaceId}}` / `{{sessionId}}` / `{{displayLines}}`) are applied
 * regardless of which layer wins so downstream agent code sees a fully
 * rendered prompt.
 */
import { describe, it, expect } from 'vitest';
import { resolveSessionSystemPrompt } from './openhands.js';
import type { SessionMetadata } from './sessions/types.js';
import type { WorkspaceSettings } from './workspaces/types.js';

const baseWorkspaceSettings = (): WorkspaceSettings => ({
  workspaceId: 'ws-1',
  openhandsApiKeyEncrypted: null,
  openhandsApiKeyIv: null,
  openhandsApiKeyTag: null,
  ttsVoice: null,
  sttLanguage: null,
  allowAutoJoin: false,
  requireQrToken: false,
  elevenlabsApiKeyEncrypted: null,
  elevenlabsApiKeyIv: null,
  elevenlabsApiKeyTag: null,
  elevenlabsVoiceId: null,
  elevenlabsTtsEnabled: false,
  kioskFooterTickersEnabled: false,
  defaultAgentPrompt: null,
  sttEngine: 'web-speech',
  sttMonthlyMinuteCap: null,
  deepgramApiKeyEncrypted: null,
  deepgramApiKeyIv: null,
  deepgramApiKeyTag: null,
  updatedAt: null,
});

describe('resolveSessionSystemPrompt', () => {
  it('returns source=builtin when neither override is set', () => {
    const out = resolveSessionSystemPrompt({
      sessionMetadata: null,
      workspaceSettings: baseWorkspaceSettings(),
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    expect(out.source).toBe('builtin');
    expect(out.effective.length).toBeGreaterThan(0);
  });

  it('returns source=workspace-default when workspace prompt is set', () => {
    const ws = { ...baseWorkspaceSettings(), defaultAgentPrompt: 'WS prompt' };
    const out = resolveSessionSystemPrompt({
      sessionMetadata: null,
      workspaceSettings: ws,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    expect(out.source).toBe('workspace-default');
    expect(out.effective).toBe('WS prompt');
  });

  it('returns source=session when session prompt is set, overriding workspace default', () => {
    const ws = { ...baseWorkspaceSettings(), defaultAgentPrompt: 'WS prompt' };
    const meta: SessionMetadata = { agentPrompt: 'SESS prompt' };
    const out = resolveSessionSystemPrompt({
      sessionMetadata: meta,
      workspaceSettings: ws,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    expect(out.source).toBe('session');
    expect(out.effective).toBe('SESS prompt');
  });

  it('treats empty-string session prompt as "no override"', () => {
    const ws = { ...baseWorkspaceSettings(), defaultAgentPrompt: 'WS prompt' };
    const meta: SessionMetadata = { agentPrompt: '' };
    const out = resolveSessionSystemPrompt({
      sessionMetadata: meta,
      workspaceSettings: ws,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    expect(out.source).toBe('workspace-default');
    expect(out.effective).toBe('WS prompt');
  });

  it('applies template substitutions on the session prompt', () => {
    const meta: SessionMetadata = {
      agentPrompt: 'WS={{WORKSPACE_ID}}; SESS={{SESSION_ID}}; URL={{SERVER_URL}}',
    };
    const out = resolveSessionSystemPrompt({
      sessionMetadata: meta,
      workspaceSettings: null,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    expect(out.effective).toContain('WS=ws-1');
    expect(out.effective).toContain('SESS=sess-1');
    // SERVER_URL substitution should turn the placeholder into a URL.
    expect(out.effective).not.toContain('{{SERVER_URL}}');
  });

  it('applies the displayLines substitution on the workspace-default prompt', () => {
    const ws = {
      ...baseWorkspaceSettings(),
      defaultAgentPrompt: 'Maximum 10-12 lines of body text only.',
    };
    const out = resolveSessionSystemPrompt({
      sessionMetadata: null,
      workspaceSettings: ws,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      displayLines: 30,
    });
    expect(out.effective).toBe('Maximum 30 lines of body text only.');
  });

  it('tolerates a null workspaceSettings', () => {
    const out = resolveSessionSystemPrompt({
      sessionMetadata: null,
      workspaceSettings: null,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
    });
    expect(out.source).toBe('builtin');
    expect(out.effective.length).toBeGreaterThan(0);
  });
});
