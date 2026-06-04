import type { Migration } from '../migrator.js';

/**
 * Migration 016: Workspace-level default agent system prompt (issue #378)
 *
 * Adds a nullable text column on `workspace_settings` that holds the
 * workspace-wide override for the agent system prompt. When NULL the
 * server falls back to the built-in `server/prompts/system-prompt.md`.
 * A per-session override (stored in the JSON `sessions.metadata` column
 * — no schema change) takes precedence over this workspace default.
 *
 * The new column is nullable with no default so the migration is fully
 * additive for existing rows — every existing workspace continues to use
 * the built-in prompt until an owner explicitly sets one.
 *
 * Down recreates `workspace_settings` to drop the new column, which
 * permanently loses the workspace-default prompt for every workspace.
 * Mirrors the rollback strategy of 011_elevenlabs and 015_kiosk_footer_tickers.
 */
export const migration: Migration = {
  version: 16,
  name: 'default_agent_prompt',
  destructive: true,

  up: `
    -- Workspace-default agent system prompt. NULL = use built-in prompt.
    ALTER TABLE workspace_settings
      ADD COLUMN default_agent_prompt TEXT;
  `,

  down: `
    -- SQLite < 3.35 cannot DROP COLUMN, so recreate the table without the
    -- new column. Carry every column added by migrations 001..015 forward
    -- so that downgrading from v16 to v15 preserves existing settings.
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
