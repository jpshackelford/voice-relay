/**
 * Regression test for #458 AC #4 — when the OpenHands adapter's
 * upstream WS reaches `OPEN` after `openSession` already resolved
 * (because the manager kicks off `connectWebSocket` and resolves the
 * binding while the ws is still `WS_CONNECTING`), the platform's
 * `onAgentSessionReady` listener observes a follow-up `session-state`
 * broadcast carrying `state: 'ready'`. Without the fix, the kiosk
 * would have stayed on `'starting'` until the first user message
 * forced the existing `onThinkingChange` fan-out to re-broadcast.
 *
 * The test wires:
 *   - `OpenHandsAgentDriver` against a `FakeAISessionManager` that
 *     starts with `ws.readyState = WS_CONNECTING` and flips to
 *     `WS_OPEN` before firing `setSessionReadyCallback`.
 *   - The same listener shape that `server/src/index.ts` registers
 *     in production: `getSessionStatus` + `broadcastSessionState(...,
 *     'ws-ready')`.
 *   - A stub registry that records every broadcast so the test can
 *     assert the kiosk would see the `'ready'` transition.
 *
 * This mirrors the production wiring 1:1 without booting Express, so
 * the assertion exercises the real driver + the real broadcast helper.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  OpenHandsAgentDriver,
  type AISessionManagerSurface,
} from './agent-driver/openhands.js';
import { broadcastSessionState } from './session-state-broadcast.js';
import type {
  AISession,
  ActionCallback,
  EventCallback,
  SessionReadyCallback,
  ThinkingChangeCallback,
} from './openhands.js';

// WS readyState constants restated locally to avoid pulling in `ws`.
const WS_CONNECTING = 0;
const WS_OPEN = 1;

class FakeMgr implements AISessionManagerSurface {
  private bindings = new Map<string, AISession>();
  sessionReady?: SessionReadyCallback;
  thinking?: ThinkingChangeCallback;
  action?: ActionCallback;
  event?: EventCallback;

  hasSessionAI(sessionId: string): boolean {
    return this.bindings.has(sessionId);
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
  setSessionReadyCallback(cb: SessionReadyCallback | undefined): void {
    this.sessionReady = cb;
  }
  getSessionAI(sessionId: string): AISession | undefined {
    return this.bindings.get(sessionId);
  }
  async getOrCreateForSession(
    sessionId: string,
    _workspaceId: string,
  ): Promise<AISession> {
    // Mirrors the production race: the manager kicks off
    // connectWebSocket internally and resolves while the ws is still
    // CONNECTING. We expose that intermediate state here.
    const ai: AISession = {
      conversationId: `conv-${sessionId}`,
      taskId: `task-${sessionId}`,
      sessionId,
      mode: 'kiosk',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      ws: { readyState: WS_CONNECTING } as never,
    };
    this.bindings.set(sessionId, ai);
    return ai;
  }
  async sendSessionMessage(): Promise<void> {
    // unused
  }
  async endSessionAI(sessionId: string): Promise<void> {
    this.bindings.delete(sessionId);
  }
  async shutdown(): Promise<void> {
    this.bindings.clear();
  }

  /**
   * Simulates the upstream WS transitioning to OPEN and the
   * manager's `ws.on('open')` handler firing the session-ready
   * callback. Mirrors the production code path in `connectWebSocket`.
   */
  simulateWsOpen(sessionId: string): void {
    const ai = this.bindings.get(sessionId);
    if (!ai || !ai.ws) return;
    (ai.ws as unknown as { readyState: number }).readyState = WS_OPEN;
    this.sessionReady?.(sessionId);
  }
}

describe('#458 AC #4 - onAgentSessionReady drives a ws-ready session-state broadcast', () => {
  test(
    'kiosk reducer ends up at state=ready after the upstream WS opens, ' +
      'without any user message',
    async () => {
      const mgr = new FakeMgr();
      const driver = new OpenHandsAgentDriver(mgr);

      // Stub registry mirrors the shape that
      // `broadcastSessionState` consumes (single
      // `broadcastMessageToSession` method). The captured messages
      // are what the kiosk would receive over its platform WS.
      const sent: Array<{ sessionId: string; message: unknown }> = [];
      const registry = {
        broadcastMessageToSession: (sessionId: string, message: unknown) =>
          sent.push({ sessionId, message }),
      };

      // Wire the production listener shape (mirrors
      // `server/src/index.ts`). The test never imports `index.ts`
      // itself so it exercises the seam, not the module-eager
      // singleton wiring.
      driver.onSessionReady((sessionId: string) => {
        void (async () => {
          const status = await driver.getSessionStatus(sessionId);
          if (status.state === 'absent') return;
          broadcastSessionState(registry, sessionId, status, 'ws-ready');
        })();
      });

      // 1. `autoConnectAI`-shaped call: openSession resolves while ws
      //    is still WS_CONNECTING. The synthesised status carries
      //    state: 'starting', which `auto-connect:connected` would
      //    broadcast verbatim -- i.e. the bug.
      const startingStatus = await driver.openSession('s1', {
        workspaceId: 'w1',
      });
      expect(startingStatus.state).toBe('starting');

      // Nothing broadcast yet -- `openSession` itself doesn't broadcast
      // (that's the auto-connect caller's job; we're testing the
      // follow-up fan-out, not the connecting broadcast).
      expect(sent).toHaveLength(0);

      // 2. Simulate the WS transition some time after openSession
      //    returned. In production this is `ws.on('open')`.
      mgr.simulateWsOpen('s1');

      // The listener is async; let the microtask + the pending
      // `getSessionStatus` promise resolve.
      await new Promise((r) => setImmediate(r));

      // 3. Assert: the registry observed exactly one ws-ready
      //    broadcast with state: 'ready'. This is the message the
      //    kiosk reducer needs to flip the connecting indicator to
      //    connected without any user message.
      expect(sent).toHaveLength(1);
      const last = sent[0].message as {
        type: string;
        sessionId: string;
        ai: { state: string };
      };
      expect(last.type).toBe('session-state');
      expect(last.sessionId).toBe('s1');
      expect(last.ai.state).toBe('ready');
    },
  );

  test('absent sessions are short-circuited (does not re-broadcast a torn-down session)', async () => {
    const mgr = new FakeMgr();
    const driver = new OpenHandsAgentDriver(mgr);

    const sent: Array<{ sessionId: string; message: unknown }> = [];
    const registry = {
      broadcastMessageToSession: (sessionId: string, message: unknown) =>
        sent.push({ sessionId, message }),
    };

    driver.onSessionReady((sessionId: string) => {
      void (async () => {
        const status = await driver.getSessionStatus(sessionId);
        if (status.state === 'absent') return;
        broadcastSessionState(registry, sessionId, status, 'ws-ready');
      })();
    });

    // Fire session-ready for a session that was never opened. The
    // listener's `getSessionStatus` returns state: 'absent', which
    // the index.ts guard already short-circuits, matching the
    // production wiring. The broadcast helper is never called.
    mgr.sessionReady?.('unknown-session');
    await new Promise((r) => setImmediate(r));

    expect(sent).toHaveLength(0);
  });

  test('getSessionStatus failure logs but does not throw -- broadcast safely skipped', async () => {
    const mgr = new FakeMgr();
    const driver = new OpenHandsAgentDriver(mgr);

    // Make getSessionStatus throw on the first call.
    const spy = vi
      .spyOn(driver, 'getSessionStatus')
      .mockRejectedValueOnce(new Error('status read failed'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const sent: Array<{ sessionId: string; message: unknown }> = [];
    const registry = {
      broadcastMessageToSession: (sessionId: string, message: unknown) =>
        sent.push({ sessionId, message }),
    };

    driver.onSessionReady((sessionId: string) => {
      void (async () => {
        try {
          const status = await driver.getSessionStatus(sessionId);
          if (status.state === 'absent') return;
          broadcastSessionState(registry, sessionId, status, 'ws-ready');
        } catch (err) {
          console.error(
            `[SessionState] ws-ready getSessionStatus failed for ${sessionId}:`,
            err,
          );
        }
      })();
    });

    await mgr.getOrCreateForSession('s1', 'w1');
    mgr.simulateWsOpen('s1');
    await new Promise((r) => setImmediate(r));

    expect(spy).toHaveBeenCalledWith('s1');
    expect(sent).toHaveLength(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SessionState] ws-ready getSessionStatus failed'),
      expect.any(Error),
    );
    errSpy.mockRestore();
    spy.mockRestore();
  });
});
