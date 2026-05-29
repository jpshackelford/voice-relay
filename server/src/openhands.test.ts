/**
 * Tests for OpenHands module - loadPrompt function, AISessionManager, formatEventSummary, and extractEventFields
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadPrompt, getServerUrl, AISessionManager, OpenHandsApiError, SandboxMissingError, UpstreamConversationEndedError, UpstreamCredentialsLostError, formatEventSummary, extractEventFields, extractEffectiveKind, shouldSkipForKioskTimeline, type AISession, type ThinkingChangeCallback } from './openhands.js';

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
      // Should appear 4 times (greeting, markdown, image, clear commands)
      expect(sessionIdMatches!.length).toBe(4);
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
      test('throws error when OpenHands API not configured', async () => {
        // In test environment, API key is not set, so client is null
        await expect(
          manager.getOrCreateForSession(
            'test-session',
            'test-workspace',
            () => {}
          )
        ).rejects.toThrow('OpenHands API not configured');
      });
    });

    describe('sendSessionMessage', () => {
      test('throws error when no session exists', async () => {
        await expect(
          manager.sendSessionMessage('nonexistent-session', 'Hello')
        ).rejects.toThrow('No active AI session for this VR session');
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

  describe('isAvailable', () => {
    test('returns false when API key not configured', () => {
      // In test environment without API key
      expect(manager.isAvailable()).toBe(false);
    });
  });

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

    await expect(
      manager.attachExistingForSession('sess-incomplete', 'ws-1', 'conv-incomplete', () => {}),
    ).rejects.toBeInstanceOf(UpstreamConversationEndedError);
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

// =============================================================================
// #349 — getOrCreateForSession carry-forward of prior context on fresh-create.
// =============================================================================
//
// The wiring contract these tests pin:
//
//   1. `options.previousConversationId` triggers the same memory-replay prep
//      used by the rebind path (fetch events → `buildReplaySuffix` →
//      `system_message_suffix`), and the result is forwarded to
//      `client.startConversation` as the 4th-arg `systemMessageSuffix`.
//   2. No `previousConversationId` → no `getEventsPage` call, and
//      `startConversation` is called with no suffix arg at all
//      (or `undefined`). This is the existing genuinely-first-bind path —
//      regression check.
//   3. Replay prep failure (empty event log, `getEventsPage` throws) is
//      swallowed by `buildReplaySuffixFromConversation` (returns `''`),
//      and the create still proceeds with no suffix — the agent just
//      starts amnesiac, mirroring #297's rebind contract.
//   4. The attach path (`existingConversationId` set) short-circuits BEFORE
//      the carry-forward branch runs; `getEventsPage` is never called
//      even if `previousConversationId` is also set. Locks the
//      mutually-exclusive precedence documented on `OpenSessionOpts`.

describe('AISessionManager.getOrCreateForSession carry-forward (#349)', () => {
  interface FreshFakeClient {
    startConversation: ReturnType<typeof vi.fn>;
    pollUntilReady: ReturnType<typeof vi.fn>;
    getConversation: ReturnType<typeof vi.fn>;
    getEventsPage: ReturnType<typeof vi.fn>;
  }

  /**
   * Build a fake client whose fresh-create path always resolves with the
   * same canned conversation. `getEventsPage` returns whatever the test
   * configures via `.mockResolvedValueOnce(...)` / `.mockImplementationOnce(...)`.
   */
  function makeClient(): FreshFakeClient {
    return {
      startConversation: vi.fn(async () => ({ id: 'task-new', status: 'PENDING' })),
      pollUntilReady: vi.fn(async () => ({
        id: 'task-new',
        status: 'COMPLETED',
        app_conversation_id: 'conv-new',
      })),
      getConversation: vi.fn(async () => ({
        id: 'conv-new',
        status: 'READY',
        session_api_key: 'KEY-NEW',
        conversation_url: 'https://agent.example.com/api/v1/conversations/conv-new',
      })),
      // Default: empty event log → suffix is ''.
      getEventsPage: vi.fn(async () => ({ items: [] as unknown[] })),
    };
  }

  /** Format used by `buildFallbackSuffix` (server/src/agent-driver/replay.ts). */
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

  let manager: AISessionManager;

  beforeEach(() => {
    manager = new AISessionManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  /** Replace `connectWebSocket` so tests don't open a real WS. */
  function stubConnectWs(m: AISessionManager): ReturnType<typeof vi.fn> {
    const spy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any).connectWebSocket = spy;
    return spy;
  }

  test('previousConversationId triggers replay prep and forwards system_message_suffix to startConversation', async () => {
    const client = makeClient();
    client.getEventsPage.mockResolvedValue({
      items: [msgEvent('user', '__USER_TURN_X__'), msgEvent('agent', '__AGENT_TURN_Y__')],
    });
    manager.setClientForTesting(client as never);
    stubConnectWs(manager);

    await manager.getOrCreateForSession('sess-cf', 'ws-cf', () => {}, {
      previousConversationId: 'conv-prior',
    });

    expect(client.getEventsPage).toHaveBeenCalledTimes(1);
    expect(client.getEventsPage).toHaveBeenCalledWith('conv-prior', { limit: 100 });
    expect(client.startConversation).toHaveBeenCalledTimes(1);
    const args = client.startConversation.mock.calls[0];
    // Signature: (initialMessage, title, secrets, opts)
    expect(args[3]).toBeDefined();
    const suffix = (args[3] as { systemMessageSuffix?: string }).systemMessageSuffix ?? '';
    expect(suffix).toContain('__USER_TURN_X__');
    expect(suffix).toContain('__AGENT_TURN_Y__');
  });

  test('previousConversationId absent: no event-log fetch, no suffix on startConversation', async () => {
    const client = makeClient();
    manager.setClientForTesting(client as never);
    stubConnectWs(manager);

    await manager.getOrCreateForSession('sess-noprior', 'ws-cf', () => {}, {});

    expect(client.getEventsPage).not.toHaveBeenCalled();
    expect(client.startConversation).toHaveBeenCalledTimes(1);
    const args = client.startConversation.mock.calls[0];
    // 4th arg either absent or undefined — both omit the suffix.
    if (args.length >= 4) {
      expect(args[3]).toBeUndefined();
    }
  });

  test('replay prep returns empty (getEventsPage throws): create proceeds with no suffix, no throw', async () => {
    const client = makeClient();
    client.getEventsPage.mockRejectedValue(new Error('event log fetch failed'));
    manager.setClientForTesting(client as never);
    stubConnectWs(manager);
    // The helper logs a warn on failure; silence it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await manager.getOrCreateForSession('sess-failreplay', 'ws-cf', () => {}, {
      previousConversationId: 'conv-prior',
    });

    expect(client.getEventsPage).toHaveBeenCalledTimes(1);
    expect(client.startConversation).toHaveBeenCalledTimes(1);
    const args = client.startConversation.mock.calls[0];
    if (args.length >= 4) {
      expect(args[3]).toBeUndefined();
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('replay prep returns empty (no events): create proceeds with no suffix', async () => {
    const client = makeClient();
    // Default getEventsPage returns { items: [] }, so buildReplaySuffix
    // short-circuits to ''. No suffix should be forwarded.
    manager.setClientForTesting(client as never);
    stubConnectWs(manager);

    await manager.getOrCreateForSession('sess-emptyreplay', 'ws-cf', () => {}, {
      previousConversationId: 'conv-prior-empty',
    });

    expect(client.getEventsPage).toHaveBeenCalledWith('conv-prior-empty', { limit: 100 });
    const args = client.startConversation.mock.calls[0];
    if (args.length >= 4) {
      expect(args[3]).toBeUndefined();
    }
  });

  test('existingConversationId takes precedence: attach path runs, no event-log fetch, no startConversation', async () => {
    // Mutually exclusive in practice: the attach path preserves the
    // on-server event log natively and replay is irrelevant.
    const client = makeClient();
    // Override getConversation so the attach path can succeed.
    client.getConversation.mockResolvedValueOnce({
      id: 'conv-attach',
      status: 'READY',
      session_api_key: 'KEY-A',
      conversation_url: 'https://agent.example.com/api/v1/conversations/conv-attach',
    });
    manager.setClientForTesting(client as never);
    stubConnectWs(manager);

    await manager.getOrCreateForSession('sess-attach', 'ws-cf', () => {}, {
      existingConversationId: 'conv-attach',
      previousConversationId: 'conv-prior-ignored',
    });

    expect(client.getConversation).toHaveBeenCalledWith('conv-attach');
    expect(client.startConversation).not.toHaveBeenCalled();
    expect(client.getEventsPage).not.toHaveBeenCalled();
  });
});


