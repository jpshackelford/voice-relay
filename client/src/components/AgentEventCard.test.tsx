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

    it('renders expand/collapse toggle button', () => {
      render(<AgentEventCard action={mockAction} />);
      const toggleBtn = screen.getByRole('button', { name: /expand details/i });
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn.textContent).toBe('▼');
    });

    it('starts collapsed by default', () => {
      render(<AgentEventCard action={mockAction} />);
      expect(screen.queryByText('CmdRunAction')).toBeNull();
    });

    it('starts expanded when defaultExpanded is true', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      expect(screen.getByText('CmdRunAction')).toBeDefined();
    });
  });

  describe('expand/collapse behavior', () => {
    it('expands when toggle button is clicked', () => {
      render(<AgentEventCard action={mockAction} />);
      
      // Initially collapsed
      expect(screen.queryByText('CmdRunAction')).toBeNull();
      
      // Click to expand
      const toggleBtn = screen.getByRole('button', { name: /expand details/i });
      fireEvent.click(toggleBtn);
      
      // Now expanded
      expect(screen.getByText('CmdRunAction')).toBeDefined();
    });

    it('collapses when expanded toggle is clicked', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      
      // Initially expanded
      expect(screen.getByText('CmdRunAction')).toBeDefined();
      
      // Click to collapse
      const toggleBtn = screen.getByRole('button', { name: /collapse details/i });
      fireEvent.click(toggleBtn);
      
      // Now collapsed
      expect(screen.queryByText('CmdRunAction')).toBeNull();
    });

    it('expands with Enter key on header', () => {
      render(<AgentEventCard action={mockAction} />);
      
      const header = document.querySelector('.agent-event-header');
      expect(header).toBeDefined();
      fireEvent.keyDown(header!, { key: 'Enter' });
      
      expect(screen.getByText('CmdRunAction')).toBeDefined();
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

  describe('timestamp display', () => {
    it('shows formatted timestamp when expanded', () => {
      render(<AgentEventCard action={mockAction} defaultExpanded />);
      // Timestamp should be formatted as time (locale-dependent)
      const timestampDiv = document.querySelector('.agent-event-timestamp');
      expect(timestampDiv).toBeDefined();
      expect(timestampDiv).not.toBeNull();
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
