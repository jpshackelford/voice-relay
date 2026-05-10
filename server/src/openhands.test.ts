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

  describe('workspaceId injection', () => {
    test('replaces {{WORKSPACE_ID}} placeholder when workspaceId provided', () => {
      const testWorkspaceId = 'ws_test_12345_abcde';
      const prompt = loadPrompt('kiosk-system', undefined, testWorkspaceId);
      
      // Should contain the actual workspace ID, not the placeholder
      expect(prompt).toContain(`"workspaceId": "${testWorkspaceId}"`);
      expect(prompt).not.toContain('{{WORKSPACE_ID}}');
      
      // Verify it appears in all curl examples
      const workspaceIdMatches = prompt.match(new RegExp(testWorkspaceId, 'g'));
      expect(workspaceIdMatches).toBeTruthy();
      // Should appear 3 times (markdown, image, clear commands)
      expect(workspaceIdMatches!.length).toBe(3);
    });

    test('keeps {{WORKSPACE_ID}} placeholder when workspaceId not provided', () => {
      const prompt = loadPrompt('kiosk-system');
      expect(prompt).toContain('{{WORKSPACE_ID}}');
    });

    test('combines displayLines and workspaceId injection', () => {
      const testWorkspaceId = 'ws_combined_test';
      const displayLines = 20;
      const prompt = loadPrompt('kiosk-system', displayLines, testWorkspaceId);
      
      // Both should be injected
      expect(prompt).toContain(`"workspaceId": "${testWorkspaceId}"`);
      expect(prompt).toContain('Maximum 20 lines of body text');
      expect(prompt).not.toContain('{{WORKSPACE_ID}}');
    });

    test('handles special characters in workspaceId', () => {
      const testWorkspaceId = 'ws-special_chars.123';
      const prompt = loadPrompt('kiosk-system', undefined, testWorkspaceId);
      expect(prompt).toContain(`"workspaceId": "${testWorkspaceId}"`);
    });

    test('handles empty string workspaceId (no replacement)', () => {
      // Empty string is falsy, so no replacement should occur
      const prompt = loadPrompt('kiosk-system', undefined, '');
      expect(prompt).toContain('{{WORKSPACE_ID}}');
    });
  });
});
