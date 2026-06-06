/**
 * Driver-substitution proof test (issue #289).
 *
 * Substitutes the in-memory `FakeDriver` for the production
 * `OpenHandsAgentDriver` and exercises the platform's auto-connect path
 * end-to-end. If the seam is real — i.e. platform code consumes only the
 * `AgentDriver` interface, not the legacy `AISessionManager` — then this
 * test passes without importing anything from
 * `server/src/agent-driver/openhands.ts`.
 *
 * Covers:
 *   - T-2.3.F.1: autoConnect → driver.openSession + status broadcast
 *   - T-2.3.F.2: text-message path → driver.sendMessage + AI relay
 *   - T-2.3.F.3: no imports from `agent-driver/openhands` (enforced by
 *                the static T-2.3.M.1 grep gate; this file deliberately
 *                imports only the public seam to make the dependency
 *                obvious)
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { FakeDriver, type AgentDriver, type AgentEvent } from './agent-driver/index.js';
import { autoConnectAI, type AutoConnectDependencies } from './auto-connect.js';
import { relayAgentResponse } from './agent-message-relay.js';
import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { MessageStore } from './storage/index.js';
import type { TtsService } from './tts/index.js';
import type { RelayedTextMessage } from './types.js';

function createRegistry(): DeviceRegistry {
  return {
    broadcastMessageToSession: vi.fn(),
    broadcastToSession: vi.fn(),
    getMinKioskDisplayLines: vi.fn().mockReturnValue(10),
  } as unknown as DeviceRegistry;
}

function createSessionRepo(): SessionRepository {
  return {
    getDevices: vi.fn().mockReturnValue([{ id: 'device-1' }]),
    getDisplaySecret: vi.fn().mockReturnValue('secret-1'),
    setDisplaySecret: vi.fn().mockReturnValue('secret-1'),
    updateMetadata: vi.fn(),
    findById: vi.fn().mockReturnValue({ metadata: {} }),
  } as unknown as SessionRepository;
}

function createWorkspaceRepo(): WorkspaceRepository {
  return {
    getSettings: vi.fn().mockReturnValue(null),
  } as unknown as WorkspaceRepository;
}

function createStore(): MessageStore {
  return {
    append: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageStore;
}

interface Harness {
  driver: FakeDriver;
  deps: AutoConnectDependencies;
  registry: DeviceRegistry;
  sessionRepo: SessionRepository;
  store: MessageStore;
}

function buildHarness(): Harness {
  const driver = new FakeDriver();
  const registry = createRegistry();
  const sessionRepo = createSessionRepo();
  const store = createStore();
  const deps: AutoConnectDependencies = {
    registry,
    sessionRepository: sessionRepo,
    workspaceRepository: createWorkspaceRepo(),
    agentDriver: driver as AgentDriver,
    store,
    // Default to a workspace key so the FakeDriver test cases that just
    // want to drive through `openSession` succeed without each test
    // having to wire one. Cases that exercise the "no key configured"
    // short-circuit override this on `h.deps.getWorkspaceApiKey`.
    getWorkspaceApiKey: vi.fn().mockResolvedValue('test-workspace-key'),
  };
  return { driver, deps, registry, sessionRepo, store };
}

describe('driver-substitution proof (issue #289 / T-2.3.F.*)', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  test('T-2.3.F.1: autoConnect calls driver.openSession and broadcasts connected status', async () => {
    const openSpy = vi.spyOn(h.driver, 'openSession');

    await autoConnectAI('session-1', 'workspace-1', h.deps);

    // openSession called with the expected workspace + display settings.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('session-1', expect.objectContaining({
      workspaceId: 'workspace-1',
      displayLines: 10,
      displayApiSecret: 'secret-1',
    }));

    // Two legacy `session-ai-status` broadcasts: connecting → connected.
    // The unified `session-state` emission (issue #295) is interleaved
    // alongside each — filter to legacy here, assert session-state below.
    const broadcasts = (h.registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls;
    const legacy = broadcasts.filter((c) => (c[1] as { type?: string }).type === 'session-ai-status');
    expect(legacy).toHaveLength(2);
    expect(legacy[0][1]).toMatchObject({
      type: 'session-ai-status',
      sessionId: 'session-1',
      connecting: true,
      connected: false,
    });
    expect(legacy[1][1]).toMatchObject({
      type: 'session-ai-status',
      sessionId: 'session-1',
      connecting: false,
      connected: true,
      conversationId: expect.stringMatching(/^fake-conv-/),
    });
    // Issue #295 — also emits unified `session-state` messages.
    const sessionState = broadcasts.filter((c) => (c[1] as { type?: string }).type === 'session-state');
    expect(sessionState).toHaveLength(2);
    expect(sessionState[0][1]).toMatchObject({
      type: 'session-state',
      sessionId: 'session-1',
      ai: expect.objectContaining({ state: 'starting' }),
    });
    expect(sessionState[1][1]).toMatchObject({
      type: 'session-state',
      sessionId: 'session-1',
      ai: expect.objectContaining({
        state: 'ready',
        conversationId: expect.stringMatching(/^fake-conv-/),
      }),
    });

    // conversationId persisted to session metadata.
    expect(h.sessionRepo.updateMetadata).toHaveBeenCalledWith('session-1', {
      aiConversationId: expect.stringMatching(/^fake-conv-/),
    });
  });

  test('T-2.3.F.2: text-message path against FakeDriver yields agent event sequence', async () => {
    // Open the session first.
    await autoConnectAI('session-1', 'workspace-1', h.deps);

    // Script an agent response.
    h.driver.script('session-1', [
      { kind: 'message', text: 'hello from fake' } as AgentEvent,
    ]);

    // Run the relay (this is the text-handler's code path in production).
    await relayAgentResponse('session-1', 'workspace-1', 'u-1', 'hi', {
      agentDriver: h.deps.agentDriver,
      registry: h.deps.registry,
      store: h.deps.store,
      sessionRepository: h.deps.sessionRepository,
      ttsService: undefined,
    });

    // The relay should have persisted the AI's message.
    const storeAppendCalls = (h.store.append as ReturnType<typeof vi.fn>).mock.calls;
    expect(storeAppendCalls).toHaveLength(1);
    const appended = storeAppendCalls[0][0] as RelayedTextMessage;
    expect(appended).toMatchObject({
      type: 'text',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      senderId: 'ai',
      text: 'hello from fake',
      partial: false,
    });
    expect(appended.utteranceId).toMatch(/^ai-/);

    // And broadcast it to session devices.
    const broadcastCalls = (h.registry.broadcastToSession as ReturnType<typeof vi.fn>).mock.calls;
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0][0]).toMatchObject({
      type: 'text',
      senderId: 'ai',
      text: 'hello from fake',
    });
    expect(broadcastCalls[0][1]).toBe('session-1');
  });

  test('T-2.3.F.2b: TTS service is invoked when enabled', async () => {
    const tts = {
      isEnabled: vi.fn().mockReturnValue(true),
      synthesizeForSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as TtsService;

    await autoConnectAI('session-1', 'workspace-1', h.deps);
    h.driver.script('session-1', [
      { kind: 'message', text: 'speak this' } as AgentEvent,
    ]);

    await relayAgentResponse('session-1', 'workspace-1', 'u-1', 'go', {
      agentDriver: h.deps.agentDriver,
      registry: h.deps.registry,
      store: h.deps.store,
      sessionRepository: h.deps.sessionRepository,
      ttsService: tts,
    });

    expect(tts.isEnabled).toHaveBeenCalledWith('workspace-1');
    expect(tts.synthesizeForSession).toHaveBeenCalledWith(
      'speak this',
      'workspace-1',
      'session-1',
      expect.stringMatching(/^ai-/),
      undefined,
    );
  });

  test('T-2.3.F.2c: relay survives agent errors without throwing', async () => {
    await autoConnectAI('session-1', 'workspace-1', h.deps);
    h.driver.simulateError('session-1', 'BAD_THING');

    await expect(
      relayAgentResponse('session-1', 'workspace-1', 'u-1', 'oops', {
        agentDriver: h.deps.agentDriver,
        registry: h.deps.registry,
        store: h.deps.store,
        sessionRepository: h.deps.sessionRepository,
        ttsService: undefined,
      })
    ).resolves.toBeUndefined();

    // No store.append for the user-facing AI message on error.
    expect(h.store.append).not.toHaveBeenCalled();
  });

  test('T-2.3.F.4: closeSession on FakeDriver clears the session', async () => {
    await autoConnectAI('session-1', 'workspace-1', h.deps);
    expect(h.driver.hasSession('session-1')).toBe(true);

    await h.driver.closeSession('session-1');
    expect(h.driver.hasSession('session-1')).toBe(false);
  });

  test('T-2.3.F.5: missing workspace API key short-circuits with sanitized status (post-#404)', async () => {
    // Pre-#404 this asserted that an "unavailable" driver (no env key)
    // short-circuited auto-connect. After #404 there is no driver-level
    // availability bit — the only way to short-circuit is for the
    // workspace to have no configured API key.
    (h.deps.getWorkspaceApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const openSpy = vi.spyOn(h.driver, 'openSession');

    await autoConnectAI('session-1', 'workspace-1', h.deps);

    expect(openSpy).not.toHaveBeenCalled();
    // Filter to legacy `session-ai-status` — issue #295 adds a unified
    // `session-state` emission alongside each legacy broadcast.
    const broadcasts = (h.registry.broadcastMessageToSession as ReturnType<typeof vi.fn>).mock.calls;
    const legacy = broadcasts.filter((c) => (c[1] as { type?: string }).type === 'session-ai-status');
    expect(legacy).toHaveLength(2);
    expect(legacy[1][1]).toMatchObject({
      connecting: false,
      connected: false,
      error: 'OpenHands API not configured',
    });
    // And the unified session-state reflects degraded.
    const sessionState = broadcasts.filter((c) => (c[1] as { type?: string }).type === 'session-state');
    expect(sessionState).toHaveLength(2);
    expect(sessionState[1][1]).toMatchObject({
      type: 'session-state',
      sessionId: 'session-1',
      ai: expect.objectContaining({
        state: 'degraded',
        error: 'OpenHands API not configured',
      }),
    });
  });
});
