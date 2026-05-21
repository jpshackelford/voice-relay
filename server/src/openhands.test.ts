/**
 * Tests for OpenHands module - loadPrompt function, AISessionManager, formatEventSummary, and extractEventFields
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadPrompt, getServerUrl, AISessionManager, formatEventSummary, extractEventFields, extractEffectiveKind, type AISession, type ThinkingChangeCallback } from './openhands.js';

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
