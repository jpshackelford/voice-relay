/**
 * Tests for OpenHands module - loadPrompt function, AISessionManager, formatEventSummary, and extractEventFields
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadPrompt, getServerUrl, AISessionManager, OpenHandsApiError, SandboxMissingError, SandboxResumeTimeoutError, SandboxResumeBudgetExhausted, UpstreamConversationEndedError, UpstreamCredentialsLostError, explainMissingHandshake, formatMissingHandshakeMessage, formatEventSummary, extractEventFields, extractEffectiveKind, shouldSkipForKioskTimeline, type AISession, type ThinkingChangeCallback, type SessionReadyCallback, type ConversationInfo } from './openhands.js';
import { RebindWindowTracker } from './agent-driver/rebind.js';

describe('getServerUrl', () => {
  test('returns BASE_URL when set', () => {
    const originalBaseUrl = process.env.BASE_URL;
    process.env.BASE_URL = 'https://app.no-hands.dev';
    try {
      expect(getServerUrl()).toBe('https://app.no-hands.dev');
    } finally {
      if (originalBaseUrl) {
        process.env.BASE_URL = originalBaseUrl;
      } else {
        delete process.env.BASE_URL;
      }
    }
  });

  test('returns localhost fallback in development environment', () => {
    const originalBaseUrl = process.env.BASE_URL;
    const originalPort = process.env.PORT;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.BASE_URL;
    process.env.PORT = '4000';
    process.env.NODE_ENV = 'development';
    try {
      expect(getServerUrl()).toBe('http://localhost:4000');
    } finally {
      if (originalBaseUrl) process.env.BASE_URL = originalBaseUrl;
      if (originalPort) process.env.PORT = originalPort;
      else delete process.env.PORT;
      if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('returns localhost fallback in test environment', () => {
    const originalBaseUrl = process.env.BASE_URL;
    const originalPort = process.env.PORT;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.BASE_URL;
    process.env.PORT = '3001';
    process.env.NODE_ENV = 'test';
    try {
      expect(getServerUrl()).toBe('http://localhost:3001');
    } finally {
      if (originalBaseUrl) process.env.BASE_URL = originalBaseUrl;
      if (originalPort) process.env.PORT = originalPort;
      else delete process.env.PORT;
      if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('uses default port 3001 when PORT not set', () => {
    const originalBaseUrl = process.env.BASE_URL;
    const originalPort = process.env.PORT;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.BASE_URL;
    delete process.env.PORT;
    process.env.NODE_ENV = 'development';
    try {
      expect(getServerUrl()).toBe('http://localhost:3001');
    } finally {
      if (originalBaseUrl) process.env.BASE_URL = originalBaseUrl;
      if (originalPort) process.env.PORT = originalPort;
      if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('throws error in production when BASE_URL not set', () => {
    const originalBaseUrl = process.env.BASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.BASE_URL;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => getServerUrl()).toThrow('BASE_URL environment variable is required in production for display API');
    } finally {
      if (originalBaseUrl) process.env.BASE_URL = originalBaseUrl;
      if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('works in production when BASE_URL is set', () => {
    const originalBaseUrl = process.env.BASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.BASE_URL = 'https://production.example.com';
    process.env.NODE_ENV = 'production';
    try {
      expect(getServerUrl()).toBe('https://production.example.com');
    } finally {
      if (originalBaseUrl) process.env.BASE_URL = originalBaseUrl;
      else delete process.env.BASE_URL;
      if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });
});

describe('loadPrompt', () => {
  describe('basic functionality', () => {
    test('loads unified system-prompt', () => {
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('Voice Relay Assistant');
      expect(prompt).toContain('/api/display');
    });

    test('unified prompt contains display API instructions', () => {
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('Display API');
      expect(prompt).toContain('DISPLAY_API_SECRET');
      expect(prompt).toContain('curl -X POST');
      expect(prompt).toContain('"type": "markdown"');
      expect(prompt).toContain('"type": "image"');
      expect(prompt).toContain('"type": "clear"');
    });

    test('unified prompt contains session settings API instructions', () => {
      const prompt = loadPrompt('system-prompt');
      // Section markers
      expect(prompt).toContain('Session Settings API');
      expect(prompt).toContain('When NOT to call this endpoint');
      // Endpoint + auth
      expect(prompt).toContain('PATCH');
      expect(prompt).toContain('/api/sessions/');
      expect(prompt).toContain('/settings');
      expect(prompt).toContain('Bearer $DISPLAY_API_SECRET');
      expect(prompt).toContain('curl -X PATCH');
      // All four mutable fields (mirrors SessionSettingsPatch shape)
      expect(prompt).toContain('"tts"');
      expect(prompt).toContain('"inputMode"');
      expect(prompt).toContain('"autoSubmit"');
      expect(prompt).toContain('"agentPrompt"');
      // Concrete trigger-phrase examples
      expect(prompt).toContain('"enabled": false');
      expect(prompt).toContain('"enabled": true');
      expect(prompt).toContain('"agentPrompt": null');
      expect(prompt).toContain('"inputMode": "visualizer"');
      expect(prompt).toContain('"autoSubmit": false');
      // Out-of-scope guidance
      expect(prompt).toContain('Device volume');
    });

    test('unified prompt contains voice response guidelines', () => {
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('spoken aloud via text-to-speech');
      expect(prompt).toContain('Keep responses to 2-4 sentences');
      expect(prompt).toContain('Be conversational and friendly');
    });

    test('unified prompt contains display constraints', () => {
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('Display Constraints');
      expect(prompt).toContain('NOT scrollable');
      expect(prompt).toContain('Maximum 10-12 lines of body text');
    });

    test('throws error for non-existent prompt', () => {
      expect(() => loadPrompt('non-existent-prompt')).toThrow('Prompt not found');
    });
  });

  describe('displayLines injection', () => {
    test('replaces display lines placeholder when provided', () => {
      const prompt = loadPrompt('system-prompt', 15);
      expect(prompt).toContain('Maximum 15 lines of body text');
      expect(prompt).toContain('content beyond 15 lines will be invisible');
    });

    test('keeps default display lines when not provided', () => {
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('Maximum 10-12 lines of body text');
      expect(prompt).toContain('content beyond ~10 lines will be invisible');
    });
  });

  describe('sessionId injection', () => {
    test('replaces {{SESSION_ID}} placeholder when sessionId provided', () => {
      const testSessionId = 'session_test_12345_abcde';
      const prompt = loadPrompt('system-prompt', undefined, undefined, testSessionId);
      
      // Should contain the actual session ID, not the placeholder
      expect(prompt).toContain(`"sessionId": "${testSessionId}"`);
      expect(prompt).not.toContain('{{SESSION_ID}}');
      
      // Verify it appears in all curl examples
      const sessionIdMatches = prompt.match(new RegExp(testSessionId, 'g'));
      expect(sessionIdMatches).toBeTruthy();
      // Should appear 12 times:
      //   - 4 in Display API curls (greeting, markdown, image, clear)
      //   - 1 in the Session Settings API prose line
      //     ("PATCH .../api/sessions/{{SESSION_ID}}/settings")
      //   - 5 in Session Settings API curls (tts off, tts on,
      //     autoSubmit, inputMode, agentPrompt null)
      //   - 2 in the verboseSttLogging curl examples (#470: on, off)
      // Bump this count when you add/remove references to
      // {{SESSION_ID}} so future drift is caught here.
      expect(sessionIdMatches!.length).toBe(12);
    });

    test('keeps {{SESSION_ID}} placeholder when sessionId not provided', () => {
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('{{SESSION_ID}}');
    });

    test('combines displayLines and sessionId injection', () => {
      const testSessionId = 'session_combined_test';
      const displayLines = 20;
      const prompt = loadPrompt('system-prompt', displayLines, undefined, testSessionId);
      
      // Both should be injected
      expect(prompt).toContain(`"sessionId": "${testSessionId}"`);
      expect(prompt).toContain('Maximum 20 lines of body text');
      expect(prompt).not.toContain('{{SESSION_ID}}');
    });

    test('handles special characters in sessionId', () => {
      const testSessionId = 'session-special_chars.123';
      const prompt = loadPrompt('system-prompt', undefined, undefined, testSessionId);
      expect(prompt).toContain(`"sessionId": "${testSessionId}"`);
    });

    test('escapes JSON-breaking characters in sessionId', () => {
      // Test that quotes are properly escaped to prevent broken JSON
      const testSessionId = 'session"test';
      const prompt = loadPrompt('system-prompt', undefined, undefined, testSessionId);

      // Should contain escaped version in JSON context
      expect(prompt).toContain('"sessionId": "session\\"test"');
      expect(prompt).not.toContain('{{SESSION_ID}}');

      // Verify the escaped JSON is valid by extracting and parsing
      const jsonMatch = prompt.match(/"sessionId":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      expect(jsonMatch).toBeTruthy();
    });

    test('escapes backslashes in sessionId', () => {
      // Test that backslashes are properly escaped
      const testSessionId = 'session\\test';
      const prompt = loadPrompt('system-prompt', undefined, undefined, testSessionId);

      // Should contain escaped backslash
      expect(prompt).toContain('"sessionId": "session\\\\test"');
    });

    test('handles empty string sessionId (no replacement)', () => {
      // Empty string is falsy, so no replacement should occur
      const prompt = loadPrompt('system-prompt', undefined, undefined, '');
      expect(prompt).toContain('{{SESSION_ID}}');
    });
  });

  describe('serverUrl injection', () => {
    test('replaces {{SERVER_URL}} with BASE_URL env var when set', () => {
      const originalBaseUrl = process.env.BASE_URL;
      process.env.BASE_URL = 'https://test.example.com';
      try {
        const prompt = loadPrompt('system-prompt');
        expect(prompt).toContain('curl -X POST https://test.example.com/api/display');
        expect(prompt).not.toContain('{{SERVER_URL}}');
      } finally {
        if (originalBaseUrl) {
          process.env.BASE_URL = originalBaseUrl;
        } else {
          delete process.env.BASE_URL;
        }
      }
    });

    test('replaces {{SERVER_URL}} with localhost fallback when BASE_URL not set in non-production', () => {
      const originalBaseUrl = process.env.BASE_URL;
      const originalPort = process.env.PORT;
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.BASE_URL;
      process.env.PORT = '3001';
      process.env.NODE_ENV = 'development';
      try {
        const prompt = loadPrompt('system-prompt');
        expect(prompt).toContain('curl -X POST http://localhost:3001/api/display');
        expect(prompt).not.toContain('{{SERVER_URL}}');
      } finally {
        if (originalBaseUrl) {
          process.env.BASE_URL = originalBaseUrl;
        }
        if (originalPort) {
          process.env.PORT = originalPort;
        } else {
          delete process.env.PORT;
        }
        if (originalNodeEnv) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    test('SERVER_URL appears in all display API examples', () => {
      const originalBaseUrl = process.env.BASE_URL;
      process.env.BASE_URL = 'https://app.no-hands.dev';
      try {
        const prompt = loadPrompt('system-prompt');
        // Count occurrences of the URL in curl commands
        const urlMatches = prompt.match(/https:\/\/app\.no-hands\.dev\/api\/display/g);
        expect(urlMatches).toBeTruthy();
        // Should appear 4 times (greeting, markdown, image, clear commands)
        expect(urlMatches!.length).toBe(4);
      } finally {
        if (originalBaseUrl) {
          process.env.BASE_URL = originalBaseUrl;
        } else {
          delete process.env.BASE_URL;
        }
      }
    });
  });

  describe('unified prompt for all device modes', () => {
    test('same prompt is used regardless of device mode', () => {
      // This test verifies the unified prompt approach - all sessions get the same prompt
      const prompt = loadPrompt('system-prompt');
      
      // Should have capabilities for both kiosk display and voice chat
      expect(prompt).toContain('Display Content');
      expect(prompt).toContain('Voice Responses');
      expect(prompt).toContain('/api/display');
      expect(prompt).toContain('text-to-speech');
    });

    test('display API is available even without displayLines', () => {
      // Mobile/chat sessions should still have display API knowledge
      const prompt = loadPrompt('system-prompt');
      expect(prompt).toContain('Display API');
      // URL should be templated from BASE_URL env var (defaults to localhost)
      expect(prompt).toContain('curl -X POST');
      expect(prompt).toContain('/api/display');
    });
  });
});

describe('AISessionManager', () => {
  let manager: AISessionManager;

  beforeEach(() => {
    // Create a new manager instance for each test
    // Note: This won't have the OpenHands client initialized (no API key in test env)
    manager = new AISessionManager();
  });

  afterEach(() => {
    // Clean up any sessions
    manager.shutdown();
  });

  describe('session-centric methods', () => {
    describe('hasSessionAI', () => {
      test('returns false when no session exists', () => {
        expect(manager.hasSessionAI('nonexistent-session')).toBe(false);
      });

      test('returns false for empty string', () => {
        expect(manager.hasSessionAI('')).toBe(false);
      });
    });

    describe('getSessionAI', () => {
      test('returns undefined when no session exists', () => {
        expect(manager.getSessionAI('nonexistent-session')).toBeUndefined();
      });

      test('returns undefined for empty string', () => {
        expect(manager.getSessionAI('')).toBeUndefined();
      });
    });

    describe('getOrCreateForSession', () => {
      test('throws when no workspace API key is provided (#404 contract)', async () => {
        // Post-#404: the env-keyed singleton fallback was removed. A
        // fresh manager with no test-installed client and no
        // `options.apiKey` must surface a typed-message error rather
        // than silently fall through to a stale singleton.
        await expect(
          manager.getOrCreateForSession(
            'test-session',
            'test-workspace',
            () => {}
          )
        ).rejects.toThrow(/OpenHands API not configured.*#404/);
      });

      test('throws even when `options.apiKey` is the empty string (#404)', async () => {
        // Empty/whitespace strings must NOT be treated as "key supplied"
        // — they'd just blow up at upstream auth time with a confusing
        // 401. We want the same typed error as the no-key case.
        await expect(
          manager.getOrCreateForSession(
            'test-session',
            'test-workspace',
            () => {},
            { apiKey: '' },
          )
        ).rejects.toThrow(/OpenHands API not configured.*#404/);
      });

      test('throws when apiKey is whitespace (#404)', async () => {
        // Pr-review regression: the sibling test's comment promised
        // "Empty/whitespace strings" but only empty was exercised. An
        // all-spaces key was previously truthy and would have built an
        // `OpenHandsClient` with a doomed token. The manager now treats
        // `apiKey?.trim()` falsiness the same as missing, surfacing the
        // typed `#404` error instead of an upstream 401.
        await expect(
          manager.getOrCreateForSession(
            'test-session',
            'test-workspace',
            () => {},
            { apiKey: '   ' },
          )
        ).rejects.toThrow(/OpenHands API not configured.*#404/);
      });
    });

    describe('attachExistingForSession (#404 contract)', () => {
      test('throws when neither test-client nor workspace API key is provided', async () => {
        // Mirror of the `getOrCreateForSession` post-#404 contract:
        // attach-existing has no env fallback either. Without a
        // `setClientForTesting` seam *and* without `options.apiKey`,
        // we must throw — not silently no-op.
        await expect(
          manager.attachExistingForSession(
            'sess-no-key',
            'ws-no-key',
            'conv-x',
            () => {},
          )
        ).rejects.toThrow(/OpenHands API not configured.*#404/);
      });
    });

    describe('sendSessionMessage', () => {
      test('throws error when no session exists', async () => {
        await expect(
          manager.sendSessionMessage('nonexistent-session', 'Hello')
        ).rejects.toThrow('No active AI session for this VR session');
      });

      test('prepends a voice-relay header when sender metadata is provided (#375)', async () => {
        // Hand-roll a session with a stubbed WS so we can inspect what's
        // sent on the wire. Skipping `getOrCreateForSession` keeps the
        // test focused on the header-prepending behaviour.
        const sent: string[] = [];
        const fakeWs = {
          readyState: 1, // WebSocket.OPEN
          send: (s: string) => sent.push(s),
          close: () => {},
        };
        const session: AISession = {
          conversationId: 'conv-h',
          taskId: 'task-h',
          sessionId: 'sess-h',
          mode: 'kiosk',
          agentServerUrl: 'https://agent.example.com',
          sessionApiKey: 'K',
          reconnectAttempts: 0,
          maxReconnectAttempts: 5,
          isThinking: false,
          ws: fakeWs as never,
        };
        // Use the public seam used elsewhere in this file to seed the map.
        (manager as unknown as { sessionAI: Map<string, AISession> })
          .sessionAI.set('sess-h', session);

        await manager.sendSessionMessage('sess-h', 'hello', {
          deviceId: 'd-h',
          senderName: 'Kitchen iPad',
          saidAtUtc: '2026-06-01T17:23:45Z',
          timezone: 'America/Los_Angeles',
        });

        expect(sent).toHaveLength(1);
        const payload = JSON.parse(sent[0]) as {
          role: string;
          content: Array<{ text: string }>;
        };
        const wireText = payload.content[0].text;
        // First turn from this device: announcement + unknown-speaker
        // line (#431) + anchor, then the raw user text on a separate
        // line. The `[speaker id=unknown device=d-h]` line is emitted
        // because no `speaker` was supplied, signalling to the agent
        // that the human is unidentified.
        expect(wireText).toBe(
          '[vr A=Kitchen iPad tz=America/Los_Angeles]\n[speaker id=unknown device=d-h]\n[t=2026-06-01T17:23Z]\nhello',
        );

        // Second turn from the same device, within the quiet period, must
        // not re-emit any header — just the message text.
        await manager.sendSessionMessage('sess-h', 'follow-up', {
          deviceId: 'd-h',
          senderName: 'Kitchen iPad',
          saidAtUtc: '2026-06-01T17:23:55Z',
          timezone: 'America/Los_Angeles',
        });
        const followUp = JSON.parse(sent[1]).content[0].text;
        expect(followUp).toBe('follow-up');
      });

      test('omits the header entirely when sender is not provided (#375)', async () => {
        const sent: string[] = [];
        const fakeWs = {
          readyState: 1,
          send: (s: string) => sent.push(s),
          close: () => {},
        };
        const session: AISession = {
          conversationId: 'conv-nh',
          taskId: 'task-nh',
          sessionId: 'sess-nh',
          mode: 'kiosk',
          agentServerUrl: 'https://agent.example.com',
          sessionApiKey: 'K',
          reconnectAttempts: 0,
          maxReconnectAttempts: 5,
          isThinking: false,
          ws: fakeWs as never,
        };
        (manager as unknown as { sessionAI: Map<string, AISession> })
          .sessionAI.set('sess-nh', session);

        await manager.sendSessionMessage('sess-nh', 'plain hello');

        const wireText = JSON.parse(sent[0]).content[0].text;
        expect(wireText).toBe('plain hello');
      });
    });

    describe('endSessionAI', () => {
      test('does nothing when no session exists', async () => {
        // Should not throw
        await expect(
          manager.endSessionAI('nonexistent-session')
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('thinking state callback', () => {
    test('setThinkingChangeCallback sets the callback', () => {
      const callback: ThinkingChangeCallback = vi.fn();
      manager.setThinkingChangeCallback(callback);
      // Callback is set - verified through integration behavior
      // Direct testing would require accessing private fields
      expect(true).toBe(true);
    });

    test('setThinkingChangeCallback accepts undefined to clear', () => {
      const callback: ThinkingChangeCallback = vi.fn();
      manager.setThinkingChangeCallback(callback);
      manager.setThinkingChangeCallback(undefined);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  // #458 — the session-ready callback fires from `ws.on('open')` so the
  // platform can re-broadcast `session-state` once the upstream binding
  // is usable. Without this fan-out the kiosk indicator stays on
  // 'starting' until the first user message drives the existing
  // thinking-change handler.
  describe('session ready callback', () => {
    test('setSessionReadyCallback sets the callback', () => {
      const callback: SessionReadyCallback = vi.fn();
      manager.setSessionReadyCallback(callback);
      // Direct testing requires accessing private fields; verified
      // through integration behaviour in the dedicated WS-mock test.
      expect(true).toBe(true);
    });

    test('setSessionReadyCallback accepts undefined to clear', () => {
      const callback: SessionReadyCallback = vi.fn();
      manager.setSessionReadyCallback(callback);
      manager.setSessionReadyCallback(undefined);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  // `isAvailable` describe block removed in #404. The probe was a relic
  // of the env-keyed singleton client fallback. Now that per-workspace
  // API keys (#403, #406) are the only credential source, "available"
  // can only be answered per-workspace at session-open time — there is
  // no manager-level state to interrogate.

  describe('shutdown', () => {
    test('cleans up without error when no sessions exist', async () => {
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });
});

describe('AISessionManager.attachExistingForSession (#341)', () => {
  interface FakeClient {
    getConversation: ReturnType<typeof vi.fn>;
  }

  function makeClient(response: unknown | Error): FakeClient {
    return {
      getConversation: vi.fn(async () => {
        if (response instanceof Error) throw response;
        return response;
      }),
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  test('attaches to an existing conversation and skips startConversation', async () => {
    const client = makeClient({
      id: 'conv-existing',
      status: 'READY',
      session_api_key: 'KEY-X',
      conversation_url: 'https://agent.example.com/api/v1/conversations/conv-existing',
    });
    manager.setClientForTesting(client as never);

    const session = await manager.attachExistingForSession(
      'sess-1',
      'ws-1',
      'conv-existing',
      () => {},
    );

    expect(session.conversationId).toBe('conv-existing');
    expect(session.sessionApiKey).toBe('KEY-X');
    expect(session.agentServerUrl).toBe('https://agent.example.com');
    expect(client.getConversation).toHaveBeenCalledTimes(1);
    expect(client.getConversation).toHaveBeenCalledWith('conv-existing');
    expect(manager.hasSessionAI('sess-1')).toBe(true);

    // Tear down the synchronously-created WS so the test process exits.
    await manager.endSessionAI('sess-1');
  });

  test('is idempotent — second call returns the existing binding', async () => {
    const client = makeClient({
      id: 'conv-x',
      session_api_key: 'KEY-X',
      conversation_url: 'https://agent.example.com/api/v1/...',
    });
    manager.setClientForTesting(client as never);

    const first = await manager.attachExistingForSession('sess-1', 'ws-1', 'conv-x', () => {});
    const second = await manager.attachExistingForSession('sess-1', 'ws-1', 'conv-x', () => {});

    expect(second).toBe(first);
    // getConversation was only called once
    expect(client.getConversation).toHaveBeenCalledTimes(1);

    await manager.endSessionAI('sess-1');
  });

  test('throws UpstreamConversationEndedError when getConversation returns null', async () => {
    const client = makeClient(null);
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-gone', 'ws-1', 'conv-dead', () => {}),
    ).rejects.toBeInstanceOf(UpstreamConversationEndedError);
    expect(manager.hasSessionAI('sess-gone')).toBe(false);
  });

  test('throws UpstreamConversationEndedError when getConversation throws', async () => {
    const client = makeClient(new Error('upstream 404'));
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-fail', 'ws-1', 'conv-broken', () => {}),
    ).rejects.toBeInstanceOf(UpstreamConversationEndedError);
    expect(manager.hasSessionAI('sess-fail')).toBe(false);
  });

  test('throws UpstreamConversationEndedError when WS handshake materials are missing', async () => {
    const client = makeClient({
      id: 'conv-incomplete',
      status: 'READY',
      // Missing session_api_key and conversation_url
    });
    manager.setClientForTesting(client as never);

    const err = await manager
      .attachExistingForSession('sess-incomplete', 'ws-1', 'conv-incomplete', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    // Issue #405: the thrown error carries a typed `reason` and a
    // self-describing message that names the cause. With no
    // `sandbox_status` signal on the record and no preceding poll
    // error, the helper falls through to `unknown`.
    const upstream = err as UpstreamConversationEndedError;
    expect(upstream.reason).toBe('unknown');
    expect(upstream.message).toMatch(/cannot open a WS session/);
    expect(upstream.message).not.toMatch(/missing WS handshake materials/);
    expect(manager.hasSessionAI('sess-incomplete')).toBe(false);
  });

  test('throws when no client is configured', async () => {
    manager.setClientForTesting(null);

    await expect(
      manager.attachExistingForSession('sess-noclient', 'ws-1', 'conv-x', () => {}),
    ).rejects.toThrow('OpenHands API not configured');
  });

  test('getOrCreateForSession with existingConversationId routes to attach path', async () => {
    const client = makeClient({
      id: 'conv-attach',
      status: 'READY',
      session_api_key: 'KEY-A',
      conversation_url: 'https://agent.example.com/api/v1/conversations/conv-attach',
    });
    // `startConversation` should never be called — only `getConversation`.
    (client as unknown as { startConversation?: ReturnType<typeof vi.fn> }).startConversation = vi.fn();
    manager.setClientForTesting(client as never);

    const session = await manager.getOrCreateForSession(
      'sess-route',
      'ws-1',
      () => {},
      { existingConversationId: 'conv-attach' },
    );

    expect(session.conversationId).toBe('conv-attach');
    expect(client.getConversation).toHaveBeenCalledWith('conv-attach');
    expect(
      (client as unknown as { startConversation: ReturnType<typeof vi.fn> }).startConversation,
    ).not.toHaveBeenCalled();

    await manager.endSessionAI('sess-route');
  });
});

/**
 * Tests for the PAUSED-sandbox recovery branch added to the attach path
 * by issue #370. Mirrors the
 * `refreshSessionCredentials PAUSED handling (#360)` suite below — the
 * two code paths share the same `resumeSandbox` + `pollSandboxRunning`
 * helpers and must stay in lockstep.
 *
 * The attach path is the entry point for two production scenarios:
 *   1. Startup rehydration (`agent-rehydrate.ts`) — server restart with
 *      a session whose upstream sandbox is currently PAUSED.
 *   2. Device-register auto-attach (`auto-connect.ts`) — kiosk reloaded
 *      after the sandbox-pause window.
 *
 * Both upstream callers catch generically and surface `degraded`, so
 * these tests assert behaviour at the manager seam rather than the
 * driver-level surface.
 */
describe('AISessionManager.attachExistingForSession PAUSED handling (#370)', () => {
  interface FakeClient {
    getConversation: ReturnType<typeof vi.fn>;
    resumeSandbox: ReturnType<typeof vi.fn>;
  }

  /**
   * Build a fake client where getConversation returns each queued response
   * in order. `Error`-typed entries are thrown instead of resolved. Each
   * test queues exactly the sequence of GET results it expects.
   */
  function makeClient(
    getConvResponses: unknown[],
    resumeImpl: () => Promise<void> = async () => {},
  ): FakeClient {
    const calls = getConvResponses.slice();
    return {
      getConversation: vi.fn(async () => {
        if (calls.length === 0) {
          throw new Error('FakeClient: no more queued getConversation responses');
        }
        const next = calls.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
      resumeSandbox: vi.fn(resumeImpl),
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
    // Tight polling so the suite stays fast. Production defaults are 30 s /
    // 2 s; the budget/interval ratio still exercises one or two polls.
    manager.setResumePollOptionsForTesting({ budgetMs: 200, intervalMs: 5 });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  test('PAUSED → resume → RUNNING happy path: attach succeeds with fresh creds', async () => {
    // First GET returns PAUSED with sandbox_id; resume succeeds; second
    // GET returns RUNNING with a fresh key + URL. Attach should construct
    // an AISession with the polled values, and the resume counter should
    // bump.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-123',
        session_api_key: null,
        conversation_url: null,
      },
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        sandbox_id: 'sbx-123',
        session_api_key: 'KEY-X',
        conversation_url: 'https://agent.example.com/api/v1/conv/conv-paused',
      },
    ]);
    manager.setClientForTesting(client as never);

    expect(manager.getSandboxResumeCount()).toBe(0);

    const session = await manager.attachExistingForSession(
      'sess-paused',
      'ws-1',
      'conv-paused',
      () => {},
    );

    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(client.resumeSandbox).toHaveBeenCalledWith('sbx-123');
    expect(client.getConversation).toHaveBeenCalledTimes(2);
    expect(session.conversationId).toBe('conv-paused');
    expect(session.sessionApiKey).toBe('KEY-X');
    expect(session.agentServerUrl).toBe('https://agent.example.com');
    expect(manager.getSandboxResumeCount()).toBe(1);
    expect(manager.hasSessionAI('sess-paused')).toBe(true);

    await manager.endSessionAI('sess-paused');
  });

  test('PAUSED → resume → poll skips STARTING and resolves on RUNNING', async () => {
    // Validates the polling state machine: STARTING means "wait, not
    // ready" — the attach must wait for RUNNING.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-99',
      },
      { id: 'conv-paused', status: 'READY', sandbox_status: 'STARTING' },
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'KEY-Y',
        conversation_url: 'https://agent.example.com/api/v1/',
      },
    ]);
    manager.setClientForTesting(client as never);

    const session = await manager.attachExistingForSession(
      'sess-starting',
      'ws-1',
      'conv-paused',
      () => {},
    );

    expect(client.getConversation).toHaveBeenCalledTimes(3);
    expect(session.sessionApiKey).toBe('KEY-Y');

    await manager.endSessionAI('sess-starting');
  });

  test('PAUSED with no sandbox_id → UpstreamConversationEndedError (no resume attempted)', async () => {
    // Platform contract violation: PAUSED must come with a sandbox_id we
    // can resume. Without one we surface as ended so the caller drives
    // `degraded`.
    const client = makeClient([
      {
        id: 'conv-broken',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: undefined,
      },
    ]);
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-broken', 'ws-1', 'conv-broken', () => {}),
    ).rejects.toBeInstanceOf(UpstreamConversationEndedError);
    expect(client.resumeSandbox).not.toHaveBeenCalled();
    expect(manager.hasSessionAI('sess-broken')).toBe(false);
  });

  test('resume HTTP 404 → UpstreamConversationEndedError (sandbox gone)', async () => {
    // 404 from POST /sandboxes/{id}/resume means the sandbox is genuinely
    // missing. The attach path has no rebind fallback (it's keyed on a
    // specific conversation id), so surface as ended.
    const client = makeClient(
      [
        {
          id: 'conv-gone',
          status: 'READY',
          sandbox_status: 'PAUSED',
          sandbox_id: 'sbx-gone',
        },
      ],
      async () => {
        throw new OpenHandsApiError(404, 'Sandbox not found', null);
      },
    );
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-gone', 'ws-1', 'conv-gone', () => {}),
    ).rejects.toBeInstanceOf(UpstreamConversationEndedError);
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(manager.getSandboxResumeCount()).toBe(0);
    expect(manager.hasSessionAI('sess-gone')).toBe(false);
  });

  test('PAUSED → resume → MISSING after resume → UpstreamConversationEndedError', async () => {
    // Race: the sandbox vanished between resume and the next poll. We
    // surface as ended so the caller drives `degraded` (acceptance
    // criterion: rehydration against a MISSING sandbox still throws
    // UpstreamConversationEndedError).
    const client = makeClient([
      {
        id: 'conv-vanish',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-x',
      },
      { id: 'conv-vanish', status: 'READY', sandbox_status: 'MISSING' },
    ]);
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-vanish', 'ws-1', 'conv-vanish', () => {}),
    ).rejects.toBeInstanceOf(UpstreamConversationEndedError);
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(manager.hasSessionAI('sess-vanish')).toBe(false);
  });

  test('PAUSED → resume budget exhausted → SandboxResumeBudgetExhausted', async () => {
    // Pre-seed the resume tracker with three successes — the 4th attempt
    // must short-circuit without calling resume. The driver layer
    // catches generically and surfaces `degraded`.
    const tracker = new RebindWindowTracker();
    tracker.recordSuccess('conv-wedged');
    tracker.recordSuccess('conv-wedged');
    tracker.recordSuccess('conv-wedged');
    manager.setResumeTrackerForTesting(tracker);

    const client = makeClient([
      {
        id: 'conv-wedged',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-wedged',
      },
    ]);
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-wedged', 'ws-1', 'conv-wedged', () => {}),
    ).rejects.toBeInstanceOf(SandboxResumeBudgetExhausted);
    expect(client.resumeSandbox).not.toHaveBeenCalled();
    expect(manager.hasSessionAI('sess-wedged')).toBe(false);
  });

  test('PAUSED → resume → poll budget exhausted → SandboxResumeTimeoutError', async () => {
    // Stay in STARTING past the polling budget. Surface the timeout to
    // operators (distinct from MISSING / ended so prod logs can
    // distinguish a wedged platform); the driver still degrades cleanly.
    manager.setResumePollOptionsForTesting({ budgetMs: 10, intervalMs: 5 });
    const responses: unknown[] = [
      {
        id: 'conv-slow',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-slow',
      },
    ];
    // Queue many STARTING responses; the loop will exhaust the budget
    // before any RUNNING reply.
    for (let i = 0; i < 50; i++) {
      responses.push({ id: 'conv-slow', status: 'READY', sandbox_status: 'STARTING' });
    }
    const client = makeClient(responses);
    manager.setClientForTesting(client as never);

    await expect(
      manager.attachExistingForSession('sess-slow', 'ws-1', 'conv-slow', () => {}),
    ).rejects.toBeInstanceOf(SandboxResumeTimeoutError);
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(manager.hasSessionAI('sess-slow')).toBe(false);
  });

  test('RUNNING (no PAUSED) bypasses resume — existing happy path unaffected', async () => {
    // Regression guard: a conversation that's already RUNNING must not
    // trigger resume at all. The existing happy-path attach test at line
    // 439 covers the non-PAUSED case; this test additionally asserts the
    // resume mock was never called.
    const client = makeClient([
      {
        id: 'conv-fine',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'KEY-A',
        conversation_url: 'https://agent.example.com/api/v1/conv/conv-fine',
      },
    ]);
    manager.setClientForTesting(client as never);

    const session = await manager.attachExistingForSession(
      'sess-fine',
      'ws-1',
      'conv-fine',
      () => {},
    );

    expect(client.resumeSandbox).not.toHaveBeenCalled();
    expect(session.sessionApiKey).toBe('KEY-A');
    expect(manager.getSandboxResumeCount()).toBe(0);

    await manager.endSessionAI('sess-fine');
  });

  test('log line emitted on successful resume from attach', async () => {
    // The `(attach)` marker in the log lets operators distinguish which
    // code path resumed the sandbox in prod journals.
    const client = makeClient([
      {
        id: 'conv-log',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-log',
      },
      {
        id: 'conv-log',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'KEY-L',
        conversation_url: 'https://agent.example.com/api/v1/',
      },
    ]);
    manager.setClientForTesting(client as never);

    const calls: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { calls.push(args); };
    try {
      await manager.attachExistingForSession('sess-log', 'ws-1', 'conv-log', () => {});
    } finally {
      console.log = originalLog;
    }
    const resumeLogged = calls.some(
      ([first]) =>
        typeof first === 'string' &&
        first.includes('sandbox resumed for conversation') &&
        first.includes('(attach)'),
    );
    expect(resumeLogged).toBe(true);

    await manager.endSessionAI('sess-log');
  });
});

describe('AISession interface', () => {
  test('has required thinking state fields', () => {
    // Type-level test to verify interface shape
    const session: AISession = {
      conversationId: 'conv-123',
      taskId: 'task-123',
      mode: 'kiosk',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
    };
    
    expect(session.isThinking).toBe(false);
    expect(session.pendingMessageId).toBeUndefined();
    expect(session.lastMessageSentAt).toBeUndefined();
  });

  test('supports session-centric fields', () => {
    const session: AISession = {
      conversationId: 'conv-123',
      taskId: 'task-123',
      sessionId: 'session-456',  // Session-centric
      mode: 'kiosk',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: true,
      pendingMessageId: 'msg-789',
      lastMessageSentAt: Date.now(),
    };
    
    expect(session.sessionId).toBe('session-456');
  });
});

/**
 * Tests for the typed "missing WS handshake materials" classification
 * introduced by issue #405. Covers the pure helper
 * `explainMissingHandshake`, the message renderer
 * `formatMissingHandshakeMessage`, and the `reason` field that both
 * throw sites (create + attach) now attach to
 * `UpstreamConversationEndedError`.
 *
 * Acceptance criteria mapping (issue #405):
 *   - `MissingWsHandshakeReason` exported and used at both throw sites
 *     → covered here + by the attach-path "WS handshake materials are
 *     missing" test in the #341 suite (asserts `.reason === 'unknown'`
 *     and the new self-describing message).
 *   - `explainMissingHandshake` unit-tested for all five branches →
 *     `explainMissingHandshake` suite below.
 *   - The thrown error carries a `reason` and a self-describing
 *     message → `attachExistingForSession (#405) — typed reason` and
 *     `getOrCreateForSession (#405) — typed reason` suites below.
 */
describe('explainMissingHandshake (#405)', () => {
  /**
   * Build a minimal `ConversationInfo` fixture so each branch test
   * keeps to the field(s) it actually depends on. `id` and `status`
   * are required by the interface; everything else is opt-in.
   */
  function info(overrides: Partial<ConversationInfo> = {}): ConversationInfo {
    return { id: 'conv-x', status: 'READY', ...overrides };
  }

  test('returns "auth-rejected" when lastError is 401 NoCredentialsError', () => {
    const err = new OpenHandsApiError(
      401,
      'Unauthorized',
      null,
      JSON.stringify({ error: 'NoCredentialsError' }),
    );
    expect(explainMissingHandshake(info(), err)).toBe('auth-rejected');
  });

  test('returns "auth-rejected" even when sandbox_status would otherwise match', () => {
    // Priority test: a 401 NoCredentialsError observed during polling
    // wins over a stale `sandbox_status: 'STOPPED'` on the record.
    const err = new OpenHandsApiError(
      401,
      'Unauthorized',
      null,
      '{"error":"NoCredentialsError"}',
    );
    expect(
      explainMissingHandshake(info({ sandbox_status: 'STOPPED' }), err),
    ).toBe('auth-rejected');
  });

  test('does NOT classify as "auth-rejected" when 401 body lacks NoCredentialsError', () => {
    const err = new OpenHandsApiError(401, 'Unauthorized', null, 'something else');
    expect(explainMissingHandshake(info(), err)).toBe('unknown');
  });

  test('does NOT classify as "auth-rejected" for non-401 errors', () => {
    const err = new OpenHandsApiError(500, 'Server error', null, 'NoCredentialsError');
    expect(explainMissingHandshake(info(), err)).toBe('unknown');
  });

  test('returns "sandbox-stopped" when sandbox_status is STOPPED', () => {
    expect(
      explainMissingHandshake(info({ sandbox_status: 'STOPPED' })),
    ).toBe('sandbox-stopped');
  });

  test('returns "sandbox-missing" when sandbox_status is MISSING', () => {
    expect(
      explainMissingHandshake(info({ sandbox_status: 'MISSING' })),
    ).toBe('sandbox-missing');
  });

  test('returns "paused-no-sandbox-id" when PAUSED with no sandbox_id', () => {
    expect(
      explainMissingHandshake(info({ sandbox_status: 'PAUSED' })),
    ).toBe('paused-no-sandbox-id');
  });

  test('does NOT return "paused-no-sandbox-id" when PAUSED has a sandbox_id', () => {
    // A PAUSED record with a sandbox_id is recoverable upstream — the
    // helper falls through to `unknown` rather than mis-classifying.
    expect(
      explainMissingHandshake(
        info({ sandbox_status: 'PAUSED', sandbox_id: 'sbx-1' }),
      ),
    ).toBe('unknown');
  });

  test('returns "unknown" when no signal is available', () => {
    expect(explainMissingHandshake(info())).toBe('unknown');
  });

  test('returns "unknown" when lastError is undefined and sandbox_status is empty', () => {
    expect(explainMissingHandshake(info({ sandbox_status: undefined }))).toBe('unknown');
  });
});

describe('formatMissingHandshakeMessage (#405)', () => {
  test('renders an "auth-rejected" message naming the 401', () => {
    const msg = formatMissingHandshakeMessage('conv-1', 'auth-rejected');
    expect(msg).toContain('conv-1');
    expect(msg).toContain('cannot open a WS session');
    expect(msg).toContain('401');
    expect(msg).toContain('NoCredentialsError');
  });

  test('renders a "sandbox-stopped" message naming STOPPED', () => {
    const msg = formatMissingHandshakeMessage('conv-1', 'sandbox-stopped');
    expect(msg).toContain('STOPPED');
  });

  test('renders a "sandbox-missing" message naming MISSING after resume', () => {
    const msg = formatMissingHandshakeMessage('conv-1', 'sandbox-missing');
    expect(msg).toContain('MISSING');
  });

  test('renders a "paused-no-sandbox-id" message naming the contract violation', () => {
    const msg = formatMissingHandshakeMessage('conv-1', 'paused-no-sandbox-id');
    expect(msg).toContain('PAUSED');
    expect(msg).toContain('sandbox_id');
  });

  test('renders an "unknown" fallback message', () => {
    const msg = formatMissingHandshakeMessage('conv-1', 'unknown');
    expect(msg).toContain('cause unknown');
  });
});

/**
 * Throw-site coverage for the create path: when the post-`pollUntilReady`
 * conversation record is missing `conversation_url` or `session_api_key`,
 * the resulting `UpstreamConversationEndedError` carries a typed
 * `reason` and a self-describing message. Mirrors the attach-path
 * coverage in the `#341` suite above.
 */
describe('AISessionManager.getOrCreateForSession (#405) — typed reason at create-path throw site', () => {
  interface FakeClient {
    startConversation: ReturnType<typeof vi.fn>;
    pollUntilReady: ReturnType<typeof vi.fn>;
    getConversation: ReturnType<typeof vi.fn>;
  }

  /**
   * Build a fake client where `startConversation` and `pollUntilReady`
   * succeed and `getConversation` returns the supplied
   * `ConversationInfo`. The conversation id flows through unchanged so
   * each test can assert on the typed reason and the rendered message.
   */
  function makeClient(convInfo: ConversationInfo | null): FakeClient {
    return {
      startConversation: vi.fn(async () => ({ id: convInfo?.id ?? 'conv-x', status: 'STARTED' })),
      pollUntilReady: vi.fn(async () => ({
        id: convInfo?.id ?? 'conv-x',
        status: 'READY',
        app_conversation_id: convInfo?.id ?? 'conv-x',
      })),
      getConversation: vi.fn(async () => convInfo),
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  test('sandbox-stopped → reason="sandbox-stopped" with STOPPED message', async () => {
    const client = makeClient({
      id: 'conv-stopped',
      status: 'READY',
      sandbox_status: 'STOPPED',
    });
    manager.setClientForTesting(client as never);

    const err = await manager
      .getOrCreateForSession('sess-stop', 'ws-1', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    const upstream = err as UpstreamConversationEndedError;
    expect(upstream.reason).toBe('sandbox-stopped');
    expect(upstream.message).toContain('conv-stopped');
    expect(upstream.message).toContain('STOPPED');
    expect(manager.hasSessionAI('sess-stop')).toBe(false);
  });

  test('sandbox-missing → reason="sandbox-missing" with MISSING message', async () => {
    const client = makeClient({
      id: 'conv-miss',
      status: 'READY',
      sandbox_status: 'MISSING',
    });
    manager.setClientForTesting(client as never);

    const err = await manager
      .getOrCreateForSession('sess-miss', 'ws-1', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    const upstream = err as UpstreamConversationEndedError;
    expect(upstream.reason).toBe('sandbox-missing');
    expect(upstream.message).toContain('MISSING');
  });

  test('paused-no-sandbox-id → reason="paused-no-sandbox-id"', async () => {
    const client = makeClient({
      id: 'conv-paused-broken',
      status: 'READY',
      sandbox_status: 'PAUSED',
      // No sandbox_id → contract violation. The create path can't
      // resume, so the WS-handshake check fires straight away.
    });
    manager.setClientForTesting(client as never);

    const err = await manager
      .getOrCreateForSession('sess-paused', 'ws-1', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    const upstream = err as UpstreamConversationEndedError;
    expect(upstream.reason).toBe('paused-no-sandbox-id');
    expect(upstream.message).toContain('PAUSED');
  });

  test('unknown → reason="unknown" with cause-unknown message', async () => {
    const client = makeClient({
      id: 'conv-blank',
      status: 'READY',
      // No sandbox_status field set
    });
    manager.setClientForTesting(client as never);

    const err = await manager
      .getOrCreateForSession('sess-blank', 'ws-1', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    const upstream = err as UpstreamConversationEndedError;
    expect(upstream.reason).toBe('unknown');
    expect(upstream.message).toContain('cause unknown');
    expect(upstream.message).not.toContain('missing WS handshake materials');
  });
});

/**
 * Throw-site coverage for the attach path: same surface as the
 * create-path suite above. The auth-rejected branch is covered by
 * driving the PAUSED → resume recovery through a polling-loop
 * transient 401 NoCredentialsError, which the new `onTransientError`
 * hook plumbs through to the post-poll classification.
 */
describe('AISessionManager.attachExistingForSession (#405) — typed reason at attach-path throw site', () => {
  interface FakeClient {
    getConversation: ReturnType<typeof vi.fn>;
    resumeSandbox: ReturnType<typeof vi.fn>;
  }

  function makeClient(
    getConvResponses: unknown[],
    resumeImpl: () => Promise<void> = async () => {},
  ): FakeClient {
    const calls = getConvResponses.slice();
    return {
      getConversation: vi.fn(async () => {
        if (calls.length === 0) {
          throw new Error('FakeClient: no more queued getConversation responses');
        }
        const next = calls.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
      resumeSandbox: vi.fn(resumeImpl),
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
    // Keep the resume-poll loop snappy so the recovery test runs in
    // milliseconds rather than waiting on the default 2s interval.
    manager.setResumePollOptionsForTesting({ budgetMs: 500, intervalMs: 5 });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  test('sandbox-stopped → reason="sandbox-stopped"', async () => {
    const client = makeClient([
      {
        id: 'conv-stopped',
        status: 'READY',
        sandbox_status: 'STOPPED',
        // No conversation_url / session_api_key — falls into the
        // WS-handshake check after the PAUSED branch is skipped.
      },
    ]);
    manager.setClientForTesting(client as never);

    const err = await manager
      .attachExistingForSession('sess-stop', 'ws-1', 'conv-stopped', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    const upstream = err as UpstreamConversationEndedError;
    expect(upstream.reason).toBe('sandbox-stopped');
    expect(upstream.message).toContain('STOPPED');
    expect(client.resumeSandbox).not.toHaveBeenCalled();
  });

  test('sandbox-missing on first lookup → reason="sandbox-missing"', async () => {
    // MISSING on a non-PAUSED record skips the PAUSED branch and
    // lands on the WS-handshake check, which classifies as
    // `sandbox-missing` directly from the record.
    const client = makeClient([
      {
        id: 'conv-miss',
        status: 'READY',
        sandbox_status: 'MISSING',
      },
    ]);
    manager.setClientForTesting(client as never);

    const err = await manager
      .attachExistingForSession('sess-miss', 'ws-1', 'conv-miss', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    expect((err as UpstreamConversationEndedError).reason).toBe('sandbox-missing');
  });

  test('unknown → reason="unknown" (no signals on the record)', async () => {
    const client = makeClient([
      {
        id: 'conv-blank',
        status: 'READY',
        // No sandbox_status, no keys
      },
    ]);
    manager.setClientForTesting(client as never);

    const err = await manager
      .attachExistingForSession('sess-blank', 'ws-1', 'conv-blank', () => {})
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(UpstreamConversationEndedError);
    expect((err as UpstreamConversationEndedError).reason).toBe('unknown');
    expect((err as UpstreamConversationEndedError).message).not.toContain(
      'missing WS handshake materials',
    );
  });

  test('poll-loop transient error is swallowed and does NOT mis-classify as auth-rejected', async () => {
    // Drive the PAUSED → resume path so `pollSandboxRunning` runs.
    // The middle response is a transient `OpenHandsApiError` (503),
    // which the poll loop swallows via the `onTransientError` hook
    // added in #405. With `RUNNING + session_api_key` returned on the
    // next attempt the happy path completes — proving the hook fires
    // without disturbing recovery. The auth-rejected branch of the
    // helper is unit-tested directly in `explainMissingHandshake (#405)`
    // above; here we only verify the plumbing doesn't leak a stray
    // poll error into the post-recovery happy path.
    const transientErr = new OpenHandsApiError(503, 'Service unavailable', null);
    const client = makeClient([
      {
        id: 'conv-poll',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-1',
      },
      transientErr,
      {
        id: 'conv-poll',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'KEY-OK',
        conversation_url: 'https://agent.example.com/api/v1/conversations/conv-poll',
      },
    ]);
    manager.setClientForTesting(client as never);

    const session = await manager.attachExistingForSession(
      'sess-poll',
      'ws-1',
      'conv-poll',
      () => {},
    );
    expect(session.sessionApiKey).toBe('KEY-OK');
    await manager.endSessionAI('sess-poll');
  });
});

/**
 * Tests for the reconnect-time credential refresh introduced by issue #291.
 *
 * The reconnect WebSocket itself is hard to exercise without a real
 * `ws` peer, so these tests target the `refreshSessionCredentials`
 * seam directly. They cover the test IDs T-3.2.1 through T-3.2.12 from
 * issue #291's expansion comment.
 */
describe('AISessionManager.refreshSessionCredentials (#291)', () => {
  interface FakeClient {
    getConversation: ReturnType<typeof vi.fn>;
  }

  function makeSession(overrides: Partial<AISession> = {}): AISession {
    return {
      conversationId: 'conv-1',
      taskId: 'task-1',
      sessionId: 'sess-1',
      mode: 'kiosk',
      agentServerUrl: 'https://agent.example.com',
      sessionApiKey: 'K1',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      ...overrides,
    };
  }

  function makeClient(responses: unknown[]): FakeClient {
    const calls = responses.slice();
    return {
      getConversation: vi.fn(async () => {
        if (calls.length === 0) {
          throw new Error('FakeClient: no more queued responses');
        }
        const next = calls.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
  });

  test('T-3.2.1/3.2.2: fetches conversation and uses rotated key', async () => {
    const client = makeClient([
      {
        id: 'conv-1',
        status: 'READY',
        session_api_key: 'K2',
        conversation_url: 'https://agent2.example.com/api/v1/...',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await manager.refreshSessionCredentials(session);

    expect(client.getConversation).toHaveBeenCalledTimes(1);
    expect(client.getConversation).toHaveBeenCalledWith('conv-1');
    expect(session.sessionApiKey).toBe('K2');
    expect(session.agentServerUrl).toBe('https://agent2.example.com');
  });

  test('T-3.2.3: unchanged key still works (no rotation increment)', async () => {
    const client = makeClient([
      {
        id: 'conv-1',
        status: 'READY',
        session_api_key: 'K1',
        conversation_url: 'https://agent.example.com/api/v1/...',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await manager.refreshSessionCredentials(session);

    expect(session.sessionApiKey).toBe('K1');
    expect(manager.getKeyRotationCount()).toBe(0);
  });

  test('T-3.2.4: cached key is updated in the in-memory AISession after rotation', async () => {
    const client = makeClient([
      {
        id: 'conv-1',
        status: 'READY',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/...',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession({ sessionApiKey: 'K1' });

    await manager.refreshSessionCredentials(session);

    expect(session.sessionApiKey).toBe('K2');
    expect(manager.getKeyRotationCount()).toBe(1);
  });

  test('T-3.2.5: MISSING sandbox surfaces as SandboxMissingError', async () => {
    const client = makeClient([
      {
        id: 'conv-1',
        status: 'READY',
        sandbox_status: 'MISSING',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/...',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(SandboxMissingError);
    // Cached key/URL must not be mutated on the MISSING branch.
    expect(session.sessionApiKey).toBe('K1');
    expect(session.agentServerUrl).toBe('https://agent.example.com');
  });

  test('T-3.2.5b: null conversation surfaces as SandboxMissingError', async () => {
    const client = makeClient([null]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(SandboxMissingError);
  });

  test('refreshSessionCredentials: 401 NoCredentialsError → UpstreamCredentialsLostError (#350)', async () => {
    // The upstream conversation lookup returning a 401 with body
    // {"error":"NoCredentialsError"} means the platform has rotated or
    // forgotten the session_api_key we hold. Surface it as a distinct
    // error class so reconnectWithRefresh can route through rebindSession.
    const client = makeClient([
      new OpenHandsApiError(401, 'OpenHands API error 401: {"error":"NoCredentialsError"}', null),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      UpstreamCredentialsLostError,
    );
    // 401 is not transient, so it must not consume retry budget.
    expect(client.getConversation).toHaveBeenCalledTimes(1);
    // Cached key/URL must not be mutated on the failure path.
    expect(session.sessionApiKey).toBe('K1');
  });

  test('refreshSessionCredentials: other 401 bodies still propagate as OpenHandsApiError (#350)', async () => {
    // The discriminator is strict — generic 401 (InvalidApiKeyError, plain
    // Unauthorized, …) must NOT be promoted into UpstreamCredentialsLostError,
    // otherwise a misconfigured-key 401 would trigger a wasted rebind.
    const client = makeClient([
      new OpenHandsApiError(401, 'OpenHands API error 401: {"error":"InvalidApiKeyError"}', null),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      OpenHandsApiError,
    );
    expect(client.getConversation).toHaveBeenCalledTimes(1);
  });

  test('T-3.2.6: repeated MISSING does not retry indefinitely', async () => {
    // The retry budget only applies to TRANSIENT 5xx errors. A MISSING
    // sandbox should propagate on the first call without any retries.
    const client = makeClient([
      { id: 'conv-1', status: 'READY', sandbox_status: 'MISSING' },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(SandboxMissingError);
    expect(client.getConversation).toHaveBeenCalledTimes(1);
  });

  test('T-3.2.8: 5xx from fetchConversation retries with backoff and recovers', async () => {
    const client = makeClient([
      new OpenHandsApiError(503, 'Service Unavailable', null),
      {
        id: 'conv-1',
        status: 'READY',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/...',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await manager.refreshSessionCredentials(session, 3);
    expect(client.getConversation).toHaveBeenCalledTimes(2);
    expect(session.sessionApiKey).toBe('K2');
  });

  test('T-3.2.9: repeated 5xx exhausts retries → throws transient error', async () => {
    const client = makeClient([
      new OpenHandsApiError(503, 'Service Unavailable', null),
      new OpenHandsApiError(503, 'Service Unavailable', null),
      new OpenHandsApiError(503, 'Service Unavailable', null),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session, 3)).rejects.toBeInstanceOf(OpenHandsApiError);
    expect(client.getConversation).toHaveBeenCalledTimes(3);
    expect(session.sessionApiKey).toBe('K1');  // Cache untouched on failure
  });

  test('T-3.2.10: log line emitted on rotation detected', async () => {
    const client = makeClient([
      {
        id: 'conv-1',
        status: 'READY',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/...',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    // Vitest 4 intercepts `console.log` for stdout capture so `vi.spyOn`
    // doesn't always observe calls. We instead patch the property directly
    // so calls are recorded regardless of vitest's per-test capture layer.
    const calls: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { calls.push(args); };
    try {
      await manager.refreshSessionCredentials(session);
    } finally {
      console.log = original;
    }
    const rotationLogged = calls.some(
      ([first]) => typeof first === 'string' && first.includes('session_api_key rotation detected'),
    );
    expect(rotationLogged).toBe(true);
  });

  test('T-3.2.11: metric counter increments on rotation', async () => {
    const client = makeClient([
      { id: 'conv-1', status: 'READY', session_api_key: 'K2', conversation_url: 'https://a/api/v1/' },
      { id: 'conv-1', status: 'READY', session_api_key: 'K3', conversation_url: 'https://a/api/v1/' },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession({ sessionApiKey: 'K1' });

    expect(manager.getKeyRotationCount()).toBe(0);
    await manager.refreshSessionCredentials(session);
    expect(manager.getKeyRotationCount()).toBe(1);
    await manager.refreshSessionCredentials(session);
    expect(manager.getKeyRotationCount()).toBe(2);
  });

  test('T-3.2.12: concurrent refreshes for the same session single-flight the fetch', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((resolve) => { resolveFetch = resolve; });
    const client = {
      getConversation: vi.fn(async () => pending),
    };
    manager.setClientForTesting(client as never);
    const session = makeSession();

    const p1 = manager.refreshSessionCredentials(session);
    const p2 = manager.refreshSessionCredentials(session);
    expect(client.getConversation).toHaveBeenCalledTimes(1);

    resolveFetch!({
      id: 'conv-1',
      status: 'READY',
      session_api_key: 'K2',
      conversation_url: 'https://agent.example.com/api/v1/',
    });
    await Promise.all([p1, p2]);
    expect(client.getConversation).toHaveBeenCalledTimes(1);
    expect(session.sessionApiKey).toBe('K2');

    // After both settle the in-flight slot must be cleared so a fresh
    // refresh on the same conversationId fires a new GET.
    const client2 = {
      getConversation: vi.fn(async () => ({
        id: 'conv-1',
        status: 'READY',
        session_api_key: 'K3',
        conversation_url: 'https://agent.example.com/api/v1/',
      })),
    };
    manager.setClientForTesting(client2 as never);
    await manager.refreshSessionCredentials(session);
    expect(client2.getConversation).toHaveBeenCalledTimes(1);
    expect(session.sessionApiKey).toBe('K3');
  });

  test('no client configured → throws SandboxMissingError immediately', async () => {
    // Default constructor in test env leaves the client null. The reconnect
    // loop must NOT tight-loop on `null` clients; surface as MISSING.
    manager.setClientForTesting(null);
    const session = makeSession();
    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(SandboxMissingError);
  });

  test('missing conversation_url surfaces as SandboxMissingError', async () => {
    const client = makeClient([
      { id: 'conv-1', status: 'READY', session_api_key: 'K2' },  // no conversation_url
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(SandboxMissingError);
  });
});

/**
 * Tests for the PAUSED sandbox-resume branch added in #360.
 *
 * Upstream pauses idle sandboxes after a short window (~4 min in prod).
 * `GET /app-conversations` then returns `sandbox_status: 'PAUSED'` with a
 * null `session_api_key` and null `conversation_url`. Before #360 we
 * surfaced this as `SandboxMissingError` and rebound, which both lost agent
 * memory and (for separate reasons tracked in #361) failed in prod —
 * leaving 100% of sessions permanently degraded ~4 min after idle.
 *
 * The PAUSED branch instead calls `POST /sandboxes/{id}/resume`, polls for
 * `RUNNING` with a fresh key, and applies the rotated credentials. Tests
 * cover the happy path, the various failure modes (PAUSED-no-sandbox-id,
 * resume 404 → MISSING, resume 5xx transient retry, poll timeout, budget
 * exhausted), plus concurrent-refresh single-flighting and the
 * reconnect-path degradation behaviour.
 */
describe('AISessionManager.refreshSessionCredentials PAUSED handling (#360)', () => {
  interface FakeClient {
    getConversation: ReturnType<typeof vi.fn>;
    resumeSandbox: ReturnType<typeof vi.fn>;
  }

  function makeSession(overrides: Partial<AISession> = {}): AISession {
    return {
      conversationId: 'conv-paused',
      taskId: 'task-paused',
      sessionId: 'sess-paused',
      mode: 'kiosk',
      agentServerUrl: 'https://agent.example.com',
      sessionApiKey: 'K1',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      ...overrides,
    };
  }

  /**
   * Build a fake client where getConversation returns each queued response
   * in order. `Error`-typed entries are thrown instead of resolved. Each
   * test queues exactly the sequence of GET results it expects.
   */
  function makeClient(
    getConvResponses: unknown[],
    resumeImpl: () => Promise<void> = async () => {},
  ): FakeClient {
    const calls = getConvResponses.slice();
    return {
      getConversation: vi.fn(async () => {
        if (calls.length === 0) {
          throw new Error('FakeClient: no more queued getConversation responses');
        }
        const next = calls.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
      resumeSandbox: vi.fn(resumeImpl),
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
    // Tight polling so the suite stays fast. Production defaults are 30 s /
    // 2 s; the budget/interval ratio still exercises one or two polls.
    manager.setResumePollOptionsForTesting({ budgetMs: 200, intervalMs: 5 });
  });

  test('PAUSED → resume → RUNNING happy path: applies fresh creds, increments counter', async () => {
    // First GET returns PAUSED with sandbox_id; resume succeeds; second GET
    // returns RUNNING with a fresh key + URL. Session should pick up K2 and
    // the resume counter should bump.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-123',
        session_api_key: null,
        conversation_url: null,
      },
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        sandbox_id: 'sbx-123',
        session_api_key: 'K2',
        conversation_url: 'https://agent2.example.com/api/v1/conv/conv-paused',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    expect(manager.getSandboxResumeCount()).toBe(0);
    await manager.refreshSessionCredentials(session);

    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(client.resumeSandbox).toHaveBeenCalledWith('sbx-123');
    expect(client.getConversation).toHaveBeenCalledTimes(2);
    expect(session.sessionApiKey).toBe('K2');
    expect(session.agentServerUrl).toBe('https://agent2.example.com');
    // Resume counts as a rotation (K1 → K2) — covers the metric we already
    // expose for #291.
    expect(manager.getKeyRotationCount()).toBe(1);
    expect(manager.getSandboxResumeCount()).toBe(1);
    // Session's conversationId is preserved (acceptance criterion: agent
    // memory continues).
    expect(session.conversationId).toBe('conv-paused');
  });

  test('PAUSED → resume → poll skips STARTING and resolves on RUNNING', async () => {
    // First GET: PAUSED. Resume fires. Then STARTING (keep polling) then
    // RUNNING. Validates the polling state machine.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-99',
      },
      { id: 'conv-paused', status: 'READY', sandbox_status: 'STARTING' },
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await manager.refreshSessionCredentials(session);
    expect(client.getConversation).toHaveBeenCalledTimes(3);
    expect(session.sessionApiKey).toBe('K2');
  });

  test('PAUSED with no sandbox_id → SandboxMissingError (no resume attempted)', async () => {
    // Defensive: a PAUSED with no sandbox_id is a platform contract
    // violation; we must NOT call resume with `undefined` (which would 404).
    // Hand off to the rebind path via SandboxMissingError instead.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: undefined,
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      SandboxMissingError,
    );
    expect(client.resumeSandbox).not.toHaveBeenCalled();
    // Cache must not be mutated on the failure path.
    expect(session.sessionApiKey).toBe('K1');
  });

  test('resume HTTP 404 → SandboxMissingError (sandbox actually gone)', async () => {
    // 404 from POST /sandboxes/{id}/resume means the sandbox is genuinely
    // missing, not paused. Hand off to the rebind path.
    const client = makeClient(
      [
        {
          id: 'conv-paused',
          status: 'READY',
          sandbox_status: 'PAUSED',
          sandbox_id: 'sbx-gone',
        },
      ],
      async () => {
        throw new OpenHandsApiError(404, 'Sandbox not found', null);
      },
    );
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      SandboxMissingError,
    );
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(session.sessionApiKey).toBe('K1');
    // Resume counter does NOT bump on failure.
    expect(manager.getSandboxResumeCount()).toBe(0);
  });

  test('resume HTTP 5xx is transient — retried by outer refresh loop', async () => {
    // The refresh loop retries on `OpenHandsApiError.transient`. A 503 from
    // resume bubbles up; the outer loop retries, gets a fresh PAUSED GET
    // result, this time resume succeeds and we poll RUNNING. End-to-end
    // result is a successful refresh after one retry.
    const callOrder: string[] = [];
    let resumeCallCount = 0;
    const responses: unknown[] = [
      // Attempt 1: PAUSED. resume → 503. Loop retries.
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-flaky',
      },
      // Attempt 2: PAUSED. resume → success. Poll → RUNNING.
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-flaky',
      },
      // Poll after successful resume.
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'K9',
        conversation_url: 'https://agent.example.com/api/v1/',
      },
    ];
    const client: FakeClient = {
      getConversation: vi.fn(async () => {
        callOrder.push('get');
        const next = responses.shift();
        if (!next) throw new Error('no more GET responses');
        if (next instanceof Error) throw next;
        return next;
      }),
      resumeSandbox: vi.fn(async () => {
        callOrder.push('resume');
        resumeCallCount++;
        if (resumeCallCount === 1) {
          throw new OpenHandsApiError(503, 'Service Unavailable', null);
        }
        // Second call succeeds.
      }),
    };
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await manager.refreshSessionCredentials(session, 3);
    expect(client.resumeSandbox).toHaveBeenCalledTimes(2);
    expect(session.sessionApiKey).toBe('K9');
    expect(manager.getSandboxResumeCount()).toBe(1);
  });

  test('poll timeout → SandboxResumeTimeoutError (no rebind)', async () => {
    // Resume succeeds, but the sandbox never reaches RUNNING within the
    // poll budget. Must surface SandboxResumeTimeoutError so the reconnect
    // path degrades cleanly instead of rebinding (which would lose agent
    // memory for no benefit).
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-slow',
      },
      // All subsequent polls stay in STARTING — never RUNNING.
      ...Array.from({ length: 200 }, () => ({
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'STARTING',
      })),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      SandboxResumeTimeoutError,
    );
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(session.sessionApiKey).toBe('K1');
    expect(manager.getSandboxResumeCount()).toBe(0);
  });

  test('poll discovers MISSING mid-recovery → SandboxMissingError', async () => {
    // Sandbox was paused, we tried to resume, but a concurrent platform
    // event reaped it (e.g. cleanup tick races with resume). The poll sees
    // MISSING and must hand off to the rebind path.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-x',
      },
      { id: 'conv-paused', status: 'READY', sandbox_status: 'MISSING' },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      SandboxMissingError,
    );
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
  });

  test('resume budget exhausted → SandboxResumeBudgetExhausted (no resume attempted)', async () => {
    // Pre-seed the resume tracker with three successes — the 4th attempt
    // must short-circuit without calling resume.
    const tracker = new RebindWindowTracker();
    tracker.recordSuccess('conv-paused');
    tracker.recordSuccess('conv-paused');
    tracker.recordSuccess('conv-paused');
    manager.setResumeTrackerForTesting(tracker);

    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-wedged',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      SandboxResumeBudgetExhausted,
    );
    expect(client.resumeSandbox).not.toHaveBeenCalled();
  });

  test('concurrent refreshes during PAUSED single-flight the resume', async () => {
    // Two concurrent refresh calls for the same session must single-flight
    // the entire PAUSED → resume → RUNNING sequence — resume must fire
    // exactly once, and both calls must observe the updated credentials.
    let resolvePending: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((r) => { resolvePending = r; });
    const responses: unknown[] = [
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-c',
      },
      pending,  // poll stalls until we resolve
    ];
    const client: FakeClient = {
      getConversation: vi.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error('no more GET');
        if (next instanceof Error) throw next;
        return next;
      }),
      resumeSandbox: vi.fn(async () => {}),
    };
    manager.setClientForTesting(client as never);
    const session = makeSession();

    const p1 = manager.refreshSessionCredentials(session);
    const p2 = manager.refreshSessionCredentials(session);

    // Resolve the pending poll with a RUNNING result.
    resolvePending!({
      id: 'conv-paused',
      status: 'READY',
      sandbox_status: 'RUNNING',
      session_api_key: 'K7',
      conversation_url: 'https://agent.example.com/api/v1/',
    });

    await Promise.all([p1, p2]);
    expect(client.resumeSandbox).toHaveBeenCalledTimes(1);
    expect(session.sessionApiKey).toBe('K7');
  });

  test('PAUSED with no client → SandboxMissingError (no resume attempted)', async () => {
    // No HTTP client means we cannot resume. Surface as MISSING so the
    // reconnect loop stops rather than tight-looping on a null client.
    manager.setClientForTesting(null);
    const session = makeSession();
    await expect(manager.refreshSessionCredentials(session)).rejects.toBeInstanceOf(
      SandboxMissingError,
    );
  });

  test('log line emitted on successful resume', async () => {
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'PAUSED',
        sandbox_id: 'sbx-log',
      },
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    const calls: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { calls.push(args); };
    try {
      await manager.refreshSessionCredentials(session);
    } finally {
      console.log = originalLog;
    }
    const resumeLogged = calls.some(
      ([first]) => typeof first === 'string' && first.includes('sandbox resumed for conversation'),
    );
    expect(resumeLogged).toBe(true);
  });

  test('RUNNING (no PAUSED branch) leaves PAUSED machinery dormant', async () => {
    // Sanity: when the upstream conversation is already RUNNING, the PAUSED
    // branch must not fire. The resume counter must stay at 0 and resume
    // must not be called.
    const client = makeClient([
      {
        id: 'conv-paused',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'K2',
        conversation_url: 'https://agent.example.com/api/v1/',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();

    await manager.refreshSessionCredentials(session);
    expect(client.resumeSandbox).not.toHaveBeenCalled();
    expect(manager.getSandboxResumeCount()).toBe(0);
    expect(session.sessionApiKey).toBe('K2');
  });

  test('SandboxResumeBudgetExhausted carries attempts metadata', () => {
    const err = new SandboxResumeBudgetExhausted('conv-x', 3);
    expect(err.name).toBe('SandboxResumeBudgetExhausted');
    expect(err.conversationId).toBe('conv-x');
    expect(err.attempts).toBe(3);
  });

  test('SandboxResumeTimeoutError carries conversationId', () => {
    const err = new SandboxResumeTimeoutError('conv-y');
    expect(err.name).toBe('SandboxResumeTimeoutError');
    expect(err.conversationId).toBe('conv-y');
  });
});


describe('formatEventSummary', () => {
  describe('V1 wrapped ActionEvent format', () => {
    test('formats CmdRun action with command', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'run',
          command: 'curl -X POST http://localhost:12000/api/display'
        }
      };
      expect(formatEventSummary(event)).toBe('curl -X POST http://localhost:12000/api/display');
    });

    test('truncates long commands', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'run',
          command: 'this is a very long command that should be truncated because it exceeds 60 characters'
        }
      };
      const result = formatEventSummary(event);
      expect(result.length).toBe(60);
      expect(result).toContain('...');
    });

    test('formats read action with path', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'read',
          path: '/workspace/project/voice-relay/client/src/App.tsx'
        }
      };
      expect(formatEventSummary(event)).toBe('Read /workspace/project/voice-relay/client/src/App.tsx');
    });

    test('formats write action with path', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'write',
          path: '/workspace/test.ts'
        }
      };
      expect(formatEventSummary(event)).toBe('Write /workspace/test.ts');
    });

    test('formats edit action with path', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'edit',
          path: '/workspace/test.ts'
        }
      };
      expect(formatEventSummary(event)).toBe('Edit /workspace/test.ts');
    });

    test('formats browse action with url', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'browse',
          url: 'https://example.com/page'
        }
      };
      expect(formatEventSummary(event)).toBe('Navigate to https://example.com/page');
    });

    test('formats think action with thought', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'think',
          thought: 'I need to analyze this code'
        }
      };
      expect(formatEventSummary(event)).toBe('I need to analyze this code');
    });

    test('formats finish action', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'finish'
        }
      };
      expect(formatEventSummary(event)).toBe('Task completed');
    });

    test('formats delegate action', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'delegate'
        }
      };
      expect(formatEventSummary(event)).toBe('Delegating to sub-agent');
    });

    test('formats message action with content', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'message',
          content: 'The user has connected me to a voice relay session.'
        }
      };
      expect(formatEventSummary(event)).toBe('The user has connected me to a voice relay session.');
    });

    test('handles unknown action type', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          action: 'custom_action'
        }
      };
      expect(formatEventSummary(event)).toBe('Custom_action');
    });

    test('handles ActionEvent without action object', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent'
      };
      expect(formatEventSummary(event)).toBe('Action');
    });

    test('handles ActionEvent with string action (edge case)', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: 'not-an-object'
      };
      expect(formatEventSummary(event)).toBe('Action');
    });
  });

  describe('V1 wrapped ObservationEvent format', () => {
    test('formats command output observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'run',
          content: 'curl response: {"status":"ok"}'
        }
      };
      expect(formatEventSummary(event)).toBe('Output: curl response: {"status":"ok"}');
    });

    test('formats cmd_output observation type', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'cmd_output',
          content: 'Hello, World!'
        }
      };
      expect(formatEventSummary(event)).toBe('Output: Hello, World!');
    });

    test('formats read observation with path', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'read',
          path: '/workspace/file.ts'
        }
      };
      expect(formatEventSummary(event)).toBe('Read /workspace/file.ts');
    });

    test('formats write observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'write',
          path: '/workspace/output.txt'
        }
      };
      expect(formatEventSummary(event)).toBe('Wrote /workspace/output.txt');
    });

    test('formats edit observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'edit',
          path: '/workspace/modified.ts'
        }
      };
      expect(formatEventSummary(event)).toBe('Edited /workspace/modified.ts');
    });

    test('formats browse observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'browse',
          url: 'https://example.com'
        }
      };
      expect(formatEventSummary(event)).toBe('Browsed https://example.com');
    });

    test('formats error observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'error',
          content: 'Command failed with exit code 1'
        }
      };
      expect(formatEventSummary(event)).toBe('Error: Command failed with exit code 1');
    });

    test('formats agent observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'agent'
        }
      };
      expect(formatEventSummary(event)).toBe('Agent observation');
    });

    test('handles unknown observation type', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'custom'
        }
      };
      expect(formatEventSummary(event)).toBe('Custom result');
    });

    test('handles ObservationEvent without observation object', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent'
      };
      expect(formatEventSummary(event)).toBe('Observation');
    });

    test('truncates long output content', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'agent',
        observation: {
          observation: 'run',
          content: 'A'.repeat(100)
        }
      };
      const result = formatEventSummary(event);
      expect(result.length).toBeLessThanOrEqual(63); // "Output: " + 55 chars
      expect(result).toContain('...');
    });
  });

  describe('SystemPromptEvent and MessageEvent', () => {
    test('formats SystemPromptEvent', () => {
      const event = {
        kind: 'SystemPromptEvent',
        source: 'agent'
      };
      expect(formatEventSummary(event)).toBe('System prompt loaded');
    });

    test('formats MessageEvent with llm_message content', () => {
      const event = {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I understand you want me to help with something.' }
          ]
        }
      };
      expect(formatEventSummary(event)).toBe('I understand you want me to help with something.');
    });

    test('truncates long MessageEvent content', () => {
      const event = {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'X'.repeat(100) }
          ]
        }
      };
      const result = formatEventSummary(event);
      expect(result.length).toBe(60);
      expect(result).toContain('...');
    });

    test('handles MessageEvent without content', () => {
      const event = {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: {
          role: 'assistant',
          content: []
        }
      };
      expect(formatEventSummary(event)).toBe('Message');
    });

    test('handles MessageEvent without llm_message', () => {
      const event = {
        kind: 'MessageEvent',
        source: 'agent'
      };
      expect(formatEventSummary(event)).toBe('Message');
    });
  });

  describe('backward compatibility - direct action types', () => {
    test('formats CmdRunAction with command', () => {
      const event = {
        kind: 'CmdRunAction',
        command: 'npm run build'
      };
      expect(formatEventSummary(event)).toBe('npm run build');
    });

    test('formats CmdOutputObservation', () => {
      const event = {
        kind: 'CmdOutputObservation'
      };
      expect(formatEventSummary(event)).toBe('Command output received');
    });

    test('formats FileReadAction with path', () => {
      const event = {
        kind: 'FileReadAction',
        path: '/workspace/file.ts'
      };
      expect(formatEventSummary(event)).toBe('Read /workspace/file.ts');
    });

    test('formats FileWriteAction with path', () => {
      const event = {
        kind: 'FileWriteAction',
        path: '/workspace/output.ts'
      };
      expect(formatEventSummary(event)).toBe('Write /workspace/output.ts');
    });

    test('formats FileEditAction with path', () => {
      const event = {
        kind: 'FileEditAction',
        path: '/workspace/edit.ts'
      };
      expect(formatEventSummary(event)).toBe('Edit /workspace/edit.ts');
    });

    test('formats AgentThinkAction with thought', () => {
      const event = {
        kind: 'AgentThinkAction',
        thought: 'Processing request'
      };
      expect(formatEventSummary(event)).toBe('Processing request');
    });

    test('formats AgentFinishAction', () => {
      const event = {
        kind: 'AgentFinishAction'
      };
      expect(formatEventSummary(event)).toBe('Task completed');
    });

    test('formats AgentDelegateAction', () => {
      const event = {
        kind: 'AgentDelegateAction'
      };
      expect(formatEventSummary(event)).toBe('Delegating to sub-agent');
    });

    test('formats ConversationStateUpdateEvent', () => {
      const event = {
        kind: 'ConversationStateUpdateEvent'
      };
      expect(formatEventSummary(event)).toBe('Status update');
    });

    test('formats unknown event kind', () => {
      const event = {
        kind: 'CustomEvent'
      };
      expect(formatEventSummary(event)).toBe('Custom');
    });

    test('formats event with no kind', () => {
      const event = {};
      expect(formatEventSummary(event)).toBe('Unknown');
    });
  });
});

describe('extractEventFields', () => {
  describe('terminal actions/observations', () => {
    test('extracts fields from ExecuteBashAction', () => {
      const event = {
        kind: 'ExecuteBashAction',
        command: 'npm test',
        source: 'agent'
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('npm test');
    });

    test('extracts fields from TerminalObservation', () => {
      const event = {
        kind: 'TerminalObservation',
        command: 'npm test',
        content: 'All tests passed',
        exit_code: 0,
        timeout: false
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('npm test');
      expect(fields.content).toBe('All tests passed');
      expect(fields.exit_code).toBe(0);
      expect(fields.timeout).toBe(false);
    });

    test('extracts content array from observation', () => {
      const event = {
        kind: 'ExecuteBashObservation',
        content: [
          { type: 'text' as const, text: 'Hello, World!' }
        ],
        exit_code: 0
      };
      const fields = extractEventFields(event);
      expect(Array.isArray(fields.content)).toBe(true);
      expect((fields.content as { type: string; text: string }[])[0].text).toBe('Hello, World!');
      expect(fields.exit_code).toBe(0);
    });

    test('extracts from wrapped ActionEvent with TerminalAction kind', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          kind: 'TerminalAction',
          command: 'ls -la'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('ls -la');
    });

    test('extracts from wrapped ObservationEvent with TerminalObservation kind', () => {
      const event = {
        kind: 'ObservationEvent',
        observation: {
          kind: 'TerminalObservation',
          content: 'file1.txt\nfile2.txt',
          exit_code: 0
        }
      };
      const fields = extractEventFields(event);
      expect(fields.content).toBe('file1.txt\nfile2.txt');
      expect(fields.exit_code).toBe(0);
    });
  });

  describe('file actions/observations', () => {
    test('extracts fields from FileEditorAction', () => {
      const event = {
        kind: 'FileEditorAction',
        path: '/workspace/test.ts',
        file_text: 'console.log("hello");'
      };
      const fields = extractEventFields(event);
      expect(fields.path).toBe('/workspace/test.ts');
      expect(fields.file_text).toBe('console.log("hello");');
    });

    test('extracts fields from StrReplaceEditorAction', () => {
      const event = {
        kind: 'StrReplaceEditorAction',
        path: '/workspace/test.ts',
        old_str: 'hello',
        new_str: 'world'
      };
      const fields = extractEventFields(event);
      expect(fields.path).toBe('/workspace/test.ts');
      expect(fields.old_str).toBe('hello');
      expect(fields.new_str).toBe('world');
    });

    test('extracts fields from FileEditorObservation', () => {
      const event = {
        kind: 'FileEditorObservation',
        path: '/workspace/test.ts',
        content: 'File content here',
        error: undefined
      };
      const fields = extractEventFields(event);
      expect(fields.path).toBe('/workspace/test.ts');
      expect(fields.content).toBe('File content here');
    });

    test('extracts error from file observation', () => {
      const event = {
        kind: 'FileEditorObservation',
        path: '/workspace/missing.ts',
        error: 'File not found'
      };
      const fields = extractEventFields(event);
      expect(fields.error).toBe('File not found');
    });

    test('extracts from wrapped ActionEvent with FileReadAction kind', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          kind: 'FileReadAction',
          path: '/workspace/config.json'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.path).toBe('/workspace/config.json');
    });
  });

  describe('MCP actions/observations', () => {
    test('extracts fields from MCPToolAction', () => {
      const event = {
        kind: 'MCPToolAction',
        tool_name: 'search_files',
        data: { query: 'test', path: '/workspace' }
      };
      const fields = extractEventFields(event);
      expect(fields.tool_name).toBe('search_files');
      expect(fields.data).toEqual({ query: 'test', path: '/workspace' });
    });

    test('extracts fields from MCPToolObservation', () => {
      const event = {
        kind: 'MCPToolObservation',
        tool_name: 'search_files',
        content: [{ type: 'text' as const, text: 'Found 5 files' }],
        is_error: false
      };
      const fields = extractEventFields(event);
      expect(fields.tool_name).toBe('search_files');
      expect(Array.isArray(fields.content)).toBe(true);
      expect(fields.is_error).toBe(false);
    });

    test('extracts error flag from MCP observation', () => {
      const event = {
        kind: 'MCPToolObservation',
        tool_name: 'invalid_tool',
        is_error: true
      };
      const fields = extractEventFields(event);
      expect(fields.is_error).toBe(true);
    });
  });

  describe('browser actions', () => {
    test('extracts fields from BrowserNavigateAction', () => {
      const event = {
        kind: 'BrowserNavigateAction',
        url: 'https://example.com',
        new_tab: true
      };
      const fields = extractEventFields(event);
      expect(fields.url).toBe('https://example.com');
      expect(fields.new_tab).toBe(true);
    });

    test('extracts fields from BrowserClickAction', () => {
      const event = {
        kind: 'BrowserClickAction',
        index: 5,
        new_tab: false
      };
      const fields = extractEventFields(event);
      expect(fields.index).toBe(5);
      expect(fields.new_tab).toBe(false);
    });

    test('extracts fields from BrowserTypeAction', () => {
      const event = {
        kind: 'BrowserTypeAction',
        index: 2,
        text: 'search query'
      };
      const fields = extractEventFields(event);
      expect(fields.index).toBe(2);
      expect(fields.text).toBe('search query');
    });

    test('extracts fields from BrowserScrollAction', () => {
      const event = {
        kind: 'BrowserScrollAction',
        direction: 'down'
      };
      const fields = extractEventFields(event);
      expect(fields.direction).toBe('down');
    });

    test('extracts fields from BrowserSwitchTabAction', () => {
      const event = {
        kind: 'BrowserSwitchTabAction',
        tab_id: 'tab-123'
      };
      const fields = extractEventFields(event);
      expect(fields.tab_id).toBe('tab-123');
    });

    test('extracts fields from wrapped BrowserNavigateAction', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          kind: 'BrowserNavigateAction',
          url: 'https://test.com'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.url).toBe('https://test.com');
    });
  });

  describe('search actions/observations', () => {
    test('extracts fields from GrepAction', () => {
      const event = {
        kind: 'GrepAction',
        pattern: 'TODO',
        path: '/workspace',
        include: '*.ts'
      };
      const fields = extractEventFields(event);
      expect(fields.pattern).toBe('TODO');
      expect(fields.path).toBe('/workspace');
      expect(fields.include).toBe('*.ts');
    });

    test('extracts fields from GrepObservation', () => {
      const event = {
        kind: 'GrepObservation',
        pattern: 'TODO',
        search_path: '/workspace',
        matches: ['file1.ts:10: // TODO: fix this', 'file2.ts:20: // TODO: review'],
        is_error: false
      };
      const fields = extractEventFields(event);
      expect(fields.pattern).toBe('TODO');
      expect(fields.search_path).toBe('/workspace');
      expect(fields.matches).toEqual(['file1.ts:10: // TODO: fix this', 'file2.ts:20: // TODO: review']);
      expect(fields.is_error).toBe(false);
    });

    test('extracts fields from GlobObservation', () => {
      const event = {
        kind: 'GlobObservation',
        pattern: '*.ts',
        search_path: '/workspace/src',
        files: ['index.ts', 'utils.ts', 'types.ts']
      };
      const fields = extractEventFields(event);
      expect(fields.pattern).toBe('*.ts');
      expect(fields.search_path).toBe('/workspace/src');
      expect(fields.files).toEqual(['index.ts', 'utils.ts', 'types.ts']);
    });
  });

  describe('think/finish actions', () => {
    test('extracts thought from ThinkAction', () => {
      const event = {
        kind: 'ThinkAction',
        thought: 'I need to analyze the code structure first.'
      };
      const fields = extractEventFields(event);
      expect(fields.thought).toBe('I need to analyze the code structure first.');
    });

    test('extracts message from FinishAction', () => {
      const event = {
        kind: 'FinishAction',
        message: 'Task completed successfully.'
      };
      const fields = extractEventFields(event);
      expect(fields.message).toBe('Task completed successfully.');
    });

    test('extracts from wrapped ThinkAction kind', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          kind: 'ThinkAction',
          thought: 'Let me consider the options.'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.thought).toBe('Let me consider the options.');
    });
  });

  describe('task tracker', () => {
    test('extracts task list from TaskTrackerAction', () => {
      const event = {
        kind: 'TaskTrackerAction',
        command: 'plan',
        task_list: [
          { title: 'Task 1', status: 'done' as const },
          { title: 'Task 2', status: 'in_progress' as const },
          { title: 'Task 3', status: 'todo' as const, notes: 'Pending review' }
        ]
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('plan');
      expect(fields.task_list).toHaveLength(3);
      expect(fields.task_list?.[0].title).toBe('Task 1');
      expect(fields.task_list?.[0].status).toBe('done');
      expect(fields.task_list?.[2].notes).toBe('Pending review');
    });

    test('extracts task list from TaskTrackerObservation', () => {
      const event = {
        kind: 'TaskTrackerObservation',
        task_list: [
          { title: 'Updated task', status: 'done' as const }
        ]
      };
      const fields = extractEventFields(event);
      expect(fields.task_list).toHaveLength(1);
    });
  });

  describe('observation linkage', () => {
    test('extracts action_id from observations', () => {
      const event = {
        kind: 'ExecuteBashObservation',
        action_id: 'action-uuid-123',
        content: 'Command output',
        exit_code: 0
      };
      const fields = extractEventFields(event);
      expect(fields.action_id).toBe('action-uuid-123');
    });

    test('extracts action_id from wrapped ObservationEvent', () => {
      const event = {
        kind: 'ObservationEvent',
        observation: {
          observation: 'run',
          action_id: 'action-uuid-456',
          content: 'Output'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.action_id).toBe('action-uuid-456');
    });
  });

  describe('error handling', () => {
    test('extracts error content from observation with is_error flag', () => {
      // Real structure: is_error flag indicates error, not observation type
      const event = {
        kind: 'ObservationEvent',
        observation: {
          kind: 'TerminalObservation',
          is_error: true,
          content: 'Permission denied',
          exit_code: 1
        }
      };
      const fields = extractEventFields(event);
      expect(fields.error).toBe('Permission denied');
      expect(fields.content).toBe('Permission denied');
    });

    test('returns empty object for unknown event kind', () => {
      const event = {
        kind: 'UnknownEvent',
        someField: 'someValue'
      };
      const fields = extractEventFields(event);
      expect(Object.keys(fields).length).toBe(0);
    });

    test('handles event with no kind', () => {
      const event = {};
      const fields = extractEventFields(event);
      expect(Object.keys(fields).length).toBe(0);
    });

    test('ignores invalid content array', () => {
      // Intentionally use invalid content format to test error handling
      const event = {
        kind: 'ExecuteBashObservation',
        content: [{ invalid: 'format' }] as unknown,
        exit_code: 0
      } as Parameters<typeof extractEventFields>[0];
      const fields = extractEventFields(event);
      expect(fields.content).toBeUndefined();
      expect(fields.exit_code).toBe(0);
    });

    test('ignores invalid task list', () => {
      // Intentionally use invalid task format to test error handling
      const event = {
        kind: 'TaskTrackerAction',
        task_list: [{ invalid: 'task' }] as unknown
      } as Parameters<typeof extractEventFields>[0];
      const fields = extractEventFields(event);
      expect(fields.task_list).toBeUndefined();
    });
  });

  describe('field priority', () => {
    test('prefers top-level fields over nested in direct events', () => {
      const event = {
        kind: 'ExecuteBashAction',
        command: 'top-level-command',
        action: {
          command: 'nested-command'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('top-level-command');
    });

    test('extracts from nested action in wrapped ActionEvent', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          kind: 'TerminalAction',
          command: 'nested-command-only'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('nested-command-only');
    });

    test('extracts from nested observation in wrapped ObservationEvent', () => {
      const event = {
        kind: 'ObservationEvent',
        observation: {
          kind: 'TerminalObservation',
          content: 'nested-content-only',
          exit_code: 1
        }
      };
      const fields = extractEventFields(event);
      expect(fields.content).toBe('nested-content-only');
      expect(fields.exit_code).toBe(1);
    });
  });

  // Tests for real OpenHands event structures (issue #257)
  // These tests verify the fix works with actual event structures from production
  describe('real event structures (issue #257)', () => {
    test('extracts command from real TerminalAction wrapped in ActionEvent', () => {
      // Real structure captured from production - action.kind is the type, not action.action
      const event = {
        kind: 'ActionEvent',
        tool_name: 'terminal',
        action: {
          command: 'echo "Hello World"',
          is_input: false,
          timeout: null,
          reset: false,
          kind: 'TerminalAction'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('echo "Hello World"');
    });

    test('extracts content from real TerminalObservation wrapped in ObservationEvent', () => {
      // Real structure captured from production
      const event = {
        kind: 'ObservationEvent',
        tool_name: 'terminal',
        action_id: 'action-001',
        observation: {
          content: [
            { type: 'text', text: 'Hello World' }
          ],
          is_error: false,
          command: 'echo "Hello World"',
          exit_code: 0,
          timeout: false,
          kind: 'TerminalObservation'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.content).toEqual([{ type: 'text', text: 'Hello World' }]);
      expect(fields.command).toBe('echo "Hello World"');
      expect(fields.exit_code).toBe(0);
      expect(fields.action_id).toBe('action-001');
    });

    test('extracts error status from real failed observation', () => {
      const event = {
        kind: 'ObservationEvent',
        tool_name: 'terminal',
        observation: {
          content: [
            { type: 'text', text: 'cat: /nonexistent: No such file or directory' }
          ],
          is_error: true,
          command: 'cat /nonexistent',
          exit_code: 1,
          timeout: false,
          kind: 'TerminalObservation'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.exit_code).toBe(1);
      // Note: is_error is only extracted for MCP/search events, not terminal
      // The exit_code is what's used for terminal success/failure
    });
  });
});

describe('extractEffectiveKind', () => {
  describe('wrapped events', () => {
    test('returns nested action.kind for ActionEvent', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          kind: 'TerminalAction',
          command: 'ls -la'
        }
      };
      expect(extractEffectiveKind(event)).toBe('TerminalAction');
    });

    test('returns nested observation.kind for ObservationEvent', () => {
      const event = {
        kind: 'ObservationEvent',
        observation: {
          kind: 'TerminalObservation',
          content: 'output',
          exit_code: 0
        }
      };
      expect(extractEffectiveKind(event)).toBe('TerminalObservation');
    });

    test('returns ActionEvent when action has no kind', () => {
      const event = {
        kind: 'ActionEvent',
        action: {
          command: 'ls'
          // missing kind field
        }
      };
      expect(extractEffectiveKind(event)).toBe('ActionEvent');
    });

    test('returns ObservationEvent when observation has no kind', () => {
      const event = {
        kind: 'ObservationEvent',
        observation: {
          content: 'output'
          // missing kind field
        }
      };
      expect(extractEffectiveKind(event)).toBe('ObservationEvent');
    });
  });

  describe('direct events', () => {
    test('returns kind as-is for TerminalAction', () => {
      const event = {
        kind: 'TerminalAction',
        command: 'ls -la'
      };
      expect(extractEffectiveKind(event)).toBe('TerminalAction');
    });

    test('returns kind as-is for ExecuteBashObservation', () => {
      const event = {
        kind: 'ExecuteBashObservation',
        content: 'output',
        exit_code: 0
      };
      expect(extractEffectiveKind(event)).toBe('ExecuteBashObservation');
    });

    test('returns kind as-is for ThinkAction', () => {
      const event = {
        kind: 'ThinkAction',
        thought: 'Let me consider...'
      };
      expect(extractEffectiveKind(event)).toBe('ThinkAction');
    });
  });

  describe('edge cases', () => {
    test('returns Unknown for event without kind', () => {
      const event = {};
      expect(extractEffectiveKind(event)).toBe('Unknown');
    });

    test('handles non-object action in ActionEvent', () => {
      const event = {
        kind: 'ActionEvent',
        action: 'not-an-object'
      };
      expect(extractEffectiveKind(event)).toBe('ActionEvent');
    });

    test('handles non-object observation in ObservationEvent', () => {
      // Use type assertion to test runtime handling of malformed data
      const event = {
        kind: 'ObservationEvent',
        observation: null as unknown as Record<string, unknown>
      };
      expect(extractEffectiveKind(event)).toBe('ObservationEvent');
    });
  });

  describe('real event examples from production (issue #257)', () => {
    test('extracts TerminalAction from real production ActionEvent', () => {
      // Exact structure from test-fixtures/sanitized-events.json
      const event = {
        id: 'action-001',
        timestamp: '2026-01-01T12:00:00.000000',
        source: 'agent',
        kind: 'ActionEvent',
        tool_name: 'terminal',
        tool_call_id: 'toolu_test001',
        summary: 'Run test command to verify connection',
        action: {
          command: "echo 'Hello World'",
          is_input: false,
          timeout: null,
          reset: false,
          kind: 'TerminalAction'
        },
        reasoning_content: 'Testing terminal command execution'
      };
      expect(extractEffectiveKind(event)).toBe('TerminalAction');
    });

    test('extracts TerminalObservation from real production ObservationEvent', () => {
      // Exact structure from test-fixtures/sanitized-events.json
      const event = {
        id: 'observation-001',
        timestamp: '2026-01-01T12:00:01.000000',
        source: 'environment',
        kind: 'ObservationEvent',
        tool_name: 'terminal',
        tool_call_id: 'toolu_test001',
        action_id: 'action-001',
        observation: {
          content: [
            {
              cache_prompt: false,
              type: 'text',
              text: 'Hello World'
            }
          ],
          is_error: false,
          command: "echo 'Hello World'",
          exit_code: 0,
          timeout: false,
          kind: 'TerminalObservation'
        }
      };
      expect(extractEffectiveKind(event)).toBe('TerminalObservation');
    });
  });
});

// =============================================================================
// Follow-up to PR #258: validation against real production event structures
// surfaced several gaps the original PR did not address. The tests below pin
// the fixes for:
//   1. formatEventSummary honoring the top-level `event.summary` field
//   2. extractEventFields populating file_editor `command` and InvokeSkill
//      `skill_name`
//   3. Linkage of ThinkObservation / InvokeSkillObservation via action_id
// =============================================================================
describe('PR #258 follow-up: summary + missing event content', () => {
  describe('formatEventSummary prefers top-level event.summary', () => {
    test('ActionEvent returns event.summary when present', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        summary: 'Display greeting on kiosk to confirm AI connection',
        action: {
          kind: 'TerminalAction',
          command: 'curl ...'
        }
      };
      expect(formatEventSummary(event)).toBe(
        'Display greeting on kiosk to confirm AI connection'
      );
    });

    test('ObservationEvent returns event.summary when present', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'environment',
        summary: 'Result of greeting render',
        observation: {
          kind: 'TerminalObservation',
          content: 'ok'
        }
      };
      expect(formatEventSummary(event)).toBe('Result of greeting render');
    });

    test('truncates long summaries', () => {
      const longSummary = 'x'.repeat(200);
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        summary: longSummary,
        action: { kind: 'TerminalAction' }
      };
      const result = formatEventSummary(event);
      expect(result.length).toBeLessThanOrEqual(80);
      expect(result.endsWith('...')).toBe(true);
    });

    test('falls back to legacy formatting when summary is empty', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        summary: '   ',
        action: { action: 'finish' }
      };
      expect(formatEventSummary(event)).toBe('Task completed');
    });

    test('falls back to legacy formatting when summary is absent', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: { action: 'run', command: 'ls' }
      };
      expect(formatEventSummary(event)).toBe('ls');
    });

    test('does not short-circuit on direct-event kinds', () => {
      // Direct kinds like CmdRunAction never carry a top-level `summary`
      // in practice; ensure the new short-circuit only fires on wrapped events.
      const event = {
        kind: 'CmdRunAction',
        source: 'agent',
        summary: 'should be ignored for direct events',
        command: 'echo hi'
      };
      expect(formatEventSummary(event)).toBe('echo hi');
    });
  });

  describe('extractEventFields for FileEditor actions', () => {
    test('extracts command + path for view operations', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          kind: 'FileEditorAction',
          command: 'view',
          path: '/workspace/README.md'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('view');
      expect(fields.path).toBe('/workspace/README.md');
    });

    test('extracts command + old_str/new_str for str_replace', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          kind: 'FileEditorAction',
          command: 'str_replace',
          path: '/workspace/README.md',
          old_str: '# Project',
          new_str: '# My Project'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.command).toBe('str_replace');
      expect(fields.old_str).toBe('# Project');
      expect(fields.new_str).toBe('# My Project');
    });
  });

  describe('extractEventFields for InvokeSkill events', () => {
    test('extracts skill_name from action.name', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        action: {
          kind: 'InvokeSkillAction',
          name: 'github'
        }
      };
      const fields = extractEventFields(event);
      expect(fields.skill_name).toBe('github');
    });

    test('extracts skill_name + content + action_id from observation', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'environment',
        action_id: 'a-1',
        observation: {
          kind: 'InvokeSkillObservation',
          skill_name: 'github',
          is_error: false,
          content: [{ type: 'text', text: 'Skill complete.' }]
        }
      };
      const fields = extractEventFields(event);
      expect(fields.skill_name).toBe('github');
      expect(fields.content).toEqual([{ type: 'text', text: 'Skill complete.' }]);
      expect(fields.is_error).toBe(false);
      expect(fields.action_id).toBe('a-1');
    });
  });

  describe('extractEventFields for ThinkObservation', () => {
    test('forwards content + action_id', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'environment',
        action_id: 'think-1',
        observation: {
          kind: 'ThinkObservation',
          content: [{ type: 'text', text: 'Thought recorded.' }]
        }
      };
      const fields = extractEventFields(event);
      expect(fields.content).toEqual([{ type: 'text', text: 'Thought recorded.' }]);
      expect(fields.action_id).toBe('think-1');
    });
  });
});

describe('shouldSkipForKioskTimeline (issues #265, #280)', () => {
  test('drops SystemPromptEvent regardless of source', () => {
    expect(shouldSkipForKioskTimeline({ kind: 'SystemPromptEvent' })).toBe(true);
    expect(shouldSkipForKioskTimeline({ kind: 'SystemPromptEvent', source: 'agent' })).toBe(true);
  });

  test('drops MessageEvent from a user source (already shown as utterance)', () => {
    // Verbatim shape from raw-events-real.json: user typed message arrives as
    // a MessageEvent with source: "user". The conversation feed already
    // renders it as an utterance bubble; we don't want a duplicate event card.
    expect(shouldSkipForKioskTimeline({
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    })).toBe(true);
  });

  test('drops MessageEvent from environment source', () => {
    expect(shouldSkipForKioskTimeline({ kind: 'MessageEvent', source: 'environment' })).toBe(true);
  });

  test('drops MessageEvent with missing source (defensive)', () => {
    // No source field at all → skip (the live path only forwards utterance
    // bubbles for source === 'agent', so anything else has no other home).
    expect(shouldSkipForKioskTimeline({ kind: 'MessageEvent' })).toBe(true);
  });

  test('drops MessageEvent with source: "agent" (issue #280)', () => {
    // Issue #280: the refresh path was rendering agent MessageEvents as
    // empty "💬 Message" cards because the normalizer doesn't know how to
    // extract `llm_message.content`. Agent chat replies are already rendered
    // as `✨ AI` utterance bubbles via the `messages` table on both live and
    // refresh; surfacing them again as timeline cards is duplication. On the
    // live path agent MessageEvents are intercepted by the `isV1MessageEvent`
    // branch upstream of this filter — including them here only affects the
    // refresh path, where rows are read straight from `agent_events`.
    expect(shouldSkipForKioskTimeline({
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    })).toBe(true);
  });

  test('drops ConversationStateUpdateEvent (issue #280)', () => {
    // The live path log-only's these and never creates a card; the refresh
    // path used to render one empty card per state update (14 of them in a
    // typical short session — see test-fixtures/raw-events-real.json).
    expect(shouldSkipForKioskTimeline({
      kind: 'ConversationStateUpdateEvent',
      source: 'environment',
      key: 'execution_status',
      value: { execution_status: 'idle' },
    })).toBe(true);
  });

  test('drops ConversationErrorEvent and ServerErrorEvent (issue #280)', () => {
    expect(shouldSkipForKioskTimeline({ kind: 'ConversationErrorEvent', message: 'boom' })).toBe(true);
    expect(shouldSkipForKioskTimeline({ kind: 'ServerErrorEvent', error: 'oh-no' })).toBe(true);
  });

  test('keeps ActionEvent and ObservationEvent', () => {
    expect(shouldSkipForKioskTimeline({ kind: 'ActionEvent', source: 'agent' })).toBe(false);
    expect(shouldSkipForKioskTimeline({ kind: 'ObservationEvent', source: 'environment' })).toBe(false);
  });

  test('keeps direct *Action / *Observation kinds', () => {
    // Direct (non-wrapped) action / observation kinds also pass through.
    // These are what the OH agent-server emits as the inner `action.kind`,
    // and the client renderer dispatches on them directly.
    expect(shouldSkipForKioskTimeline({ kind: 'TerminalAction' })).toBe(false);
    expect(shouldSkipForKioskTimeline({ kind: 'TerminalObservation' })).toBe(false);
    expect(shouldSkipForKioskTimeline({ kind: 'FileEditAction' })).toBe(false);
  });

  test('keeps unknown event kinds (default-allow regression guard)', () => {
    // The filter is an allow-by-default safety net; only the known
    // problematic classes are denied so new OH event kinds remain visible
    // until a developer makes an explicit decision. Regression guard for
    // issue #280 — without this we'd silently hide future event types.
    expect(shouldSkipForKioskTimeline({ kind: 'SomeFutureEvent', source: 'agent' })).toBe(false);
    expect(shouldSkipForKioskTimeline({ kind: 'BrandNewAction' })).toBe(false);
  });

  test('returns false (default-show) for non-object / null / missing kind — mirrored by client (issue #280 parity)', () => {
    // These four edge-case inputs MUST produce the same outcome on both sides
    // (server: don't skip = client: show). The client test
    // `shouldShowInKioskTimeline` in normalizeAgentEvent.test.ts asserts the
    // mirror — see "default-shows malformed inputs to mirror the server".
    expect(shouldSkipForKioskTimeline(null)).toBe(false);
    expect(shouldSkipForKioskTimeline(undefined)).toBe(false);
    expect(shouldSkipForKioskTimeline('not an event')).toBe(false);
    expect(shouldSkipForKioskTimeline({})).toBe(false);
    expect(shouldSkipForKioskTimeline({ source: 'agent' })).toBe(false);
  });
});

describe('shouldSkipForKioskTimeline — fixture parity (issue #280)', () => {
  // Cross-checks the server predicate against the same fixture used in
  // `client/src/utils/normalizeAgentEvent.test.ts`. If the two ever diverge,
  // both tests fail in lockstep — that's the parity regression guard the
  // expansion comment on #280 calls for.
  function loadFixture(): Array<{ kind?: string; source?: string }> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixturePath = path.resolve(here, '../../test-fixtures/raw-events-real.json');
    const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { items: Array<{ kind?: string; source?: string }> };
    return raw.items;
  }

  test('drops 19 of the 23 fixture events, keeps only the 4 Terminal entries', () => {
    const items = loadFixture();
    expect(items).toHaveLength(23);
    const surviving = items.filter(e => !shouldSkipForKioskTimeline(e));
    expect(surviving).toHaveLength(4);
    // Sanity check: the surviving entries are the TerminalAction/Observation
    // pairs (wrapped ActionEvent/ObservationEvent).
    expect(surviving.map(e => e.kind)).toEqual([
      'ActionEvent',
      'ObservationEvent',
      'ActionEvent',
      'ObservationEvent',
    ]);
  });

  test('per-index parity outcome matches client predicate (regression guard)', () => {
    // Identical expected array to the client-side test. If a contributor
    // changes only one side of the boundary the other test will fail too,
    // forcing them to update both.
    const items = loadFixture();
    const expectedSkip = [
      true,  // 0 ConversationStateUpdateEvent
      true,  // 1 ConversationStateUpdateEvent
      true,  // 2 SystemPromptEvent
      true,  // 3 MessageEvent user
      true,  // 4 ConversationStateUpdateEvent
      true,  // 5 ConversationStateUpdateEvent
      true,  // 6 ConversationStateUpdateEvent
      false, // 7 ActionEvent
      false, // 8 ObservationEvent
      true,  // 9 ConversationStateUpdateEvent
      true,  // 10 ConversationStateUpdateEvent
      true,  // 11 MessageEvent agent
      true,  // 12 ConversationStateUpdateEvent
      true,  // 13 ConversationStateUpdateEvent
      true,  // 14 MessageEvent user
      true,  // 15 ConversationStateUpdateEvent
      true,  // 16 ConversationStateUpdateEvent
      true,  // 17 ConversationStateUpdateEvent
      false, // 18 ActionEvent
      false, // 19 ObservationEvent
      true,  // 20 ConversationStateUpdateEvent
      true,  // 21 MessageEvent agent
      true,  // 22 ConversationStateUpdateEvent
    ];
    const actual = items.map(e => shouldSkipForKioskTimeline(e));
    expect(actual).toEqual(expectedSkip);
  });
});

/**
 * Tests for {@link AISessionManager.rebindSession} — the MISSING-sandbox
 * recovery primitive introduced in issue #296.
 *
 * The full reconnect-then-rebind path is exercised indirectly through
 * `rebindSession` (which is what `reconnectWithRefresh` calls); the WS
 * dial itself is not testable here without a real `ws` peer, but every
 * state-machine assertion on `session.rebinding` / `session.degraded` /
 * `agentServerUrl` / `sessionApiKey` is observable from the manager.
 *
 * Test IDs T-4.1.I.* match the acceptance matrix in #296.
 */
describe('AISessionManager.rebindSession (#296)', () => {
  interface RebindFakeClient {
    rebindConversation: ReturnType<typeof vi.fn>;
    getEventsPage: ReturnType<typeof vi.fn>;
  }

  function makeSession(overrides: Partial<AISession> = {}): AISession {
    return {
      conversationId: 'conv-rb-1',
      taskId: 'task-rb-1',
      sessionId: 'sess-rb-1',
      mode: 'kiosk',
      agentServerUrl: 'https://old.example.com',
      sessionApiKey: 'KOLD',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      ...overrides,
    };
  }

  /**
   * Build a fake `OpenHandsClient` whose `rebindConversation` returns
   * queued responses. The fake also exposes a `getEventsPage` mock so
   * the memory-replay prep step (#297) finds a method to call; by
   * default it returns an empty page (no suffix), and tests that care
   * override the mock implementation explicitly.
   */
  function makeClient(responses: unknown[]): RebindFakeClient {
    const calls = responses.slice();
    return {
      rebindConversation: vi.fn(async (_id: string, _opts?: unknown) => {
        if (calls.length === 0) throw new Error('FakeClient: no more queued responses');
        const next = calls.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
      getEventsPage: vi.fn(async () => ({ items: [] as unknown[] })),
    };
  }

  /** Deterministic fake clock/sleep pair for rebind backoff tests. */
  function makeFakeTime() {
    let now = 0;
    return {
      clock: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Inject a fake session into the manager's private session map.
   * The manager doesn't expose a public setter (sessions are normally
   * built via `getOrCreateForSession`, which opens a real WS); we reach
   * into the private map for these tests because the rebind path
   * cannot legitimately run without a registered session.
   */
  function attachSession(session: AISession): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessionAI.set(session.sessionId!, session);
  }

  /**
   * Replace `connectWebSocket` with a no-op spy so the rebind path
   * doesn't try to open a real WS — we still assert it was called with
   * the rebound session, which is the integration point that proves
   * the new credentials would be used.
   */
  function stubConnectWs(): ReturnType<typeof vi.fn> {
    const spy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).connectWebSocket = spy;
    return spy;
  }

  test('T-4.1.I.1/I.3: successful rebind clears rebinding, updates binding, dials new WS', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1/foo',
        sandbox_status: 'RUNNING',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    const connectSpy = stubConnectWs();

    // Capture rebinding flag mid-flight by spying through a promise.
    let rebindingDuring: boolean | undefined;
    const originalRebind = client.rebindConversation;
    client.rebindConversation = vi.fn(async (id: string) => {
      rebindingDuring = session.rebinding;
      return await (originalRebind as (id: string) => Promise<unknown>)(id);
    });

    expect(manager.getRebindCount()).toBe(0);
    await manager.rebindSession(session);

    expect(rebindingDuring).toBe(true);
    expect(session.rebinding).toBe(false);
    expect(session.degraded).toBe(false);
    expect(session.degradedReason).toBeNull();
    expect(session.agentServerUrl).toBe('https://new.example.com');
    expect(session.sessionApiKey).toBe('KNEW');
    expect(session.reconnectAttempts).toBe(0);
    expect(manager.getRebindCount()).toBe(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith(session);
  });

  test('T-4.1.I.4: rebind preserves conversationId unchanged', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1/foo',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const before = session.conversationId;
    await manager.rebindSession(session);
    expect(session.conversationId).toBe(before);
  });

  test('T-4.1.I.5: rebind exhaustion → degraded with user-facing reason', async () => {
    const time = makeFakeTime();
    // Indefinite 503s blow through the 30s budget.
    const responses: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      responses.push(new OpenHandsApiError(503, 'try later', null));
    }
    const client = makeClient(responses);
    manager.setClientForTesting(client as never);
    manager.setRebindOptionsForTesting({ sleep: time.sleep, clock: time.clock });
    const session = makeSession();
    attachSession(session);
    const connectSpy = stubConnectWs();

    await manager.rebindSession(session);

    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toMatch(/recover the agent runtime/i);
    expect(session.rebinding).toBe(false);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(manager.getRebindCount()).toBe(0);
  });

  test('rebind 404 → degraded with conversation-gone reason', async () => {
    const client = makeClient([new OpenHandsApiError(404, 'gone', null)]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toMatch(/conversation no longer exists/i);
  });

  test('rebind 403 → degraded with authz reason', async () => {
    const client = makeClient([new OpenHandsApiError(403, 'forbidden', null)]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toMatch(/not authorized/i);
  });

  // #364: end-to-end coverage that the structured upstream-failure log
  // line lands in `console.error` AND the existing kiosk-facing
  // `degradedReason` line is unchanged. Without this guard a future
  // refactor could silently regress either half.
  test('#364: rebind 403 emits structured log with status + body and keeps degradedReason unchanged', async () => {
    const upstreamBody = '{"error":"Forbidden","detail":"bad token"}';
    const client = makeClient([
      new OpenHandsApiError(403, 'OpenHands API error 403: forbidden', null, upstreamBody),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await manager.rebindSession(session);

    // Regression guard: kiosk-facing reason is exactly as it was pre-#364.
    expect(session.degradedReason).toBe(
      'Not authorized to recover the agent runtime — restart needed',
    );

    const lines = errSpy.mock.calls
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    // Structured upstream-failure line is present alongside the user-facing one.
    const structured = lines.find((l) => l.includes('[AI] rebind upstream error'));
    expect(structured).toBeDefined();
    expect(structured!).toContain('status=403');
    expect(structured!).toMatch(/body=".*Forbidden.*bad token.*"/);
    expect(structured!).toContain('error=RebindForbidden');
    // The existing operator-facing summary line is still emitted.
    const summary = lines.find((l) => l.startsWith('[AI] Rebind failed for conversation'));
    expect(summary).toBeDefined();
    expect(summary!).toContain('Not authorized to recover the agent runtime');

    errSpy.mockRestore();
  });

  test('#364: rebind 409 (non-403/404 4xx) emits structured log with status=409 + body', async () => {
    const upstreamBody = '{"error":"ConflictError","message":"sandbox state conflict"}';
    const client = makeClient([
      new OpenHandsApiError(409, 'conflict', null, upstreamBody),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await manager.rebindSession(session);

    const structured = errSpy.mock.calls
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .find((l) => l.includes('[AI] rebind upstream error'));
    expect(structured).toBeDefined();
    expect(structured!).toContain('status=409');
    expect(structured!).toMatch(/body=".*ConflictError.*"/);

    errSpy.mockRestore();
  });

  test('#364: rebind 403 with session_api_key in body redacts the key before logging', async () => {
    // Defense-in-depth: even if the upstream platform ever echoes a
    // session_api_key in an error body, the journal must not capture it.
    const leakyBody = '{"error":"Forbidden","session_api_key":"sk_live_VERY_SECRET","x":1}';
    const client = makeClient([
      new OpenHandsApiError(403, 'forbidden', null, leakyBody),
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await manager.rebindSession(session);

    const joined = errSpy.mock.calls.flat().filter((a): a is string => typeof a === 'string').join('\n');
    expect(joined).not.toContain('sk_live_VERY_SECRET');
    expect(joined).toContain('***');

    errSpy.mockRestore();
  });

  test('T-4.1.I.7: max 3 rebinds in 5min window → 4th degrades without HTTP call', async () => {
    // Three successful rebinds in quick succession, then a fourth should
    // short-circuit to degraded *before* the HTTP layer is touched.
    const client = makeClient([
      { id: 'conv-rb-1', status: 'READY', session_api_key: 'K1', conversation_url: 'https://r1.example.com/api/v1' },
      { id: 'conv-rb-1', status: 'READY', session_api_key: 'K2', conversation_url: 'https://r2.example.com/api/v1' },
      { id: 'conv-rb-1', status: 'READY', session_api_key: 'K3', conversation_url: 'https://r3.example.com/api/v1' },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    await manager.rebindSession(session);
    await manager.rebindSession(session);
    expect(manager.getRebindCount()).toBe(3);
    expect(session.degraded).toBe(false);

    // Fourth attempt — the window tracker fires before the HTTP layer.
    await manager.rebindSession(session);
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toMatch(/recover the agent runtime/i);
    // Still 3 successful rebinds — the 4th never made an HTTP call.
    expect(manager.getRebindCount()).toBe(3);
    expect(client.rebindConversation).toHaveBeenCalledTimes(3);
  });

  test('T-4.1.I.8: post-rebind sessionApiKey is the new value (key-refresh continuity)', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession({ sessionApiKey: 'KOLD' });
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    expect(session.sessionApiKey).toBe('KNEW');
  });

  test('rebind with no configured client → degraded immediately', async () => {
    // Manager constructed in beforeEach without ambient env vars has no client.
    manager.setClientForTesting(null);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toMatch(/client not configured/i);
  });

  test('rebind tears down stale WS reference before HTTP call', async () => {
    // Build a fake WS that records `close` calls; verify it's released
    // before the new connectWebSocket fires.
    let closed = false;
    const fakeWs = {
      removeAllListeners: vi.fn(),
      close: vi.fn(() => {
        closed = true;
      }),
    };
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession({ ws: fakeWs as never });
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    expect(closed).toBe(true);
    expect(fakeWs.removeAllListeners).toHaveBeenCalled();
  });

  test('rebindSession is safe to call after session end (no connectWebSocket)', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    manager.setClientForTesting(client as never);
    const session = makeSession();
    // Attach then immediately remove to simulate session ended mid-rebind.
    attachSession(session);
    const connectSpy = stubConnectWs();

    // Drop the session from the manager mid-flight by replacing the
    // rebindConversation impl to delete on call.
    const origImpl = client.rebindConversation;
    client.rebindConversation = vi.fn(async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).sessionAI.delete(session.sessionId!);
      return await (origImpl as (id: string) => Promise<unknown>)(id);
    });

    await manager.rebindSession(session);
    // Rebind succeeded but WS not redialed because session is gone.
    expect(manager.getRebindCount()).toBe(1);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  test('reconnectWithRefresh routes MISSING through rebind (integration)', async () => {
    // Refresh sees MISSING; the manager should then attempt the rebind
    // and end up not-degraded with the new key.
    const refreshClient = {
      getConversation: vi.fn(async () => ({
        id: 'conv-rb-1',
        status: 'READY',
        sandbox_status: 'MISSING',
        session_api_key: 'IGNORED',
        conversation_url: 'https://ignored.example.com/api/v1',
      })),
      // rebindConversation provides the recovery response.
      rebindConversation: vi.fn(async () => ({
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KAFTER',
        conversation_url: 'https://after.example.com/api/v1',
      })),
    };
    manager.setClientForTesting(refreshClient as never);
    const session = makeSession();
    attachSession(session);
    const connectSpy = stubConnectWs();

    // Drive the private path through the public-ish entry point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (manager as any).reconnectWithRefresh(session);

    expect(refreshClient.getConversation).toHaveBeenCalledTimes(1);
    expect(refreshClient.rebindConversation).toHaveBeenCalledTimes(1);
    expect(session.degraded).toBe(false);
    expect(session.sessionApiKey).toBe('KAFTER');
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  test('reconnectWithRefresh: non-MISSING refresh error still degrades (no rebind)', async () => {
    const client = {
      getConversation: vi.fn(async () => {
        throw new OpenHandsApiError(500, 'boom', null);
      }),
      rebindConversation: vi.fn(),
    };
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (manager as any).reconnectWithRefresh(session);
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toMatch(/reconnect failed/i);
    // rebind path NOT taken — only the refresh's own retries ran.
    expect(client.rebindConversation).not.toHaveBeenCalled();
  });

  test('reconnectWithRefresh: 401 NoCredentialsError triggers exactly one rebind (#350)', async () => {
    // Refresh throws a 401 with NoCredentialsError body — the upstream
    // platform has rotated/forgotten our session_api_key. Functionally
    // equivalent to MISSING; the manager must route through rebindSession
    // and recover (not degrade).
    const refreshClient = {
      getConversation: vi.fn(async () => {
        throw new OpenHandsApiError(
          401,
          'OpenHands API error 401: {"error":"NoCredentialsError"}',
          null,
        );
      }),
      rebindConversation: vi.fn(async () => ({
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KAFTER',
        conversation_url: 'https://after.example.com/api/v1',
      })),
    };
    manager.setClientForTesting(refreshClient as never);
    const session = makeSession();
    attachSession(session);
    const connectSpy = stubConnectWs();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (manager as any).reconnectWithRefresh(session);

    expect(refreshClient.rebindConversation).toHaveBeenCalledTimes(1);
    expect(session.degraded).toBe(false);
    expect(session.sessionApiKey).toBe('KAFTER');
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  test('reconnectWithRefresh: 401 non-NoCredentials still degrades (no rebind) (#350)', async () => {
    // A 401 with a non-NoCredentialsError body (e.g. InvalidApiKeyError)
    // means our auth config is broken, not that the upstream sandbox lost
    // our key. Rebinding wouldn't help and would waste budget. The
    // discriminator must keep this on the degrade path.
    const client = {
      getConversation: vi.fn(async () => {
        throw new OpenHandsApiError(
          401,
          'OpenHands API error 401: {"error":"InvalidApiKeyError"}',
          null,
        );
      }),
      rebindConversation: vi.fn(),
    };
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (manager as any).reconnectWithRefresh(session);

    expect(session.degraded).toBe(true);
    expect(client.rebindConversation).not.toHaveBeenCalled();
  });

  test('rebind respects the in-flight `rebinding` flag for driver observers', async () => {
    // The driver layer maps `ai.rebinding === true` to AgentSessionState
    // `reconnecting`. This test pins the contract that the flag is true
    // for the entire HTTP call window, even when the platform takes a
    // little while to respond.
    const time = makeFakeTime();
    let resolveRebind!: (info: object) => void;
    const pending = new Promise<object>((resolve) => {
      resolveRebind = resolve;
    });
    const client = {
      rebindConversation: vi.fn(() => pending),
    };
    manager.setClientForTesting(client as never);
    manager.setRebindOptionsForTesting({ sleep: time.sleep, clock: time.clock });
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const promise = manager.rebindSession(session);
    // Yield so rebindSession enters its try block.
    await Promise.resolve();
    expect(session.rebinding).toBe(true);

    resolveRebind({
      id: 'conv-rb-1',
      status: 'READY',
      session_api_key: 'KNEW',
      conversation_url: 'https://new.example.com/api/v1',
    });
    await promise;
    expect(session.rebinding).toBe(false);
  });

  test('concurrent rebindSession calls for the same conversation single-flight to one upstream POST', async () => {
    // Two rapid WS-close events for the same session must not both pass
    // checkBudget and race on credential updates. The inFlightRebind map
    // (mirroring inFlightRefresh from #291) dedupes them onto one promise.
    let resolveRebind!: (info: object) => void;
    const pending = new Promise<object>((resolve) => {
      resolveRebind = resolve;
    });
    const client = {
      rebindConversation: vi.fn(() => pending),
    };
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    const connectSpy = stubConnectWs();

    // Fire two concurrent rebindSession calls before the first one settles.
    const p1 = manager.rebindSession(session);
    const p2 = manager.rebindSession(session);
    // Yield so both enter the single-flight wrapper.
    await Promise.resolve();

    // Only one HTTP call should be queued, not two.
    expect(client.rebindConversation).toHaveBeenCalledTimes(1);

    resolveRebind({
      id: 'conv-rb-1',
      status: 'READY',
      session_api_key: 'KNEW',
      conversation_url: 'https://new.example.com/api/v1',
    });
    await Promise.all([p1, p2]);

    // Credentials updated exactly once; window counted exactly once;
    // WS dial happens exactly once.
    expect(client.rebindConversation).toHaveBeenCalledTimes(1);
    expect(session.agentServerUrl).toBe('https://new.example.com');
    expect(session.sessionApiKey).toBe('KNEW');
    expect(manager.getRebindCount()).toBe(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // After settle, the in-flight map is cleared so a future genuine
    // rebind for the same conversation can run again.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((manager as any).inFlightRebind.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Memory replay (#297) — `system_message_suffix` rehydration.
  // -------------------------------------------------------------------------
  //
  // After rebind, the agent on the fresh sandbox starts with an empty
  // context window. The memory-replay path fetches the platform-side
  // event log (which survives sandbox death — see
  // `docs/openhands-platform.md` § Death and recovery) and pipes it into
  // the rebind POST as `system_message_suffix` so the rebound agent can
  // answer follow-ups that reference prior turns.

  /** Build a MessageEvent that buildFallbackSuffix accepts as a replay turn. */
  function msgEvent(source: 'user' | 'agent', text: string): unknown {
    return {
      id: `e-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'MessageEvent',
      source,
      timestamp: '2024-01-01T00:00:00Z',
      llm_message: {
        role: source === 'user' ? 'user' : 'assistant',
        content: [{ type: 'text', text }],
      },
    };
  }

  test('T-4.2.I.1: happy-path rebind POSTs system_message_suffix derived from condense', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    client.getEventsPage.mockResolvedValue({
      items: [msgEvent('user', 'we were debugging the parser'), msgEvent('agent', 'fixed it')],
    });
    manager.setClientForTesting(client as never);
    manager.setCondenseImplForTesting(async () => ({
      summary: '__CONDENSE_OK__ parser was being debugged',
    }));
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);

    expect(client.rebindConversation).toHaveBeenCalledTimes(1);
    const [, opts] = client.rebindConversation.mock.calls[0];
    expect(opts).toBeDefined();
    expect((opts as { systemMessageSuffix?: string }).systemMessageSuffix).toContain(
      '__CONDENSE_OK__ parser was being debugged',
    );
  });

  test('T-4.2.I.2: condense failure triggers fallback suffix from event log', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    const events: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(msgEvent(i % 2 === 0 ? 'user' : 'agent', `__TURN_${i}__`));
    }
    client.getEventsPage.mockResolvedValue({ items: events });
    manager.setClientForTesting(client as never);
    manager.setCondenseImplForTesting(async () => {
      throw new Error('condense unavailable');
    });
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);

    const [, opts] = client.rebindConversation.mock.calls[0];
    const suffix = (opts as { systemMessageSuffix?: string }).systemMessageSuffix ?? '';
    expect(suffix).toContain('__TURN_9__');
    expect(suffix).toContain('__TURN_8__');
  });

  test('T-4.2.I.3: both condense and event-log failure proceeds with empty suffix', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    client.getEventsPage.mockRejectedValue(new Error('events endpoint down'));
    manager.setClientForTesting(client as never);
    manager.setCondenseImplForTesting(async () => {
      throw new Error('condense unavailable');
    });
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await manager.rebindSession(session);
    } finally {
      warn.mockRestore();
    }

    // Rebind still completed.
    expect(client.rebindConversation).toHaveBeenCalledTimes(1);
    expect(session.degraded).toBe(false);
    const [, opts] = client.rebindConversation.mock.calls[0];
    // Empty-string suffix is forwarded — the HTTP layer drops it before
    // the body assembles, but the orchestrator's behaviour is "always
    // pass the field through" so consumers / tests can observe it.
    expect((opts as { systemMessageSuffix?: string }).systemMessageSuffix).toBe('');
  });

  test('T-4.2.I.4: second rebind re-condenses from raw events, not previous suffix', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'K1',
        conversation_url: 'https://r1.example.com/api/v1',
      },
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'K2',
        conversation_url: 'https://r2.example.com/api/v1',
      },
    ]);
    const events: unknown[] = [
      msgEvent('user', 'original utterance'),
      msgEvent('agent', 'original reply'),
    ];
    client.getEventsPage.mockResolvedValue({ items: events });
    manager.setClientForTesting(client as never);

    const condenseInputs: unknown[][] = [];
    let suffixA: string | undefined;
    manager.setCondenseImplForTesting(async (es) => {
      condenseInputs.push(es);
      const seq = condenseInputs.length;
      return { summary: `__CONDENSE_${seq}__` };
    });

    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);
    suffixA = (client.rebindConversation.mock.calls[0][1] as { systemMessageSuffix?: string })
      .systemMessageSuffix;
    expect(suffixA).toContain('__CONDENSE_1__');

    // Second rebind for the same conversation. Condense must be called
    // again with the ORIGINAL event log, never with `suffixA` as input.
    await manager.rebindSession(session);

    expect(condenseInputs).toHaveLength(2);
    expect(condenseInputs[1]).toEqual(events);
    // The second condense call's input must NOT contain the first suffix.
    const serialised = JSON.stringify(condenseInputs[1]);
    expect(serialised).not.toContain('__CONDENSE_1__');
    expect(serialised).not.toContain(suffixA ?? '__missing__');

    const suffixB = (client.rebindConversation.mock.calls[1][1] as { systemMessageSuffix?: string })
      .systemMessageSuffix;
    expect(suffixB).toContain('__CONDENSE_2__');
  });

  test('T-4.2.I.5: fallback suffix contains recognisable substrings end-to-end', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    client.getEventsPage.mockResolvedValue({
      items: [
        msgEvent('user', "What's the weather?"),
        msgEvent('agent', 'Sunny'),
        msgEvent('user', 'What did I just ask?'),
      ],
    });
    manager.setClientForTesting(client as never);
    // No condense impl → fallback runs.
    manager.setCondenseImplForTesting(undefined);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);

    const suffix =
      (client.rebindConversation.mock.calls[0][1] as { systemMessageSuffix?: string })
        .systemMessageSuffix ?? '';
    expect(suffix).toContain("What's the weather?");
    expect(suffix).toContain('Sunny');
  });

  test('T-4.2.I.6: suffix size never exceeds MAX_SUFFIX_CHARS guard', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    // 100 verbose turns at ~300 chars each = ~30 KB raw.
    const events: unknown[] = [];
    for (let i = 0; i < 100; i++) {
      const text = `turn ${i} ` + 'lorem ipsum '.repeat(25);
      events.push(msgEvent(i % 2 === 0 ? 'user' : 'agent', text));
    }
    client.getEventsPage.mockResolvedValue({ items: events });
    manager.setClientForTesting(client as never);
    manager.setCondenseImplForTesting(undefined);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    await manager.rebindSession(session);

    const suffix =
      (client.rebindConversation.mock.calls[0][1] as { systemMessageSuffix?: string })
        .systemMessageSuffix ?? '';
    // 4 KB absolute ceiling per replay.MAX_SUFFIX_CHARS.
    expect(suffix.length).toBeLessThanOrEqual(4096);
  });

  test('memory replay prep failure does not block the rebind itself', async () => {
    const client = makeClient([
      {
        id: 'conv-rb-1',
        status: 'READY',
        session_api_key: 'KNEW',
        conversation_url: 'https://new.example.com/api/v1',
      },
    ]);
    client.getEventsPage.mockRejectedValue(new Error('events down'));
    manager.setClientForTesting(client as never);
    const session = makeSession();
    attachSession(session);
    stubConnectWs();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await manager.rebindSession(session);
    } finally {
      warn.mockRestore();
    }
    expect(session.degraded).toBe(false);
    expect(session.agentServerUrl).toBe('https://new.example.com');
    expect(session.sessionApiKey).toBe('KNEW');
    expect(manager.getRebindCount()).toBe(1);
  });
});

/**
 * Tests for issue #403 — refresh and rebind must use the per-workspace
 * OpenHands API key (`session.apiKey`) instead of the manager's env-keyed
 * singleton (`this.client`).
 *
 * The contract we lock down here:
 *   1. When `session.apiKey` is set, refresh / rebind / pollSandboxRunning
 *      all build a workspace-scoped client from that key, NOT the env
 *      singleton.
 *   2. When `session.apiKey` is unset (env-fallback deploys, hand-rolled
 *      test fixtures), they fall back to the env singleton — preserving
 *      today's behaviour until the env fallback is removed in #404.
 *   3. A rotated workspace key (different on a subsequent call) is
 *      honored — the client is re-derived every call, never cached.
 *
 * We exercise these by spying on the private `clientForSession` so we can
 * observe the resolution from the manager's perspective and inject a fake
 * client distinguishable from the env singleton.
 */
describe('AISessionManager workspace-key resolution (#403)', () => {
  interface FakeClient {
    getConversation: ReturnType<typeof vi.fn>;
    rebindConversation: ReturnType<typeof vi.fn>;
    getEventsPage: ReturnType<typeof vi.fn>;
    resumeSandbox: ReturnType<typeof vi.fn>;
    /** Tag so failures point at the right fake in error messages. */
    label: string;
  }

  function makeFakeClient(
    label: string,
    getConvResponse: unknown = {
      id: 'conv-403',
      status: 'READY',
      session_api_key: 'K-fresh',
      conversation_url: 'https://agent-new.example.com/api/v1/...',
      sandbox_status: 'RUNNING',
    },
    rebindResponse: unknown = {
      id: 'conv-403',
      status: 'READY',
      session_api_key: 'K-rebound',
      conversation_url: 'https://agent-rebound.example.com/api/v1/foo',
      sandbox_status: 'RUNNING',
    },
  ): FakeClient {
    return {
      label,
      getConversation: vi.fn(async () => getConvResponse),
      rebindConversation: vi.fn(async () => rebindResponse),
      getEventsPage: vi.fn(async () => ({ items: [] as unknown[] })),
      resumeSandbox: vi.fn(async () => undefined),
    };
  }

  function makeSession(overrides: Partial<AISession> = {}): AISession {
    return {
      conversationId: 'conv-403',
      taskId: 'task-403',
      sessionId: 'sess-403',
      workspaceId: 'ws-403',
      mode: 'kiosk',
      agentServerUrl: 'https://agent-old.example.com',
      sessionApiKey: 'K-stale',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
      ...overrides,
    };
  }

  function attachSession(manager: AISessionManager, session: AISession): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessionAI.set(session.sessionId!, session);
  }

  function stubConnectWs(manager: AISessionManager): ReturnType<typeof vi.fn> {
    const spy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).connectWebSocket = spy;
    return spy;
  }

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('refresh: uses workspace client when session.apiKey is set, NOT the env singleton', async () => {
    const envClient = makeFakeClient('env');
    const wsClient = makeFakeClient('workspace');
    manager.setClientForTesting(envClient as never);

    const session = makeSession({ apiKey: 'key-B' });
    // Spy on the private resolver so we can inject the workspace fake and
    // simultaneously assert that the resolver was invoked with the
    // session — this is the integration point the issue cares about.
    const cfsSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(manager as any, 'clientForSession')
      .mockReturnValue(wsClient);

    await manager.refreshSessionCredentials(session);

    expect(cfsSpy).toHaveBeenCalledWith(session);
    expect(wsClient.getConversation).toHaveBeenCalledTimes(1);
    expect(wsClient.getConversation).toHaveBeenCalledWith('conv-403');
    expect(envClient.getConversation).not.toHaveBeenCalled();
  });

  test('refresh: falls back to env singleton when session.apiKey is unset (#404 cleanup)', async () => {
    const envClient = makeFakeClient('env');
    manager.setClientForTesting(envClient as never);

    // No apiKey on the session → clientForSession returns this.client.
    const session = makeSession({ apiKey: undefined });
    await manager.refreshSessionCredentials(session);

    expect(envClient.getConversation).toHaveBeenCalledTimes(1);
    expect(envClient.getConversation).toHaveBeenCalledWith('conv-403');
  });

  test('rebind: uses workspace client (rebindConversation + getEventsPage) when session.apiKey is set', async () => {
    const envClient = makeFakeClient('env');
    const wsClient = makeFakeClient('workspace');
    manager.setClientForTesting(envClient as never);

    const session = makeSession({ apiKey: 'key-B' });
    attachSession(manager, session);
    stubConnectWs(manager);

    const cfsSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(manager as any, 'clientForSession')
      .mockReturnValue(wsClient);

    await manager.rebindSession(session);

    expect(cfsSpy).toHaveBeenCalledWith(session);
    expect(wsClient.rebindConversation).toHaveBeenCalledTimes(1);
    expect(wsClient.rebindConversation).toHaveBeenCalledWith(
      'conv-403',
      expect.any(Object),
    );
    // Memory-replay prep MUST also use the workspace client — it's part of
    // the same upstream auth boundary.
    expect(wsClient.getEventsPage).toHaveBeenCalledTimes(1);
    // The env singleton must never see either call.
    expect(envClient.rebindConversation).not.toHaveBeenCalled();
    expect(envClient.getEventsPage).not.toHaveBeenCalled();
  });

  test('rebind: falls back to env singleton when session.apiKey is unset', async () => {
    const envClient = makeFakeClient('env');
    manager.setClientForTesting(envClient as never);

    const session = makeSession({ apiKey: undefined });
    attachSession(manager, session);
    stubConnectWs(manager);

    await manager.rebindSession(session);

    expect(envClient.rebindConversation).toHaveBeenCalledTimes(1);
    expect(envClient.rebindConversation).toHaveBeenCalledWith(
      'conv-403',
      expect.any(Object),
    );
    expect(envClient.getEventsPage).toHaveBeenCalledTimes(1);
  });

  test('rebind: when neither workspace nor env client is configured, degrades cleanly', async () => {
    // No env client AND no apiKey → clientForSession returns null. The
    // existing degrade path must still fire (no crash) so a session whose
    // workspace key was deleted post-attach doesn't tight-loop.
    manager.setClientForTesting(null);
    const session = makeSession({ apiKey: undefined });
    attachSession(manager, session);
    stubConnectWs(manager);

    await manager.rebindSession(session);

    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toBe(
      'OpenHands client not configured — cannot rebind',
    );
  });

  test('PAUSED → RUNNING resume polls upstream with the workspace client too', async () => {
    // The PAUSED branch in doRefreshSessionCredentials calls
    // pollSandboxRunning, which used to fall back to this.client and
    // would have sent the env key during the resume poll loop. After
    // #403 it must use the same workspace-scoped client.
    manager.setResumePollOptionsForTesting({ budgetMs: 200, intervalMs: 5 });

    const envClient = makeFakeClient('env');
    const wsClient = makeFakeClient('workspace');
    // Queue: first GET returns PAUSED; second (poll) returns RUNNING.
    let call = 0;
    wsClient.getConversation = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          id: 'conv-403',
          status: 'READY',
          sandbox_id: 'sb-1',
          sandbox_status: 'PAUSED',
          session_api_key: null,
          conversation_url: null,
        };
      }
      return {
        id: 'conv-403',
        status: 'READY',
        sandbox_status: 'RUNNING',
        session_api_key: 'K-fresh',
        conversation_url: 'https://agent-resumed.example.com/api/v1/...',
      };
    });

    manager.setClientForTesting(envClient as never);
    const session = makeSession({ apiKey: 'key-B' });

    vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(manager as any, 'clientForSession')
      .mockReturnValue(wsClient);

    await manager.refreshSessionCredentials(session);

    // Workspace client serviced BOTH the initial GET *and* the
    // PAUSED→RUNNING poll, and resumed the sandbox.
    expect(wsClient.getConversation).toHaveBeenCalledTimes(2);
    expect(wsClient.resumeSandbox).toHaveBeenCalledWith('sb-1');
    expect(envClient.getConversation).not.toHaveBeenCalled();
    expect(envClient.resumeSandbox).not.toHaveBeenCalled();
    // Resume actually happened.
    expect(manager.getSandboxResumeCount()).toBe(1);
  });

  test('key rotation: a session whose apiKey is swapped between refreshes builds a fresh client each call', async () => {
    // Simulates the "operator rotated the workspace key via the UI" case
    // at the AISession level: each call must consult session.apiKey and
    // build a brand-new client — no stale cached singleton.
    const envClient = makeFakeClient('env');
    manager.setClientForTesting(envClient as never);

    const session = makeSession({ apiKey: 'key-B' });

    const wsClientA = makeFakeClient('ws-A');
    const wsClientB = makeFakeClient('ws-B');
    const seen: string[] = [];
    vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(manager as any, 'clientForSession')
      .mockImplementation((s: unknown) => {
        const sess = s as AISession;
        seen.push(sess.apiKey ?? 'none');
        return sess.apiKey === 'key-B' ? wsClientA : wsClientB;
      });

    await manager.refreshSessionCredentials(session);
    // Operator rotates the key on the running session (this would in
    // practice happen via the next attach, but the resolver semantics
    // must still hold per-call).
    session.apiKey = 'key-C';
    await manager.refreshSessionCredentials(session);

    expect(seen).toEqual(['key-B', 'key-C']);
    expect(wsClientA.getConversation).toHaveBeenCalledTimes(1);
    expect(wsClientB.getConversation).toHaveBeenCalledTimes(1);
    expect(envClient.getConversation).not.toHaveBeenCalled();
  });

  test('clientForSession integration: workspace key actually instantiates an OpenHandsClient with that key', async () => {
    // White-box check that the helper itself (not just the spy) selects
    // the workspace-key branch. We verify the constructed client is a
    // real OpenHandsClient instance distinct from this.client.
    const envClient = makeFakeClient('env');
    manager.setClientForTesting(envClient as never);
    const sessionWithKey = makeSession({ apiKey: 'key-B' });
    const sessionWithout = makeSession({ apiKey: undefined });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withKey = (manager as any).clientForSession(sessionWithKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withoutKey = (manager as any).clientForSession(sessionWithout);

    // With a workspace key: a freshly-constructed client (not the singleton).
    expect(withKey).not.toBe(envClient);
    expect(withKey).not.toBeNull();
    // Without a workspace key: the env singleton, unchanged.
    expect(withoutKey).toBe(envClient);
  });
});

// ---------------------------------------------------------------------------
// Restart-simulation: durable AISession state survives a process bounce
// (issue #363).
// ---------------------------------------------------------------------------

describe('AISessionManager + SessionAIStateRepository (#363)', () => {
  // Lazy import to keep the dynamic table available for the entire suite
  // without imposing the dependency on other describe blocks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SqliteCtor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Repo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let migrationList: any;

  beforeEach(async () => {
    SqliteCtor = (await import('better-sqlite3')).default;
    Repo = (await import('./sessions/session-ai-state-repository.js')).SessionAIStateRepository;
    migrationList = (await import('./storage/migrations/index.js')).migrations;
  });

  function makeDb(): { db: ReturnType<typeof SqliteCtor>; repo: InstanceType<typeof Repo> } {
    const db = new SqliteCtor(':memory:');
    db.pragma('foreign_keys = ON');
    const sorted = [...migrationList].sort(
      (a: { version: number }, b: { version: number }) => a.version - b.version,
    );
    for (const m of sorted) db.exec(m.up);
    const repo = new Repo(db);
    return { db, repo };
  }

  function insertSession(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    sessionId: string,
    workspaceId: string,
  ): void {
    db.prepare(
      `INSERT OR IGNORE INTO users (id, github_id, username, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).run('user-363', 363, 'tester363');
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(workspaceId, 'user-363', 'Workspace', `ws-${workspaceId}`, 'CODE-3636');
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, name, status, started_at)
       VALUES (?, ?, 'restart-test', 'active', datetime('now'))`,
    ).run(sessionId, workspaceId);
  }

  // Build a session object that satisfies the AISession contract for
  // the transitionTo / persistInitialState paths. Real production
  // sessions carry many more fields, but transitionTo only reads
  // `conversationId` and `sessionId`.
  function makeMinimalSession(
    sessionId: string,
    conversationId: string,
  ): AISession {
    return {
      conversationId,
      taskId: 'task-restart',
      sessionId,
      mode: 'kiosk',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
    };
  }

  test('a degraded transition is observable to a brand-new manager against the same DB', () => {
    // 1. First "process": manager A transitions session-1 to degraded.
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    const managerA = new AISessionManager();
    managerA.setAIStateRepository(repo);
    const session = makeMinimalSession('session-1', 'conv-rb-restart');
    // Simulate the create path: write the initial row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (managerA as any).persistInitialState(session);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (managerA as any).transitionTo(session, 'degraded', 'sandbox missing');

    // 2. Discard manager A; build manager B against the same DB.
    const managerB = new AISessionManager();
    managerB.setAIStateRepository(repo);

    // 3. The durable row reflects the degraded state — the new manager
    //    has no in-memory cache, so the only way to know is to read
    //    the repo.
    const row = repo.findBySessionId('session-1');
    expect(row).not.toBeNull();
    expect(row!.state).toBe('degraded');
    expect(row!.stateReason).toBe('sandbox missing');
  });

  test('rebind window history survives a manager restart', async () => {
    // Drive two "successful rebinds" through the persistRebindAttempts
    // helper, recreate the manager, and assert the new tracker
    // recognises 2 entries — so a 3rd succeeds and a 4th throws.
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    const { RebindBudgetExhausted } = await import('./agent-driver/rebind.js');

    const managerA = new AISessionManager();
    managerA.setAIStateRepository(repo);
    const session = makeMinimalSession('session-1', 'conv-rb-restart');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (managerA as any).persistInitialState(session);
    // Record two successes through the public tracker — this is what
    // doRebindSession does in production.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trackerA = (managerA as any).rebindTracker as RebindWindowTracker;
    trackerA.recordSuccess(session.conversationId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (managerA as any).persistRebindAttempts(session);
    trackerA.recordSuccess(session.conversationId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (managerA as any).persistRebindAttempts(session);
    expect(trackerA.countInWindow(session.conversationId)).toBe(2);

    // Sanity-check the row carries both timestamps.
    expect(repo.findBySessionId('session-1')!.rebindAttempts.length).toBe(2);

    // Restart.
    const managerB = new AISessionManager();
    managerB.setAIStateRepository(repo);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trackerB = (managerB as any).rebindTracker as RebindWindowTracker;
    expect(trackerB.countInWindow(session.conversationId)).toBe(2);
    // Third success still within budget.
    trackerB.recordSuccess(session.conversationId);
    expect(trackerB.countInWindow(session.conversationId)).toBe(3);
    // Fourth attempt exceeds the cap.
    expect(() => trackerB.checkBudget(session.conversationId)).toThrow(
      RebindBudgetExhausted,
    );
  });

  test('endSessionAI removes the durable row', async () => {
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    const manager = new AISessionManager();
    manager.setAIStateRepository(repo);
    const session = makeMinimalSession('session-1', 'conv-end');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessionAI.set('session-1', session);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).persistInitialState(session);
    expect(repo.findBySessionId('session-1')).not.toBeNull();
    await manager.endSessionAI('session-1');
    expect(repo.findBySessionId('session-1')).toBeNull();
  });

  test('shutdown closes WS but preserves durable state rows', async () => {
    // The whole point of #363: process shutdown must NOT delete state
    // rows. Only user-initiated endSessionAI (driver close/restart)
    // does.
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    insertSession(db, 'session-2', 'workspace-1');
    const manager = new AISessionManager();
    manager.setAIStateRepository(repo);
    const s1 = makeMinimalSession('session-1', 'conv-1');
    const s2 = makeMinimalSession('session-2', 'conv-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessionAI.set('session-1', s1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessionAI.set('session-2', s2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).persistInitialState(s1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).persistInitialState(s2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).transitionTo(s2, 'degraded', 'we gave up at 02:00');

    await manager.shutdown();

    // The auto-deploy hook will restart the process; rows must survive.
    expect(repo.findBySessionId('session-1')).not.toBeNull();
    expect(repo.findBySessionId('session-1')!.state).toBe('running');
    const r2 = repo.findBySessionId('session-2');
    expect(r2).not.toBeNull();
    expect(r2!.state).toBe('degraded');
    expect(r2!.stateReason).toBe('we gave up at 02:00');
  });

  test('transitionTo updates the in-memory AISession cache too', () => {
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    const manager = new AISessionManager();
    manager.setAIStateRepository(repo);
    const session = makeMinimalSession('session-1', 'conv-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).persistInitialState(session);

    // running → degraded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).transitionTo(session, 'degraded', 'lost upstream');
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toBe('lost upstream');
    expect(session.rebinding).toBe(false);

    // degraded → rebinding
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).transitionTo(session, 'rebinding', null);
    expect(session.degraded).toBe(false);
    expect(session.degradedReason).toBeNull();
    expect(session.rebinding).toBe(true);

    // rebinding → running
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).transitionTo(session, 'running', null);
    expect(session.degraded).toBe(false);
    expect(session.rebinding).toBe(false);
  });

  test('transitionTo without a repo is a silent in-memory write (legacy fallback)', () => {
    // Pre-#363 behavior: no repo wired. The in-memory cache still flips
    // so device callbacks see the right state, but no DB write occurs.
    const manager = new AISessionManager();
    // Explicitly no setAIStateRepository call.
    const session = makeMinimalSession('session-1', 'conv-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).transitionTo(session, 'degraded', 'no repo');
    expect(session.degraded).toBe(true);
    expect(session.degradedReason).toBe('no repo');
  });

  test('seeding the tracker via setAIStateRepository ignores rows with empty histories', async () => {
    // Defensive: a row whose attempts column is NULL must not pollute
    // the tracker.
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    insertSession(db, 'session-2', 'workspace-1');
    repo.upsert({
      sessionId: 'session-1',
      conversationId: 'conv-1',
      state: 'running',
      rebindAttempts: [Date.now() - 60_000, Date.now() - 30_000],
    });
    repo.upsert({
      sessionId: 'session-2',
      conversationId: 'conv-2',
      state: 'running',
      // No attempts — must seed nothing for conv-2.
    });

    const manager = new AISessionManager();
    manager.setAIStateRepository(repo);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracker = (manager as any).rebindTracker as RebindWindowTracker;
    expect(tracker.countInWindow('conv-1')).toBe(2);
    expect(tracker.countInWindow('conv-2')).toBe(0);
  });

  test('a transitionTo error from the repo does not crash the caller (best-effort persistence)', () => {
    // White-box: install a repo that throws on transitionTo. The
    // in-memory cache must still be updated and no exception should
    // surface.
    const { db, repo } = makeDb();
    insertSession(db, 'session-1', 'workspace-1');
    repo.upsert({ sessionId: 'session-1', conversationId: 'conv-1', state: 'running' });
    const manager = new AISessionManager();
    manager.setAIStateRepository(repo);
    const session = makeMinimalSession('session-1', 'conv-1');

    // Patch the repo to blow up.
    const originalTransitionTo = repo.transitionTo.bind(repo);
    repo.transitionTo = () => {
      throw new Error('simulated DB failure');
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Must not throw.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).transitionTo(session, 'degraded', 'live failure');
      // In-memory cache reflects the new state.
      expect(session.degraded).toBe(true);
      // DB row was not updated (the throw aborted it).
      expect(repo.findBySessionId('session-1')!.state).toBe('running');
    } finally {
      errorSpy.mockRestore();
      repo.transitionTo = originalTransitionTo;
    }
  });
});


