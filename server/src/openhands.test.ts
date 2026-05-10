/**
 * Tests for OpenHands module - loadPrompt function
 */

import { describe, test, expect } from 'vitest';
import { loadPrompt } from './openhands.js';

describe('loadPrompt', () => {
  describe('basic functionality', () => {
    test('loads kiosk-system prompt', () => {
      const prompt = loadPrompt('kiosk-system');
      expect(prompt).toContain('Voice Relay Kiosk Assistant');
      expect(prompt).toContain('/api/display');
    });

    test('loads chat-system prompt', () => {
      const prompt = loadPrompt('chat-system');
      expect(prompt).toBeTruthy();
    });

    test('throws error for non-existent prompt', () => {
      expect(() => loadPrompt('non-existent-prompt')).toThrow('Prompt not found');
    });
  });

  describe('displayLines injection', () => {
    test('replaces display lines placeholder when provided', () => {
      const prompt = loadPrompt('kiosk-system', 15);
      expect(prompt).toContain('Maximum 15 lines of body text');
      expect(prompt).toContain('content beyond 15 lines will be invisible');
    });

    test('keeps default display lines when not provided', () => {
      const prompt = loadPrompt('kiosk-system');
      expect(prompt).toContain('Maximum 10-12 lines of body text');
      expect(prompt).toContain('content beyond ~10 lines will be invisible');
    });

    test('does not modify chat-system prompt with displayLines', () => {
      const prompt = loadPrompt('chat-system', 15);
      // Chat prompt should not have display lines content
      expect(prompt).not.toContain('Maximum 15 lines of body text');
    });
  });

  describe('sessionId injection', () => {
    test('replaces {{SESSION_ID}} placeholder when sessionId provided', () => {
      const testSessionId = 'session_test_12345_abcde';
      const prompt = loadPrompt('kiosk-system', undefined, undefined, testSessionId);
      
      // Should contain the actual session ID, not the placeholder
      expect(prompt).toContain(`"sessionId": "${testSessionId}"`);
      expect(prompt).not.toContain('{{SESSION_ID}}');
      
      // Verify it appears in all curl examples
      const sessionIdMatches = prompt.match(new RegExp(testSessionId, 'g'));
      expect(sessionIdMatches).toBeTruthy();
      // Should appear 3 times (markdown, image, clear commands)
      expect(sessionIdMatches!.length).toBe(3);
    });

    test('keeps {{SESSION_ID}} placeholder when sessionId not provided', () => {
      const prompt = loadPrompt('kiosk-system');
      expect(prompt).toContain('{{SESSION_ID}}');
    });

    test('combines displayLines and sessionId injection', () => {
      const testSessionId = 'session_combined_test';
      const displayLines = 20;
      const prompt = loadPrompt('kiosk-system', displayLines, undefined, testSessionId);
      
      // Both should be injected
      expect(prompt).toContain(`"sessionId": "${testSessionId}"`);
      expect(prompt).toContain('Maximum 20 lines of body text');
      expect(prompt).not.toContain('{{SESSION_ID}}');
    });

    test('handles special characters in sessionId', () => {
      const testSessionId = 'session-special_chars.123';
      const prompt = loadPrompt('kiosk-system', undefined, undefined, testSessionId);
      expect(prompt).toContain(`"sessionId": "${testSessionId}"`);
    });

    test('escapes JSON-breaking characters in sessionId', () => {
      // Test that quotes are properly escaped to prevent broken JSON
      const testSessionId = 'session"test';
      const prompt = loadPrompt('kiosk-system', undefined, undefined, testSessionId);

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
      const prompt = loadPrompt('kiosk-system', undefined, undefined, testSessionId);

      // Should contain escaped backslash
      expect(prompt).toContain('"sessionId": "session\\\\test"');
    });

    test('handles empty string sessionId (no replacement)', () => {
      // Empty string is falsy, so no replacement should occur
      const prompt = loadPrompt('kiosk-system', undefined, undefined, '');
      expect(prompt).toContain('{{SESSION_ID}}');
    });
  });
});
