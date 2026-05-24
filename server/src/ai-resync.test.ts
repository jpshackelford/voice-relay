/**
 * Unit tests for the AI session-state resync emitted on device register.
 *
 * Test plan from issue #290 (Phase 3 SESSION_STATE checklist):
 *  - T-3.1.1   resync sends session-ai-status when state=ready
 *  - T-3.1.2   resync sends session-ai-status + ai-thinking when state=thinking
 *  - T-3.1.3   resync sends session-ai-status when state=starting
 *  - T-3.1.4   resync sends session-ai-status when state=reconnecting
 *  - T-3.1.5   resync sends session-ai-status when state=degraded
 *  - T-3.1.6   resync is SKIPPED when state=absent
 *  - T-3.1.7   resync targets only the registering WS
 *  - T-3.1.8   resync ordering: after history, before next event
 *  - T-3.1.9   getSessionStatus throws does not break register
 *  - T-3.1.10  anonymous session skips resync
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resyncAISessionState } from './ai-resync.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import type {
  AgentDriver,
  AgentSessionState,
  AgentSessionStatus,
} from './agent-driver/index.js';

function makeStatus(
  sessionId: string,
  state: AgentSessionState,
  overrides: Partial<AgentSessionStatus> = {}
): AgentSessionStatus {
  return {
    sessionId,
    state,
    conversationId: 'conv-abc',
    error: null,
    thinkingSince: null,
    startingSince: null,
    ...overrides,
  };
}

function makeMockDriver(
  status: AgentSessionStatus | Error
): Pick<AgentDriver, 'getSessionStatus'> {
  return {
    getSessionStatus:
      status instanceof Error
        ? vi.fn().mockRejectedValue(status)
        : vi.fn().mockResolvedValue(status),
  };
}

function makeMockWs() {
  return { send: vi.fn() };
}

function getSentMessages(ws: { send: ReturnType<typeof vi.fn> }) {
  return ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
}

describe('resyncAISessionState', () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence expected warnings (T-3.1.9) while keeping spy semantics.
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('T-3.1.1: sends session-ai-status with connected=true when state=ready', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(makeStatus('s1', 'ready'));

    await resyncAISessionState(ws, 's1', driver);

    expect(driver.getSessionStatus).toHaveBeenCalledExactlyOnceWith('s1');
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(getSentMessages(ws)).toEqual([
      {
        type: 'session-ai-status',
        sessionId: 's1',
        connected: true,
        connecting: false,
        conversationId: 'conv-abc',
      },
    ]);
  });

  test('T-3.1.2: sends session-ai-status + ai-thinking when state=thinking', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(
      makeStatus('s1', 'thinking', { thinkingSince: '2026-05-24T18:00:00.000Z' })
    );

    await resyncAISessionState(ws, 's1', driver);

    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(getSentMessages(ws)).toEqual([
      {
        type: 'session-ai-status',
        sessionId: 's1',
        connected: true,
        connecting: false,
        conversationId: 'conv-abc',
      },
      {
        type: 'ai-thinking',
        sessionId: 's1',
        thinking: true,
        thinkingSince: '2026-05-24T18:00:00.000Z',
      },
    ]);
  });

  test('T-3.1.3: sends session-ai-status with connecting=true when state=starting', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(
      makeStatus('s1', 'starting', {
        conversationId: null,
        startingSince: '2026-05-24T18:00:00.000Z',
      })
    );

    await resyncAISessionState(ws, 's1', driver);

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(getSentMessages(ws)).toEqual([
      {
        type: 'session-ai-status',
        sessionId: 's1',
        connected: false,
        connecting: true,
      },
    ]);
  });

  test('T-3.1.4: sends session-ai-status with connecting=true when state=reconnecting', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(makeStatus('s1', 'reconnecting'));

    await resyncAISessionState(ws, 's1', driver);

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(getSentMessages(ws)).toEqual([
      {
        type: 'session-ai-status',
        sessionId: 's1',
        connected: false,
        connecting: true,
        conversationId: 'conv-abc',
      },
    ]);
  });

  test('T-3.1.5: sends session-ai-status with error when state=degraded', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(
      makeStatus('s1', 'degraded', {
        conversationId: null,
        error: 'something broke',
      })
    );

    await resyncAISessionState(ws, 's1', driver);

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(getSentMessages(ws)).toEqual([
      {
        type: 'session-ai-status',
        sessionId: 's1',
        connected: false,
        connecting: false,
        error: 'something broke',
      },
    ]);
  });

  test('T-3.1.6: SKIPS resync when state=absent', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(makeStatus('s1', 'absent', { conversationId: null }));

    await resyncAISessionState(ws, 's1', driver);

    expect(driver.getSessionStatus).toHaveBeenCalledExactlyOnceWith('s1');
    expect(ws.send).not.toHaveBeenCalled();
  });

  test('T-3.1.7: only the registering WS receives the resync', async () => {
    // Two other devices already in the session; only the registering ws
    // should receive a message. The helper takes a single ws by contract,
    // so we verify by passing ws1 and asserting ws2/ws3 are untouched.
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    const ws3 = makeMockWs();
    const driver = makeMockDriver(makeStatus('s1', 'ready'));

    await resyncAISessionState(ws1, 's1', driver);

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).not.toHaveBeenCalled();
    expect(ws3.send).not.toHaveBeenCalled();
  });

  test('T-3.1.8: ordering — session-ai-status precedes ai-thinking', async () => {
    // The contract is: status first (so the client folds it into history),
    // then ai-thinking only when applicable. We can verify that ordering
    // directly from the recorded send() calls.
    const ws = makeMockWs();
    const driver = makeMockDriver(
      makeStatus('s1', 'thinking', { thinkingSince: '2026-05-24T18:00:00.000Z' })
    );

    await resyncAISessionState(ws, 's1', driver);

    const types = getSentMessages(ws).map((m) => m.type);
    expect(types).toEqual(['session-ai-status', 'ai-thinking']);
  });

  test('T-3.1.9: getSessionStatus throwing does not break the register flow', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(new Error('driver exploded'));

    await expect(
      resyncAISessionState(ws, 's1', driver)
    ).resolves.toBeUndefined();

    expect(ws.send).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    const warnMessage = consoleWarn.mock.calls[0][0] as string;
    expect(warnMessage).toContain('[AI Resync]');
    expect(warnMessage).toContain('s1');
  });

  test('T-3.1.10: anonymous session is a no-op (no driver call, no send)', async () => {
    const ws = makeMockWs();
    const driver = makeMockDriver(makeStatus(ANONYMOUS_SESSION_ID, 'ready'));

    await resyncAISessionState(ws, ANONYMOUS_SESSION_ID, driver);

    expect(driver.getSessionStatus).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  test('omits conversationId when driver reports null', async () => {
    // Avoid emitting `"conversationId": null` on the wire, which would force
    // clients to handle both undefined and null.
    const ws = makeMockWs();
    const driver = makeMockDriver(makeStatus('s1', 'ready', { conversationId: null }));

    await resyncAISessionState(ws, 's1', driver);

    const [msg] = getSentMessages(ws);
    expect(msg).not.toHaveProperty('conversationId');
  });
});
