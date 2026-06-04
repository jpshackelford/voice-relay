import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Migrator } from '../migrator.js';
import { migrations } from './index.js';

/**
 * Verifies migration 016 (workspace default_agent_prompt column) plays nicely
 * with the rest of the chain and is round-trippable. Mirrors the structure of
 * `015_kiosk_footer_tickers.test.ts`.
 */
describe('migration 016: default_agent_prompt', () => {
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

  it('adds default_agent_prompt column with NULL default on fresh DB', async () => {
    await migrateAll();
    expect(getColumns()).toContain('default_agent_prompt');

    insertOwnedWorkspace('ws1');
    db.prepare(`INSERT INTO workspace_settings (workspace_id) VALUES (?)`).run('ws1');
    const row = db
      .prepare(
        `SELECT default_agent_prompt FROM workspace_settings WHERE workspace_id = ?`
      )
      .get('ws1') as { default_agent_prompt: string | null };
    expect(row.default_agent_prompt).toBeNull();
  });

  it('accepts a stored prompt value and roundtrips it', async () => {
    await migrateAll();
    insertOwnedWorkspace('ws1');
    db.prepare(
      `INSERT INTO workspace_settings (workspace_id, default_agent_prompt) VALUES (?, ?)`
    ).run('ws1', 'You are a kitchen kiosk. Be terse.');

    const row = db
      .prepare(
        `SELECT default_agent_prompt FROM workspace_settings WHERE workspace_id = ?`
      )
      .get('ws1') as { default_agent_prompt: string | null };
    expect(row.default_agent_prompt).toBe('You are a kitchen kiosk. Be terse.');
  });

  it('preserves existing columns (elevenlabs, kiosk_footer_tickers, etc.)', async () => {
    await migrateAll();
    const cols = getColumns();
    for (const c of [
      'elevenlabs_voice_id',
      'elevenlabs_tts_enabled',
      'allow_auto_join',
      'require_qr_token',
      'kiosk_footer_tickers_enabled',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('rollback to v15 drops the new column without losing other settings', async () => {
    await migrateAll();
    insertOwnedWorkspace('ws1');
    db.prepare(`
      INSERT INTO workspace_settings (
        workspace_id, allow_auto_join, kiosk_footer_tickers_enabled,
        default_agent_prompt
      ) VALUES (?, ?, ?, ?)
    `).run('ws1', 0, 1, 'lost-on-rollback');

    const migrator = new Migrator({ db, migrations });
    const res = await migrator.migrateTo(15);
    expect(res.direction).toBe('down');
    expect(res.count).toBe(1);

    expect(getColumns()).not.toContain('default_agent_prompt');
    const row = db
      .prepare(
        `SELECT allow_auto_join, kiosk_footer_tickers_enabled
         FROM workspace_settings WHERE workspace_id = ?`
      )
      .get('ws1') as {
        allow_auto_join: number;
        kiosk_footer_tickers_enabled: number;
      };
    expect(row.allow_auto_join).toBe(0);
    expect(row.kiosk_footer_tickers_enabled).toBe(1);
  });

  it('is idempotent against a re-run of migrateUp()', async () => {
    await migrateAll();
    await expect(migrateAll()).resolves.not.toThrow();
    const cols = getColumns().filter((c) => c === 'default_agent_prompt');
    expect(cols).toHaveLength(1);
  });

  it('round-trips: up -> down -> up restores the column at the end', async () => {
    await migrateAll();
    const migrator = new Migrator({ db, migrations });
    await migrator.migrateTo(15);
    expect(getColumns()).not.toContain('default_agent_prompt');
    await migrator.migrateTo(16);
    expect(getColumns()).toContain('default_agent_prompt');
  });
});
