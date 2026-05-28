import type { Migration } from '../migrator.js';

/**
 * Migration 015: Kiosk footer tickers workspace setting (issue #340)
 *
 * Adds a boolean column gating the new bottom-of-screen transcription &
 * AI-action ticker strips on the kiosk display.
 *
 * Columns added:
 * - kiosk_footer_tickers_enabled: INTEGER, default 0 (off)
 *
 * The default is OFF so that workspaces that upgrade across this migration
 * see no visual change beyond the unconditional connection-dot relocation.
 *
 * Down recreates `workspace_settings` to drop the new column, which permanently
 * loses the ticker preference for every workspace. Require explicit
 * --confirm-destructive to roll back (same pattern as 011_elevenlabs).
 */
export const migration: Migration = {
  version: 15,
  name: 'kiosk_footer_tickers',
  destructive: true,

  up: `
    -- Add ticker-enabled flag (default: disabled to preserve current UX).
    ALTER TABLE workspace_settings
      ADD COLUMN kiosk_footer_tickers_enabled INTEGER NOT NULL DEFAULT 0;
  `,

  down: `
    -- SQLite < 3.35 cannot DROP COLUMN, so recreate the table without the
    -- new column (mirrors the 011_elevenlabs rollback strategy).
    CREATE TABLE workspace_settings_backup AS SELECT
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      updated_at
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
      updated_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    INSERT INTO workspace_settings (
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      updated_at
    )
    SELECT
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      updated_at
    FROM workspace_settings_backup;
    DROP TABLE workspace_settings_backup;
  `,
};
