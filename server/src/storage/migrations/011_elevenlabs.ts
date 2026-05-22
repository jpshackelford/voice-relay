import type { Migration } from '../migrator.js';

/**
 * Migration 011: ElevenLabs TTS settings
 * 
 * Adds columns for ElevenLabs API key and voice configuration.
 * 
 * Columns added:
 * - elevenlabs_api_key_encrypted: Encrypted API key (same pattern as OpenHands key)
 * - elevenlabs_api_key_iv: Initialization vector for AES-256-GCM
 * - elevenlabs_api_key_tag: Auth tag for AES-256-GCM
 * - elevenlabs_voice_id: Selected voice ID (default: Aria voice)
 * - elevenlabs_tts_enabled: Whether TTS is enabled (default: false)
 * 
 * Security notes:
 * - API key encrypted at rest using AES-256-GCM (same as OpenHands API key)
 * - Voice ID is not sensitive (public ElevenLabs voice identifiers)
 * - TTS disabled by default to avoid unexpected API usage
 */
export const migration: Migration = {
  version: 11,
  name: 'elevenlabs',
  // Down recreates `workspace_settings` to drop the new columns, which
  // permanently loses the encrypted ElevenLabs API key, voice selection and
  // TTS-enabled flag for every workspace. Require explicit
  // --confirm-destructive to roll back.
  destructive: true,

  up: `
    -- Add ElevenLabs API key encryption columns (same pattern as OpenHands key)
    ALTER TABLE workspace_settings ADD COLUMN elevenlabs_api_key_encrypted TEXT;
    ALTER TABLE workspace_settings ADD COLUMN elevenlabs_api_key_iv TEXT;
    ALTER TABLE workspace_settings ADD COLUMN elevenlabs_api_key_tag TEXT;
    
    -- Add voice configuration (default: Aria voice, optimized for conversational AI)
    ALTER TABLE workspace_settings ADD COLUMN elevenlabs_voice_id TEXT DEFAULT 'Xb7hH8MSUJpSbSDYk0k2';
    
    -- Add TTS enabled flag (default: disabled to avoid surprise API costs)
    ALTER TABLE workspace_settings ADD COLUMN elevenlabs_tts_enabled INTEGER DEFAULT 0;
  `,
  
  down: `
    -- SQLite doesn't support DROP COLUMN in older versions, so we recreate the table
    CREATE TABLE workspace_settings_backup AS SELECT 
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv, 
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, updated_at
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
      updated_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    INSERT INTO workspace_settings (
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, updated_at
    )
    SELECT 
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, updated_at
    FROM workspace_settings_backup;
    DROP TABLE workspace_settings_backup;
  `,
};
