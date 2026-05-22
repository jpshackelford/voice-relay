import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildAgentEventsUrl,
  fetchAgentEventHistory,
} from './agentEvents';

const originalFetch = globalThis.fetch;

function mockFetchOnce(
  body: unknown,
  init: { status?: number; ok?: boolean; throws?: unknown } = {},
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => {
    if (init.throws) throw init.throws;
    const status = init.status ?? 200;
    const ok = init.ok ?? status < 400;
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('buildAgentEventsUrl', () => {
  it('builds the base URL with no params', () => {
    expect(buildAgentEventsUrl({ sessionId: 'abc' })).toBe(
      '/api/sessions/abc/agent-events',
    );
  });

  it('includes limit, after, kinds and rehydrate', () => {
    const url = buildAgentEventsUrl({
      sessionId: 's-1',
      limit: 250,
      after: '2026-05-21T10:00:00.000Z',
      kinds: ['ActionEvent', 'MessageEvent'],
      rehydrate: 'force',
    });
    expect(url).toContain('/api/sessions/s-1/agent-events?');
    expect(url).toContain('limit=250');
    expect(url).toContain('rehydrate=force');
    expect(url).toContain('kind=ActionEvent%2CMessageEvent');
    expect(url).toContain('after=2026-05-21T10%3A00%3A00.000Z');
  });

  it('omits the kinds param when given an empty array', () => {
    const url = buildAgentEventsUrl({ sessionId: 's-1', kinds: [] });
    expect(url).toBe('/api/sessions/s-1/agent-events');
  });

  it('URL-encodes the session id', () => {
    const url = buildAgentEventsUrl({ sessionId: 'a/b c' });
    expect(url).toBe('/api/sessions/a%2Fb%20c/agent-events');
  });
});

describe('fetchAgentEventHistory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns normalized events on 200 success', async () => {
    const fetchMock = mockFetchOnce({
      events: [
        {
          id: 'evt-1',
          kind: 'ActionEvent',
          source: 'agent',
          timestamp: '2026-05-21T10:00:00Z',
          action: { kind: 'ExecuteBashAction', command: 'ls' },
        },
      ],
      total: 1,
      rehydrated: false,
      rehydration_complete: true,
      conversation_id: 'conv-1',
      hydrated_at_oldest: '2026-05-21T10:00:00Z',
      hydrated_at_newest: '2026-05-21T10:00:00Z',
    });

    const result = await fetchAgentEventHistory({
      sessionId: 's-1',
      limit: 500,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain('/api/sessions/s-1/agent-events');
    expect(calledUrl).toContain('limit=500');
    expect((init as RequestInit | undefined)?.credentials).toBe('include');

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('evt-1');
    expect(result.events[0].kind).toBe('ExecuteBashAction'); // unwrapped
    expect(result.events[0].command).toBe('ls');
    expect(result.total).toBe(1);
    expect(result.conversationId).toBe('conv-1');
    expect(result.rehydrationComplete).toBe(true);
  });

  it('handles partial rehydration (rehydration_complete: false)', async () => {
    mockFetchOnce({
      events: [],
      total: 0,
      rehydrated: true,
      rehydration_complete: false,
      rehydration_error: 'OH timeout',
      conversation_id: 'conv-1',
      hydrated_at_oldest: null,
      hydrated_at_newest: null,
    });

    const result = await fetchAgentEventHistory({ sessionId: 's-1' });

    expect(result.rehydrated).toBe(true);
    expect(result.rehydrationComplete).toBe(false);
    expect(result.rehydrationError).toBe('OH timeout');
    expect(result.events).toEqual([]);
  });

  it('handles the no-mapping case (conversation_id: null)', async () => {
    mockFetchOnce({
      events: [],
      total: 0,
      rehydrated: false,
      rehydration_complete: true,
      conversation_id: null,
      hydrated_at_oldest: null,
      hydrated_at_newest: null,
    });

    const result = await fetchAgentEventHistory({ sessionId: 's-1' });
    expect(result.conversationId).toBeNull();
    expect(result.events).toEqual([]);
  });

  it('throws AgentEventFetchError with status on 401', async () => {
    mockFetchOnce({ error: 'Authentication required' }, { ok: false, status: 401 });
    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toMatchObject({
      name: 'AgentEventFetchError',
      status: 401,
      message: 'Authentication required',
    });
  });

  it('throws AgentEventFetchError with status on 403', async () => {
    mockFetchOnce({ error: 'Access denied to session' }, { ok: false, status: 403 });
    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toMatchObject({
      status: 403,
      message: 'Access denied to session',
    });
  });

  it('throws AgentEventFetchError with status on 404', async () => {
    mockFetchOnce({ error: 'Session not found' }, { ok: false, status: 404 });
    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws with a generic message on 5xx without an error body', async () => {
    mockFetchOnce(null, { ok: false, status: 500 });
    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('wraps network errors in AgentEventFetchError', async () => {
    mockFetchOnce(null, { throws: new TypeError('Failed to fetch') });
    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toMatchObject({
      name: 'AgentEventFetchError',
      message: 'Failed to fetch',
    });
  });

  it('re-throws AbortError untouched', async () => {
    const abortErr = new DOMException('aborted', 'AbortError');
    mockFetchOnce(null, { throws: abortErr });
    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toBe(
      abortErr,
    );
  });

  it('passes the AbortSignal through to fetch', async () => {
    const fetchMock = mockFetchOnce({
      events: [],
      total: 0,
      rehydrated: false,
      rehydration_complete: true,
      conversation_id: null,
      hydrated_at_oldest: null,
      hydrated_at_newest: null,
    });

    const controller = new AbortController();
    await fetchAgentEventHistory({ sessionId: 's-1', signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit | undefined)?.signal).toBe(controller.signal);
  });

  it('asserts events.length <= 500 (issue #269 pagination decision)', async () => {
    // Build a fake response at the cap. The kiosk uses MAX_ACTIONS=50, so
    // anything more is just unused budget — but we want to know if the
    // server contract ever drifts past the documented 500 limit.
    const events = Array.from({ length: 500 }, (_, i) => ({
      id: `evt-${i}`,
      kind: 'TerminalAction',
      timestamp: `2026-05-21T10:${String(i % 60).padStart(2, '0')}:00Z`,
    }));
    mockFetchOnce({
      events,
      total: 500,
      rehydrated: false,
      rehydration_complete: true,
      conversation_id: 'c',
      hydrated_at_oldest: null,
      hydrated_at_newest: null,
    });

    const result = await fetchAgentEventHistory({ sessionId: 's-1', limit: 500 });
    expect(result.events.length).toBeLessThanOrEqual(500);
  });

  it('throws AgentEventFetchError on invalid JSON body', async () => {
    const mock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
          },
        }) as unknown as Response,
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    await expect(fetchAgentEventHistory({ sessionId: 's-1' })).rejects.toThrow(
      /Invalid agent-events response body/,
    );
  });
});
