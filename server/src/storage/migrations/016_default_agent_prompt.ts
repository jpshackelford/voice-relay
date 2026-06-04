import type { Migration } from '../migrator.js';

/**
 * Migration 016: Workspace default agent prompt (issue #378)
 *
 * Adds a TEXT column to `workspace_settings` holding the workspace-wide
 * default prompt body that is injected into every OpenHands conversation
 * created for sessions in this workspace. When NULL (the default), the
 * server falls back to `server/prompts/system-prompt.md`.
 *
 * Per-session overrides live on `sessions.metadata.agentPrompt` (JSON, no
 * migration needed); they take precedence over this column. See
 * `resolveSessionSystemPrompt` in `server/src/sessions/settings-service.ts`
 * for the precedence rules.
 *
 * Columns added:
 * - default_agent_prompt: TEXT, default NULL (no workspace override).
 *
 * Backward compatibility: the column defaults to NULL so existing
 * workspaces keep using the built-in system prompt. The new column does
 * not influence any code path until an operator opts in via PATCH
 * /api/workspaces/:id/settings.
 *
 * Down recreates `workspace_settings` to drop the new column (SQLite < 3.35
 * cannot DROP COLUMN). Mirrors the rollback strategy used by migrations
 * 011 and 015.
 */
export const migration: Migration = {
  version: 16,
  name: 'default_agent_prompt',
  destructive: true,

  up: `
    ALTER TABLE workspace_settings
      ADD COLUMN default_agent_prompt TEXT;
  `,

  down: `
    CREATE TABLE workspace_settings_backup AS SELECT
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      kiosk_footer_tickers_enabled, updated_at
    FROM workspace_settings;
    DROP TABLE workspace_settings;
    CREATE TABLE workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      openhands_api_key_encrypted TEXT,
      openhands_api_key_iv TEXT,
      openhands_api_key_tag TEXT,
      tts_voice TEXT,
      stt_language TEXT,
      allow_auto_join INTEGER DEFAULT 1,
      require_qr_token INTEGER DEFAULT 0,
      elevenlabs_api_key_encrypted TEXT,
      elevenlabs_api_key_iv TEXT,
      elevenlabs_api_key_tag TEXT,
      elevenlabs_voice_id TEXT DEFAULT 'Xb7hH8MSUJpSbSDYk0k2',
      elevenlabs_tts_enabled INTEGER DEFAULT 0,
      kiosk_footer_tickers_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    INSERT INTO workspace_settings (
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      kiosk_footer_tickers_enabled, updated_at
    )
    SELECT
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      kiosk_footer_tickers_enabled, updated_at
    FROM workspace_settings_backup;
    DROP TABLE workspace_settings_backup;
  `,
};
