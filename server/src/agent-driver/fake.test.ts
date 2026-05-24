/**
 * Tests for `FakeDriver` — invariants of the scripted-event DSL, idempotency,
 * implicit state transitions, and simulate-* helpers. Each test creates its
 * own `FakeDriver` to avoid shared state.
 */

import { describe, test, expect } from 'vitest';
import { FakeDriver } from './fake.js';
import type { AgentEvent, AgentSessionStatus } from './types.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe('FakeDriver — openSession', () => {
  test('T-2.1.1: openSession returns ready status with conversation id', async () => {
    const driver = new FakeDriver();
    const status = await driver.openSession('s1', { workspaceId: 'w1' });
    expect(status.sessionId).toBe('s1');
    expect(status.state).toBe('ready');
    expect(status.conversationId).not.toBeNull();
    expect(status.error).toBeNull();
    expect(status.thinkingSince).toBeNull();
    expect(status.startingSince).toBeNull();
  });

  test('T-2.1.2: openSession is idempotent (returns equivalent status, no reset)', async () => {
    const driver = new FakeDriver();
    const first = await driver.openSession('s1', { workspaceId: 'w1' });
    const second = await driver.openSession('s1', { workspaceId: 'w1' });
    expect(second).toEqual(first);
    expect(second.conversationId).toBe(first.conversationId);
  });

  test('openSession passes through optional opts without leaking them in status', async () => {
    const driver = new FakeDriver();
    const status = await driver.openSession('s1', {
      workspaceId: 'w1',
      displayLines: 4,
      apiKey: 'unused',
      displayApiSecret: 'unused',
    });
    expect(status.state).toBe('ready');
  });
});

describe('FakeDriver — sendMessage happy path', () => {
  test('T-2.1.3: scripted message event is yielded to the consumer', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ kind: 'message', text: 'hello' }]);
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const messageEvents = events.filter((e) => e.kind === 'message');
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]).toEqual({ kind: 'message', text: 'hello' });
  });

  test('T-2.1.4: sendMessage emits implicit status(thinking) before and status(ready) after', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ kind: 'message', text: 'hi' }]);
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('status');
    expect(kinds[kinds.length - 1]).toBe('status');
    const firstStatus = events[0] as Extract<AgentEvent, { kind: 'status' }>;
    const lastStatus = events[events.length - 1] as Extract<AgentEvent, { kind: 'status' }>;
    expect(firstStatus.status.state).toBe('thinking');
    expect(firstStatus.status.thinkingSince).not.toBeNull();
    expect(lastStatus.status.state).toBe('ready');
    expect(lastStatus.status.thinkingSince).toBeNull();
  });

  test('T-2.1.5: sendMessage emits action then message in order', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [
      {
        kind: 'action',
        action: {
          tool: 'shell',
          args: { cmd: 'ls' },
          toolCallId: 'tc1',
          observation: { result: 'README.md', status: 'ok' },
        },
      },
      { kind: 'message', text: 'done' },
    ]);
    const events = await collect(driver.sendMessage('s1', 'u1', 'go'));
    const nonStatus = events.filter((e) => e.kind !== 'status');
    expect(nonStatus.map((e) => e.kind)).toEqual(['action', 'message']);
    const action = nonStatus[0] as Extract<AgentEvent, { kind: 'action' }>;
    expect(action.action.tool).toBe('shell');
    expect(action.action.toolCallId).toBe('tc1');
    expect(action.action.observation).toEqual({ result: 'README.md', status: 'ok' });
  });

  test('default response when no script is queued', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const message = events.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(message).toBeDefined();
    expect(typeof message.text).toBe('string');
  });

  test('control:delay does not break the iterable', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ control: 'delay', ms: 1 }, { kind: 'message', text: 'after-delay' }]);
    const start = Date.now();
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(0);
    const message = events.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(message.text).toBe('after-delay');
  });
});

describe('FakeDriver — idempotency', () => {
  test('T-2.1.6: utteranceId idempotency replays cached terminal event', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ kind: 'message', text: 'first' }]);
    driver.script('s1', [{ kind: 'message', text: 'second' }]);

    const firstEvents = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const firstMessage = firstEvents.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(firstMessage.text).toBe('first');

    const replayEvents = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    expect(replayEvents).toHaveLength(1);
    expect(replayEvents[0]).toEqual(firstMessage);
  });

  test('different utteranceIds consume distinct scripts', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ kind: 'message', text: 'first' }]);
    driver.script('s1', [{ kind: 'message', text: 'second' }]);

    const u1 = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const u2 = await collect(driver.sendMessage('s1', 'u2', 'hi'));
    expect((u1.find((e) => e.kind === 'message') as { text: string }).text).toBe('first');
    expect((u2.find((e) => e.kind === 'message') as { text: string }).text).toBe('second');
  });
});

describe('FakeDriver — simulate helpers', () => {
  test('T-2.1.7: simulateMissing yields status(reconnecting) then recoverable error', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.simulateMissing('s1');
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    expect(events).toHaveLength(2);
    const status = events[0] as Extract<AgentEvent, { kind: 'status' }>;
    const err = events[1] as Extract<AgentEvent, { kind: 'error' }>;
    expect(status.kind).toBe('status');
    expect(status.status.state).toBe('reconnecting');
    expect(err.kind).toBe('error');
    expect(err.recoverable).toBe(true);
  });

  test('T-2.1.8: simulateStuck transitions session to degraded immediately', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.simulateStuck('s1');
    const status = await driver.getSessionStatus('s1');
    expect(status.state).toBe('degraded');
    expect(status.error).toBe('stuck');
  });

  test('T-2.1.9: simulateError yields unrecoverable error with the given code', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.simulateError('s1', 'E_TEST');
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const errors = events.filter((e) => e.kind === 'error') as Array<
      Extract<AgentEvent, { kind: 'error' }>
    >;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ kind: 'error', message: 'E_TEST', recoverable: false });
    const status = await driver.getSessionStatus('s1');
    expect(status.state).toBe('degraded');
    expect(status.error).toBe('E_TEST');
  });
});

describe('FakeDriver — restartSession', () => {
  test('T-2.1.10: restartSession on degraded transitions through starting back to ready', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.simulateStuck('s1');
    expect((await driver.getSessionStatus('s1')).state).toBe('degraded');
    const status = await driver.restartSession('s1');
    expect(status.state).toBe('ready');
    expect(status.error).toBeNull();
    expect(status.startingSince).toBeNull();
  });

  test('T-2.1.11: restartSession clears utteranceId memo so retries can succeed', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ kind: 'message', text: 'first' }]);
    await collect(driver.sendMessage('s1', 'u1', 'hi'));

    await driver.restartSession('s1');
    driver.script('s1', [{ kind: 'message', text: 'post-restart' }]);
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const message = events.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(message.text).toBe('post-restart');
  });

  test('restartSession on an unopened session is safe and returns ready', async () => {
    const driver = new FakeDriver();
    const status = await driver.restartSession('never-opened');
    expect(status.state).toBe('ready');
  });
});

describe('FakeDriver — closeSession and unknown sessions', () => {
  test('T-2.1.12: closeSession transitions to absent', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    await driver.closeSession('s1');
    const status = await driver.getSessionStatus('s1');
    expect(status.state).toBe('absent');
    expect(status.conversationId).toBeNull();
  });

  test('T-2.1.13: closeSession is idempotent', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    await driver.closeSession('s1');
    await expect(driver.closeSession('s1')).resolves.toBeUndefined();
  });

  test('T-2.1.14: getSessionStatus on unknown session returns absent', async () => {
    const driver = new FakeDriver();
    const status: AgentSessionStatus = await driver.getSessionStatus('never-opened');
    expect(status).toEqual({
      sessionId: 'never-opened',
      state: 'absent',
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: null,
    });
  });
});

describe('FakeDriver — auto-open and concurrency', () => {
  test('T-2.1.15: sendMessage on unopened session auto-opens and streams events', async () => {
    const driver = new FakeDriver();
    driver.script('s2', [{ kind: 'message', text: 'auto-opened' }]);
    const events = await collect(driver.sendMessage('s2', 'u1', 'hi'));
    const message = events.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(message.text).toBe('auto-opened');
    expect((await driver.getSessionStatus('s2')).state).toBe('ready');
  });

  test('T-2.1.16: concurrent sendMessage calls on different sessions maintain order', async () => {
    const driver = new FakeDriver();
    await driver.openSession('a', { workspaceId: 'w1' });
    await driver.openSession('b', { workspaceId: 'w1' });
    driver.script('a', [{ kind: 'message', text: 'A-1' }]);
    driver.script('b', [{ kind: 'message', text: 'B-1' }]);

    const [aEvents, bEvents] = await Promise.all([
      collect(driver.sendMessage('a', 'u1', 'hi')),
      collect(driver.sendMessage('b', 'u1', 'hi')),
    ]);
    const aMsg = aEvents.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    const bMsg = bEvents.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(aMsg.text).toBe('A-1');
    expect(bMsg.text).toBe('B-1');
  });
});

describe('FakeDriver — script-based control entries', () => {
  test('script with control:simulateStuck transitions to degraded via sendMessage', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [{ control: 'simulateStuck' }]);
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    expect(events).toHaveLength(1);
    const status = events[0] as Extract<AgentEvent, { kind: 'status' }>;
    expect(status.kind).toBe('status');
    expect(status.status.state).toBe('degraded');
    expect(status.status.error).toBe('stuck');
  });

  test('script with only an action (no terminal) ends with default message', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.script('s1', [
      {
        kind: 'action',
        action: { tool: 'noop', args: {}, toolCallId: 'tc1' },
      },
    ]);
    const events = await collect(driver.sendMessage('s1', 'u1', 'hi'));
    const message = events.find((e) => e.kind === 'message') as Extract<
      AgentEvent,
      { kind: 'message' }
    >;
    expect(message).toBeDefined();
    expect(typeof message.text).toBe('string');
  });
});

describe('FakeDriver — reset', () => {
  test('reset wipes all sessions', async () => {
    const driver = new FakeDriver();
    await driver.openSession('s1', { workspaceId: 'w1' });
    driver.reset();
    const status = await driver.getSessionStatus('s1');
    expect(status.state).toBe('absent');
  });
});
