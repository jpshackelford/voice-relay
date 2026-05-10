/**
 * Tests for OpenHands module - loadPrompt function
 */

import { describe, test, expect } from 'vitest';
import { loadPrompt } from './openhands.js';

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
      // Should appear 3 times (markdown, image, clear commands)
      expect(sessionIdMatches!.length).toBe(3);
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
      expect(prompt).toContain('curl -X POST https://vr.chorecraft.net/api/display');
    });
  });
});
