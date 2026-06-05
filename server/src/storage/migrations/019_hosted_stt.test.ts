import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../migrator.js';
import { migrations } from './index.js';

/**
 * Verifies migration 019 (hosted_stt) is additive against the existing
 * schema, defaults `stt_engine` to 'web-speech' for existing rows, and
 * is fully round-trippable. Mirrors the 016/017 test structure.
 *
 * Issue: #386
 */
describe('migration 019: hosted_stt', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  async function migrateAll() {
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateUp();
  }

  function getColumns(table: string): string[] {
    const rows = db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  function tableExists(name: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
    return row !== undefined;
  }

  function seed(workspaceId: string): void {
    db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
      .run('u1', 1, 'alice');
    db.prepare(`INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`)
      .run(workspaceId, 'u1', 'WS', workspaceId);
  }

  it('adds the five workspace_settings columns and the two new tables', async () => {
    await migrateAll();

    const cols = getColumns('workspace_settings');
    expect(cols).toContain('stt_engine');
    expect(cols).toContain('stt_monthly_minute_cap');
    expect(cols).toContain('deepgram_api_key_encrypted');
    expect(cols).toContain('deepgram_api_key_iv');
    expect(cols).toContain('deepgram_api_key_tag');

    expect(tableExists('session_engine_speakers')).toBe(true);
    expect(tableExists('workspace_stt_usage')).toBe(true);
  });

  it("defaults stt_engine to 'web-speech' for existing rows", async () => {
    await migrateAll();
    seed('ws1');
    db.prepare(`INSERT INTO workspace_settings (workspace_id) VALUES (?)`).run('ws1');
    const row = db
      .prepare(
        `SELECT stt_engine, stt_monthly_minute_cap, deepgram_api_key_encrypted
         FROM workspace_settings WHERE workspace_id = ?`,
      )
      .get('ws1') as {
        stt_engine: string;
        stt_monthly_minute_cap: number | null;
        deepgram_api_key_encrypted: string | null;
      };
    expect(row.stt_engine).toBe('web-speech');
    expect(row.stt_monthly_minute_cap).toBeNull();
    expect(row.deepgram_api_key_encrypted).toBeNull();
  });

  it('preserves columns from earlier migrations', async () => {
    await migrateAll();
    const cols = getColumns('workspace_settings');
    for (const c of [
      'openhands_api_key_encrypted',
      'tts_voice',
      'allow_auto_join',
      'require_qr_token',
      'elevenlabs_voice_id',
      'elevenlabs_tts_enabled',
      'kiosk_footer_tickers_enabled',
      'default_agent_prompt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('session_engine_speakers enforces composite primary key', async () => {
    await migrateAll();
    seed('ws1');
    db.prepare(`INSERT INTO sessions (id, workspace_id) VALUES (?, ?)`).run('s1', 'ws1');
    db.prepare(`INSERT INTO devices (id, workspace_id, name, mode) VALUES (?, ?, ?, ?)`)
      .run('d1', 'ws1', 'Kiosk', 'kiosk');

    const insert = db.prepare(
      `INSERT INTO session_engine_speakers
         (session_id, device_id, engine_label, speaker_id)
       VALUES (?, ?, ?, NULL)`,
    );
    insert.run('s1', 'd1', 'S1');
    expect(() => insert.run('s1', 'd1', 'S1')).toThrow();
    // Different label on the same (session, device) is allowed.
    expect(() => insert.run('s1', 'd1', 'S2')).not.toThrow();
  });

  it('workspace_stt_usage accepts REAL minutes_used', async () => {
    await migrateAll();
    seed('ws1');
    db.prepare(
      `INSERT INTO workspace_stt_usage (workspace_id, month, minutes_used) VALUES (?, ?, ?)`,
    ).run('ws1', '2026-06', 12.5);
    const row = db
      .prepare(
        `SELECT minutes_used FROM workspace_stt_usage WHERE workspace_id = ? AND month = ?`,
      )
      .get('ws1', '2026-06') as { minutes_used: number };
    expect(row.minutes_used).toBeCloseTo(12.5);
  });

  it('cascades workspace_stt_usage rows when the workspace is deleted', async () => {
    await migrateAll();
    db.pragma('foreign_keys = ON');
    seed('ws1');
    db.prepare(
      `INSERT INTO workspace_stt_usage (workspace_id, month, minutes_used) VALUES (?, ?, ?)`,
    ).run('ws1', '2026-06', 1);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run('ws1');
    const remaining = db
      .prepare(`SELECT COUNT(*) as n FROM workspace_stt_usage`)
      .get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('round-trips: up -> down -> up preserves elevenlabs + footer-ticker data', async () => {
    await migrateAll();
    seed('ws1');
    db.prepare(
      `INSERT INTO workspace_settings
         (workspace_id, allow_auto_join, kiosk_footer_tickers_enabled,
          elevenlabs_voice_id, elevenlabs_tts_enabled, stt_engine,
          stt_monthly_minute_cap, deepgram_api_key_encrypted,
          deepgram_api_key_iv, deepgram_api_key_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ws1',
      0,
      1,
      'voice-id-xyz',
      1,
      'deepgram',
      1000,
      'enc',
      'iv',
      'tag',
    );

    const migrator = new Migrator({ db, migrations });
    const downRes = await migrator.migrateTo(18);
    expect(downRes.direction).toBe('down');
    expect(getColumns('workspace_settings')).not.toContain('stt_engine');
    expect(getColumns('workspace_settings')).not.toContain('deepgram_api_key_encrypted');
    expect(tableExists('session_engine_speakers')).toBe(false);
    expect(tableExists('workspace_stt_usage')).toBe(false);

    // Non-STT settings survive the down half.
    const survived = db
      .prepare(
        `SELECT allow_auto_join, kiosk_footer_tickers_enabled,
                elevenlabs_voice_id, elevenlabs_tts_enabled
         FROM workspace_settings WHERE workspace_id = ?`,
      )
      .get('ws1') as {
        allow_auto_join: number;
        kiosk_footer_tickers_enabled: number;
        elevenlabs_voice_id: string;
        elevenlabs_tts_enabled: number;
      };
    expect(survived.allow_auto_join).toBe(0);
    expect(survived.kiosk_footer_tickers_enabled).toBe(1);
    expect(survived.elevenlabs_voice_id).toBe('voice-id-xyz');
    expect(survived.elevenlabs_tts_enabled).toBe(1);

    // Re-applying 019 brings the columns back as nullable / default.
    await migrator.migrateTo(19);
    expect(getColumns('workspace_settings')).toContain('stt_engine');
    const restored = db
      .prepare(
        `SELECT stt_engine, stt_monthly_minute_cap FROM workspace_settings
         WHERE workspace_id = ?`,
      )
      .get('ws1') as { stt_engine: string; stt_monthly_minute_cap: number | null };
    expect(restored.stt_engine).toBe('web-speech');
    expect(restored.stt_monthly_minute_cap).toBeNull();
  });

  it('is idempotent against a second migrateUp()', async () => {
    await migrateAll();
    await expect(migrateAll()).resolves.not.toThrow();
    const sttEngineColumns = getColumns('workspace_settings').filter(
      (c) => c === 'stt_engine',
    );
    expect(sttEngineColumns).toHaveLength(1);
  });
});
