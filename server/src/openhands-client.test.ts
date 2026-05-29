/**
 * HTTP-boundary unit tests for `OpenHandsClient`.
 *
 * These tests stub the global `fetch` so they cover the *contract* between
 * `OpenHandsClient` methods and the OpenHands platform REST endpoints —
 * specifically the realistic response shapes returned by
 * `POST /api/v1/app-conversations`, `GET /api/v1/app-conversations/start-tasks`,
 * and `GET /api/v1/app-conversations`. The orchestration-policy tests live in
 * `agent-driver/rebind.test.ts`; this file exists to lock down the boundary
 * those tests have to trust.
 *
 * Motivated by #361: the previous `OpenHandsClient.rebindConversation`
 * assumed `POST /app-conversations` returned a synchronous `AppConversation`
 * (with `session_api_key`/`conversation_url`). In reality the endpoint
 * returns an asynchronous `AppConversationStartTask` (`{ id, status, ... }`)
 * that the caller must poll-until-ready and then `GET` the conversation by
 * id to fetch the populated record. These tests assert the new three-phase
 * dance.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenHandsClient, OpenHandsApiError } from './openhands.js';

const API_BASE = 'https://app.all-hands.dev/api/v1';

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/**
 * Build a `fetch` stub that dispatches requests to a sequence of
 * route-matched handlers. Each handler is consumed once; subsequent
 * matches throw if there's no remaining handler for the route. Records
 * every call into `calls` so tests can assert exact request order/body.
 */
function makeFetchStub(handlers: Array<{
  match: (url: string, init: RequestInit) => boolean;
  respond: () => { ok: boolean; status?: number; body: unknown };
}>): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const remaining = handlers.slice();
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method ?? 'GET').toUpperCase();
    let parsedBody: Record<string, unknown> | null = null;
    if (typeof init.body === 'string' && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        parsedBody = null;
      }
    }
    calls.push({ url, method, body: parsedBody });

    const idx = remaining.findIndex((h) => h.match(url, init));
    if (idx === -1) {
      throw new Error(`No handler for ${method} ${url}`);
    }
    const { respond } = remaining.splice(idx, 1)[0]!;
    const { ok, status, body } = respond();
    return {
      ok,
      status: status ?? (ok ? 200 : 500),
      headers: { get: (_name: string) => null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function startTaskRoute(taskId: string, opts: { status?: string } = {}) {
  return {
    match: (url: string, init: RequestInit) =>
      url === `${API_BASE}/app-conversations` && (init.method ?? '').toUpperCase() === 'POST',
    respond: () => ({
      ok: true,
      body: { id: taskId, status: opts.status ?? 'WORKING' },
    }),
  };
}

function pollStartTaskRoute(taskId: string, opts: {
  status?: string;
  app_conversation_id?: string | null;
} = {}) {
  return {
    match: (url: string, init: RequestInit) =>
      url.startsWith(`${API_BASE}/app-conversations/start-tasks?ids=`) &&
      (init.method ?? 'GET').toUpperCase() === 'GET',
    respond: () => ({
      ok: true,
      body: [
        {
          id: taskId,
          status: opts.status ?? 'READY',
          app_conversation_id: opts.app_conversation_id ?? null,
        },
      ],
    }),
  };
}

function getConversationRoute(conversationId: string, info: Record<string, unknown>) {
  return {
    match: (url: string, init: RequestInit) =>
      url ===
        `${API_BASE}/app-conversations?ids=${encodeURIComponent(conversationId)}` &&
      (init.method ?? 'GET').toUpperCase() === 'GET',
    respond: () => ({ ok: true, body: [info] }),
  };
}

// ---------------------------------------------------------------------------
// rebindConversation HTTP-boundary
// ---------------------------------------------------------------------------

describe('OpenHandsClient.rebindConversation (#361)', () => {
  let client: OpenHandsClient;

  beforeEach(() => {
    client = new OpenHandsClient('test-api-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  test('drives the three-phase async dance: POST start-task → poll → getConversation', async () => {
    // Realistic AppConversationStartTask: just { id, status }, no
    // session_api_key, no conversation_url.
    const { fetchFn, calls } = makeFetchStub([
      startTaskRoute('task-123', { status: 'WORKING' }),
      // First poll: still WORKING
      pollStartTaskRoute('task-123', { status: 'WORKING' }),
      // Second poll: READY, surfaces app_conversation_id back
      pollStartTaskRoute('task-123', {
        status: 'READY',
        app_conversation_id: 'conv-rb-1',
      }),
      // Final GET pulls the populated conversation record
      getConversationRoute('conv-rb-1', {
        id: 'conv-rb-1',
        status: 'RUNNING',
        sandbox_status: 'RUNNING',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1/conv-rb-1',
      }),
    ]);
    vi.stubGlobal('fetch', fetchFn);

    const info = await client.rebindConversation(
      'conv-rb-1',
      {},
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    // Result shape matches a populated ConversationInfo, NOT a start-task.
    expect(info).toEqual({
      id: 'conv-rb-1',
      status: 'RUNNING',
      sandbox_status: 'RUNNING',
      session_api_key: 'KNEW',
      conversation_url: 'https://new.example.com/api/v1/conv-rb-1',
    });

    // Exactly 4 HTTP calls in the expected order.
    expect(calls).toHaveLength(4);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${API_BASE}/app-conversations`);
    expect(calls[0]?.body).toEqual({ conversation_id: 'conv-rb-1' });
    expect(calls[1]?.method).toBe('GET');
    expect(calls[1]?.url).toContain('/app-conversations/start-tasks?ids=task-123');
    expect(calls[2]?.method).toBe('GET');
    expect(calls[3]?.method).toBe('GET');
    expect(calls[3]?.url).toBe(`${API_BASE}/app-conversations?ids=conv-rb-1`);
  });

  test('POST body forwards systemMessageSuffix when supplied (#297)', async () => {
    const { fetchFn, calls } = makeFetchStub([
      startTaskRoute('task-xyz'),
      pollStartTaskRoute('task-xyz', { status: 'READY' }),
      getConversationRoute('conv-rb-2', {
        id: 'conv-rb-2',
        status: 'RUNNING',
        sandbox_status: 'RUNNING',
        session_api_key: 'KK',
        conversation_url: 'https://x.example.com/api/v1/conv-rb-2',
      }),
    ]);
    vi.stubGlobal('fetch', fetchFn);

    await client.rebindConversation(
      'conv-rb-2',
      { systemMessageSuffix: 'memory replay: hi' },
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    expect(calls[0]?.body).toEqual({
      conversation_id: 'conv-rb-2',
      system_message_suffix: 'memory replay: hi',
    });
  });

  test('POST body omits systemMessageSuffix when empty string', async () => {
    // Empty suffix is dropped at the HTTP layer (the rebind helper still
    // forwards it through the OpenHandsRebindClient interface, but here at
    // the wire we never want the empty string to reach the platform).
    const { fetchFn, calls } = makeFetchStub([
      startTaskRoute('task-empty'),
      pollStartTaskRoute('task-empty', { status: 'READY' }),
      getConversationRoute('conv-rb-3', {
        id: 'conv-rb-3',
        status: 'RUNNING',
        session_api_key: 'KK',
        conversation_url: 'https://x.example.com/api/v1/conv-rb-3',
      }),
    ]);
    vi.stubGlobal('fetch', fetchFn);

    await client.rebindConversation(
      'conv-rb-3',
      { systemMessageSuffix: '' },
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    expect(calls[0]?.body).toEqual({ conversation_id: 'conv-rb-3' });
  });

  test('falls back to the input conversation_id when the start-task omits app_conversation_id', async () => {
    // Platform contract: rebind preserves the conversation_id. If the
    // start-task record happens not to surface app_conversation_id (null
    // is the documented default), we fall back to the input id.
    const { fetchFn, calls } = makeFetchStub([
      startTaskRoute('task-fb'),
      pollStartTaskRoute('task-fb', {
        status: 'READY',
        app_conversation_id: null,
      }),
      getConversationRoute('conv-rb-fb', {
        id: 'conv-rb-fb',
        status: 'RUNNING',
        session_api_key: 'KK',
        conversation_url: 'https://x.example.com/api/v1/conv-rb-fb',
      }),
    ]);
    vi.stubGlobal('fetch', fetchFn);

    const info = await client.rebindConversation(
      'conv-rb-fb',
      {},
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );
    expect(info.id).toBe('conv-rb-fb');
    // Last call queried the input id, not some stray task id.
    const lastCall = calls.at(-1)!;
    expect(lastCall.url).toBe(`${API_BASE}/app-conversations?ids=conv-rb-fb`);
  });

  test('POST failure surfaces as OpenHandsApiError (transient 5xx)', async () => {
    // The POST fails with 503. Per the request() helper, the resulting
    // error is an OpenHandsApiError with status=503, transient=true. The
    // helper layer's retry policy is what handles the transient bit; here
    // we just verify the error class & status survive the boundary.
    const { fetchFn } = makeFetchStub([
      {
        match: (url: string, init: RequestInit) =>
          url === `${API_BASE}/app-conversations` &&
          (init.method ?? '').toUpperCase() === 'POST',
        respond: () => ({ ok: false, status: 503, body: 'unavailable' }),
      },
    ]);
    vi.stubGlobal('fetch', fetchFn);

    await expect(
      client.rebindConversation('conv-fail', {}, { pollIntervalMs: 1, timeoutMs: 100 }),
    ).rejects.toMatchObject({
      name: 'OpenHandsApiError',
      status: 503,
      transient: true,
    });
  });

  test('POST 403 surfaces as non-transient OpenHandsApiError', async () => {
    const { fetchFn } = makeFetchStub([
      {
        match: (url: string, init: RequestInit) =>
          url === `${API_BASE}/app-conversations` &&
          (init.method ?? '').toUpperCase() === 'POST',
        respond: () => ({ ok: false, status: 403, body: 'forbidden' }),
      },
    ]);
    vi.stubGlobal('fetch', fetchFn);

    await expect(
      client.rebindConversation('conv-403', {}, { pollIntervalMs: 1, timeoutMs: 100 }),
    ).rejects.toMatchObject({
      name: 'OpenHandsApiError',
      status: 403,
      transient: false,
    });
  });

  test('throws OpenHandsApiError(0) if getConversation returns no record after the task is READY', async () => {
    // The rebind start-task completes, but the conversation lookup comes
    // back empty. This is a real edge case worth covering — the platform
    // can succeed at marking the task READY just before the conversation
    // record is queryable. We surface a transient-shaped error so the
    // helper layer's retry policy gets a chance to recover.
    const { fetchFn } = makeFetchStub([
      startTaskRoute('task-nil'),
      pollStartTaskRoute('task-nil', { status: 'READY' }),
      {
        match: (url: string) =>
          url === `${API_BASE}/app-conversations?ids=conv-nil`,
        respond: () => ({ ok: true, body: [null] }),
      },
    ]);
    vi.stubGlobal('fetch', fetchFn);

    await expect(
      client.rebindConversation('conv-nil', {}, { pollIntervalMs: 1, timeoutMs: 5_000 }),
    ).rejects.toMatchObject({
      name: 'OpenHandsApiError',
      status: 0,
      transient: true,
    });
  });

  test('propagates pollUntilReady failure (ERROR start-task) as a generic Error, not OpenHandsApiError', async () => {
    // If the platform fails to boot the new sandbox, pollUntilReady throws
    // a plain Error with the failure reason. The rebind helper layer maps
    // unknown errors to RebindBudgetExhausted, which is the correct
    // degradation path.
    const { fetchFn } = makeFetchStub([
      startTaskRoute('task-err'),
      pollStartTaskRoute('task-err', { status: 'ERROR' }),
    ]);
    vi.stubGlobal('fetch', fetchFn);

    await expect(
      client.rebindConversation('conv-err', {}, { pollIntervalMs: 1, timeoutMs: 5_000 }),
    ).rejects.toThrow(/failed to start/i);
  });

  test('honours custom poll timeoutMs (gives up if task never reaches READY)', async () => {
    // The poll route returns WORKING forever. With a tight timeout we
    // expect pollUntilReady to throw — the rebind helper sees a plain
    // Error and degrades.
    const { fetchFn } = makeFetchStub([
      startTaskRoute('task-slow'),
    ]);
    // Add an arbitrary number of "still working" poll responses by reusing
    // a sticky route (we don't bother with sequential-handler discipline
    // here since pollUntilReady doesn't care about count).
    const stickyFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init.method ?? 'GET').toUpperCase();
      if (url === `${API_BASE}/app-conversations` && method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ id: 'task-slow', status: 'WORKING' }),
          json: async () => ({ id: 'task-slow', status: 'WORKING' }),
        } as unknown as Response;
      }
      if (url.includes('/app-conversations/start-tasks?ids=task-slow')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify([{ id: 'task-slow', status: 'WORKING' }]),
          json: async () => [{ id: 'task-slow', status: 'WORKING' }],
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', stickyFetch);
    // Reference fetchFn so the linter doesn't complain about the unused
    // helper; we deliberately swap to a sticky fetch for this test.
    void fetchFn;

    await expect(
      client.rebindConversation('conv-slow', {}, { pollIntervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// Sanity check: the OpenHandsApiError class is importable from this module
// path (guards against accidental future renames that would break the
// rebind tests which depend on it).
// ---------------------------------------------------------------------------
describe('OpenHandsApiError', () => {
  test('status 503 is transient; status 403 is not', () => {
    expect(new OpenHandsApiError(503, 'x', null).transient).toBe(true);
    expect(new OpenHandsApiError(403, 'x', null).transient).toBe(false);
  });
});
