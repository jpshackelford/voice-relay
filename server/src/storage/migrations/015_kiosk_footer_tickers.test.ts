import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../migrator.js';
import { migrations } from './index.js';

/**
 * Verifies migration 015 (kiosk footer tickers) plays nicely with the rest of
 * the chain and is round-trippable. Targets the orchestrator refinement of
 * "must be backward-compatible with existing data."
 */
describe('migration 015: kiosk_footer_tickers', () => {
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

  function getColumns(): string[] {
    const rows = db
      .prepare(`PRAGMA table_info(workspace_settings)`)
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  function insertOwnedWorkspace(id: string) {
    db.prepare(`INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)`)
      .run('u1', 1, 'alice');
    db.prepare(`INSERT INTO workspaces (id, owner_id, name, slug) VALUES (?, ?, ?, ?)`)
      .run(id, 'u1', 'WS', id);
  }

  it('adds kiosk_footer_tickers_enabled column with default 0 on fresh DB', async () => {
    await migrateAll();
    expect(getColumns()).toContain('kiosk_footer_tickers_enabled');

    insertOwnedWorkspace('ws1');
    db.prepare(`INSERT INTO workspace_settings (workspace_id) VALUES (?)`).run('ws1');
    const row = db
      .prepare(
        `SELECT kiosk_footer_tickers_enabled FROM workspace_settings WHERE workspace_id = ?`
      )
      .get('ws1') as { kiosk_footer_tickers_enabled: number };
    expect(row.kiosk_footer_tickers_enabled).toBe(0);
  });

  it('preserves elevenlabs and other existing columns', async () => {
    await migrateAll();
    const cols = getColumns();
    for (const c of [
      'elevenlabs_voice_id',
      'elevenlabs_tts_enabled',
      'allow_auto_join',
      'require_qr_token',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('rollback to v14 drops the new column without losing other settings', async () => {
    await migrateAll();
    insertOwnedWorkspace('ws1');
    db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, kiosk_footer_tickers_enabled)
      VALUES (?, ?, ?)
    `).run('ws1', 0, 1);

    const migrator = new Migrator({ db, migrations });
    const res = await migrator.migrateTo(14);
    expect(res.direction).toBe('down');
    // Rollback now traverses migrations 16 (default_agent_prompt) and
    // 15 (kiosk_footer_tickers) — both added after this test was first
    // authored.
    expect(res.count).toBe(2);

    expect(getColumns()).not.toContain('kiosk_footer_tickers_enabled');
    expect(getColumns()).not.toContain('default_agent_prompt');
    const row = db
      .prepare(`SELECT allow_auto_join FROM workspace_settings WHERE workspace_id = ?`)
      .get('ws1') as { allow_auto_join: number };
    expect(row.allow_auto_join).toBe(0);
  });

  it('is idempotent against a re-run of migrateUp()', async () => {
    await migrateAll();
    await expect(migrateAll()).resolves.not.toThrow();
    const cols = getColumns().filter((c) => c === 'kiosk_footer_tickers_enabled');
    expect(cols).toHaveLength(1);
  });

  it('round-trips: up -> down -> up restores the column at the end', async () => {
    await migrateAll();
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(14);
    expect(getColumns()).not.toContain('kiosk_footer_tickers_enabled');
    await migrator.migrateTo(15);
    expect(getColumns()).toContain('kiosk_footer_tickers_enabled');
  });
});
