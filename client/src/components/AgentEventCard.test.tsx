import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentEventCard } from './AgentEventCard';
import type { AgentAction, ExtendedAgentAction } from '../types';

describe('AgentEventCard', () => {
  const mockAction: AgentAction = {
    id: 'action-1',
    timestamp: '2024-05-20T10:30:00.000Z',
    kind: 'CmdRunAction',
    source: 'agent',
    summary: 'Run `ls -la` to list files',
  };

  describe('rendering', () => {
    it('renders action with summary as title', () => {
      render(<AgentEventCard action={mockAction} />);
      expect(screen.getByText('Run `ls -la` to list files')).toBeDefined();
    });

    it('renders action icon based on kind', () => {
      render(<AgentEventCard action={mockAction} />);
      // CmdRunAction should show 🔧 icon (from getActionIcon)
      expect(screen.getByText('🔧')).toBeDefined();
    });

    it('renders expand/collapse toggle indicator', () => {
      render(<AgentEventCard action={mockAction} />);
      const toggle = document.querySelector('.agent-event-toggle');
      expect(toggle).toBeDefined();
      expect(toggle?.textContent).toBe('▼');
    });

    it('starts collapsed by default', () => {
      render(<AgentEventCard action={mockAction} />);
      // When collapsed, the expanded details section should not be visible
      const details = document.querySelector('.agent-event-details');
      expect(details).toBeNull();
    });

    it('starts expanded when defaultExpanded is true', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      // When expanded, should show the summary in the content area
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
    });
  });

  describe('expand/collapse behavior', () => {
    it('expands when toggle button is clicked', () => {
      render(<AgentEventCard action={mockAction} />);
      
      // Initially collapsed
      expect(document.querySelector('.agent-event-details')).toBeNull();
      
      // Click to expand
      const toggleBtn = screen.getByRole('button', { name: /expand details/i });
      fireEvent.click(toggleBtn);
      
      // Now expanded - shows content
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
    });

    it('collapses when expanded toggle is clicked', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      
      // Initially expanded
      expect(document.querySelector('.agent-event-details')).toBeDefined();
      
      // Click to collapse
      const toggleBtn = screen.getByRole('button', { name: /collapse details/i });
      fireEvent.click(toggleBtn);
      
      // Now collapsed
      expect(document.querySelector('.agent-event-details')).toBeNull();
    });

    it('expands with Enter key on header', () => {
      render(<AgentEventCard action={mockAction} />);
      
      const header = document.querySelector('.agent-event-header');
      expect(header).toBeDefined();
      fireEvent.keyDown(header!, { key: 'Enter' });
      
      // Should show expanded details
      expect(document.querySelector('.agent-event-details')).toBeDefined();
    });

    it('expands with Space key on header', () => {
      render(<AgentEventCard action={mockAction} />);
      
      const header = document.querySelector('.agent-event-header');
      expect(header).toBeDefined();
      fireEvent.keyDown(header!, { key: ' ' });
      
      // Should show expanded details
      expect(document.querySelector('.agent-event-details')).toBeDefined();
    });

    it('does not show details section when expanded but no content', () => {
      const actionWithoutContent: AgentAction = {
        ...mockAction,
        kind: 'UnknownAction',  // Unknown action with no content
        summary: '',  // No summary
      };
      render(<AgentEventCard action={actionWithoutContent} defaultExpanded />);
      
      // Should not show details section if no content
      expect(document.querySelector('.agent-event-details')).toBeNull();
    });
  });

  describe('success indicator', () => {
    it('shows success indicator for observation with exit_code 0', () => {
      const observation: ExtendedAgentAction = {
        ...mockAction,
        kind: 'CmdOutputObservation',
        exitCode: 0,
        isObservation: true,
      };
      render(<AgentEventCard action={observation} />);
      expect(screen.getByTitle('Success')).toBeDefined();
    });

    it('shows success indicator using V1Event exit_code field', () => {
      const observation: AgentAction = {
        ...mockAction,
        kind: 'ExecuteBashObservation',
        exit_code: 0,  // V1Event field name
      };
      render(<AgentEventCard action={observation} />);
      expect(screen.getByTitle('Success')).toBeDefined();
    });

    it('shows timeout indicator for observation with exit_code -1', () => {
      const observation: ExtendedAgentAction = {
        ...mockAction,
        kind: 'CmdOutputObservation',
        exitCode: -1,
        isObservation: true,
      };
      render(<AgentEventCard action={observation} />);
      expect(screen.getByTitle('Timeout')).toBeDefined();
    });

    it('shows timeout indicator using V1Event timeout field', () => {
      const observation: AgentAction = {
        ...mockAction,
        kind: 'ExecuteBashObservation',
        timeout: true,  // V1Event field name
      };
      render(<AgentEventCard action={observation} />);
      expect(screen.getByTitle('Timeout')).toBeDefined();
    });

    it('does not show indicator for actions (non-observations)', () => {
      render(<AgentEventCard action={mockAction} />);
      expect(screen.queryByTitle('Success')).toBeNull();
      expect(screen.queryByTitle('Timeout')).toBeNull();
    });
  });

  describe('kind formatting', () => {
    it('formats action kind when no summary provided', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'FileReadAction',
        summary: '',  // Empty summary
      };
      render(<AgentEventCard action={action} />);
      // Should format FileReadAction as "File Read"
      expect(screen.getByText('File Read')).toBeDefined();
    });

    it('uses summary as title when provided', () => {
      render(<AgentEventCard action={mockAction} />);
      expect(screen.getByText('Run `ls -la` to list files')).toBeDefined();
    });
  });

  describe('rich content rendering', () => {
    it('renders terminal observation with command and output', () => {
      const observation: AgentAction = {
        ...mockAction,
        kind: 'ExecuteBashObservation',
        command: 'echo hello',
        content: 'hello',
      };
      render(<AgentEventCard action={observation} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      // Should have rendered markdown with code formatting
      expect(content?.innerHTML).toContain('echo hello');
    });

    it('renders task list with status icons', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'TaskTrackerAction',
        task_list: [
          { title: 'Task 1', status: 'done' },
          { title: 'Task 2', status: 'in_progress' },
          { title: 'Task 3', status: 'todo' },
        ],
      };
      render(<AgentEventCard action={action} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toContain('✅');
      expect(content?.textContent).toContain('🔄');
      expect(content?.textContent).toContain('⏳');
      expect(content?.textContent).toContain('Task 1');
    });

    it('renders MCP tool action with JSON arguments', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'MCPToolAction',
        data: { param: 'value' },
      };
      render(<AgentEventCard action={action} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toContain('MCP Tool Call');
      expect(content?.innerHTML).toContain('param');
    });

    it('renders grep observation with matches', () => {
      const observation: AgentAction = {
        ...mockAction,
        kind: 'GrepObservation',
        pattern: 'TODO',
        search_path: '/src',
        matches: ['src/file.ts:10'],
      };
      render(<AgentEventCard action={observation} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toContain('Pattern');
      expect(content?.textContent).toContain('TODO');
      expect(content?.textContent).toContain('Matches');
    });

    it('renders file editor observation with error', () => {
      const observation: AgentAction = {
        ...mockAction,
        kind: 'FileEditorObservation',
        error: 'File not found',
      };
      render(<AgentEventCard action={observation} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toContain('Error');
      expect(content?.textContent).toContain('File not found');
    });

    it('renders content as HTML with markdown parsed', () => {
      const observation: AgentAction = {
        ...mockAction,
        kind: 'ExecuteBashObservation',
        command: 'ls',
        content: 'file.txt',
      };
      render(<AgentEventCard action={observation} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      // Content should be rendered using dangerouslySetInnerHTML
      // Check that it's a div (not code element as before)
      expect(content?.tagName.toLowerCase()).toBe('div');
    });

    it('falls back to summary when no specific content available', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'UnknownAction',
        summary: 'Unknown action summary',
      };
      render(<AgentEventCard action={action} defaultExpanded />);
      
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toContain('Unknown action summary');
    });
  });

  describe('V1Event kind support', () => {
    it('shows correct icon for ExecuteBashAction', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'ExecuteBashAction',
      };
      render(<AgentEventCard action={action} />);
      expect(screen.getByText('🔧')).toBeDefined();
    });

    it('shows correct icon for FileEditorAction', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'FileEditorAction',
      };
      render(<AgentEventCard action={action} />);
      expect(screen.getByText('📁')).toBeDefined();
    });

    it('shows correct icon for BrowserNavigateAction', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'BrowserNavigateAction',
      };
      render(<AgentEventCard action={action} />);
      expect(screen.getByText('🌐')).toBeDefined();
    });

    it('shows correct icon for ThinkAction', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'ThinkAction',
      };
      render(<AgentEventCard action={action} />);
      expect(screen.getByText('💭')).toBeDefined();
    });

    it('shows correct icon for MCPToolAction', () => {
      const action: AgentAction = {
        ...mockAction,
        kind: 'MCPToolAction',
      };
      render(<AgentEventCard action={action} />);
      expect(screen.getByText('🔌')).toBeDefined();
    });
  });

  describe('accessibility', () => {
    it('has proper tabIndex on header', () => {
      render(<AgentEventCard action={mockAction} />);
      const header = document.querySelector('.agent-event-header');
      expect(header).toBeDefined();
      expect(header?.getAttribute('tabIndex')).toBe('0');
    });

    it('toggle button has aria-expanded attribute', () => {
      render(<AgentEventCard action={mockAction} />);
      const toggle = screen.getByRole('button', { name: /expand details/i });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
  });
});
