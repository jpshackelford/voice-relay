/**
 * Unit tests for the register-time AI session resync (issue #290).
 *
 * These tests substitute a `FakeDriver` (or per-test stub) for the
 * production `AgentDriver`, run the resync helper directly against a
 * `vi.fn`-backed mock WebSocket, and assert on the JSON payloads sent.
 *
 * The test IDs (T-3.1.x) match the test table in issue #290's expansion
 * comment so future work auditing coverage can cross-reference.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { resyncAgentSessionStatus } from './resync-agent-status.js';
import { FakeDriver } from './agent-driver/fake.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import type { AgentDriver, AgentSessionStatus } from './agent-driver/types.js';
import type {
  SessionAIStateRepository,
  SessionAIStateRow,
  SessionAIStateName,
} from './sessions/index.js';

interface MockWs {
  send: Mock<(data: string) => void>;
}

function makeWs(): MockWs {
  return { send: vi.fn<(data: string) => void>() };
}

function parsed(ws: MockWs): unknown[] {
  return ws.send.mock.calls.map(([payload]) => JSON.parse(payload));
}

/**
 * Build a minimal `AgentDriver` whose `getSessionStatus` returns a fixed
 * status. The other methods throw to prove they are not invoked.
 */
function driverWithStatus(
  status: AgentSessionStatus,
): Pick<AgentDriver, 'getSessionStatus'> & { calls: AgentSessionStatus[] } {
  const calls: AgentSessionStatus[] = [];
  return {
    calls,
    async getSessionStatus(sessionId: string) {
      calls.push({ ...status, sessionId });
      return { ...status, sessionId };
    },
  };
}

describe('resyncAgentSessionStatus', () => {
  describe('T-3.1.1: state=ready', () => {
    it('sends a session-ai-status with connected:true plus unified session-state (issue #295)', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'ready',
        conversationId: 'c1',
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      // Legacy + new unified `session-state` — pre-#295 was a single send.
      expect(ws.send).toHaveBeenCalledTimes(2);
      const [legacy, sessionState] = parsed(ws);
      expect(legacy).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: true,
        connecting: false,
        conversationId: 'c1',
      });
      expect(sessionState).toMatchObject({
        type: 'session-state',
        sessionId: 'sess-1',
        ai: expect.objectContaining({ state: 'ready', conversationId: 'c1' }),
      });
    });
  });

  describe('T-3.1.2: state=thinking', () => {
    it('sends session-ai-status THEN ai-thinking THEN unified session-state (issue #295)', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'thinking',
        conversationId: 'c1',
        error: null,
        thinkingSince: '2026-05-23T22:00:00Z',
        startingSince: null,
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      // Legacy pair (session-ai-status, ai-thinking) + new unified
      // session-state. Pre-#295 this was 2 messages.
      expect(ws.send).toHaveBeenCalledTimes(3);
      const messages = parsed(ws);
      expect(messages[0]).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: true,
        connecting: false,
        conversationId: 'c1',
      });
      expect(messages[1]).toEqual({
        type: 'ai-thinking',
        sessionId: 'sess-1',
        thinking: true,
        thinkingSince: '2026-05-23T22:00:00Z',
      });
      expect(messages[2]).toMatchObject({
        type: 'session-state',
        sessionId: 'sess-1',
        ai: expect.objectContaining({
          state: 'thinking',
          thinkingSince: '2026-05-23T22:00:00Z',
        }),
      });
    });

    it('still sends ai-thinking when thinkingSince is null (without the field)', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'thinking',
        conversationId: 'c1',
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      expect(parsed(ws)[1]).toEqual({
        type: 'ai-thinking',
        sessionId: 'sess-1',
        thinking: true,
      });
    });
  });

  describe('T-3.1.3: state=starting', () => {
    it('sends session-ai-status + session-state (issue #295) with connecting:true', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'starting',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: '2026-05-23T22:00:00Z',
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      expect(ws.send).toHaveBeenCalledTimes(2);
      const [legacy, sessionState] = parsed(ws);
      expect(legacy).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: false,
        connecting: true,
      });
      expect(sessionState).toMatchObject({
        type: 'session-state',
        ai: expect.objectContaining({ state: 'starting' }),
      });
    });
  });

  describe('T-3.1.4: state=reconnecting', () => {
    it('sends session-ai-status with connecting:true, connected:false', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'reconnecting',
        conversationId: 'c1',
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      expect(parsed(ws)[0]).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: false,
        connecting: true,
        conversationId: 'c1',
      });
    });
  });

  describe('T-3.1.5: state=degraded', () => {
    it('sends session-ai-status + session-state (issue #295) with error and both flags false', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'degraded',
        conversationId: null,
        error: 'something',
        thinkingSince: null,
        startingSince: null,
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      expect(ws.send).toHaveBeenCalledTimes(2);
      const [legacy, sessionState] = parsed(ws);
      expect(legacy).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: false,
        connecting: false,
        error: 'something',
      });
      expect(sessionState).toMatchObject({
        type: 'session-state',
        ai: expect.objectContaining({ state: 'degraded', error: 'something' }),
      });
    });
  });

  describe('T-3.1.6: state=absent — skip', () => {
    it('sends nothing to the WS', async () => {
      const ws = makeWs();
      const driver = driverWithStatus({
        sessionId: 'sess-1',
        state: 'absent',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('T-3.1.7: targets only the registering WS', () => {
    it('does not touch other devices', async () => {
      const wsNew = makeWs();
      const wsOther1 = makeWs();
      const wsOther2 = makeWs();
      const driver = new FakeDriver();
      await driver.openSession('sess-1', { workspaceId: 'ws-1' });
      // Verify the helper writes only to the WS argument (post-#295 the
      // count is 2: legacy + unified session-state).
      await resyncAgentSessionStatus(wsNew, 'sess-1', driver);
      expect(wsNew.send).toHaveBeenCalledTimes(2);
      expect(wsOther1.send).not.toHaveBeenCalled();
      expect(wsOther2.send).not.toHaveBeenCalled();
    });
  });

  describe('T-3.1.9: getSessionStatus throws — soft-fail', () => {
    it('does not throw; logs and returns', async () => {
      const ws = makeWs();
      const driver: Pick<AgentDriver, 'getSessionStatus'> = {
        async getSessionStatus() {
          throw new Error('boom');
        },
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        resyncAgentSessionStatus(ws, 'sess-1', driver),
      ).resolves.toBeUndefined();
      expect(ws.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('T-3.1.10: anonymous session skips resync', () => {
    let getSessionStatusSpy: Mock<(sessionId: string) => Promise<AgentSessionStatus>>;
    let driver: Pick<AgentDriver, 'getSessionStatus'>;

    beforeEach(() => {
      getSessionStatusSpy = vi.fn<(sessionId: string) => Promise<AgentSessionStatus>>();
      driver = { getSessionStatus: getSessionStatusSpy };
    });

    it('does not call getSessionStatus', async () => {
      const ws = makeWs();
      await resyncAgentSessionStatus(ws, ANONYMOUS_SESSION_ID, driver);
      expect(getSessionStatusSpy).not.toHaveBeenCalled();
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('end-to-end with FakeDriver', () => {
    it('resync after openSession (ready) matches the ready path', async () => {
      const driver = new FakeDriver();
      await driver.openSession('sess-1', { workspaceId: 'ws-1' });
      const ws = makeWs();
      await resyncAgentSessionStatus(ws, 'sess-1', driver);
      const [msg] = parsed(ws);
      // FakeDriver assigns a fabricated conversation id. We don't pin the
      // exact value — just the shape and the truthy `connected`.
      expect(msg).toMatchObject({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: true,
        connecting: false,
      });
      expect((msg as { conversationId?: string }).conversationId).toMatch(/^fake-conv-/);
    });

    it('resync when no session was ever opened sends nothing (state=absent)', async () => {
      const driver = new FakeDriver();
      const ws = makeWs();
      await resyncAgentSessionStatus(ws, 'never-opened', driver);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  /**
   * Issue #351 — when boot rehydration fails, the rehydrate pass
   * persists `state='degraded'` to `session_ai_state` and broadcasts
   * `degraded` to an empty room. The first kiosk to register after the
   * restart must learn the degraded state at register time, *not* on
   * the next utterance via the dropped-text handler.
   *
   * Driver-only behavior would observe `state='absent'` (no live
   * binding after a failed attach) and stay silent. The durable repo
   * is the source of truth that closes that gap.
   */
  describe('T-3.1.11: absent driver + degraded durable row (issue #351)', () => {
    function fakeAIStateRepo(
      seed: Partial<SessionAIStateRow>[] = [],
    ): Pick<SessionAIStateRepository, 'findBySessionId'> & {
      rows: Map<string, SessionAIStateRow>;
    } {
      const rows = new Map<string, SessionAIStateRow>();
      for (const r of seed) {
        if (!r.sessionId) continue;
        rows.set(r.sessionId, {
          sessionId: r.sessionId,
          conversationId: r.conversationId ?? 'conv-default',
          state: r.state ?? ('running' as SessionAIStateName),
          stateReason: r.stateReason ?? null,
          stateChangedAt: r.stateChangedAt ?? new Date().toISOString(),
          rebindAttempts: r.rebindAttempts ?? [],
          updatedAt: r.updatedAt ?? new Date().toISOString(),
        });
      }
      return {
        rows,
        findBySessionId: vi.fn((sessionId: string) => rows.get(sessionId) ?? null),
      };
    }

    const absentDriver = driverWithStatus({
      sessionId: 'sess-1',
      state: 'absent',
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: null,
    });

    it('synthesizes a degraded snapshot from the durable row when driver reports absent', async () => {
      const ws = makeWs();
      const repo = fakeAIStateRepo([
        {
          sessionId: 'sess-1',
          conversationId: 'conv-dead-123',
          state: 'degraded',
          stateReason: 'Upstream conversation no longer reachable',
        },
      ]);

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo);

      // Legacy `session-ai-status` + unified `session-state` — both
      // carry the synthesized degraded state.
      expect(ws.send).toHaveBeenCalledTimes(2);
      const [legacy, sessionState] = parsed(ws);
      expect(legacy).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: false,
        connecting: false,
        conversationId: 'conv-dead-123',
        error: 'Upstream conversation no longer reachable',
      });
      expect(sessionState).toEqual({
        type: 'session-state',
        sessionId: 'sess-1',
        ai: {
          sessionId: 'sess-1',
          state: 'degraded',
          conversationId: 'conv-dead-123',
          error: 'Upstream conversation no longer reachable',
          thinkingSince: null,
          startingSince: null,
        },
      });
    });

    it('falls back to a generic reason when the durable row has no stateReason', async () => {
      const ws = makeWs();
      const repo = fakeAIStateRepo([
        {
          sessionId: 'sess-1',
          conversationId: 'conv-2',
          state: 'degraded',
          stateReason: null,
        },
      ]);

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo);

      expect(ws.send).toHaveBeenCalledTimes(2);
      const [legacy] = parsed(ws);
      expect(legacy).toMatchObject({
        type: 'session-ai-status',
        connected: false,
        connecting: false,
        error: expect.stringMatching(/restart session/i),
      });
    });

    it('absent driver + no durable row → silent (regression of existing behavior)', async () => {
      const ws = makeWs();
      const repo = fakeAIStateRepo(); // empty

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo);

      expect(ws.send).not.toHaveBeenCalled();
      expect(repo.findBySessionId).toHaveBeenCalledWith('sess-1');
    });

    it('absent driver + running durable row → silent (must not over-broadcast)', async () => {
      const ws = makeWs();
      const repo = fakeAIStateRepo([
        { sessionId: 'sess-1', conversationId: 'conv-x', state: 'running' },
      ]);

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('absent driver + rebinding durable row → silent (only sticky degraded is surfaced)', async () => {
      const ws = makeWs();
      const repo = fakeAIStateRepo([
        { sessionId: 'sess-1', conversationId: 'conv-x', state: 'rebinding' },
      ]);

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('absent driver + ended durable row → silent', async () => {
      const ws = makeWs();
      const repo = fakeAIStateRepo([
        { sessionId: 'sess-1', conversationId: 'conv-x', state: 'ended' },
      ]);

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('non-absent driver state wins; durable row is not consulted', async () => {
      const ws = makeWs();
      const ready = driverWithStatus({
        sessionId: 'sess-1',
        state: 'ready',
        conversationId: 'live-conv',
        error: null,
        thinkingSince: null,
        startingSince: null,
      });
      const repo = fakeAIStateRepo([
        // Stale degraded row from a prior process — driver says ready,
        // which must win.
        {
          sessionId: 'sess-1',
          conversationId: 'old-conv',
          state: 'degraded',
          stateReason: 'old reason',
        },
      ]);

      await resyncAgentSessionStatus(ws, 'sess-1', ready, repo);

      const [legacy] = parsed(ws);
      expect(legacy).toMatchObject({
        type: 'session-ai-status',
        connected: true,
        connecting: false,
        conversationId: 'live-conv',
      });
      // Defensive: repo lookup is only performed on the absent branch.
      expect(repo.findBySessionId).not.toHaveBeenCalled();
    });

    it('repo lookup throwing is soft-failed (logs and stays silent)', async () => {
      const ws = makeWs();
      const repo: Pick<SessionAIStateRepository, 'findBySessionId'> = {
        findBySessionId: vi.fn(() => {
          throw new Error('db is wedged');
        }),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        resyncAgentSessionStatus(ws, 'sess-1', absentDriver, repo),
      ).resolves.toBeUndefined();

      expect(ws.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('absent driver + no repo provided → silent (back-compat with older callers)', async () => {
      const ws = makeWs();

      await resyncAgentSessionStatus(ws, 'sess-1', absentDriver /* no repo */);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});
