/**
 * Tests for `reportDroppedText` — the dropped-text observability hatch from
 * issue #341 § D, hardened in #373 to stop clobbering legitimate
 * `starting` / `reconnecting` snapshots.
 *
 * The handler always warn-logs once the input qualifies (non-anonymous,
 * non-partial, defined sessionId). It then consults the driver's
 * authoritative `getSessionStatus` and only broadcasts a `session-state`
 * snapshot when the driver reports `state === 'degraded'`. Any other
 * state (`absent`, `starting`, `reconnecting`, `ready`, `thinking`)
 * leaves the wire untouched so the next legitimate transition
 * broadcast wins.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportDroppedText } from './dropped-text-handler.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import type { DeviceRegistry } from './registry.js';
import type {
  AgentDriver,
  AgentSessionState,
  AgentSessionStatus,
} from './agent-driver/types.js';

function createMockRegistry() {
  return {
    broadcastMessageToSession: vi.fn(),
  } as unknown as DeviceRegistry;
}

function makeStatus(
  sessionId: string,
  state: AgentSessionState,
  overrides: Partial<AgentSessionStatus> = {},
): AgentSessionStatus {
  return {
    sessionId,
    state,
    conversationId: null,
    error: null,
    thinkingSince: null,
    startingSince: null,
    ...overrides,
  };
}

/**
 * Build a minimal `AgentDriver` mock whose only exercised method here is
 * `getSessionStatus`. The other methods throw if accidentally invoked, so
 * tests fail loudly if the handler grows new driver dependencies without
 * updating expectations.
 */
function createMockDriver(
  getSessionStatus: (sessionId: string) => Promise<AgentSessionStatus>,
): AgentDriver {
  const unreachable = (name: string) => () => {
    throw new Error(`AgentDriver.${name} should not be called by reportDroppedText`);
  };
  return {
    getSessionStatus: vi.fn(getSessionStatus),
    hasSession: unreachable('hasSession') as AgentDriver['hasSession'],
    openSession: unreachable('openSession') as AgentDriver['openSession'],
    closeSession: unreachable('closeSession') as AgentDriver['closeSession'],
    restartSession: unreachable('restartSession') as AgentDriver['restartSession'],
    sendMessage: unreachable('sendMessage') as AgentDriver['sendMessage'],
  } as unknown as AgentDriver;
}

describe('reportDroppedText (#341 § D, #373)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ─── Short-circuit guards (preserved from pre-#373 behaviour) ────────────

  test('returns false and does nothing for partial frames', async () => {
    const registry = createMockRegistry();
    const driver = createMockDriver(async () => makeStatus('s', 'degraded'));
    const result = await reportDroppedText({
      sessionId: 'session-abc',
      utteranceId: 'utt-1',
      partial: true,
      registry,
      agentDriver: driver,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
    expect(driver.getSessionStatus).not.toHaveBeenCalled();
  });

  test('returns false and does nothing for anonymous session', async () => {
    const registry = createMockRegistry();
    const driver = createMockDriver(async () => makeStatus('s', 'degraded'));
    const result = await reportDroppedText({
      sessionId: ANONYMOUS_SESSION_ID,
      utteranceId: 'utt-1',
      partial: false,
      registry,
      agentDriver: driver,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
    expect(driver.getSessionStatus).not.toHaveBeenCalled();
  });

  test('returns false and does nothing for undefined sessionId', async () => {
    const registry = createMockRegistry();
    const driver = createMockDriver(async () => makeStatus('s', 'degraded'));
    const result = await reportDroppedText({
      sessionId: undefined,
      utteranceId: 'utt-1',
      partial: false,
      registry,
      agentDriver: driver,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
    expect(driver.getSessionStatus).not.toHaveBeenCalled();
  });

  // ─── Warn log fires unconditionally for qualifying inputs ─────────────────

  test('always warn-logs once the input qualifies (regardless of driver state)', async () => {
    const registry = createMockRegistry();
    const driver = createMockDriver(async () => makeStatus('session-xyz', 'starting'));
    await reportDroppedText({
      sessionId: 'session-xyz',
      utteranceId: 'utt-abc-123',
      partial: false,
      registry,
      agentDriver: driver,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dropped message: no AI session for session-xyz'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('utt-abc-123'));
  });

  // ─── #373: per-state broadcast behaviour ─────────────────────────────────

  test('#373: broadcasts the driver-authoritative status when state is degraded', async () => {
    const registry = createMockRegistry();
    const degradedStatus = makeStatus('session-abc', 'degraded', {
      conversationId: 'conv-1',
      error: 'AI not attached — try restarting the session',
    });
    const driver = createMockDriver(async () => degradedStatus);

    const result = await reportDroppedText({
      sessionId: 'session-abc',
      utteranceId: 'utt-1',
      partial: false,
      registry,
      agentDriver: driver,
    });

    expect(result).toBe(true);
    expect(driver.getSessionStatus).toHaveBeenCalledWith('session-abc');
    expect(registry.broadcastMessageToSession).toHaveBeenCalledTimes(1);
    expect(registry.broadcastMessageToSession).toHaveBeenCalledWith(
      'session-abc',
      expect.objectContaining({
        type: 'session-state',
        sessionId: 'session-abc',
        ai: expect.objectContaining({
          sessionId: 'session-abc',
          state: 'degraded',
          conversationId: 'conv-1',
          error: expect.stringContaining('restart'),
        }),
      }),
    );
  });

  // The four states explicitly called out in the acceptance criteria
  // (`starting`, `reconnecting`, `absent`) plus `ready` and `thinking`
  // for completeness — all must NOT broadcast.
  test.each<AgentSessionState>(['absent', 'starting', 'reconnecting', 'ready', 'thinking'])(
    '#373: does NOT broadcast when driver reports state=%s (warn still fires)',
    async (state) => {
      const registry = createMockRegistry();
      const status = makeStatus('session-abc', state);
      const driver = createMockDriver(async () => status);

      const result = await reportDroppedText({
        sessionId: 'session-abc',
        utteranceId: 'utt-1',
        partial: false,
        registry,
        agentDriver: driver,
      });

      expect(result).toBe(true);
      expect(driver.getSessionStatus).toHaveBeenCalledWith('session-abc');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dropped message: no AI session for session-abc'),
      );
      expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
    },
  );

  // ─── Error-path: getSessionStatus throws ─────────────────────────────────

  test('swallows getSessionStatus rejections and does not broadcast', async () => {
    const registry = createMockRegistry();
    const driver = createMockDriver(async () => {
      throw new Error('boom');
    });

    const result = await reportDroppedText({
      sessionId: 'session-abc',
      utteranceId: 'utt-1',
      partial: false,
      registry,
      agentDriver: driver,
    });

    expect(result).toBe(true);
    // First warn is the dropped-message log; the failure is also logged.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dropped message: no AI session for session-abc'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getSessionStatus(session-abc) failed'),
      expect.any(Error),
    );
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
  });
});
