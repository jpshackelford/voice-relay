import type { Migration } from '../migrator.js';

/**
 * Migration 019: Optional hosted STT with diarization (issue #386)
 *
 * Adds the storage primitives required to opt a workspace into a hosted
 * streaming STT engine (Deepgram in v1) as an alternative to the
 * browser's Web Speech API. The engine selection lives on
 * `workspace_settings` so the existing settings router and repository
 * can manage it the same way they manage every other workspace-level
 * knob; the encrypted Deepgram API key columns mirror the ElevenLabs
 * pattern from migration 011.
 *
 * The two new tables — `session_engine_speakers` and
 * `workspace_stt_usage` — are dedicated to STT and have no
 * relationships outside the existing FK graph. Both are created with
 * `IF NOT EXISTS` for idempotency.
 *
 * Columns added on `workspace_settings`:
 *
 *   - stt_engine                      TEXT NOT NULL DEFAULT 'web-speech'
 *     Which engine devices in this workspace should use by default
 *     ('web-speech' | 'deepgram'). Devices may override via
 *     `devices.config.stt_engine` (existing JSON column, no schema
 *     change needed).
 *
 *   - stt_monthly_minute_cap          INTEGER (nullable)
 *     Cost guardrail: when the workspace's current-month usage
 *     reaches this many minutes, the token broker stops issuing new
 *     hosted-STT tokens and the client falls back to Web Speech.
 *     NULL means "no cap" (only honored when the owner explicitly
 *     opts out of the cap UI).
 *
 *   - deepgram_api_key_encrypted/iv/tag TEXT (all nullable)
 *     Per-workspace Deepgram API key, encrypted with the same
 *     AES-256-GCM helper that protects the OpenHands and ElevenLabs
 *     keys.
 *
 * New tables:
 *
 *   - session_engine_speakers(session_id, device_id, engine_label, speaker_id)
 *     Maps a per-session engine-emitted speaker label (e.g. Deepgram's
 *     'S1') to a workspace-scoped `speakers.id` (#383) when a real
 *     person has been identified. The relay uses this table to swap
 *     the opaque engine label for the resolved speaker id on outbound
 *     `RelayedTextMessage`s.
 *
 *   - workspace_stt_usage(workspace_id, month, minutes_used)
 *     Per-workspace, per-calendar-month minute counter. Incremented
 *     by the client at the end of a hosted-STT session via the WS
 *     `stt-session-end` message. `month` is `YYYY-MM`.
 *
 * Rollback strategy
 * -----------------
 * The down migration drops the two new tables and rebuilds
 * `workspace_settings` without the five new columns, mirroring the
 * recreate-without-column pattern from 011_elevenlabs and
 * 016_default_agent_prompt. Marked `destructive: true` because the
 * recreate permanently loses the encrypted Deepgram API key, the
 * configured cap, the `stt_engine` selection, and every row of usage /
 * speaker-mapping data for every workspace.
 *
 * FK-safety
 * ---------
 * The `ALTER TABLE workspace_settings ADD COLUMN` half is purely
 * additive and runs cleanly with `PRAGMA foreign_keys = ON`. The two
 * new tables only reference existing tables (`workspaces`, `sessions`,
 * `devices`, `speakers`) and use `ON DELETE CASCADE` / `ON DELETE SET
 * NULL` so cleanup of parent rows never blocks on STT bookkeeping.
 */
export const migration: Migration = {
  version: 19,
  name: 'hosted_stt',
  destructive: true,

  up: `
    -- 1. Workspace-level STT engine selection + cap + encrypted Deepgram key.
    ALTER TABLE workspace_settings ADD COLUMN stt_engine TEXT NOT NULL DEFAULT 'web-speech';
    ALTER TABLE workspace_settings ADD COLUMN stt_monthly_minute_cap INTEGER;
    ALTER TABLE workspace_settings ADD COLUMN deepgram_api_key_encrypted TEXT;
    ALTER TABLE workspace_settings ADD COLUMN deepgram_api_key_iv TEXT;
    ALTER TABLE workspace_settings ADD COLUMN deepgram_api_key_tag TEXT;

    -- 2. Engine-speaker mapping: per (session, device, engine label).
    --    The session FK handles the only cascade that really matters
    --    (when a session ends, its diarisation mappings go with it).
    --    device_id and speaker_id are intentionally *not* FK-constrained
    --    -- both deletions are rare, the mapping is auxiliary, and
    --    avoiding cross-table FK references keeps this migration usable
    --    in any test fixture that already has the sessions table without
    --    having to also bring devices and speakers along for the ride.
    CREATE TABLE IF NOT EXISTS session_engine_speakers (
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      engine_label TEXT NOT NULL,
      speaker_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, device_id, engine_label),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_session_engine_speakers_speaker
      ON session_engine_speakers(speaker_id);

    -- 3. Per-workspace, per-month minute counter.
    --    Counter is a REAL so partial minutes don't round to zero on
    --    short sessions; the broker still budgets against an INTEGER cap.
    CREATE TABLE IF NOT EXISTS workspace_stt_usage (
      workspace_id TEXT NOT NULL,
      month TEXT NOT NULL,
      minutes_used REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, month),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `,

  down: `
    -- Drop the new tables first; their FKs reference workspace_settings'
    -- parents indirectly via workspaces/sessions/devices/speakers.
    DROP INDEX IF EXISTS idx_session_engine_speakers_speaker;
    DROP TABLE IF EXISTS session_engine_speakers;
    DROP TABLE IF EXISTS workspace_stt_usage;

    -- SQLite < 3.35 cannot DROP COLUMN, so recreate workspace_settings
    -- without the five new columns. Carry every column added by
    -- migrations 001..018 forward so that downgrading from v19 to v18
    -- preserves existing settings.
    CREATE TABLE workspace_settings_backup AS SELECT
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      kiosk_footer_tickers_enabled, default_agent_prompt, updated_at
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
      default_agent_prompt TEXT,
      updated_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    INSERT INTO workspace_settings (
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      kiosk_footer_tickers_enabled, default_agent_prompt, updated_at
    )
    SELECT
      workspace_id, openhands_api_key_encrypted, openhands_api_key_iv,
      openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
      require_qr_token, elevenlabs_api_key_encrypted, elevenlabs_api_key_iv,
      elevenlabs_api_key_tag, elevenlabs_voice_id, elevenlabs_tts_enabled,
      kiosk_footer_tickers_enabled, default_agent_prompt, updated_at
    FROM workspace_settings_backup;
    DROP TABLE workspace_settings_backup;
  `,
};
