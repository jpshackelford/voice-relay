/**
 * Unit tests for `OpenHandsAgentDriver` — the AgentDriver adapter over
 * AISessionManager (#288).
 *
 * Strategy: drive the adapter against a `FakeAISessionManager` that
 * implements the narrow `AISessionManagerSurface`. The fake exposes the
 * forwarder callbacks the adapter installs so tests can fire upstream
 * events synchronously and assert on the resulting `AgentEvent` stream.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { OpenHandsAgentDriver, type AISessionManagerSurface } from './openhands.js';
import type {
  AISession,
  ActionCallback,
  AgentAction as OHAgentAction,
  EventCallback,
  RawOpenHandsEvent,
  ThinkingChangeCallback,
} from '../openhands.js';
import type { AgentEvent } from './types.js';

// ---------------------------------------------------------------------------
// Fake AISessionManager
// ---------------------------------------------------------------------------

interface FakeAIBinding {
  conversationId: string;
  ws?: { readyState: number };
  isThinking: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
}

class FakeAISessionManager implements AISessionManagerSurface {
  thinking?: ThinkingChangeCallback;
  action?: ActionCallback;
  event?: EventCallback;
  readonly bindings = new Map<string, FakeAIBinding>();
  readonly calls: Array<{ name: string; args: unknown[] }> = [];
  /** Optional override of `getOrCreateForSession` behavior per test. */
  getOrCreateImpl?: (sessionId: string, workspaceId: string) => Promise<FakeAIBinding>;
  /** Optional override of `sendSessionMessage` behavior per test. */
  sendImpl?: (sessionId: string, message: string) => Promise<void>;
  /** Override of `isAvailable` per test. Defaults to true. */
  available = true;

  isAvailable(): boolean {
    return this.available;
  }

  hasSessionAI(sessionId: string): boolean {
    return this.bindings.has(sessionId);
  }

  async shutdown(): Promise<void> {
    this.calls.push({ name: 'shutdown', args: [] });
    this.bindings.clear();
  }

  setThinkingChangeCallback(cb: ThinkingChangeCallback | undefined): void {
    this.thinking = cb;
  }
  setActionCallback(cb: ActionCallback | undefined): void {
    this.action = cb;
  }
  setEventCallback(cb: EventCallback | undefined): void {
    this.event = cb;
  }

  getSessionAI(sessionId: string): AISession | undefined {
    const b = this.bindings.get(sessionId);
    return b ? (b as unknown as AISession) : undefined;
  }

  async getOrCreateForSession(
    sessionId: string,
    workspaceId: string,
    _onMessage: (m: string, ts?: string) => void,
    _options?: { displayLines?: number; apiKey?: string; displayApiSecret?: string },
  ): Promise<AISession> {
    this.calls.push({ name: 'getOrCreateForSession', args: [sessionId, workspaceId] });
    if (this.getOrCreateImpl) {
      const b = await this.getOrCreateImpl(sessionId, workspaceId);
      this.bindings.set(sessionId, b);
      return b as unknown as AISession;
    }
    const existing = this.bindings.get(sessionId);
    if (existing) return existing as unknown as AISession;
    const fresh: FakeAIBinding = {
      conversationId: `conv-${sessionId}`,
      ws: { readyState: 1 },
      isThinking: false,
    };
    this.bindings.set(sessionId, fresh);
    return fresh as unknown as AISession;
  }

  async sendSessionMessage(sessionId: string, message: string): Promise<void> {
    this.calls.push({ name: 'sendSessionMessage', args: [sessionId, message] });
    if (this.sendImpl) {
      await this.sendImpl(sessionId, message);
    }
  }

  async endSessionAI(sessionId: string): Promise<void> {
    this.calls.push({ name: 'endSessionAI', args: [sessionId] });
    this.bindings.delete(sessionId);
  }

  // Test helpers — fire the forwarders the adapter installed.
  fireThinking(sessionId: string, thinking: boolean): void {
    this.thinking?.(sessionId, thinking);
  }
  fireAction(sessionId: string, action: OHAgentAction): void {
    this.action?.(sessionId, action);
  }
  fireEvent(sessionId: string, conversationId: string, raw: RawOpenHandsEvent): void {
    this.event?.(sessionId, conversationId, raw);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collect(
  iterable: AsyncIterable<AgentEvent>,
  feed?: () => void,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const it = iterable[Symbol.asyncIterator]();
  // Kick off iteration; first next() drives the adapter through
  // getOrCreateForSession + sendSessionMessage before yielding anything.
  let nextPromise = it.next();
  // Allow microtasks to run so `sendSessionMessage` resolves before we feed.
  await new Promise((r) => setImmediate(r));
  feed?.();
  while (true) {
    const { value, done } = await nextPromise;
    if (done) return events;
    events.push(value);
    nextPromise = it.next();
  }
}

function makeAgentMessageRaw(text: string, timestamp?: string): RawOpenHandsEvent {
  return {
    id: 'evt-1',
    source: 'agent',
    timestamp,
    llm_message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as RawOpenHandsEvent;
}

function makeErrorRaw(kind: string, message?: string): RawOpenHandsEvent {
  return {
    id: 'evt-err',
    kind,
    message,
  } as RawOpenHandsEvent;
}

const OPTS = { workspaceId: 'wk-1' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenHandsAgentDriver', () => {
  let mgr: FakeAISessionManager;
  let driver: OpenHandsAgentDriver;

  beforeEach(() => {
    mgr = new FakeAISessionManager();
    driver = new OpenHandsAgentDriver(mgr);
  });

  describe('constructor', () => {
    test('installs forwarder callbacks on construction', () => {
      expect(typeof mgr.thinking).toBe('function');
      expect(typeof mgr.action).toBe('function');
      expect(typeof mgr.event).toBe('function');
    });
  });

  describe('openSession (T-2.2.1 .. T-2.2.4)', () => {
    test('T-2.2.1: eagerly binds upstream and returns ready (issue #289)', async () => {
      // Migration of the legacy auto-connect path onto the driver requires
      // openSession to eagerly call `getOrCreateForSession` so callers can
      // persist the conversation ID. The fake manager's default
      // `getOrCreateForSession` creates a connected binding.
      const status = await driver.openSession('s1', OPTS);
      const created = mgr.calls.find((c) => c.name === 'getOrCreateForSession');
      expect(created).toBeDefined();
      expect(created?.args).toEqual(['s1', 'wk-1']);
      expect(status.state).toBe('ready');
      expect(status.conversationId).toBe('conv-s1');
    });

    test('T-2.2.2: with existing connected binding returns ready (no re-bind)', async () => {
      mgr.bindings.set('s1', {
        conversationId: 'conv-s1',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const status = await driver.openSession('s1', OPTS);
      expect(status.state).toBe('ready');
      expect(status.conversationId).toBe('conv-s1');
      // mgr.hasSessionAI short-circuits the eager-bind path.
      expect(mgr.calls.find((c) => c.name === 'getOrCreateForSession')).toBeUndefined();
    });

    test('T-2.2.3: with thinking binding returns thinking', async () => {
      mgr.bindings.set('s1', {
        conversationId: 'conv-s1',
        ws: { readyState: 1 },
        isThinking: true,
      });
      const status = await driver.openSession('s1', OPTS);
      expect(status.state).toBe('thinking');
    });

    test('T-2.2.4: openSession is idempotent — second call does not re-bind', async () => {
      const a = await driver.openSession('s1', OPTS);
      const initialBindCount = mgr.calls.filter((c) => c.name === 'getOrCreateForSession').length;
      const b = await driver.openSession('s1', OPTS);
      const finalBindCount = mgr.calls.filter((c) => c.name === 'getOrCreateForSession').length;
      expect(a).toEqual(b);
      expect(finalBindCount).toBe(initialBindCount);
    });

    test('T-2.2.4b: openSession propagates upstream bind failures (issue #289)', async () => {
      mgr.getOrCreateImpl = async () => {
        throw new Error('no API key');
      };
      await expect(driver.openSession('s1', OPTS)).rejects.toThrow(/no API key/);
    });
  });

  describe('sendMessage (T-2.2.5 .. T-2.2.12)', () => {
    test('T-2.2.5: with no prior binding triggers getOrCreateForSession', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hello'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('hi back'));
      });
      const created = mgr.calls.find((c) => c.name === 'getOrCreateForSession');
      expect(created).toBeDefined();
      expect(created?.args).toEqual(['s1', 'wk-1']);
      expect(events.some((e) => e.kind === 'message')).toBe(true);
    });

    test('T-2.2.6: forwards message text via sendSessionMessage', async () => {
      await driver.openSession('s1', OPTS);
      await collect(driver.sendMessage('s1', 'u1', 'hello world'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('ok'));
      });
      const sends = mgr.calls.filter((c) => c.name === 'sendSessionMessage');
      expect(sends).toHaveLength(1);
      expect(sends[0].args).toEqual(['s1', 'hello world']);
    });

    test('T-2.2.7: agent-message event surfaces as terminal message', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('hello!', '2026-01-01T00:00:00Z'));
      });
      const last = events[events.length - 1];
      expect(last).toEqual({
        kind: 'message',
        text: 'hello!',
        serverTimestamp: '2026-01-01T00:00:00Z',
      });
    });

    test('T-2.2.8: action callback surfaces as action event', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'do thing'), () => {
        mgr.fireAction('s1', {
          id: 'a-1',
          timestamp: '2026-01-01T00:00:00Z',
          kind: 'TerminalAction',
          source: 'agent',
          summary: 'ran ls',
        });
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('done'));
      });
      const action = events.find((e) => e.kind === 'action');
      expect(action).toBeDefined();
      if (action?.kind === 'action') {
        expect(action.action.tool).toBe('TerminalAction');
        expect(action.action.toolCallId).toBe('a-1');
        expect(action.action.args.source).toBe('agent');
        expect(action.action.args.summary).toBe('ran ls');
      }
    });

    test('T-2.2.9: thinking transitions surface as status events', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'conv-s1',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const events = await collect(driver.sendMessage('s1', 'u1', 'go'), () => {
        // Thinking starts: mgr flips isThinking and fires callback.
        const b = mgr.bindings.get('s1');
        if (b) b.isThinking = true;
        mgr.fireThinking('s1', true);
        // Thinking ends, message arrives:
        if (b) b.isThinking = false;
        mgr.fireThinking('s1', false);
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('result'));
      });
      const statuses = events.filter((e) => e.kind === 'status');
      // Expect thinking → ready transition captured.
      expect(statuses.length).toBeGreaterThanOrEqual(2);
      const thinkingStatus = statuses.find(
        (e) => e.kind === 'status' && e.status.state === 'thinking',
      );
      const readyStatus = statuses.find(
        (e) => e.kind === 'status' && e.status.state === 'ready',
      );
      expect(thinkingStatus).toBeDefined();
      expect(readyStatus).toBeDefined();
    });

    test('T-2.2.10: iterable terminates on agent message', async () => {
      await driver.openSession('s1', OPTS);
      const iter = driver.sendMessage('s1', 'u1', 'hi')[Symbol.asyncIterator]();
      const first = iter.next();
      await new Promise((r) => setImmediate(r));
      mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('done'));
      const r1 = await first;
      expect(r1.done).toBe(false);
      // Drain until done; the terminal message is followed by completion.
      let last = r1;
      while (!last.done) {
        last = await iter.next();
      }
      expect(last.done).toBe(true);
    });

    test('T-2.2.11: utteranceId idempotency replays cached terminal', async () => {
      await driver.openSession('s1', OPTS);
      await collect(driver.sendMessage('s1', 'u1', 'first'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('result'));
      });
      // Second call with the same utteranceId should not re-send to upstream.
      const sendsBefore = mgr.calls.filter((c) => c.name === 'sendSessionMessage').length;
      const replay: AgentEvent[] = [];
      for await (const ev of driver.sendMessage('s1', 'u1', 'first')) {
        replay.push(ev);
      }
      const sendsAfter = mgr.calls.filter((c) => c.name === 'sendSessionMessage').length;
      expect(sendsAfter).toBe(sendsBefore);
      expect(replay).toEqual([{ kind: 'message', text: 'result', serverTimestamp: undefined }]);
    });

    test('T-2.2.11b: utteranceMemo bounded by limit (oldest evicted FIFO)', async () => {
      // The driver caps memo growth at 256 entries per session. Drive 260
      // unique utterances and verify:
      //  - The first utterance is no longer replayed (evicted).
      //  - A mid-window utterance is still replayed (still memoized).
      //  - The newest utterance is replayed.
      await driver.openSession('s1', OPTS);
      const TOTAL = 260; // > UTTERANCE_MEMO_LIMIT (256)
      for (let i = 0; i < TOTAL; i++) {
        await collect(driver.sendMessage('s1', `u${i}`, `msg-${i}`), () => {
          mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw(`reply-${i}`));
        });
      }
      const sendsBeforeReplay = mgr.calls.filter(
        (c) => c.name === 'sendSessionMessage',
      ).length;

      // Oldest (u0) evicted: a repeat should hit upstream (no cached replay).
      // We can't easily await an unterminated turn here, so abort early after
      // confirming `sendSessionMessage` fires again for the evicted id.
      const it = driver.sendMessage('s1', 'u0', 'msg-0')[Symbol.asyncIterator]();
      const firstPromise = it.next();
      await new Promise((r) => setImmediate(r));
      const sendsAfterEvicted = mgr.calls.filter(
        (c) => c.name === 'sendSessionMessage',
      ).length;
      expect(sendsAfterEvicted).toBe(sendsBeforeReplay + 1);
      // Drain the new turn so it doesn't leak across tests.
      mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('reply-evicted'));
      await firstPromise;
      let done = false;
      while (!done) done = (await it.next()).done === true;

      // Still-memoized mid-window utterance: pure replay, no upstream call.
      const sendsBeforeMid = mgr.calls.filter(
        (c) => c.name === 'sendSessionMessage',
      ).length;
      const midReplay: AgentEvent[] = [];
      for await (const ev of driver.sendMessage('s1', 'u200', 'msg-200')) {
        midReplay.push(ev);
      }
      const sendsAfterMid = mgr.calls.filter(
        (c) => c.name === 'sendSessionMessage',
      ).length;
      expect(sendsAfterMid).toBe(sendsBeforeMid);
      expect(midReplay).toEqual([
        { kind: 'message', text: 'reply-200', serverTimestamp: undefined },
      ]);

      // Newest utterance: replay (most recent, definitely in memo).
      const newestReplay: AgentEvent[] = [];
      for await (const ev of driver.sendMessage('s1', `u${TOTAL - 1}`, '')) {
        newestReplay.push(ev);
      }
      expect(newestReplay).toEqual([
        { kind: 'message', text: `reply-${TOTAL - 1}`, serverTimestamp: undefined },
      ]);
    });

    test('T-2.2.12: concurrent sendMessages do not cross-talk', async () => {
      await driver.openSession('s1', OPTS);
      // First turn: bind and queue up; we won't terminate it until we choose to.
      const it1 = driver.sendMessage('s1', 'u1', 'first')[Symbol.asyncIterator]();
      const it2 = driver.sendMessage('s1', 'u2', 'second')[Symbol.asyncIterator]();
      const p1 = it1.next();
      const p2 = it2.next();
      await new Promise((r) => setImmediate(r));
      // Terminal for turn 1 only.
      mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('reply-1'));
      const r1 = await p1;
      expect(r1.done).toBe(false);
      if (!r1.done) {
        expect(r1.value.kind).toBe('message');
        if (r1.value.kind === 'message') expect(r1.value.text).toBe('reply-1');
      }
      // Drain turn 1 to completion.
      let n = await it1.next();
      while (!n.done) n = await it1.next();
      // Now terminate turn 2 with a distinct message.
      mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('reply-2'));
      const r2 = await p2;
      expect(r2.done).toBe(false);
      if (!r2.done) {
        expect(r2.value.kind).toBe('message');
        if (r2.value.kind === 'message') expect(r2.value.text).toBe('reply-2');
      }
      // Drain turn 2.
      let m = await it2.next();
      while (!m.done) m = await it2.next();
    });

    test('auto-opens when sendMessage called without prior openSession', async () => {
      await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('hello'));
      });
      const created = mgr.calls.find((c) => c.name === 'getOrCreateForSession');
      expect(created).toBeDefined();
      // Falls back to sessionId as workspaceId when no openSession was made.
      expect(created?.args).toEqual(['s1', 's1']);
    });

    test('sendSessionMessage failure surfaces as terminal error', async () => {
      await driver.openSession('s1', OPTS);
      mgr.sendImpl = async () => {
        throw new Error('ws not connected');
      };
      const events: AgentEvent[] = [];
      for await (const ev of driver.sendMessage('s1', 'u1', 'hi')) {
        events.push(ev);
      }
      expect(events).toEqual([
        { kind: 'error', message: 'ws not connected', recoverable: false },
      ]);
    });

    test('getOrCreateForSession failure during lazy-bind surfaces as terminal error', async () => {
      // openSession (eager) is skipped here so sendMessage hits the lazy-bind
      // path. Setup mirrors the original test's intent prior to #289's eager
      // bind change.
      mgr.getOrCreateImpl = async () => {
        throw new Error('OH not configured');
      };
      const events: AgentEvent[] = [];
      for await (const ev of driver.sendMessage('s1', 'u1', 'hi')) {
        events.push(ev);
      }
      expect(events).toEqual([
        { kind: 'error', message: 'OH not configured', recoverable: false },
      ]);
    });
  });

  describe('restartSession (T-2.2.13)', () => {
    test('T-2.2.13: calls endSessionAI then getOrCreateForSession', async () => {
      await driver.openSession('s1', OPTS);
      // Pretend there's an active binding.
      mgr.bindings.set('s1', {
        conversationId: 'conv-old',
        ws: { readyState: 1 },
        isThinking: true,
      });
      // After #289 openSession eagerly bound once; drop the prior call log
      // so the ordering assertion targets the restartSession turn only.
      mgr.calls.length = 0;
      mgr.getOrCreateImpl = async () => ({
        conversationId: 'conv-new',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const status = await driver.restartSession('s1');
      const names = mgr.calls.map((c) => c.name);
      const endIdx = names.indexOf('endSessionAI');
      const createIdx = names.indexOf('getOrCreateForSession');
      expect(endIdx).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThan(endIdx);
      expect(status.conversationId).toBe('conv-new');
      expect(status.state).toBe('ready');
    });

    test('restartSession drains in-flight turns with recoverable error', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'conv-1',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const events: AgentEvent[] = [];
      const consume = (async () => {
        for await (const ev of driver.sendMessage('s1', 'u1', 'hi')) {
          events.push(ev);
        }
      })();
      await new Promise((r) => setImmediate(r));
      await driver.restartSession('s1');
      await consume;
      const terminal = events[events.length - 1];
      expect(terminal.kind).toBe('error');
      if (terminal.kind === 'error') {
        expect(terminal.recoverable).toBe(true);
      }
    });
  });

  describe('getSessionStatus (T-2.2.14 .. T-2.2.17)', () => {
    test('T-2.2.14: connected → ready', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('ready');
      expect(status.conversationId).toBe('c');
    });

    test('T-2.2.15: connecting → starting', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 0 },
        isThinking: false,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('starting');
    });

    test('T-2.2.16: thinking → thinking', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 1 },
        isThinking: true,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('thinking');
    });

    test('T-2.2.17: missing binding → absent', async () => {
      const status = await driver.getSessionStatus('s1');
      expect(status).toEqual({
        sessionId: 's1',
        state: 'absent',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
    });

    test('no upstream ws → starting when openSession recorded', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        isThinking: false,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('starting');
    });

    test('closed ws (CLOSING/CLOSED) → reconnecting', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 3 },
        isThinking: false,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('reconnecting');
    });

    test('AISession.degraded=true → degraded with reason surfaced as error (#291)', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        // The reconnect loop in AISessionManager sets these when refresh
        // discovers a MISSING sandbox or exhausts transient retries.
        degraded: true,
        degradedReason: 'Agent runtime no longer available — restart needed',
        ws: { readyState: 3 },
        isThinking: false,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).toBe('Agent runtime no longer available — restart needed');
      expect(status.conversationId).toBe('c');
    });

    test('AISession.degraded=true with no reason → degraded with fallback error', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        degraded: true,
        isThinking: false,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).toBe('Agent runtime no longer available');
    });

    test('degraded takes precedence over isThinking', async () => {
      // If the reconnect loop gave up while a turn was in flight, the
      // session should surface as degraded rather than thinking; the user
      // needs to know the agent isn't actually working.
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        degraded: true,
        degradedReason: 'gone',
        ws: { readyState: 3 },
        isThinking: true,
      });
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
    });
  });

  describe('closeSession (T-2.2.18, T-2.2.19)', () => {
    test('T-2.2.18: delegates to endSessionAI and clears local state', async () => {
      await driver.openSession('s1', OPTS);
      await driver.closeSession('s1');
      expect(mgr.calls.map((c) => c.name)).toContain('endSessionAI');
      // After close, status returns absent.
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('absent');
    });

    test('T-2.2.19: closeSession is idempotent', async () => {
      await driver.openSession('s1', OPTS);
      await driver.closeSession('s1');
      await driver.closeSession('s1');
      // Both calls delegate; no error.
      expect(mgr.calls.filter((c) => c.name === 'endSessionAI')).toHaveLength(2);
    });

    test('closeSession on unknown session is a no-op (still delegates)', async () => {
      await driver.closeSession('unknown');
      expect(mgr.calls.filter((c) => c.name === 'endSessionAI')).toHaveLength(1);
    });

    test('closeSession drains in-flight turns with terminal error', async () => {
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const events: AgentEvent[] = [];
      const consume = (async () => {
        for await (const ev of driver.sendMessage('s1', 'u1', 'hi')) {
          events.push(ev);
        }
      })();
      await new Promise((r) => setImmediate(r));
      await driver.closeSession('s1');
      await consume;
      const terminal = events[events.length - 1];
      expect(terminal.kind).toBe('error');
    });
  });

  describe('error events (T-2.2.20, T-2.2.21)', () => {
    test('T-2.2.20: error event from event callback surfaces as error', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeErrorRaw('ConnectionError', 'lost link'));
      });
      const terminal = events[events.length - 1];
      expect(terminal).toEqual({
        kind: 'error',
        message: 'lost link',
        recoverable: true,
      });
    });

    test('T-2.2.21: terminal error closes the iterable', async () => {
      await driver.openSession('s1', OPTS);
      const it = driver.sendMessage('s1', 'u1', 'hi')[Symbol.asyncIterator]();
      const p = it.next();
      await new Promise((r) => setImmediate(r));
      mgr.fireEvent('s1', 'conv-s1', makeErrorRaw('AgentErrorEvent', 'boom'));
      const r1 = await p;
      expect(r1.done).toBe(false);
      let last = r1;
      while (!last.done) last = await it.next();
      expect(last.done).toBe(true);
    });

    test('non-recoverable error kinds map to recoverable:false', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeErrorRaw('AgentErrorEvent', 'fatal'));
      });
      const terminal = events[events.length - 1];
      expect(terminal).toEqual({
        kind: 'error',
        message: 'fatal',
        recoverable: false,
      });
    });

    test('raw error event without a message field falls back to kind', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', { kind: 'AgentErrorEvent' } as RawOpenHandsEvent);
      });
      const terminal = events[events.length - 1];
      expect(terminal).toEqual({
        kind: 'error',
        message: 'AgentErrorEvent',
        recoverable: false,
      });
    });
  });

  describe('event translation edge cases', () => {
    test('non-agent raw events are ignored (no terminal yielded)', async () => {
      await driver.openSession('s1', OPTS);
      const it = driver.sendMessage('s1', 'u1', 'hi')[Symbol.asyncIterator]();
      const first = it.next();
      await new Promise((r) => setImmediate(r));
      // Fire a random non-error, non-agent-message event.
      mgr.fireEvent('s1', 'conv-s1', {
        id: 'x',
        kind: 'SomeOtherKind',
        source: 'environment',
      } as RawOpenHandsEvent);
      // Then fire a real terminal so the iterable finishes.
      mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('done'));
      const r = await first;
      expect(r.done).toBe(false);
      if (!r.done) {
        expect(r.value.kind).toBe('message');
      }
      // Drain.
      let n = await it.next();
      while (!n.done) n = await it.next();
    });

    test('agent message with no text content is ignored', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        // Empty content → no message yield; then a real terminal.
        mgr.fireEvent('s1', 'conv-s1', {
          id: 'x',
          source: 'agent',
          llm_message: { role: 'assistant', content: [{ type: 'image' }] },
        } as RawOpenHandsEvent);
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('text-content'));
      });
      const terminal = events[events.length - 1];
      expect(terminal).toEqual({ kind: 'message', text: 'text-content', serverTimestamp: undefined });
    });

    test('agent message without timestamp omits serverTimestamp', async () => {
      await driver.openSession('s1', OPTS);
      const events = await collect(driver.sendMessage('s1', 'u1', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('plain'));
      });
      const last = events[events.length - 1];
      expect(last.kind).toBe('message');
      if (last.kind === 'message') {
        expect(last.text).toBe('plain');
        // No explicit serverTimestamp set.
        expect(last.serverTimestamp).toBeUndefined();
      }
    });

    test('thinking event with no in-flight turn is dropped silently', () => {
      // No openSession, no sendMessage — fire thinking.
      expect(() => mgr.fireThinking('s1', true)).not.toThrow();
    });

    test('action event with no in-flight turn is dropped silently', () => {
      expect(() =>
        mgr.fireAction('s1', {
          id: 'a',
          timestamp: '',
          kind: 'X',
          source: 'agent',
          summary: '',
        }),
      ).not.toThrow();
    });

    test('event for unknown session is dropped silently', () => {
      expect(() =>
        mgr.fireEvent('unknown', 'c', makeAgentMessageRaw('hi')),
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Platform fan-out hooks (issue #289)
  // ---------------------------------------------------------------------------

  describe('platform fan-out hooks (T-2.3.D.*)', () => {
    test('T-2.3.D.1: isAvailable delegates to manager.isAvailable', () => {
      mgr.available = true;
      expect(driver.isAvailable()).toBe(true);
      mgr.available = false;
      expect(driver.isAvailable()).toBe(false);
    });

    test('T-2.3.D.2: hasSession delegates to manager.hasSessionAI', () => {
      expect(driver.hasSession('s1')).toBe(false);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 1 },
        isThinking: false,
      });
      expect(driver.hasSession('s1')).toBe(true);
    });

    test('T-2.3.D.3: onRawEvent fan-out fires for every upstream event', () => {
      const received: Array<{ session: string; conv: string }> = [];
      const unsub = driver.onRawEvent((session, conv, _raw) => {
        received.push({ session, conv });
      });

      mgr.fireEvent('s1', 'conv-1', makeAgentMessageRaw('hi'));
      mgr.fireEvent('s2', 'conv-2', makeAgentMessageRaw('there'));

      expect(received).toEqual([
        { session: 's1', conv: 'conv-1' },
        { session: 's2', conv: 'conv-2' },
      ]);

      unsub();
      mgr.fireEvent('s3', 'conv-3', makeAgentMessageRaw('after'));
      expect(received).toHaveLength(2);
    });

    test('T-2.3.D.4: onThinkingChange fan-out fires for every upstream change', () => {
      const log: Array<[string, boolean]> = [];
      const unsub = driver.onThinkingChange((s, t) => log.push([s, t]));

      mgr.fireThinking('s1', true);
      mgr.fireThinking('s1', false);

      expect(log).toEqual([
        ['s1', true],
        ['s1', false],
      ]);
      unsub();
      mgr.fireThinking('s1', true);
      expect(log).toHaveLength(2);
    });

    test('T-2.3.D.5: onActionEvent fan-out fires for every upstream action', () => {
      const log: Array<{ session: string; kind: string }> = [];
      const unsub = driver.onActionEvent((s, a) => log.push({ session: s, kind: a.kind }));

      mgr.fireAction('s1', {
        id: 'a1',
        timestamp: '2026-01-01T00:00:00Z',
        kind: 'BrowserOpen',
        source: 'agent',
        summary: '',
      });

      expect(log).toEqual([{ session: 's1', kind: 'BrowserOpen' }]);
      unsub();
    });

    test('T-2.3.D.6: a throwing listener does not break sibling listeners', () => {
      const calls: string[] = [];
      driver.onRawEvent(() => {
        calls.push('listener-1');
        throw new Error('boom');
      });
      driver.onRawEvent(() => {
        calls.push('listener-2');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mgr.fireEvent('s1', 'conv-1', makeAgentMessageRaw('hi'));
      consoleSpy.mockRestore();

      expect(calls).toEqual(['listener-1', 'listener-2']);
    });

    test('T-2.3.D.7: shutdown delegates to manager.shutdown and clears local state', async () => {
      mgr.bindings.set('s1', {
        conversationId: 'c1',
        ws: { readyState: 1 },
        isThinking: false,
      });
      await driver.openSession('s1', OPTS);

      await driver.shutdown();

      expect(mgr.calls.find((c) => c.name === 'shutdown')).toBeDefined();
      // After shutdown the driver no longer tracks the session.
      expect(driver.hasSession('s1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // T-3.4.* — ConversationExecutionStatus → driver state mapping (#293)
  //
  // The driver translates upstream `ConversationStateUpdateEvent` events
  // with `key === 'execution_status'` onto its provider-neutral
  // `AgentSessionState`. These tests pin each row of the mapping table from
  // `docs/architecture.md` § Session state mapping and the transition
  // behaviours called out in the issue.
  // ---------------------------------------------------------------------------
  describe('execution_status event → driver state (#293)', () => {
    function makeStatusEvent(
      status: string,
      extras: Record<string, unknown> = {},
    ): RawOpenHandsEvent {
      return {
        id: `evt-status-${status}`,
        kind: 'ConversationStateUpdateEvent',
        key: 'execution_status',
        value: { execution_status: status, ...extras },
      } as RawOpenHandsEvent;
    }

    beforeEach(async () => {
      // All execution-status tests want a bound, connected session — the
      // mapping reads off the in-driver state, but the binding has to
      // exist (or `synthesizeStatus` returns `absent` regardless).
      await driver.openSession('s1', OPTS);
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 1 },
        isThinking: false,
      });
    });

    test('T-3.4.1: idle → ready', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('idle'));
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('ready');
      expect(status.error).toBe(null);
      expect(status.thinkingSince).toBe(null);
    });

    test('T-3.4.2: finished → ready', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('finished'));
      expect((await driver.getSessionStatus('s1')).state).toBe('ready');
    });

    test('T-3.4.3: paused → ready', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('paused'));
      expect((await driver.getSessionStatus('s1')).state).toBe('ready');
    });

    test('T-3.4.4: waiting_for_confirmation → ready', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('waiting_for_confirmation'));
      expect((await driver.getSessionStatus('s1')).state).toBe('ready');
    });

    test('T-3.4.5: running → thinking, sets thinkingSince from event timestamp', async () => {
      const ts = '2026-01-01T12:00:00.000Z';
      mgr.fireEvent('s1', 'c', {
        ...makeStatusEvent('running'),
        timestamp: ts,
      } as RawOpenHandsEvent);
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('thinking');
      expect(status.thinkingSince).toBe(ts);
    });

    test('T-3.4.5b: running event without timestamp falls back to current time', async () => {
      const before = Date.now();
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      const after = Date.now();
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('thinking');
      expect(status.thinkingSince).not.toBe(null);
      const sinceMs = new Date(status.thinkingSince as string).getTime();
      expect(sinceMs).toBeGreaterThanOrEqual(before);
      expect(sinceMs).toBeLessThanOrEqual(after);
    });

    test('T-3.4.6: stuck → degraded with "stuck" error', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('stuck'));
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).toMatch(/stuck/i);
    });

    test('T-3.4.6b: stuck → degraded uses upstream error payload when present', async () => {
      mgr.fireEvent(
        's1',
        'c',
        makeStatusEvent('stuck', { error: 'inner loop stalled, no progress in 90s' }),
      );
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).toBe('inner loop stalled, no progress in 90s');
    });

    test('T-3.4.7: error → degraded with upstream error payload', async () => {
      mgr.fireEvent(
        's1',
        'c',
        makeStatusEvent('error', { error: 'upstream LLM 500 — try again' }),
      );
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).toBe('upstream LLM 500 — try again');
    });

    test('T-3.4.7b: error → degraded with default message when payload absent', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('error'));
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).not.toBe(null);
      expect(status.error?.length).toBeGreaterThan(0);
    });

    test('T-3.4.7c: error payload may also live under .message or .reason', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('error', { message: 'fallback message' }));
      expect((await driver.getSessionStatus('s1')).error).toBe('fallback message');

      // Re-open a clean session for the second probe so we don't dedupe.
      await driver.closeSession('s1');
      await driver.openSession('s2', OPTS);
      mgr.bindings.set('s2', { conversationId: 'c2', ws: { readyState: 1 }, isThinking: false });
      mgr.fireEvent('s2', 'c2', makeStatusEvent('error', { reason: 'because' }));
      expect((await driver.getSessionStatus('s2')).error).toBe('because');
    });

    test('T-3.4.8: deleting → absent', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('deleting'));
      expect((await driver.getSessionStatus('s1')).state).toBe('absent');
    });

    test('T-3.4.9: running → idle transition emits status event into in-flight turn', async () => {
      const events: AgentEvent[] = [];
      const consume = (async () => {
        for await (const ev of driver.sendMessage('s1', 'u1', 'hi')) {
          events.push(ev);
          if (ev.kind === 'message' || ev.kind === 'error') break;
        }
      })();
      await new Promise((r) => setImmediate(r));
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      mgr.fireEvent('s1', 'c', makeStatusEvent('idle'));
      mgr.fireEvent('s1', 'c', makeAgentMessageRaw('done'));
      await consume;

      const statuses = events.filter((e) => e.kind === 'status') as Array<{
        kind: 'status';
        status: { state: string };
      }>;
      expect(statuses.length).toBeGreaterThanOrEqual(2);
      expect(statuses[0].status.state).toBe('thinking');
      expect(statuses[1].status.state).toBe('ready');
    });

    test('T-3.4.10: tool-only turn (no message) returns to ready on idle', async () => {
      // The 🤔 indicator should not stick on when a turn produces only
      // tool calls. running → idle is enough; no agent message required.
      const thinkingFlips: Array<{ sessionId: string; thinking: boolean }> = [];
      driver.onThinkingChange((sessionId, thinking) => {
        thinkingFlips.push({ sessionId, thinking });
      });
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      mgr.fireEvent('s1', 'c', makeStatusEvent('idle'));

      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('ready');
      expect(status.thinkingSince).toBe(null);
      // Listener saw a true→false sequence even though no message arrived.
      expect(thinkingFlips).toEqual([
        { sessionId: 's1', thinking: true },
        { sessionId: 's1', thinking: false },
      ]);
    });

    test('T-3.4.11: thinkingSince is set only on entry to running', async () => {
      const t1 = '2026-01-01T12:00:00.000Z';
      const t2 = '2026-01-01T12:00:10.000Z';
      mgr.fireEvent('s1', 'c', { ...makeStatusEvent('running'), timestamp: t1 } as RawOpenHandsEvent);
      const after1 = await driver.getSessionStatus('s1');
      expect(after1.thinkingSince).toBe(t1);

      // Second `running` event while already running — must NOT reset.
      mgr.fireEvent('s1', 'c', { ...makeStatusEvent('running'), timestamp: t2 } as RawOpenHandsEvent);
      const after2 = await driver.getSessionStatus('s1');
      expect(after2.thinkingSince).toBe(t1);
    });

    test('T-3.4.12: thinkingSince cleared on exit from running', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      expect((await driver.getSessionStatus('s1')).thinkingSince).not.toBe(null);
      mgr.fireEvent('s1', 'c', makeStatusEvent('idle'));
      expect((await driver.getSessionStatus('s1')).thinkingSince).toBe(null);
    });

    test('T-3.4.13: adapter ws-torn-down overrides upstream running', async () => {
      // The upstream wire is gone; the adapter knows AISessionManager
      // will auto-reconnect. A stale `running` event lingering in the
      // buffer must not override that.
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 3 }, // CLOSED
        isThinking: true,
      });
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('reconnecting');
    });

    test('T-3.4.14: adapter ai.degraded (from #291/#323) overrides upstream running', async () => {
      // When the reconnect loop has already given up (sandbox MISSING
      // or refresh-credentials exhausted), trailing `running` events
      // from a still-draining ws buffer must not flip the snapshot
      // back to thinking. The adapter override stays sticky.
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 3 },
        isThinking: false,
        degraded: true,
        degradedReason: 'Sandbox MISSING — restart required',
      });
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      const status = await driver.getSessionStatus('s1');
      expect(status.state).toBe('degraded');
      expect(status.error).toBe('Sandbox MISSING — restart required');
    });

    test('T-3.4.15: orphan event for unknown sessionId is logged and dropped', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        mgr.fireEvent('does-not-exist', 'c', makeStatusEvent('running'));
        // No state created for the orphan session.
        expect((await driver.getSessionStatus('does-not-exist')).state).toBe('absent');
        expect(warn).toHaveBeenCalled();
        const message = warn.mock.calls.map((args) => String(args[0])).join(' ');
        expect(message).toMatch(/orphan execution_status/i);
      } finally {
        warn.mockRestore();
      }
    });

    test('T-3.4.16: consecutive duplicate running events are deduped', async () => {
      // Two identical running events should not re-fire the thinking
      // listener — only the entry transition counts.
      const fired: boolean[] = [];
      driver.onThinkingChange((_sid, thinking) => fired.push(thinking));
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      mgr.fireEvent('s1', 'c', makeStatusEvent('running'));
      expect(fired).toEqual([true]);
    });

    test('unknown execution_status value is logged and ignored', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        // `aborted` is not in the documented status set.
        mgr.fireEvent('s1', 'c', makeStatusEvent('aborted'));
        // State should not have transitioned to anything — still on the
        // legacy ws-open default.
        const status = await driver.getSessionStatus('s1');
        expect(status.state).toBe('ready');
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    test('execution_status takes precedence over legacy ai.isThinking', async () => {
      // Even when `AISessionManager.isThinking` is stuck on (e.g. a
      // tool-only turn produced no message so the legacy path never
      // cleared it), the execution_status event drives the snapshot.
      mgr.bindings.set('s1', {
        conversationId: 'c',
        ws: { readyState: 1 },
        isThinking: true,
      });
      mgr.fireEvent('s1', 'c', makeStatusEvent('idle'));
      expect((await driver.getSessionStatus('s1')).state).toBe('ready');
    });

    test('error → idle transition clears the executionError', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('error', { error: 'temporarily failed' }));
      expect((await driver.getSessionStatus('s1')).error).toBe('temporarily failed');
      mgr.fireEvent('s1', 'c', makeStatusEvent('idle'));
      const after = await driver.getSessionStatus('s1');
      expect(after.state).toBe('ready');
      expect(after.error).toBe(null);
    });

    test('restartSession resets executionStatus and executionError', async () => {
      mgr.fireEvent('s1', 'c', makeStatusEvent('stuck'));
      expect((await driver.getSessionStatus('s1')).state).toBe('degraded');

      // Restart the binding so the new connection starts clean.
      mgr.bindings.set('s1', { conversationId: 'c', ws: { readyState: 1 }, isThinking: false });
      await driver.restartSession('s1');
      // Re-bind to simulate the new ws coming up. (restartSession leaves
      // the AISessionManager binding alive via getOrCreateForSession in
      // the production path; the fake clears it in endSessionAI, so we
      // restore it explicitly here.)
      mgr.bindings.set('s1', { conversationId: 'c', ws: { readyState: 1 }, isThinking: false });
      const after = await driver.getSessionStatus('s1');
      expect(after.state).toBe('ready');
      expect(after.error).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // Single-flight conversation start (#292)
  //
  // Two or more devices joining the same session at the same time used to race
  // on `getOrCreateForSession`, creating orphaned upstream conversations. The
  // adapter now coalesces concurrent starts onto a single shared promise keyed
  // by sessionId; these tests pin that contract.
  // ---------------------------------------------------------------------------
  describe('single-flight conversation start (T-3.3.*)', () => {
    /**
     * Helper that builds a controllable `getOrCreateForSession` impl. The
     * returned `release` resolves the pending bind with the supplied binding;
     * `reject` rejects it. Until then, concurrent callers stay parked.
     */
    function controlledBind(): {
      install: () => void;
      release: (binding?: FakeAIBinding) => void;
      reject: (err: Error) => void;
      callCount: () => number;
    } {
      let resolveBind: ((b: FakeAIBinding) => void) | null = null;
      let rejectBind: ((err: Error) => void) | null = null;
      let calls = 0;
      return {
        install: () => {
          mgr.getOrCreateImpl = (sessionId: string) => {
            calls += 1;
            return new Promise<FakeAIBinding>((resolve, reject) => {
              resolveBind = resolve;
              rejectBind = reject;
            }).then((b) => {
              // Ensure the fake records the binding so subsequent
              // `hasSessionAI` checks behave realistically.
              mgr.bindings.set(sessionId, b);
              return b;
            });
          };
        },
        release: (binding?: FakeAIBinding) => {
          resolveBind?.(
            binding ?? {
              conversationId: 'conv-shared',
              ws: { readyState: 1 },
              isThinking: false,
            },
          );
        },
        reject: (err: Error) => {
          rejectBind?.(err);
        },
        callCount: () => calls,
      };
    }

    test('T-3.3.1: 5 concurrent sendMessages trigger only 1 upstream start', async () => {
      const ctl = controlledBind();
      ctl.install();
      const iters = Array.from({ length: 5 }, (_, i) =>
        driver.sendMessage('s1', `u${i}`, `msg-${i}`)[Symbol.asyncIterator](),
      );
      // Kick all five concurrently — they should all park inside lazyBindSession.
      iters.forEach((it) => it.next());
      // Allow microtasks to settle (each one races into getOrCreateForSession).
      await new Promise((r) => setImmediate(r));
      expect(ctl.callCount()).toBe(1);
      // Release the shared bind; all 5 turns then send their distinct text.
      ctl.release();
      await new Promise((r) => setImmediate(r));
      // Each turn issued exactly one sendSessionMessage with its own text.
      const sendCalls = mgr.calls.filter((c) => c.name === 'sendSessionMessage');
      expect(sendCalls).toHaveLength(5);
      expect(sendCalls.map((c) => c.args[1]).sort()).toEqual(
        ['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4'].sort(),
      );
      // Tear down via closeSession — drains the FIFO with a terminal error
      // event so every iterator completes cleanly without needing 5 events.
      await driver.closeSession('s1');
    });

    test('T-3.3.3: all concurrent callers see the same conversationId', async () => {
      const ctl = controlledBind();
      ctl.install();
      const iters = Array.from({ length: 3 }, (_, i) =>
        driver.sendMessage('s1', `u${i}`, `m${i}`)[Symbol.asyncIterator](),
      );
      iters.forEach((it) => it.next());
      await new Promise((r) => setImmediate(r));
      ctl.release({
        conversationId: 'conv-XYZ',
        ws: { readyState: 1 },
        isThinking: false,
      });
      await new Promise((r) => setImmediate(r));
      // Status reads the same conversationId.
      const status = await driver.getSessionStatus('s1');
      expect(status.conversationId).toBe('conv-XYZ');
      // Each send call hit the same upstream binding (only 1 getOrCreate).
      expect(ctl.callCount()).toBe(1);
      await driver.closeSession('s1');
    });

    test('T-3.3.4: concurrent sends after success do not re-start', async () => {
      // First turn binds upstream.
      await collect(driver.sendMessage('s1', 'u0', 'hi'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('reply-0'));
      });
      const baselineCreates = mgr.calls.filter(
        (c) => c.name === 'getOrCreateForSession',
      ).length;
      // Fire 3 more concurrent sends — they should reuse the existing binding,
      // so `getOrCreateForSession` count stays flat.
      const iters = Array.from({ length: 3 }, (_, i) =>
        driver.sendMessage('s1', `u-late-${i}`, `late-${i}`)[Symbol.asyncIterator](),
      );
      iters.forEach((it) => it.next());
      await new Promise((r) => setImmediate(r));
      const afterCreates = mgr.calls.filter(
        (c) => c.name === 'getOrCreateForSession',
      ).length;
      expect(afterCreates).toBe(baselineCreates);
      await driver.closeSession('s1');
    });

    test('T-3.3.5: failure clears the in-flight slot (next call re-starts)', async () => {
      const ctl = controlledBind();
      ctl.install();
      // First concurrent batch — all see the same rejection.
      const it1 = driver.sendMessage('s1', 'u1', 'first')[Symbol.asyncIterator]();
      const next1 = it1.next();
      await new Promise((r) => setImmediate(r));
      ctl.reject(new Error('boom'));
      const r1 = await next1;
      expect(r1.done).toBe(false);
      if (!r1.done) {
        expect(r1.value).toEqual({ kind: 'error', message: 'boom', recoverable: false });
      }
      // Drain to completion.
      let d = await it1.next();
      while (!d.done) d = await it1.next();
      // Slot must be clear: a fresh `sendMessage` triggers a NEW upstream call.
      const firstCallCount = ctl.callCount();
      // Replace impl with a successful one for the retry.
      mgr.getOrCreateImpl = async (sessionId: string) => {
        const b: FakeAIBinding = {
          conversationId: `conv-${sessionId}-retry`,
          ws: { readyState: 1 },
          isThinking: false,
        };
        mgr.bindings.set(sessionId, b);
        return b;
      };
      await collect(driver.sendMessage('s1', 'u2', 'second'), () => {
        mgr.fireEvent('s1', 'conv-s1-retry', makeAgentMessageRaw('ok'));
      });
      const totalCreates = mgr.calls.filter(
        (c) => c.name === 'getOrCreateForSession',
      ).length;
      // One call for the failed start, one for the retry.
      expect(firstCallCount).toBe(1);
      expect(totalCreates).toBe(2);
    });

    test('T-3.3.6: all concurrent callers see the same error on failure', async () => {
      const ctl = controlledBind();
      ctl.install();
      const iters = Array.from({ length: 3 }, (_, i) =>
        driver.sendMessage('s1', `u${i}`, 'm')[Symbol.asyncIterator](),
      );
      const nexts = iters.map((it) => it.next());
      await new Promise((r) => setImmediate(r));
      expect(ctl.callCount()).toBe(1);
      ctl.reject(new Error('upstream 503'));
      const results = await Promise.all(nexts);
      for (const r of results) {
        expect(r.done).toBe(false);
        if (!r.done) {
          expect(r.value).toEqual({
            kind: 'error',
            message: 'upstream 503',
            recoverable: false,
          });
        }
      }
      // Drain.
      for (const it of iters) {
        let r = await it.next();
        while (!r.done) r = await it.next();
      }
    });

    test('T-3.3.7: openSession and sendMessage racing share one upstream start', async () => {
      const ctl = controlledBind();
      ctl.install();
      const openP = driver.openSession('s1', OPTS);
      const it = driver.sendMessage('s1', 'u1', 'hi')[Symbol.asyncIterator]();
      const sendNext = it.next();
      await new Promise((r) => setImmediate(r));
      // Only one upstream call should have been initiated.
      expect(ctl.callCount()).toBe(1);
      ctl.release({
        conversationId: 'conv-once',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const status = await openP;
      expect(status.conversationId).toBe('conv-once');
      // After resolution, only one upstream conversation exists.
      expect(
        mgr.calls.filter((c) => c.name === 'getOrCreateForSession'),
      ).toHaveLength(1);
      mgr.fireEvent('s1', 'conv-once', makeAgentMessageRaw('ok'));
      await sendNext;
      let d = await it.next();
      while (!d.done) d = await it.next();
    });

    test('T-3.3.8: distinct sessionIds are independent', async () => {
      // Use a per-session controlled bind so both sessions can stay parked
      // independently. Each session gets its own resolver entry.
      const resolvers = new Map<string, (b: FakeAIBinding) => void>();
      let calls = 0;
      mgr.getOrCreateImpl = (sessionId: string) => {
        calls += 1;
        return new Promise<FakeAIBinding>((resolve) => {
          resolvers.set(sessionId, resolve);
        }).then((b) => {
          mgr.bindings.set(sessionId, b);
          return b;
        });
      };
      const it1 = driver.sendMessage('s1', 'u1', 'hi')[Symbol.asyncIterator]();
      const it2 = driver.sendMessage('s2', 'u2', 'hi')[Symbol.asyncIterator]();
      it1.next();
      it2.next();
      await new Promise((r) => setImmediate(r));
      // Both sessions started — single-flight is per-session, not global.
      expect(calls).toBe(2);
      expect(resolvers.size).toBe(2);
      // Resolve both independently to confirm no cross-talk on the map.
      resolvers.get('s1')?.({
        conversationId: 'conv-s1',
        ws: { readyState: 1 },
        isThinking: false,
      });
      resolvers.get('s2')?.({
        conversationId: 'conv-s2',
        ws: { readyState: 1 },
        isThinking: false,
      });
      await new Promise((r) => setImmediate(r));
      // Each session has its own binding.
      const s1 = await driver.getSessionStatus('s1');
      const s2 = await driver.getSessionStatus('s2');
      expect(s1.conversationId).toBe('conv-s1');
      expect(s2.conversationId).toBe('conv-s2');
      await driver.closeSession('s1');
      await driver.closeSession('s2');
    });

    test('T-3.3.9: serial sendMessages do not interact with the in-flight map', async () => {
      // First call binds and completes; in-flight slot should be empty when
      // the second call starts so it sees no contention. We don't measure
      // overhead directly; instead we assert the map is clean by triggering
      // a second start path that would see the slot if it leaked.
      await collect(driver.sendMessage('s1', 'u1', 'first'), () => {
        mgr.fireEvent('s1', 'conv-s1', makeAgentMessageRaw('a'));
      });
      // Restart should issue both endSessionAI and getOrCreateForSession.
      // If the in-flight slot leaked, restartSession would await a stale
      // promise and never complete.
      mgr.getOrCreateImpl = async (sessionId: string) => {
        const b: FakeAIBinding = {
          conversationId: `conv-${sessionId}-2`,
          ws: { readyState: 1 },
          isThinking: false,
        };
        mgr.bindings.set(sessionId, b);
        return b;
      };
      const status = await driver.restartSession('s1');
      expect(status.conversationId).toBe('conv-s1-2');
    });

    test('restartSession and a concurrent sendMessage share one upstream start', async () => {
      // Initial binding so endSessionAI has something to tear down.
      await driver.openSession('s1', OPTS);
      mgr.calls.length = 0;
      // Stage a controlled rebind: restartSession's lazyBindSession should
      // populate the in-flight slot; a concurrent sendMessage joining must
      // not race a second getOrCreateForSession.
      const ctl = controlledBind();
      ctl.install();
      const restartP = driver.restartSession('s1');
      // Park microtasks to let restartSession get past endSessionAI.
      await new Promise((r) => setImmediate(r));
      const it = driver.sendMessage('s1', 'u-late', 'late')[Symbol.asyncIterator]();
      const sendNext = it.next();
      await new Promise((r) => setImmediate(r));
      // Despite two callers, only one upstream conversation start.
      expect(ctl.callCount()).toBe(1);
      ctl.release({
        conversationId: 'conv-restarted',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const status = await restartP;
      expect(status.conversationId).toBe('conv-restarted');
      mgr.fireEvent('s1', 'conv-restarted', makeAgentMessageRaw('ok'));
      await sendNext;
      let d = await it.next();
      while (!d.done) d = await it.next();
      // Final accounting: exactly one getOrCreateForSession after the restart.
      expect(
        mgr.calls.filter((c) => c.name === 'getOrCreateForSession'),
      ).toHaveLength(1);
    });

    test('restartSession surfaces bind failure as a rejection', async () => {
      // First bind succeeds.
      await driver.openSession('s1', OPTS);
      mgr.calls.length = 0;
      // Subsequent restart's bind fails.
      mgr.getOrCreateImpl = async () => {
        throw new Error('cannot rebind');
      };
      await expect(driver.restartSession('s1')).rejects.toThrow('cannot rebind');
      // Slot must be clear so retries are possible.
      mgr.getOrCreateImpl = async (sessionId: string) => {
        const b: FakeAIBinding = {
          conversationId: `conv-${sessionId}-retry`,
          ws: { readyState: 1 },
          isThinking: false,
        };
        mgr.bindings.set(sessionId, b);
        return b;
      };
      const status = await driver.restartSession('s1');
      expect(status.conversationId).toBe('conv-s1-retry');
    });
  });
});
