import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConversationPane } from './ConversationPane';
import type { Utterance } from '../types';

describe('ConversationPane', () => {
  const deviceId = 'test-device-123';

  const createUtterance = (overrides: Partial<Utterance> = {}): Utterance => ({
    id: `utterance-${Math.random()}`,
    text: 'Test message',
    partial: false,
    senderId: 'other-device',
    senderName: 'Other User',
    receivedAt: new Date(),
    ...overrides,
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    utterances: new Map<string, Utterance>(),
    deviceId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders when isOpen is true', () => {
      render(<ConversationPane {...defaultProps} isOpen={true} />);
      expect(screen.getByText('Conversation')).toBeDefined();
    });

    it('has open class when isOpen is true', () => {
      render(<ConversationPane {...defaultProps} isOpen={true} />);
      const pane = document.querySelector('.conversation-pane');
      expect(pane?.classList.contains('open')).toBe(true);
    });

    it('does not have open class when isOpen is false', () => {
      render(<ConversationPane {...defaultProps} isOpen={false} />);
      const pane = document.querySelector('.conversation-pane');
      expect(pane?.classList.contains('open')).toBe(false);
    });
  });

  describe('empty state', () => {
    it('shows empty message when no utterances', () => {
      render(<ConversationPane {...defaultProps} utterances={new Map()} />);
      expect(screen.getByText('No messages yet. Start the conversation!')).toBeDefined();
    });
  });

  describe('messages', () => {
    it('displays messages from others', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        text: 'Hello from other user',
        senderName: 'Alice',
        senderId: 'alice-device',
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      expect(screen.getByText('Alice:')).toBeDefined();
      expect(screen.getByText('Hello from other user')).toBeDefined();
    });

    it('displays own messages with "You" label', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        text: 'My own message',
        senderId: deviceId,
        senderName: 'Me',
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      expect(screen.getByText('You:')).toBeDefined();
      expect(screen.getByText('My own message')).toBeDefined();
    });

    it('shows typing indicator for partial messages', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        text: 'Still typing',
        partial: true,
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      expect(screen.getByText('...')).toBeDefined();
    });

    it('sorts messages by received time', () => {
      const earlier = createUtterance({
        id: 'msg-1',
        text: 'First message',
        receivedAt: new Date('2024-01-01T10:00:00'),
      });
      const later = createUtterance({
        id: 'msg-2',
        text: 'Second message',
        receivedAt: new Date('2024-01-01T11:00:00'),
      });
      // Add in reverse order
      const utterances = new Map([
        ['msg-2', later],
        ['msg-1', earlier],
      ]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      const messages = screen.getAllByText(/message$/);
      expect(messages[0].textContent).toBe('First message');
      expect(messages[1].textContent).toBe('Second message');
    });

    it('applies correct CSS classes to own messages', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        senderId: deviceId,
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      const message = document.querySelector('.message');
      expect(message?.classList.contains('own-message')).toBe(true);
    });

    it('applies correct CSS classes to partial messages', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        partial: true,
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      const message = document.querySelector('.message');
      expect(message?.classList.contains('partial')).toBe(true);
    });

    it('applies correct CSS classes to final messages', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        partial: false,
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<ConversationPane {...defaultProps} utterances={utterances} />);
      
      const message = document.querySelector('.message');
      expect(message?.classList.contains('final')).toBe(true);
    });
  });

  describe('close functionality', () => {
    it('calls onClose when back button clicked', async () => {
      render(<ConversationPane {...defaultProps} />);
      const backButton = screen.getByText('← Back');
      
      await act(async () => {
        fireEvent.click(backButton);
      });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop clicked', async () => {
      render(<ConversationPane {...defaultProps} />);
      const backdrop = document.querySelector('.conversation-backdrop');
      
      await act(async () => {
        fireEvent.click(backdrop!);
      });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });
});
