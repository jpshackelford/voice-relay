import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AgentEventRepository } from './agent-event-repository.js';
import { migration as migration012 } from './migrations/012_agent_events.js';

describe('migration 012_agent_events', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration012.up);
  });

  afterEach(() => {
    db.close();
  });

  it('creates the agent_events table with the documented columns', () => {
    const cols = db.prepare(`PRAGMA table_info(agent_events)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const byName = new Map(cols.map(c => [c.name, c]));
    expect(byName.has('id')).toBe(true);
    expect(byName.has('event_id')).toBe(true);
    expect(byName.get('conversation_id')?.notnull).toBe(1);
    expect(byName.get('session_id')?.notnull).toBe(1);
    expect(byName.get('workspace_id')?.notnull).toBe(1);
    expect(byName.get('kind')?.notnull).toBe(1);
    expect(byName.get('source')?.notnull).toBe(0);
    expect(byName.has('event_timestamp')).toBe(true);
    expect(byName.get('hydrated_at')?.notnull).toBe(1);
    expect(byName.get('raw_event')?.notnull).toBe(1);
  });

  it('creates the three required indexes', () => {
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_events'`)
      .all() as Array<{ name: string }>;
    const names = new Set(idx.map(i => i.name));
    expect(names.has('agent_events_natural')).toBe(true);
    expect(names.has('agent_events_session_time')).toBe(true);
    expect(names.has('agent_events_hydrated_at')).toBe(true);
  });

  it('partial unique index allows multiple NULL event_id rows but blocks dup non-null ids', () => {
    const insert = db.prepare(`
      INSERT INTO agent_events
        (event_id, conversation_id, session_id, workspace_id, kind, raw_event)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    // Two NULL event_ids must coexist
    insert.run(null, 'c1', 's1', 'w1', 'ActionEvent', '{}');
    insert.run(null, 'c1', 's1', 'w1', 'ActionEvent', '{}');

    // First insert of a concrete id succeeds, second is ignored by INSERT OR IGNORE
    insert.run('evt-1', 'c1', 's1', 'w1', 'ActionEvent', '{}');
    const dup = db.prepare(`
      INSERT OR IGNORE INTO agent_events
        (event_id, conversation_id, session_id, workspace_id, kind, raw_event)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = dup.run('evt-1', 'c1', 's1', 'w1', 'ActionEvent', '{}');
    expect(result.changes).toBe(0);

    // But same event_id in a *different* conversation is fine
    const result2 = dup.run('evt-1', 'c2', 's1', 'w1', 'ActionEvent', '{}');
    expect(result2.changes).toBe(1);
  });

  it('down migration drops table and indexes', () => {
    db.exec(migration012.down);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_events'`)
      .all();
    expect(tables).toHaveLength(0);
  });
});

describe('AgentEventRepository', () => {
  let db: Database.Database;
  let repo: AgentEventRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration012.up);
    repo = new AgentEventRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a single event with all indexed fields', () => {
    const id = repo.insert({
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      rawEvent: {
        id: 'evt-1',
        kind: 'ActionEvent',
        source: 'agent',
        timestamp: '2026-05-21T10:00:00Z',
        action: { kind: 'TerminalAction' },
      },
    });
    expect(id).not.toBeNull();

    const found = repo.findBySession({ sessionId: 'sess-1' });
    expect(found).toHaveLength(1);
    expect(found[0].eventId).toBe('evt-1');
    expect(found[0].kind).toBe('ActionEvent');
    expect(found[0].source).toBe('agent');
    expect(found[0].eventTimestamp).toBe('2026-05-21T10:00:00Z');
    expect(found[0].rawEvent).toMatchObject({ id: 'evt-1', kind: 'ActionEvent' });
  });

  it('insert() returns null and does not duplicate on natural-key conflict', () => {
    const first = repo.insert({
      conversationId: 'c1',
      sessionId: 's1',
      workspaceId: 'w1',
      rawEvent: { id: 'evt-1', kind: 'MessageEvent' },
    });
    const second = repo.insert({
      conversationId: 'c1',
      sessionId: 's1',
      workspaceId: 'w1',
      rawEvent: { id: 'evt-1', kind: 'MessageEvent' },
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(repo.countBySession('s1')).toBe(1);
  });

  it('insertMany returns count of newly inserted rows ignoring duplicates', () => {
    const rows = [
      { conversationId: 'c1', sessionId: 's1', workspaceId: 'w1', rawEvent: { id: 'a', kind: 'K' } },
      { conversationId: 'c1', sessionId: 's1', workspaceId: 'w1', rawEvent: { id: 'b', kind: 'K' } },
      { conversationId: 'c1', sessionId: 's1', workspaceId: 'w1', rawEvent: { id: 'a', kind: 'K' } },
    ];
    expect(repo.insertMany(rows)).toBe(2);
    expect(repo.countBySession('s1')).toBe(2);
  });

  it('insertMany handles empty input', () => {
    expect(repo.insertMany([])).toBe(0);
  });

  it('synthetic (NULL event_id) events are always inserted without dedup', () => {
    for (let i = 0; i < 3; i++) {
      repo.insert({
        conversationId: 'c1',
        sessionId: 's1',
        workspaceId: 'w1',
        rawEvent: { kind: 'Synthetic' },
      });
    }
    expect(repo.countBySession('s1')).toBe(3);
  });

  it('orders by event_timestamp ASC regardless of insert order', () => {
    repo.insert({
      conversationId: 'c1',
      sessionId: 's1',
      workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'K', timestamp: '2026-05-21T12:00:00Z' },
    });
    repo.insert({
      conversationId: 'c1',
      sessionId: 's1',
      workspaceId: 'w1',
      rawEvent: { id: '2', kind: 'K', timestamp: '2026-05-21T10:00:00Z' },
    });
    const found = repo.findBySession({ sessionId: 's1' });
    expect(found.map(e => e.eventId)).toEqual(['2', '1']);
  });

  it('respects after filter on event_timestamp', () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'K', timestamp: '2026-05-21T10:00:00Z' },
    });
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '2', kind: 'K', timestamp: '2026-05-21T12:00:00Z' },
    });
    const found = repo.findBySession({ sessionId: 's1', after: '2026-05-21T11:00:00Z' });
    expect(found.map(e => e.eventId)).toEqual(['2']);
  });

  it('respects kinds filter', () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'ActionEvent', timestamp: '2026-05-21T10:00:00Z' },
    });
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '2', kind: 'MessageEvent', timestamp: '2026-05-21T11:00:00Z' },
    });
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '3', kind: 'ThinkAction', timestamp: '2026-05-21T12:00:00Z' },
    });
    const found = repo.findBySession({
      sessionId: 's1',
      kinds: ['ActionEvent', 'ThinkAction'],
    });
    expect(found.map(e => e.eventId)).toEqual(['1', '3']);
  });

  it('respects limit and caps to MAX_LIMIT', () => {
    for (let i = 0; i < 10; i++) {
      repo.insert({
        conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
        rawEvent: { id: `e-${i}`, kind: 'K', timestamp: `2026-05-21T10:00:0${i}Z` },
      });
    }
    expect(repo.findBySession({ sessionId: 's1', limit: 3 })).toHaveLength(3);
    // Massive limit gets capped, query still succeeds
    expect(repo.findBySession({ sessionId: 's1', limit: 100_000 })).toHaveLength(10);
    // Non-positive limit is treated as 1 (clamp)
    expect(repo.findBySession({ sessionId: 's1', limit: 0 })).toHaveLength(1);
  });

  it('does not return events from other sessions', () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'K' },
    });
    repo.insert({
      conversationId: 'c2', sessionId: 's2', workspaceId: 'w1',
      rawEvent: { id: '2', kind: 'K' },
    });
    expect(repo.findBySession({ sessionId: 's1' })).toHaveLength(1);
    expect(repo.findBySession({ sessionId: 's2' })).toHaveLength(1);
  });

  it('getHydrationWindow returns count + bounds', () => {
    expect(repo.getHydrationWindow('empty')).toEqual({
      total: 0, oldest: null, newest: null,
    });
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'K' },
    });
    const w = repo.getHydrationWindow('s1');
    expect(w.total).toBe(1);
    expect(typeof w.oldest).toBe('string');
    expect(typeof w.newest).toBe('string');
  });

  it('deleteOlderThan removes rows by hydrated_at', () => {
    // Insert one with hydrated_at far in the past
    db.prepare(`
      INSERT INTO agent_events
        (event_id, conversation_id, session_id, workspace_id, kind, raw_event, hydrated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('old', 'c1', 's1', 'w1', 'K', '{}', '2000-01-01T00:00:00.000Z');
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: 'new', kind: 'K' },
    });

    const deleted = repo.deleteOlderThan('2024-01-01T00:00:00.000Z');
    expect(deleted).toBe(1);
    expect(repo.countBySession('s1')).toBe(1);
    expect(repo.findBySession({ sessionId: 's1' })[0].eventId).toBe('new');
  });

  it('deleteOlderThan with a future cutoff wipes everything for this session', () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'K' },
    });
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '2', kind: 'K' },
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(repo.deleteOlderThan(future)).toBe(2);
  });

  it('deleteBySession only affects the given session', () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: '1', kind: 'K' },
    });
    repo.insert({
      conversationId: 'c2', sessionId: 's2', workspaceId: 'w1',
      rawEvent: { id: '2', kind: 'K' },
    });
    expect(repo.deleteBySession('s1')).toBe(1);
    expect(repo.countBySession('s2')).toBe(1);
  });

  it('falls back to safe defaults when raw event lacks indexed fields', () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: {} as Record<string, unknown>,
    });
    const found = repo.findBySession({ sessionId: 's1' });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('unknown');
    expect(found[0].source).toBeNull();
    expect(found[0].eventTimestamp).toBeNull();
    expect(found[0].eventId).toBeNull();
  });
});
