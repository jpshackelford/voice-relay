/**
 * Unit tests for `OpenHandsAgentDriver` — the AgentDriver adapter over
 * AISessionManager (#288).
 *
 * Strategy: drive the adapter against a `FakeAISessionManager` that
 * implements the narrow `AISessionManagerSurface`. The fake exposes the
 * forwarder callbacks the adapter installs so tests can fire upstream
 * events synchronously and assert on the resulting `AgentEvent` stream.
 */

import { describe, test, expect, beforeEach } from 'vitest';
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
    test('T-2.2.1: with no upstream binding returns absent', async () => {
      const status = await driver.openSession('s1', OPTS);
      expect(status).toEqual({
        sessionId: 's1',
        state: 'absent',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
    });

    test('T-2.2.2: with existing connected binding returns ready', async () => {
      mgr.bindings.set('s1', {
        conversationId: 'conv-s1',
        ws: { readyState: 1 },
        isThinking: false,
      });
      const status = await driver.openSession('s1', OPTS);
      expect(status.state).toBe('ready');
      expect(status.conversationId).toBe('conv-s1');
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

    test('T-2.2.4: openSession is idempotent', async () => {
      const a = await driver.openSession('s1', OPTS);
      const b = await driver.openSession('s1', OPTS);
      expect(a).toEqual(b);
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

    test('getOrCreateForSession failure surfaces as terminal error', async () => {
      await driver.openSession('s1', OPTS);
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
});
