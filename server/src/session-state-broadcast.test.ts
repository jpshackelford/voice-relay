/**
 * Unit tests for the `session-state` broadcast helper (issue #295).
 *
 * Test IDs (T-3.6.S.*) map to the implementation-plan comment in the
 * issue.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildSessionStateMessage,
  broadcastSessionState,
} from './session-state-broadcast.js';
import type { AgentSessionStatus } from './agent-driver/types.js';

const readyStatus: AgentSessionStatus = {
  sessionId: 'sess-1',
  state: 'ready',
  conversationId: 'conv-1',
  error: null,
  thinkingSince: null,
  startingSince: null,
};

describe('session-state broadcast helper (issue #295)', () => {
  describe('T-3.6.S.1: buildSessionStateMessage', () => {
    it('transports the driver status 1:1 inside the `ai` field', () => {
      const msg = buildSessionStateMessage('sess-1', readyStatus);
      expect(msg).toEqual({
        type: 'session-state',
        sessionId: 'sess-1',
        ai: readyStatus,
      });
      // Same reference — we don't deep-clone (intentional; the helper is
      // a thin transport, not a defensive boundary).
      expect(msg.ai).toBe(readyStatus);
    });

    it('preserves all reserved fields (thinkingSince, startingSince, error)', () => {
      const thinking: AgentSessionStatus = {
        ...readyStatus,
        state: 'thinking',
        thinkingSince: '2026-05-24T22:00:00Z',
      };
      const msg = buildSessionStateMessage('sess-1', thinking);
      expect(msg.ai).toMatchObject({
        state: 'thinking',
        thinkingSince: '2026-05-24T22:00:00Z',
      });
    });
  });

  describe('T-3.6.S.2: broadcastSessionState success path', () => {
    it('calls registry.broadcastMessageToSession with the unified message', () => {
      const registry = { broadcastMessageToSession: vi.fn() };
      broadcastSessionState(registry, 'sess-1', readyStatus, 'unit-test');
      expect(registry.broadcastMessageToSession).toHaveBeenCalledTimes(1);
      expect(registry.broadcastMessageToSession).toHaveBeenCalledWith('sess-1', {
        type: 'session-state',
        sessionId: 'sess-1',
        ai: readyStatus,
      });
    });

    it('is a no-op when the registry is undefined', () => {
      expect(() =>
        broadcastSessionState(undefined, 'sess-1', readyStatus, 'unit-test'),
      ).not.toThrow();
    });
  });

  describe('T-3.6.S.3: broadcastSessionState swallows registry errors', () => {
    it('logs and does not rethrow', () => {
      const registry = {
        broadcastMessageToSession: vi.fn(() => {
          throw new Error('boom');
        }),
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() =>
        broadcastSessionState(registry, 'sess-1', readyStatus, 'unit-test'),
      ).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
