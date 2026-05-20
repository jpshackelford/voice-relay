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
      // When expanded, should show the summary in a code block
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toBe('Run `ls -la` to list files');
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
      
      // Now expanded - shows summary in code block
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.textContent).toBe('Run `ls -la` to list files');
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

    it('does not show details section when expanded but no summary', () => {
      const actionWithoutSummary: AgentAction = {
        ...mockAction,
        summary: '',  // No summary
      };
      render(<AgentEventCard action={actionWithoutSummary} defaultExpanded />);
      
      // Should not show details section if summary is empty
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

  describe('expanded content display', () => {
    it('shows summary in code block when expanded', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      const content = document.querySelector('.agent-event-content');
      expect(content).toBeDefined();
      expect(content?.tagName.toLowerCase()).toBe('code');
      expect(content?.textContent).toBe('Run `ls -la` to list files');
    });

    it('does not show raw event kind when expanded', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      // Should NOT show raw event kind like "CmdRunAction"
      expect(screen.queryByText('CmdRunAction')).toBeNull();
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
