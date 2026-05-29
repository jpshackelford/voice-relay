/**
 * Unit tests for `rebind.ts` — the rebind helper for the OpenHands
 * AgentDriver (#296).
 *
 * Strategy:
 * - Mock the OH HTTP client with a tiny `OpenHandsRebindClient` impl whose
 *   `rebindConversation` returns queued responses (success values or
 *   thrown errors), so each test can assert on exact request count and
 *   the precise sequence of responses.
 * - Inject a fake `sleep`/`clock` so backoff timing assertions are
 *   deterministic without `vi.useFakeTimers()`.
 *
 * Test IDs (T-4.1.U.*) correspond to the acceptance tests in issue #296.
 */

import { describe, test, expect } from 'vitest';
import {
  rebindConversation,
  RebindBudgetExhausted,
  RebindForbidden,
  RebindConversationGone,
  RebindWindowTracker,
  REBIND_BACKOFF_MS,
  REBIND_BUDGET_MS,
  type OpenHandsRebindClient,
} from './rebind.js';
import { OpenHandsApiError, type ConversationInfo } from '../openhands.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake `OpenHandsRebindClient` that pops one entry per call.
 *
 * Each entry is either:
 * - a `ConversationInfo` value to resolve with, OR
 * - an `Error` to reject with.
 *
 * Tests can read `calls` to assert the exact number of HTTP calls made.
 */
function makeClient(responses: Array<ConversationInfo | Error>): {
  client: OpenHandsRebindClient;
  calls: string[];
  callOpts: Array<{ systemMessageSuffix?: string } | undefined>;
} {
  const queue = responses.slice();
  const calls: string[] = [];
  const callOpts: Array<{ systemMessageSuffix?: string } | undefined> = [];
  return {
    client: {
      async rebindConversation(
        conversationId: string,
        opts?: { systemMessageSuffix?: string },
      ): Promise<ConversationInfo> {
        calls.push(conversationId);
        callOpts.push(opts);
        const next = queue.shift();
        if (next === undefined) {
          throw new Error('fake client: no more queued responses');
        }
        if (next instanceof Error) throw next;
        return next;
      },
    },
    calls,
    callOpts,
  };
}

/** Build a deterministic fake clock + sleep pair. */
function makeFakeTime() {
  let now = 0;
  return {
    clock: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance(ms: number) {
      now += ms;
    },
    nowRef: () => now,
  };
}

/**
 * Minimal valid response for "rebind succeeded on a fresh sandbox".
 *
 * Note: this is the shape that `OpenHandsClient.rebindConversation()`
 * **returns** to the helper layer — i.e. the post-`getConversation`
 * `ConversationInfo` after the client has internally driven the three-phase
 * async dance (POST start-task → poll until ready → GET conversation), per
 * #361. It is **not** the raw `POST /app-conversations` response shape; that
 * is `AppConversationStartTask` and never carries `session_api_key` on its
 * own. Tests at this layer exercise the *policy* helper, not the HTTP
 * boundary — the HTTP boundary is unit-tested in
 * `server/src/openhands-client.test.ts`.
 */
function okResponse(overrides: Partial<ConversationInfo> = {}): ConversationInfo {
  return {
    id: 'conv1',
    status: 'READY',
    session_api_key: 'KNEW',
    conversation_url: 'https://new.example.com/api/v1/foo',
    sandbox_status: 'RUNNING',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rebindConversation — HTTP retry orchestration
// ---------------------------------------------------------------------------

describe('rebindConversation (rebind helper)', () => {
  test('T-4.1.U.1: POSTs with existing conversation_id (no parent)', async () => {
    // The "no parent" assertion is upheld at the OpenHandsClient method
    // level — `rebindConversation()` there sends `{ conversation_id }` with
    // no `parent_conversation_id`. Here we verify the helper passes the
    // conversation_id through unchanged and makes exactly one call.
    const { client, calls } = makeClient([okResponse()]);
    const result = await rebindConversation(client, 'conv1');
    expect(calls).toEqual(['conv1']);
    expect(result.conversationId).toBe('conv1');
  });

  test('T-4.1.U.2: returns normalized agent_server_url + session_api_key', async () => {
    const { client } = makeClient([
      okResponse({
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1/foo',
        sandbox_status: 'RUNNING',
      }),
    ]);
    const result = await rebindConversation(client, 'conv1');
    expect(result).toEqual({
      conversationId: 'conv1',
      agentServerUrl: 'https://new.example.com',
      sessionApiKey: 'KNEW',
      sandboxStatus: 'RUNNING',
    });
  });

  test('T-4.1.U.3: retries on transient 5xx then succeeds', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      new OpenHandsApiError(503, 'unavailable', null),
      okResponse(),
    ]);
    const result = await rebindConversation(client, 'conv1', {
      sleep: time.sleep,
      clock: time.clock,
    });
    expect(calls.length).toBe(2);
    expect(result.conversationId).toBe('conv1');
  });

  test('T-4.1.U.4: backoff sequence is 1s,2s,4s,8s before the 5th attempt', async () => {
    const time = makeFakeTime();
    const sleepDelays: number[] = [];
    const recordingSleep = async (ms: number) => {
      sleepDelays.push(ms);
      await time.sleep(ms);
    };
    const { client, calls } = makeClient([
      new OpenHandsApiError(500, 'oops', null),
      new OpenHandsApiError(500, 'oops', null),
      new OpenHandsApiError(500, 'oops', null),
      new OpenHandsApiError(500, 'oops', null),
      okResponse(),
    ]);
    const result = await rebindConversation(client, 'conv1', {
      sleep: recordingSleep,
      clock: time.clock,
    });
    expect(calls.length).toBe(5);
    expect(sleepDelays).toEqual([1_000, 2_000, 4_000, 8_000]);
    // Elapsed wall time matches sum of backoffs (15 s).
    expect(time.nowRef()).toBe(15_000);
    expect(result.conversationId).toBe('conv1');
  });

  test('T-4.1.U.5: gives up after total ~30s with RebindBudgetExhausted', async () => {
    const time = makeFakeTime();
    // Indefinite 503s. The backoff sequence is [1, 2, 4, 8, 16]s. With a
    // 30s budget the cumulative sleeps before each attempt are 0, 1, 3, 7,
    // 15, 30s — the 5th attempt happens at elapsed=15s, sleep gets clipped
    // to 15s (budget - elapsed), and on iteration 6 the budget check
    // kicks the loop out. So exactly 5 HTTP attempts.
    //
    // We pin `budgetMs` here so the assertion is independent of the
    // module-level constant (which was bumped to 180_000 as part of
    // #361's async-rebind rework — see REBIND_BUDGET_MS docstring).
    const budgetMs = 30_000;
    const responses: Array<ConversationInfo | Error> = [];
    for (let i = 0; i < REBIND_BACKOFF_MS.length + 1; i++) {
      responses.push(new OpenHandsApiError(503, 'try later', null));
    }
    const { client, calls } = makeClient(responses);
    await expect(
      rebindConversation(client, 'conv1', {
        sleep: time.sleep,
        clock: time.clock,
        budgetMs,
      }),
    ).rejects.toBeInstanceOf(RebindBudgetExhausted);
    expect(calls.length).toBe(REBIND_BACKOFF_MS.length); // exactly 5 attempts
    // Elapsed time is the budget (sleeps clip at the budget boundary).
    expect(time.nowRef()).toBeLessThanOrEqual(budgetMs);
  });

  test('T-4.1.U.6: 403 fails fast with RebindForbidden (no retry)', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      new OpenHandsApiError(403, 'forbidden', null),
    ]);
    await expect(
      rebindConversation(client, 'conv1', { sleep: time.sleep, clock: time.clock }),
    ).rejects.toBeInstanceOf(RebindForbidden);
    expect(calls.length).toBe(1);
    expect(time.nowRef()).toBe(0); // no sleep happened
  });

  test('T-4.1.U.7: 404 fails fast with RebindConversationGone (no retry)', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      new OpenHandsApiError(404, 'not found', null),
    ]);
    await expect(
      rebindConversation(client, 'conv1', { sleep: time.sleep, clock: time.clock }),
    ).rejects.toBeInstanceOf(RebindConversationGone);
    expect(calls.length).toBe(1);
    expect(time.nowRef()).toBe(0);
  });

  test('non-403/404 4xx also fails fast as RebindForbidden', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      new OpenHandsApiError(401, 'unauthorized', null),
    ]);
    await expect(
      rebindConversation(client, 'conv1', { sleep: time.sleep, clock: time.clock }),
    ).rejects.toBeInstanceOf(RebindForbidden);
    expect(calls.length).toBe(1);
  });

  test('429 (rate limited) retries — transient per OpenHandsApiError', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      new OpenHandsApiError(429, 'too many requests', null),
      okResponse(),
    ]);
    const result = await rebindConversation(client, 'conv1', {
      sleep: time.sleep,
      clock: time.clock,
    });
    expect(calls.length).toBe(2);
    expect(result.conversationId).toBe('conv1');
  });

  test('network error (status 0) is transient → retries', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      new OpenHandsApiError(0, 'network', null),
      okResponse(),
    ]);
    const result = await rebindConversation(client, 'conv1', {
      sleep: time.sleep,
      clock: time.clock,
    });
    expect(calls.length).toBe(2);
    expect(result.conversationId).toBe('conv1');
  });

  test('malformed response (no session_api_key) is transient → retries', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      // First response is missing session_api_key — treated as transient
      // because the platform may be returning a half-baked record while
      // the new sandbox is still spinning up.
      okResponse({ session_api_key: undefined }),
      okResponse(),
    ]);
    const result = await rebindConversation(client, 'conv1', {
      sleep: time.sleep,
      clock: time.clock,
    });
    expect(calls.length).toBe(2);
    expect(result.sessionApiKey).toBe('KNEW');
  });

  test('malformed response (bad conversation_url) is transient → retries', async () => {
    const time = makeFakeTime();
    const { client, calls } = makeClient([
      okResponse({ conversation_url: 'not-a-url' }),
      okResponse(),
    ]);
    const result = await rebindConversation(client, 'conv1', {
      sleep: time.sleep,
      clock: time.clock,
    });
    expect(calls.length).toBe(2);
    expect(result.agentServerUrl).toBe('https://new.example.com');
  });

  test('non-OpenHandsApiError throws RebindBudgetExhausted immediately (no retry)', async () => {
    // Anything other than OpenHandsApiError implies a deeper bug; we
    // surface as budget-exhausted so the manager degrades cleanly.
    const time = makeFakeTime();
    const { client, calls } = makeClient([new Error('something else')]);
    await expect(
      rebindConversation(client, 'conv1', { sleep: time.sleep, clock: time.clock }),
    ).rejects.toBeInstanceOf(RebindBudgetExhausted);
    expect(calls.length).toBe(1);
  });

  test('budget-exhausted error carries attempts + lastStatus', async () => {
    const time = makeFakeTime();
    const responses: Array<ConversationInfo | Error> = [];
    for (let i = 0; i < REBIND_BACKOFF_MS.length + 1; i++) {
      responses.push(new OpenHandsApiError(502, 'bad gateway', null));
    }
    const { client } = makeClient(responses);
    try {
      // Pin budgetMs to 30 s (the pre-#361 value) so the attempts count
      // is deterministic regardless of the module-level constant.
      await rebindConversation(client, 'conv-z', {
        sleep: time.sleep,
        clock: time.clock,
        budgetMs: 30_000,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RebindBudgetExhausted);
      const e = err as RebindBudgetExhausted;
      expect(e.conversationId).toBe('conv-z');
      expect(e.attempts).toBe(REBIND_BACKOFF_MS.length);
      expect(e.lastStatus).toBe(502);
    }
  });

  test('parses sandbox_status default to RUNNING when omitted', async () => {
    const { client } = makeClient([
      okResponse({ sandbox_status: undefined }),
    ]);
    const result = await rebindConversation(client, 'conv1');
    expect(result.sandboxStatus).toBe('RUNNING');
  });
});

// ---------------------------------------------------------------------------
// RebindWindowTracker — per-conversation 5-minute rolling cap
// ---------------------------------------------------------------------------

describe('RebindWindowTracker', () => {
  test('countInWindow starts at 0', () => {
    let now = 1_000_000;
    const tracker = new RebindWindowTracker(() => now);
    expect(tracker.countInWindow('conv1')).toBe(0);
    tracker.checkBudget('conv1'); // no throw
  });

  test('records successes and increments the count', () => {
    let now = 1_000_000;
    const tracker = new RebindWindowTracker(() => now);
    tracker.recordSuccess('conv1');
    expect(tracker.countInWindow('conv1')).toBe(1);
    now += 10_000;
    tracker.recordSuccess('conv1');
    expect(tracker.countInWindow('conv1')).toBe(2);
  });

  test('after MAX_REBINDS_PER_WINDOW, checkBudget throws RebindBudgetExhausted', () => {
    let now = 1_000_000;
    const tracker = new RebindWindowTracker(() => now);
    tracker.recordSuccess('conv1');
    tracker.recordSuccess('conv1');
    tracker.recordSuccess('conv1');
    expect(() => tracker.checkBudget('conv1')).toThrow(RebindBudgetExhausted);
  });

  test('older entries fall out of the window', () => {
    let now = 1_000_000;
    const tracker = new RebindWindowTracker(() => now);
    tracker.recordSuccess('conv1');
    tracker.recordSuccess('conv1');
    tracker.recordSuccess('conv1');
    expect(() => tracker.checkBudget('conv1')).toThrow(RebindBudgetExhausted);
    // Advance past the window: all old entries should drop.
    now += 5 * 60_000 + 1;
    expect(tracker.countInWindow('conv1')).toBe(0);
    expect(() => tracker.checkBudget('conv1')).not.toThrow();
  });

  test('separate conversations track independently', () => {
    let now = 1_000_000;
    const tracker = new RebindWindowTracker(() => now);
    tracker.recordSuccess('conv1');
    tracker.recordSuccess('conv1');
    tracker.recordSuccess('conv1');
    expect(() => tracker.checkBudget('conv1')).toThrow(RebindBudgetExhausted);
    // conv2 untouched.
    expect(tracker.countInWindow('conv2')).toBe(0);
    expect(() => tracker.checkBudget('conv2')).not.toThrow();
  });

  test('partial pruning: only entries inside the window count', () => {
    let now = 1_000_000;
    const tracker = new RebindWindowTracker(() => now);
    tracker.recordSuccess('conv1');
    now += 4 * 60_000; // 4 min later
    tracker.recordSuccess('conv1');
    now += 2 * 60_000; // total 6 min; first entry now stale
    expect(tracker.countInWindow('conv1')).toBe(1);
    // Still room for two more before the cap.
    tracker.recordSuccess('conv1');
    expect(tracker.countInWindow('conv1')).toBe(2);
    tracker.recordSuccess('conv1');
    expect(tracker.countInWindow('conv1')).toBe(3);
    expect(() => tracker.checkBudget('conv1')).toThrow(RebindBudgetExhausted);
  });
});

// ---------------------------------------------------------------------------
// systemMessageSuffix forwarding (#297)
// ---------------------------------------------------------------------------

describe('rebindConversation systemMessageSuffix forwarding (#297)', () => {
  test('T-4.2.I.1: forwards a non-empty suffix to the underlying client', async () => {
    const { client, callOpts } = makeClient([okResponse()]);
    await rebindConversation(client, 'conv1', {
      systemMessageSuffix: 'memory replay: user asked about widgets',
    });
    expect(callOpts).toHaveLength(1);
    expect(callOpts[0]).toEqual({
      systemMessageSuffix: 'memory replay: user asked about widgets',
    });
  });

  test('omits opts entirely when no suffix is supplied', async () => {
    const { client, callOpts } = makeClient([okResponse()]);
    await rebindConversation(client, 'conv1');
    expect(callOpts).toHaveLength(1);
    expect(callOpts[0]).toBeUndefined();
  });

  test('forwards empty-string suffix as an explicit opts object', async () => {
    // The HTTP layer drops empty strings before assembling the request
    // body, but the orchestrator must still forward the option so the
    // intent ("we tried and got nothing") is observable to tests / the
    // client layer.
    const { client, callOpts } = makeClient([okResponse()]);
    await rebindConversation(client, 'conv1', { systemMessageSuffix: '' });
    expect(callOpts[0]).toEqual({ systemMessageSuffix: '' });
  });

  test('same suffix is reused across retry attempts', async () => {
    const { client, callOpts } = makeClient([
      new OpenHandsApiError(500, 'transient', null),
      okResponse(),
    ]);
    const time = makeFakeTime();
    await rebindConversation(client, 'conv1', {
      systemMessageSuffix: 'replay-A',
      sleep: time.sleep,
      clock: time.clock,
    });
    expect(callOpts).toHaveLength(2);
    expect(callOpts[0]).toEqual({ systemMessageSuffix: 'replay-A' });
    expect(callOpts[1]).toEqual({ systemMessageSuffix: 'replay-A' });
  });
});
