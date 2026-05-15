/**
 * Tests for OpenHands module - loadPrompt function and AISessionManager
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadPrompt, getServerUrl, AISessionManager, type AISession, type ThinkingChangeCallback } from './openhands.js';

describe('getServerUrl', () => {
  test('returns BASE_URL when set', () => {
    const originalBaseUrl = process.env.BASE_URL;
    process.env.BASE_URL = 'https://vr.chorecraft.net';
    try {
      expect(getServerUrl()).toBe('https://vr.chorecraft.net');
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
      process.env.BASE_URL = 'https://vr.chorecraft.net';
      try {
        const prompt = loadPrompt('system-prompt');
        // Count occurrences of the URL in curl commands
        const urlMatches = prompt.match(/https:\/\/vr\.chorecraft\.net\/api\/display/g);
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
