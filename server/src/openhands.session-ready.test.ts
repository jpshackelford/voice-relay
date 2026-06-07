/**
 * Integration test for #458 — the session-ready callback wiring in
 * `AISessionManager.connectWebSocket`.
 *
 * `connectWebSocket` constructs `new WebSocket(...)` which would try to
 * dial out for real, so we replace the `ws` module with an
 * EventEmitter-based mock. The mock captures the constructed instance so
 * tests can emit `open` synchronously and assert the manager-level
 * `onSessionReady` callback fires with the right `sessionId`.
 *
 * This is the focused regression test for AC #3: with the upstream WS
 * still `WS_CONNECTING` at the moment `openSession` returns, the platform
 * eventually observes a session-ready signal once the WS transitions to
 * `OPEN`.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Minimal mock WebSocket. We implement just `on` and `emit` directly
 * (the real `ws` package returns instances that extend `EventEmitter`),
 * because the hoisted factory can't pull `node:events` synchronously
 * under vitest's ESM runtime.
 */
interface MockWSLike {
  readyState: number;
  url: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  on(event: string, handler: (...args: unknown[]) => void): MockWSLike;
  emit(event: string, ...args: unknown[]): boolean;
  listenerCount(event: string): number;
}

const { wsInstances, MockWS } = vi.hoisted(() => {
  const instances: MockWSLikeInternal[] = [];

  interface MockWSLikeInternal {
    readyState: number;
    url: string;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    on(event: string, handler: (...args: unknown[]) => void): MockWSLikeInternal;
    emit(event: string, ...args: unknown[]): boolean;
    listenerCount(event: string): number;
  }

  class MockWSImpl implements MockWSLikeInternal {
    readyState = 0;
    url: string;
    send = vi.fn();
    close = vi.fn();
    terminate = vi.fn();
    removeAllListeners = vi.fn(() => {
      this.handlers.clear();
      return this;
    });
    private handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();
    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void): MockWSImpl {
      let list = this.handlers.get(event);
      if (!list) {
        list = [];
        this.handlers.set(event, list);
      }
      list.push(handler);
      return this;
    }
    emit(event: string, ...args: unknown[]): boolean {
      const list = this.handlers.get(event);
      if (!list || list.length === 0) return false;
      for (const h of list.slice()) h(...args);
      return true;
    }
    listenerCount(event: string): number {
      return this.handlers.get(event)?.length ?? 0;
    }
  }

  return { wsInstances: instances, MockWS: MockWSImpl };
});

vi.mock('ws', () => ({
  default: MockWS,
  WebSocket: MockWS,
}));

import { AISessionManager, type AISession } from './openhands.js';

// Silences "imported type is unused" linter complaints on MockWSLike when
// the test bodies only narrow `wsInstances` items implicitly.
type _Anchor = MockWSLike;
void (null as unknown as _Anchor);

beforeEach(() => {
  wsInstances.length = 0;
});

function makeSession(overrides: Partial<AISession> = {}): AISession {
  return {
    conversationId: 'conv-1',
    taskId: 'task-1',
    sessionId: 'sess-1',
    mode: 'kiosk',
    agentServerUrl: 'https://agent.example.com',
    sessionApiKey: 'K',
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    isThinking: false,
    ...overrides,
  } as AISession;
}

type WithConnect = { connectWebSocket(s: AISession): void };

describe('#458 — AISessionManager session-ready callback fires from ws.on(open)', () => {
  test('invokes the registered session-ready callback when the WS opens', () => {
    const manager = new AISessionManager();
    const callback = vi.fn();
    manager.setSessionReadyCallback(callback);

    const session = makeSession();
    (manager as unknown as WithConnect).connectWebSocket(session);

    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0];
    expect(ws.listenerCount('open')).toBeGreaterThan(0);

    ws.readyState = 1;
    ws.emit('open');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('sess-1');
  });

  test('skips the callback when the session has no VR sessionId', () => {
    const manager = new AISessionManager();
    const callback = vi.fn();
    manager.setSessionReadyCallback(callback);

    const session = makeSession({ sessionId: undefined });
    (manager as unknown as WithConnect).connectWebSocket(session);

    expect(wsInstances).toHaveLength(1);
    wsInstances[0].readyState = 1;
    wsInstances[0].emit('open');

    expect(callback).not.toHaveBeenCalled();
  });

  test('does nothing when no callback is registered', () => {
    const manager = new AISessionManager();
    const session = makeSession();
    (manager as unknown as WithConnect).connectWebSocket(session);

    expect(wsInstances).toHaveLength(1);
    wsInstances[0].readyState = 1;
    expect(() => wsInstances[0].emit('open')).not.toThrow();
  });

  test('swallows callback exceptions so the WS handler does not crash', () => {
    const manager = new AISessionManager();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      manager.setSessionReadyCallback(() => {
        throw new Error('listener boom');
      });
      const session = makeSession();
      (manager as unknown as WithConnect).connectWebSocket(session);

      expect(wsInstances).toHaveLength(1);
      wsInstances[0].readyState = 1;
      expect(() => wsInstances[0].emit('open')).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(
        '[AI] onSessionReady callback threw:',
        expect.any(Error),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  test('fires on every (re)open so the kiosk re-syncs after a reconnect', () => {
    const manager = new AISessionManager();
    const callback = vi.fn();
    manager.setSessionReadyCallback(callback);

    const session = makeSession();
    (manager as unknown as WithConnect).connectWebSocket(session);
    wsInstances[0].readyState = 1;
    wsInstances[0].emit('open');

    (manager as unknown as WithConnect).connectWebSocket(session);
    wsInstances[1].readyState = 1;
    wsInstances[1].emit('open');

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, 'sess-1');
    expect(callback).toHaveBeenNthCalledWith(2, 'sess-1');
  });
});
