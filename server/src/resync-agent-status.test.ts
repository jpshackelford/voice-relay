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
    it('sends a single session-ai-status with connected:true', async () => {
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
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(parsed(ws)[0]).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: true,
        connecting: false,
        conversationId: 'c1',
      });
    });
  });

  describe('T-3.1.2: state=thinking', () => {
    it('sends session-ai-status THEN ai-thinking in that order', async () => {
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
      expect(ws.send).toHaveBeenCalledTimes(2);
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
    it('sends session-ai-status with connecting:true, connected:false', async () => {
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
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(parsed(ws)[0]).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: false,
        connecting: true,
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
    it('sends session-ai-status with error and both flags false', async () => {
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
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(parsed(ws)[0]).toEqual({
        type: 'session-ai-status',
        sessionId: 'sess-1',
        connected: false,
        connecting: false,
        error: 'something',
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
      // Verify the helper writes only to the WS argument.
      await resyncAgentSessionStatus(wsNew, 'sess-1', driver);
      expect(wsNew.send).toHaveBeenCalledTimes(1);
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
});
