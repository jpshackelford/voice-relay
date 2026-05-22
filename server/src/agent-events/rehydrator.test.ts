import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AgentEventRepository } from '../storage/agent-event-repository.js';
import { migration as migration012 } from '../storage/migrations/012_agent_events.js';
import { AgentEventRehydrator } from './rehydrator.js';
import { OpenHandsApiError, type RawOpenHandsEvent } from '../openhands.js';

interface FakeClient {
  getEventsPage: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
  return {
    getEventsPage: vi.fn(),
  };
}

function makePage(items: RawOpenHandsEvent[], nextPageId?: string) {
  return nextPageId ? { items, next_page_id: nextPageId } : { items };
}

describe('AgentEventRehydrator', () => {
  let db: Database.Database;
  let repo: AgentEventRepository;
  let client: FakeClient;
  let buildClient: ReturnType<typeof vi.fn>;
  let getWorkspaceApiKey: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration012.up);
    repo = new AgentEventRepository(db);
    client = makeClient();
    buildClient = vi.fn(() => client);
    getWorkspaceApiKey = vi.fn(async () => 'wk-key');
    sleep = vi.fn(async () => {});
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function makeRehydrator(opts: Partial<ConstructorParameters<typeof AgentEventRehydrator>[0]> = {}) {
    return new AgentEventRehydrator({
      repo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildClient: buildClient as any,
      getWorkspaceApiKey: getWorkspaceApiKey as unknown as (id: string) => Promise<string | null>,
      sleep: sleep as unknown as (ms: number) => Promise<void>,
      backoffMs: [10, 10, 10, 10, 10, 10],
      ...opts,
    });
  }

  it('returns rehydrated:false when rows already exist', async () => {
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: 'e1', kind: 'K' },
    });
    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(result).toEqual({ rehydrated: false, complete: true, inserted: 0, pagesFetched: 0 });
    expect(client.getEventsPage).not.toHaveBeenCalled();
  });

  it('walks paginated OH responses end-to-end and persists rows in order', async () => {
    client.getEventsPage
      .mockResolvedValueOnce(makePage([
        { id: 'a', kind: 'MessageEvent', timestamp: '2026-05-21T10:00:00Z' },
        { id: 'b', kind: 'ActionEvent', timestamp: '2026-05-21T10:00:01Z' },
      ], 'p2'))
      .mockResolvedValueOnce(makePage([
        { id: 'c', kind: 'ActionEvent', timestamp: '2026-05-21T10:00:02Z' },
      ], 'p3'))
      .mockResolvedValueOnce(makePage([]));

    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });

    expect(result.rehydrated).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.inserted).toBe(3);
    expect(result.pagesFetched).toBe(3);
    expect(client.getEventsPage).toHaveBeenCalledTimes(3);

    const stored = repo.findBySession({ sessionId: 's1' });
    expect(stored.map(e => e.eventId)).toEqual(['a', 'b', 'c']);
  });

  it('dedups duplicate events arriving from OH against existing rows', async () => {
    // Pre-existing row from live ingest
    repo.insert({
      conversationId: 'c1', sessionId: 's1', workspaceId: 'w1',
      rawEvent: { id: 'a', kind: 'K' },
    });

    client.getEventsPage.mockResolvedValueOnce(makePage([
      { id: 'a', kind: 'K' },
      { id: 'b', kind: 'K' },
    ]));

    // Force rehydration even though rows exist
    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1', force: true,
    });
    expect(result.inserted).toBe(1); // only `b` was new
    expect(repo.countBySession('s1')).toBe(2);
  });

  it('retries with backoff on 5xx and eventually succeeds', async () => {
    client.getEventsPage
      .mockRejectedValueOnce(new OpenHandsApiError(503, 'down', null))
      .mockRejectedValueOnce(new OpenHandsApiError(502, 'down', null))
      .mockResolvedValueOnce(makePage([{ id: 'a', kind: 'K' }]));

    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });

    expect(result.complete).toBe(true);
    expect(result.inserted).toBe(1);
    expect(client.getEventsPage).toHaveBeenCalledTimes(3);
    // We slept twice (between the three calls)
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After header from 429 responses', async () => {
    client.getEventsPage
      .mockRejectedValueOnce(new OpenHandsApiError(429, 'rate', '3'))
      .mockResolvedValueOnce(makePage([]));

    const r = makeRehydrator();
    await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('returns rehydration_complete:false when all retries on a page are exhausted', async () => {
    client.getEventsPage.mockRejectedValue(new OpenHandsApiError(503, 'gone', null));

    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });

    expect(result.rehydrated).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.inserted).toBe(0);
    expect(result.error).toBeDefined();
    // 6 attempts per page → 6 calls
    expect(client.getEventsPage).toHaveBeenCalledTimes(6);
  });

  it('persists earlier pages even when a later page exhausts retries', async () => {
    client.getEventsPage
      .mockResolvedValueOnce(makePage([{ id: 'a', kind: 'K' }], 'p2'))
      .mockRejectedValue(new OpenHandsApiError(500, 'boom', null));

    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(result.complete).toBe(false);
    expect(result.inserted).toBe(1);
    expect(repo.countBySession('s1')).toBe(1);
  });

  it('gives up immediately on non-transient errors (4xx other than 429)', async () => {
    // Match the wrapping shape produced by OpenHandsClient.request
    client.getEventsPage.mockRejectedValue(
      new OpenHandsApiError(403, 'OpenHands API error 403: forbidden', null)
    );

    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(result.complete).toBe(false);
    expect(result.error).toContain('403');
    expect(client.getEventsPage).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns error when workspace API key is missing', async () => {
    getWorkspaceApiKey.mockResolvedValueOnce(null);
    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(result.complete).toBe(false);
    expect(result.error).toContain('No workspace API key');
    expect(client.getEventsPage).not.toHaveBeenCalled();
  });

  it('single-flights concurrent requests for the same session', async () => {
    // Use a deferred Promise we control directly — using mockImplementationOnce
    // would create a race where the test could fire resolveFirst before
    // getEventsPage is actually invoked.
    let resolveFirst: (v: { items: RawOpenHandsEvent[]; next_page_id?: string }) => void;
    const firstCall = new Promise<{ items: RawOpenHandsEvent[]; next_page_id?: string }>(
      res => { resolveFirst = res; }
    );
    client.getEventsPage.mockReturnValueOnce(firstCall);

    const r = makeRehydrator();
    const p1 = r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    const p2 = r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });

    // Allow ensureHydrated's sync work + the first getWorkspaceApiKey await
    // to settle so the lock and the in-flight HTTP call exist.
    await new Promise(setImmediate);
    expect(r.isRehydrating('s1')).toBe(true);
    expect(client.getEventsPage).toHaveBeenCalledTimes(1);

    resolveFirst!(makePage([{ id: 'a', kind: 'K' }]));

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both consumers should observe the same result object (single-flight).
    expect(r1).toBe(r2);
    expect(client.getEventsPage).toHaveBeenCalledTimes(1);
    expect(r.isRehydrating('s1')).toBe(false);
  });

  it('releases the in-flight lock after rehydration finishes', async () => {
    client.getEventsPage.mockResolvedValueOnce(makePage([]));
    const r = makeRehydrator();
    await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(r.isRehydrating('s1')).toBe(false);

    // After clearing rows, a *new* attempt is started by the next call
    repo.deleteBySession('s1');
    client.getEventsPage.mockResolvedValueOnce(makePage([
      { id: 'x', kind: 'K' },
    ]));
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(result.inserted).toBe(1);
  });

  it('treats network errors (status 0) as transient', async () => {
    client.getEventsPage
      .mockRejectedValueOnce(new OpenHandsApiError(0, 'ECONNRESET', null))
      .mockResolvedValueOnce(makePage([{ id: 'a', kind: 'K' }]));

    const r = makeRehydrator();
    const result = await r.ensureHydrated({
      sessionId: 's1', workspaceId: 'w1', conversationId: 'c1',
    });
    expect(result.complete).toBe(true);
    expect(result.inserted).toBe(1);
  });
});
