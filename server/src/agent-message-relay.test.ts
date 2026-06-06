/**
 * Tests for `relayAgentResponse` — the consumer of
 * `agentDriver.sendMessage`'s `AsyncIterable<AgentEvent>` that replaces
 * the legacy session-level `onMessage` callback (issue #289).
 *
 * Uses `FakeDriver` to exercise the iteration loop without OpenHands.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { FakeDriver, type AgentEvent } from './agent-driver/index.js';
import { relayAgentResponse, type AgentMessageRelayDeps } from './agent-message-relay.js';
import type { DeviceRegistry } from './registry.js';
import type { MessageStore } from './storage/index.js';
import type { SessionRepository } from './sessions/index.js';
import type { RelayedTextMessage } from './types.js';

function makeDeps(driver: FakeDriver, overrides: Partial<AgentMessageRelayDeps> = {}): AgentMessageRelayDeps {
  return {
    agentDriver: driver,
    registry: {
      broadcastToSession: vi.fn(),
    } as unknown as DeviceRegistry,
    store: {
      append: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageStore,
    sessionRepository: {
      findById: vi.fn().mockReturnValue({ metadata: {} }),
    } as unknown as SessionRepository,
    ...overrides,
  };
}

describe('relayAgentResponse', () => {
  let driver: FakeDriver;

  beforeEach(() => {
    driver = new FakeDriver();
  });

  test('broadcasts and persists a single agent message', async () => {
    driver.script('s1', [
      { kind: 'message', text: 'hello' } as AgentEvent,
    ]);
    const deps = makeDeps(driver);

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    const broadcastCalls = (deps.registry.broadcastToSession as ReturnType<typeof vi.fn>).mock.calls;
    expect(broadcastCalls).toHaveLength(1);
    const broadcast = broadcastCalls[0][0] as RelayedTextMessage;
    expect(broadcast).toMatchObject({
      type: 'text',
      senderId: 'ai',
      text: 'hello',
      sessionId: 's1',
      workspaceId: 'wk-1',
    });
    expect(broadcastCalls[0][1]).toBe('s1');

    expect(deps.store.append).toHaveBeenCalledTimes(1);
  });

  test('forwards serverTimestamp on messages that carry one', async () => {
    driver.script('s1', [
      { kind: 'message', text: 'tic', serverTimestamp: '2026-05-24T17:00:00Z' } as AgentEvent,
    ]);
    const deps = makeDeps(driver);

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    const broadcast = (deps.registry.broadcastToSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as RelayedTextMessage;
    expect(broadcast.serverTimestamp).toBe('2026-05-24T17:00:00Z');
  });

  test('swallows error events (no broadcast for kind=error)', async () => {
    driver.simulateError('s1', 'BAD');
    const deps = makeDeps(driver);

    await expect(relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps)).resolves.toBeUndefined();
    expect(deps.registry.broadcastToSession).not.toHaveBeenCalled();
    expect(deps.store.append).not.toHaveBeenCalled();
  });

  test('skips TTS when service is undefined', async () => {
    driver.script('s1', [{ kind: 'message', text: 'mute' } as AgentEvent]);
    const deps = makeDeps(driver);

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);
    // No assertion on TTS since none is provided — just ensures we don't crash.
    expect(deps.store.append).toHaveBeenCalledTimes(1);
  });

  test('skips TTS when service is disabled for the workspace', async () => {
    const tts = {
      isEnabled: vi.fn().mockReturnValue(false),
      synthesizeForSession: vi.fn().mockResolvedValue(undefined),
    };
    driver.script('s1', [{ kind: 'message', text: 'mute' } as AgentEvent]);
    const deps = makeDeps(driver, { ttsService: tts as never });

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    expect(tts.isEnabled).toHaveBeenCalledWith('wk-1');
    expect(tts.synthesizeForSession).not.toHaveBeenCalled();
  });

  test('forwards `sender` metadata to the driver (#375)', async () => {
    // Wrap the FakeDriver so we can inspect what was passed to sendMessage.
    const seen: Array<unknown> = [];
    const wrapper = {
      hasSession: (sid: string) => driver.hasSession(sid),
      openSession: driver.openSession.bind(driver),
      sendMessage: (sessionId: string, utteranceId: string, text: string, sender?: unknown) => {
        seen.push(sender);
        return driver.sendMessage(sessionId, utteranceId, text);
      },
      restartSession: driver.restartSession.bind(driver),
      getSessionStatus: driver.getSessionStatus.bind(driver),
      closeSession: driver.closeSession.bind(driver),
    };
    driver.script('s1', [{ kind: 'message', text: 'ack' } as AgentEvent]);
    const deps = makeDeps(driver, {
      agentDriver: wrapper as never,
      sender: {
        deviceId: 'd-1',
        senderName: 'Kitchen iPad',
        saidAtUtc: '2026-06-01T17:23:45Z',
        timezone: 'America/Los_Angeles',
      },
    });

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      deviceId: 'd-1',
      senderName: 'Kitchen iPad',
      saidAtUtc: '2026-06-01T17:23:45Z',
      timezone: 'America/Los_Angeles',
    });
  });

  test('forwards `engineSpeakerLabel` on the sender object when present (#411)', async () => {
    const seen: Array<unknown> = [];
    const wrapper = {
      hasSession: (sid: string) => driver.hasSession(sid),
      openSession: driver.openSession.bind(driver),
      sendMessage: (sessionId: string, utteranceId: string, text: string, sender?: unknown) => {
        seen.push(sender);
        return driver.sendMessage(sessionId, utteranceId, text);
      },
      restartSession: driver.restartSession.bind(driver),
      getSessionStatus: driver.getSessionStatus.bind(driver),
      closeSession: driver.closeSession.bind(driver),
    };
    driver.script('s1', [{ kind: 'message', text: 'ack' } as AgentEvent]);
    const deps = makeDeps(driver, {
      agentDriver: wrapper as never,
      sender: {
        deviceId: 'd-1',
        senderName: 'Kitchen iPad',
        saidAtUtc: '2026-06-01T17:23:45Z',
        timezone: 'America/Los_Angeles',
        engineSpeakerLabel: 'S1',
      },
    });

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      deviceId: 'd-1',
      senderName: 'Kitchen iPad',
      saidAtUtc: '2026-06-01T17:23:45Z',
      timezone: 'America/Los_Angeles',
      engineSpeakerLabel: 'S1',
    });
  });

  test('forwards `sender = undefined` when none was supplied (#375)', async () => {
    const seen: Array<unknown> = [];
    const wrapper = {
      hasSession: (sid: string) => driver.hasSession(sid),
      openSession: driver.openSession.bind(driver),
      sendMessage: (sessionId: string, utteranceId: string, text: string, sender?: unknown) => {
        seen.push(sender);
        return driver.sendMessage(sessionId, utteranceId, text);
      },
      restartSession: driver.restartSession.bind(driver),
      getSessionStatus: driver.getSessionStatus.bind(driver),
      closeSession: driver.closeSession.bind(driver),
    };
    driver.script('s1', [{ kind: 'message', text: 'ack' } as AgentEvent]);
    const deps = makeDeps(driver, { agentDriver: wrapper as never });

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeUndefined();
  });

  test('forwards a session TTS-settings override when present', async () => {
    const settings = { enabled: true, outputDeviceId: 'dev-1' };
    const tts = {
      isEnabled: vi.fn().mockReturnValue(true),
      synthesizeForSession: vi.fn().mockResolvedValue(undefined),
    };
    driver.script('s1', [{ kind: 'message', text: 'speak' } as AgentEvent]);
    const deps = makeDeps(driver, {
      ttsService: tts as never,
      sessionRepository: {
        findById: vi.fn().mockReturnValue({ metadata: { ttsSettings: settings } }),
      } as unknown as SessionRepository,
    });

    await relayAgentResponse('s1', 'wk-1', 'u-1', 'hi', deps);

    expect(tts.synthesizeForSession).toHaveBeenCalledWith(
      'speak',
      'wk-1',
      's1',
      expect.stringMatching(/^ai-/),
      settings,
    );
  });
});
