import { describe, it, expect } from 'vitest';
import {
  getActionContent,
  getObservationContent,
  getEventContent,
  extractTextContent,
  MAX_CONTENT_LENGTH,
} from './getEventContent';
import type { AgentAction, ContentPart } from '../types';

describe('getEventContent utilities', () => {
  // Helper to create a base action
  const baseAction = (overrides: Partial<AgentAction> = {}): AgentAction => ({
    id: 'test-1',
    timestamp: '2024-05-20T10:30:00.000Z',
    kind: 'Unknown',
    source: 'agent',
    summary: 'Test summary',
    ...overrides,
  });

  describe('extractTextContent', () => {
    it('returns empty string for undefined', () => {
      expect(extractTextContent(undefined)).toBe('');
    });

    it('returns string content as-is', () => {
      expect(extractTextContent('hello world')).toBe('hello world');
    });

    it('extracts text from ContentPart array', () => {
      const content: ContentPart[] = [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ];
      expect(extractTextContent(content)).toBe('Line 1\nLine 2');
    });

    it('filters out image parts', () => {
      const content: ContentPart[] = [
        { type: 'text', text: 'Hello' },
        { type: 'image', image_urls: ['http://example.com/img.png'] },
        { type: 'text', text: 'World' },
      ];
      expect(extractTextContent(content)).toBe('Hello\nWorld');
    });
  });

  describe('getActionContent', () => {
    describe('ExecuteBashAction', () => {
      it('formats command', () => {
        const action = baseAction({
          kind: 'ExecuteBashAction',
          command: 'ls -la',
        });
        const content = getActionContent(action);
        expect(content).toBe('Command:\n`ls -la`');
      });

      it('returns empty for missing command', () => {
        const action = baseAction({
          kind: 'ExecuteBashAction',
        });
        expect(getActionContent(action)).toBe('');
      });
    });

    describe('FileEditorAction', () => {
      it('formats create command with path and content', () => {
        const action = baseAction({
          kind: 'FileEditorAction',
          command: 'create',
          path: '/src/test.ts',
          file_text: 'const x = 1;',
        });
        const content = getActionContent(action);
        expect(content).toContain('**Create:** `/src/test.ts`');
        expect(content).toContain('const x = 1;');
      });

      it('infers create from file_text when command is absent', () => {
        const action = baseAction({
          kind: 'FileEditorAction',
          path: '/src/test.ts',
          file_text: 'const x = 1;',
        });
        const content = getActionContent(action);
        expect(content).toContain('**Create:** `/src/test.ts`');
        expect(content).toContain('const x = 1;');
      });

      it('renders view command (regression: previously empty)', () => {
        const action = baseAction({
          kind: 'FileEditorAction',
          command: 'view',
          path: '/src/test.ts',
        });
        // Previously returned '' which made the card empty in production.
        expect(getActionContent(action)).toBe('**View:** `/src/test.ts`');
      });

      it('renders str_replace with old/new snippets', () => {
        const action = baseAction({
          kind: 'FileEditorAction',
          command: 'str_replace',
          path: '/src/test.ts',
          old_str: 'foo',
          new_str: 'bar',
        });
        const content = getActionContent(action);
        expect(content).toContain('**Edit:** `/src/test.ts`');
        expect(content).toContain('**Old:**');
        expect(content).toContain('foo');
        expect(content).toContain('**New:**');
        expect(content).toContain('bar');
      });

      it('renders insert with new_str body', () => {
        const action = baseAction({
          kind: 'FileEditorAction',
          command: 'insert',
          path: '/src/test.ts',
          new_str: 'new line',
        });
        const content = getActionContent(action);
        expect(content).toContain('**Insert into:** `/src/test.ts`');
        expect(content).toContain('new line');
      });

      it('truncates long create content', () => {
        const longText = 'x'.repeat(MAX_CONTENT_LENGTH + 100);
        const action = baseAction({
          kind: 'FileEditorAction',
          command: 'create',
          path: '/src/test.ts',
          file_text: longText,
        });
        const content = getActionContent(action);
        expect(content).toContain('...(truncated)');
        expect(content.length).toBeLessThan(longText.length + 100);
      });
    });

    describe('InvokeSkillAction (regression for PR #258 follow-up)', () => {
      it('shows the invoked skill name', () => {
        const action = baseAction({
          kind: 'InvokeSkillAction',
          skill_name: 'github',
        });
        expect(getActionContent(action)).toBe('**Invoke skill:** `github`');
      });

      it('falls back to a generic label when name is missing', () => {
        const action = baseAction({ kind: 'InvokeSkillAction' });
        expect(getActionContent(action)).toBe('**Invoke skill**');
      });
    });

    describe('MCPToolAction', () => {
      it('formats MCP tool call with arguments', () => {
        const action = baseAction({
          kind: 'MCPToolAction',
          data: { param1: 'value1', param2: 42 },
        });
        const content = getActionContent(action);
        expect(content).toContain('**MCP Tool Call**');
        expect(content).toContain('**Arguments:**');
        expect(content).toContain('```json');
        expect(content).toContain('"param1": "value1"');
      });
    });

    describe('ThinkAction', () => {
      it('returns thought content', () => {
        const action = baseAction({
          kind: 'ThinkAction',
          thought: 'I need to analyze this code...',
        });
        expect(getActionContent(action)).toBe('I need to analyze this code...');
      });
    });

    describe('FinishAction', () => {
      it('returns message content trimmed', () => {
        const action = baseAction({
          kind: 'FinishAction',
          message: '  Task completed successfully  ',
        });
        expect(getActionContent(action)).toBe('Task completed successfully');
      });
    });

    describe('TaskTrackerAction', () => {
      it('formats task list with status icons', () => {
        const action = baseAction({
          kind: 'TaskTrackerAction',
          task_list: [
            { title: 'Task 1', status: 'done' },
            { title: 'Task 2', status: 'in_progress' },
            { title: 'Task 3', status: 'todo' },
          ],
        });
        const content = getActionContent(action);
        expect(content).toContain('**Command:** `plan`');
        expect(content).toContain('**Task List (3 items):**');
        expect(content).toContain('✅');
        expect(content).toContain('🔄');
        expect(content).toContain('⏳');
        expect(content).toContain('Task 1');
        expect(content).toContain('[DONE]');
        expect(content).toContain('[IN PROGRESS]');
        expect(content).toContain('[TODO]');
      });

      it('formats task with notes', () => {
        const action = baseAction({
          kind: 'TaskTrackerAction',
          task_list: [
            { title: 'Task 1', status: 'todo', notes: 'Important note' },
          ],
        });
        const content = getActionContent(action);
        expect(content).toContain('*Notes: Important note*');
      });

      it('shows empty task list', () => {
        const action = baseAction({
          kind: 'TaskTrackerAction',
          task_list: [],
        });
        const content = getActionContent(action);
        expect(content).toContain('**Task List:** Empty');
      });
    });

    describe('BrowserNavigateAction', () => {
      it('formats URL', () => {
        const action = baseAction({
          kind: 'BrowserNavigateAction',
          url: 'https://example.com',
        });
        expect(getActionContent(action)).toBe('Browsing https://example.com');
      });

      it('includes new tab indicator', () => {
        const action = baseAction({
          kind: 'BrowserNavigateAction',
          url: 'https://example.com',
          new_tab: true,
        });
        const content = getActionContent(action);
        expect(content).toContain('**New Tab:** Yes');
      });
    });

    describe('GrepAction', () => {
      it('formats pattern and path', () => {
        const action = baseAction({
          kind: 'GrepAction',
          pattern: 'TODO',
          path: '/src',
          include: '*.ts',
        });
        const content = getActionContent(action);
        expect(content).toContain('**Pattern:** `TODO`');
        expect(content).toContain('**Path:** `/src`');
        expect(content).toContain('**Include:** `*.ts`');
      });
    });
  });

  describe('getObservationContent', () => {
    describe('ExecuteBashObservation', () => {
      it('formats command and output', () => {
        const action = baseAction({
          kind: 'ExecuteBashObservation',
          command: 'echo hello',
          content: 'hello',
        });
        const content = getObservationContent(action);
        expect(content).toContain('Command: `echo hello`');
        expect(content).toContain('```sh');
        expect(content).toContain('hello');
      });

      it('shows no output message for empty output', () => {
        const action = baseAction({
          kind: 'ExecuteBashObservation',
          command: 'touch file.txt',
          content: '',
        });
        const content = getObservationContent(action);
        expect(content).toContain('(no output)');
      });

      it('handles ContentPart array', () => {
        const action = baseAction({
          kind: 'ExecuteBashObservation',
          command: 'ls',
          content: [
            { type: 'text', text: 'file1.txt' },
            { type: 'text', text: 'file2.txt' },
          ],
        });
        const content = getObservationContent(action);
        expect(content).toContain('file1.txt');
        expect(content).toContain('file2.txt');
      });
    });

    describe('FileEditorObservation', () => {
      it('formats error message', () => {
        const action = baseAction({
          kind: 'FileEditorObservation',
          error: 'File not found',
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Error:**');
        expect(content).toContain('File not found');
      });

      it('formats file content in code block', () => {
        const action = baseAction({
          kind: 'FileEditorObservation',
          content: 'const x = 1;',
        });
        const content = getObservationContent(action);
        expect(content).toContain('```');
        expect(content).toContain('const x = 1;');
      });
    });

    describe('InvokeSkillObservation (regression for PR #258 follow-up)', () => {
      it('formats successful skill result with name + content', () => {
        const action = baseAction({
          kind: 'InvokeSkillObservation',
          skill_name: 'github',
          content: 'Skill ran successfully.',
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Skill:** `github`');
        expect(content).toContain('**Result:**');
        expect(content).toContain('Skill ran successfully.');
      });

      it('formats error result', () => {
        const action = baseAction({
          kind: 'InvokeSkillObservation',
          skill_name: 'github',
          is_error: true,
          content: 'auth failed',
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Error:**');
        expect(content).toContain('auth failed');
      });

      it('produces non-empty content even when no body is sent', () => {
        const action = baseAction({
          kind: 'InvokeSkillObservation',
          skill_name: 'github',
        });
        const content = getObservationContent(action);
        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain('github');
      });
    });

    describe('ThinkObservation (regression for PR #258 follow-up)', () => {
      it('renders content text when present', () => {
        const action = baseAction({
          kind: 'ThinkObservation',
          content: 'Thought recorded.',
        });
        expect(getObservationContent(action)).toBe('Thought recorded.');
      });

      it('produces a fallback when content is empty (previously empty card)', () => {
        const action = baseAction({ kind: 'ThinkObservation' });
        expect(getObservationContent(action)).toBe('Thought recorded.');
      });
    });

    describe('MCPToolObservation', () => {
      it('formats successful result', () => {
        const action = baseAction({
          kind: 'MCPToolObservation',
          tool_name: 'file_editor',
          content: 'File created successfully',
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Tool:** file_editor');
        expect(content).toContain('**Result:**');
        expect(content).toContain('File created successfully');
      });

      it('formats error result', () => {
        const action = baseAction({
          kind: 'MCPToolObservation',
          tool_name: 'file_editor',
          content: 'Permission denied',
          is_error: true,
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Tool:** file_editor');
        expect(content).toContain('**Error:**');
        expect(content).toContain('Permission denied');
      });
    });

    describe('GrepObservation', () => {
      it('formats matches list', () => {
        const action = baseAction({
          kind: 'GrepObservation',
          pattern: 'TODO',
          search_path: '/src',
          matches: ['src/file1.ts:10', 'src/file2.ts:20'],
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Pattern:** `TODO`');
        expect(content).toContain('**Search Path:** `/src`');
        expect(content).toContain('**Matches (2):**');
        expect(content).toContain('`src/file1.ts:10`');
      });

      it('shows no matches message', () => {
        const action = baseAction({
          kind: 'GrepObservation',
          pattern: 'NONEXISTENT',
          search_path: '/src',
          matches: [],
        });
        const content = getObservationContent(action);
        expect(content).toContain('No matches found');
      });
    });

    describe('GlobObservation', () => {
      it('formats files list', () => {
        const action = baseAction({
          kind: 'GlobObservation',
          pattern: '*.ts',
          search_path: '/src',
          files: ['src/app.ts', 'src/index.ts'],
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Files Found (2):**');
        expect(content).toContain('`src/app.ts`');
      });

      it('shows no files message', () => {
        const action = baseAction({
          kind: 'GlobObservation',
          pattern: '*.xyz',
          search_path: '/src',
          files: [],
        });
        const content = getObservationContent(action);
        expect(content).toContain('No files found');
      });
    });

    describe('BrowserObservation', () => {
      it('formats output', () => {
        const action = baseAction({
          kind: 'BrowserObservation',
          content: 'Page loaded successfully',
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Output:**');
        expect(content).toContain('Page loaded successfully');
      });

      it('formats error', () => {
        const action = baseAction({
          kind: 'BrowserObservation',
          error: 'Connection refused',
        });
        const content = getObservationContent(action);
        expect(content).toContain('**Error:**');
        expect(content).toContain('Connection refused');
      });
    });
  });

  describe('getEventContent', () => {
    it('routes actions to getActionContent', () => {
      const action = baseAction({
        kind: 'ExecuteBashAction',
        command: 'ls',
      });
      expect(getEventContent(action)).toBe(getActionContent(action));
    });

    it('routes observations to getObservationContent', () => {
      const action = baseAction({
        kind: 'ExecuteBashObservation',
        command: 'ls',
        content: 'output',
      });
      expect(getEventContent(action)).toBe(getObservationContent(action));
    });

    it('returns empty for unknown action types', () => {
      const action = baseAction({
        kind: 'UnknownAction',
      });
      expect(getEventContent(action)).toBe('');
    });

    it('extracts text content for unknown observation types', () => {
      const action = baseAction({
        kind: 'UnknownObservation',
        content: 'Some content',
      });
      expect(getEventContent(action)).toBe('Some content');
    });
  });

  describe('content truncation', () => {
    it('truncates long content at MAX_CONTENT_LENGTH', () => {
      const longContent = 'x'.repeat(MAX_CONTENT_LENGTH + 500);
      const action = baseAction({
        kind: 'ExecuteBashObservation',
        command: 'cat largefile.txt',
        content: longContent,
      });
      const content = getObservationContent(action);
      expect(content).toContain('...(truncated)');
      // Content should be truncated
      expect(content.indexOf('x'.repeat(100))).toBeGreaterThanOrEqual(0);
    });
  });

  // ===== Additional coverage for issue #303 =====
  // Targeted tests for previously uncovered branches in browser-action helpers,
  // task-tracker observations, file-editor observations, and other edge cases.

  describe('FileEditorAction edge cases', () => {
    it('falls back to a generic header when command is unrecognised', () => {
      const action = baseAction({
        kind: 'FileEditorAction',
        command: 'undo',
        path: '/tmp/foo.txt',
      });

      expect(getActionContent(action)).toBe('**undo:** `/tmp/foo.txt`');
    });

    it('falls back to "File" header when command and path are both missing', () => {
      const action = baseAction({ kind: 'FileEditorAction' });
      expect(getActionContent(action)).toBe('**File:** `file`');
    });
  });

  describe('BrowserAction variants (additional coverage)', () => {
    it('formats BrowserClickAction with the element index', () => {
      const action = baseAction({
        kind: 'BrowserClickAction',
        index: 7,
      });
      expect(getActionContent(action)).toBe('**Element Index:** 7');
    });

    it('formats BrowserClickAction with new_tab indicator', () => {
      const action = baseAction({
        kind: 'BrowserClickAction',
        index: 3,
        new_tab: true,
      });
      const content = getActionContent(action);
      expect(content).toContain('**Element Index:** 3');
      expect(content).toContain('**New Tab:** Yes');
    });

    it('shows "unknown" element index when missing on BrowserClickAction', () => {
      const action = baseAction({ kind: 'BrowserClickAction' });
      expect(getActionContent(action)).toBe('**Element Index:** unknown');
    });

    it('formats BrowserTypeAction with short text', () => {
      const action = baseAction({
        kind: 'BrowserTypeAction',
        index: 4,
        text: 'hi',
      });
      const content = getActionContent(action);
      expect(content).toContain('**Element Index:** 4');
      expect(content).toContain('**Text:** hi');
    });

    it('truncates BrowserTypeAction text longer than 50 characters', () => {
      const action = baseAction({
        kind: 'BrowserTypeAction',
        index: 0,
        text: 'a'.repeat(80),
      });
      const content = getActionContent(action);
      expect(content).toContain('...');
      // Ensure the truncated preview is exactly 50 chars + ellipsis prefix.
      expect(content).toContain('**Text:** ' + 'a'.repeat(50) + '...');
    });

    it('formats BrowserTypeAction with missing text as empty preview', () => {
      const action = baseAction({ kind: 'BrowserTypeAction' });
      const content = getActionContent(action);
      expect(content).toContain('**Element Index:** unknown');
      expect(content).toContain('**Text:** ');
    });

    it('formats BrowserGetStateAction with screenshot flag', () => {
      const action = baseAction({
        kind: 'BrowserGetStateAction',
        include_screenshot: true,
      });
      expect(getActionContent(action)).toBe('**Include Screenshot:** Yes');
    });

    it('returns empty for BrowserGetStateAction without screenshot flag', () => {
      const action = baseAction({ kind: 'BrowserGetStateAction' });
      expect(getActionContent(action)).toBe('');
    });

    it('formats BrowserGetContentAction with extract_links and start offset', () => {
      const action = baseAction({
        kind: 'BrowserGetContentAction',
        extract_links: true,
        start_from_char: 100,
      });
      const content = getActionContent(action);
      expect(content).toContain('**Extract Links:** Yes');
      expect(content).toContain('**Start From Character:** 100');
    });

    it('returns empty for BrowserGetContentAction with no flags set', () => {
      const action = baseAction({ kind: 'BrowserGetContentAction' });
      expect(getActionContent(action)).toBe('');
    });

    it('formats BrowserScrollAction with explicit direction', () => {
      const action = baseAction({
        kind: 'BrowserScrollAction',
        direction: 'up',
      });
      expect(getActionContent(action)).toBe('**Direction:** up');
    });

    it('defaults BrowserScrollAction direction to "down" when missing', () => {
      const action = baseAction({ kind: 'BrowserScrollAction' });
      expect(getActionContent(action)).toBe('**Direction:** down');
    });

    it('formats BrowserSwitchTabAction with the tab id', () => {
      const action = baseAction({
        kind: 'BrowserSwitchTabAction',
        tab_id: 'tab-42',
      });
      expect(getActionContent(action)).toBe('**Tab ID:** tab-42');
    });

    it('formats BrowserCloseTabAction with "unknown" tab id when missing', () => {
      const action = baseAction({ kind: 'BrowserCloseTabAction' });
      expect(getActionContent(action)).toBe('**Tab ID:** unknown');
    });

    it('returns empty string for tabs-list browser action (no switch case body)', () => {
      const action = baseAction({ kind: 'BrowserListTabsAction' });
      expect(getActionContent(action)).toBe('');
    });
  });

  describe('FileEditorObservation extra branches', () => {
    it('returns empty string when content is missing', () => {
      const action = baseAction({ kind: 'FileEditorObservation' });
      expect(getObservationContent(action)).toBe('');
    });

    it('uses the FileEditorObservation branch for StrReplaceEditorObservation aliases', () => {
      const action = baseAction({
        kind: 'StrReplaceEditorObservation',
        content: 'updated body',
      });
      const content = getObservationContent(action);
      expect(content).toContain('updated body');
    });
  });

  describe('BrowserObservation default branch', () => {
    it('falls back to a success message when there is no content or error', () => {
      const action = baseAction({ kind: 'BrowserObservation' });
      expect(getObservationContent(action)).toBe('Browser action completed successfully.');
    });
  });

  describe('TaskTrackerObservation', () => {
    it('lists tasks when task_list is non-empty', () => {
      const action = baseAction({
        kind: 'TaskTrackerObservation',
        task_list: [
          { title: 'Investigate bug', status: 'in_progress' },
          { title: 'Write tests', status: 'todo' },
        ],
      });
      const content = getObservationContent(action);
      expect(content).toContain('**Command:** `view`');
      expect(content).toContain('Investigate bug');
      expect(content).toContain('Write tests');
      expect(content).toContain('**Task List (2 items):**');
    });

    it('falls back to "Task List: Empty" when no tasks are present', () => {
      const action = baseAction({ kind: 'TaskTrackerObservation' });
      const content = getObservationContent(action);
      expect(content).toContain('**Command:** `view`');
      expect(content).toContain('**Task List:** Empty');
    });

    it('renders TaskTrackerAction with notes and singular "item" wording', () => {
      const action = baseAction({
        kind: 'TaskTrackerAction',
        task_list: [
          { title: 'Mystery item', status: 'todo', notes: 'On hold' },
        ],
      });
      const content = getActionContent(action);
      expect(content).toContain('**[TODO]**');
      expect(content).toContain('Mystery item');
      expect(content).toContain('Notes: On hold');
      // Single-item list uses singular "item" wording.
      expect(content).toContain('**Task List (1 item):**');
    });
  });

  describe('GlobObservation / GrepObservation error branches', () => {
    it('renders an error message for a GlobObservation with is_error=true', () => {
      const action = baseAction({
        kind: 'GlobObservation',
        pattern: '*.ts',
        search_path: '/src',
        is_error: true,
        content: 'permission denied',
      });
      const content = getObservationContent(action);
      expect(content).toContain('**Error:**');
      expect(content).toContain('permission denied');
    });

    it('renders an error message for a GrepObservation with is_error=true', () => {
      const action = baseAction({
        kind: 'GrepObservation',
        pattern: 'TODO',
        search_path: '/src',
        include: '*.ts',
        is_error: true,
        content: 'regex failed',
      });
      const content = getObservationContent(action);
      expect(content).toContain('**Pattern:** `TODO`');
      expect(content).toContain('**Include:** `*.ts`');
      expect(content).toContain('**Error:**');
      expect(content).toContain('regex failed');
    });

    it('falls back to `path` when search_path is absent on GlobObservation', () => {
      const action = baseAction({
        kind: 'GlobObservation',
        pattern: '*.md',
        path: '/docs',
        files: ['README.md'],
      });
      const content = getObservationContent(action);
      expect(content).toContain('**Search Path:** `/docs`');
    });
  });

  describe('FinishObservation', () => {
    it('renders the content body on success', () => {
      const action = baseAction({
        kind: 'FinishObservation',
        content: 'All done!',
      });
      expect(getObservationContent(action)).toBe('All done!');
    });

    it('formats an error when is_error is true', () => {
      const action = baseAction({
        kind: 'FinishObservation',
        is_error: true,
        content: 'Something failed',
      });
      const content = getObservationContent(action);
      expect(content).toContain('**Error:**');
      expect(content).toContain('Something failed');
    });
  });
});
