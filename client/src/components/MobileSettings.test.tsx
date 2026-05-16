import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MobileSettings } from './MobileSettings';

describe('MobileSettings', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    displayName: 'Test Device',
    ttsEnabled: false,
    ttsSupported: true,
    autoSubmit: true,
    onTtsChange: vi.fn(),
    onAutoSubmitChange: vi.fn(),
    onModeChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders when isOpen is true', () => {
      render(<MobileSettings {...defaultProps} isOpen={true} />);
      expect(screen.getByText('Settings')).toBeDefined();
    });

    it('does not render when isOpen is false', async () => {
      const { rerender } = render(<MobileSettings {...defaultProps} isOpen={false} />);
      
      // Wait for animation timeout
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
      });

      rerender(<MobileSettings {...defaultProps} isOpen={false} />);
      expect(screen.queryByText('Settings')).toBeNull();
    });
  });

  describe('display name', () => {
    it('shows device name', () => {
      render(<MobileSettings {...defaultProps} displayName="My Phone" />);
      expect(screen.getByText(/📱 My Phone/)).toBeDefined();
    });
  });

  describe('TTS toggle', () => {
    it('shows TTS toggle with correct state', () => {
      render(<MobileSettings {...defaultProps} ttsEnabled={true} />);
      const checkbox = screen.getByRole('checkbox', { name: /read messages aloud/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('calls onTtsChange when toggled', async () => {
      render(<MobileSettings {...defaultProps} ttsEnabled={false} />);
      const checkbox = screen.getByRole('checkbox', { name: /read messages aloud/i });
      
      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(defaultProps.onTtsChange).toHaveBeenCalledWith(true);
    });

    it('disables TTS toggle when not supported', () => {
      render(<MobileSettings {...defaultProps} ttsSupported={false} />);
      const checkbox = screen.getByRole('checkbox', { name: /read messages aloud/i }) as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });

    it('shows not supported text when TTS unavailable', () => {
      render(<MobileSettings {...defaultProps} ttsSupported={false} />);
      expect(screen.getByText('(not supported)')).toBeDefined();
    });
  });

  describe('auto-submit toggle', () => {
    it('shows auto-submit toggle with correct state', () => {
      render(<MobileSettings {...defaultProps} autoSubmit={true} />);
      const checkbox = screen.getByRole('checkbox', { name: /auto-send speech/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('calls onAutoSubmitChange when toggled', async () => {
      render(<MobileSettings {...defaultProps} autoSubmit={true} />);
      const checkbox = screen.getByRole('checkbox', { name: /auto-send speech/i });
      
      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(defaultProps.onAutoSubmitChange).toHaveBeenCalledWith(false);
    });

    it('shows hint for auto-submit enabled', () => {
      render(<MobileSettings {...defaultProps} autoSubmit={true} />);
      expect(screen.getByText('Speech sends immediately')).toBeDefined();
    });

    it('shows hint for auto-submit disabled', () => {
      render(<MobileSettings {...defaultProps} autoSubmit={false} />);
      expect(screen.getByText('Edit before sending')).toBeDefined();
    });
  });

  describe('mode switch', () => {
    it('shows switch to kiosk button', () => {
      render(<MobileSettings {...defaultProps} />);
      expect(screen.getByText(/Switch to Kiosk Mode/)).toBeDefined();
    });

    it('calls onModeChange with kiosk when clicked', async () => {
      render(<MobileSettings {...defaultProps} />);
      const button = screen.getByText(/Switch to Kiosk Mode/);
      
      await act(async () => {
        fireEvent.click(button);
      });

      expect(defaultProps.onModeChange).toHaveBeenCalledWith('kiosk');
    });
  });

  describe('close button', () => {
    it('shows close button', () => {
      render(<MobileSettings {...defaultProps} />);
      const closeButton = screen.getByText('✕');
      expect(closeButton).toBeDefined();
    });

    it('calls onClose when close button clicked', async () => {
      render(<MobileSettings {...defaultProps} />);
      const closeButton = screen.getByText('✕');
      
      await act(async () => {
        fireEvent.click(closeButton);
      });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onClose when overlay clicked', async () => {
      render(<MobileSettings {...defaultProps} />);
      const overlay = document.querySelector('.mobile-settings-overlay');
      
      await act(async () => {
        fireEvent.click(overlay!);
      });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('does not close when modal content clicked', async () => {
      render(<MobileSettings {...defaultProps} />);
      const modal = document.querySelector('.mobile-settings-modal');
      
      await act(async () => {
        fireEvent.click(modal!);
      });

      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });
});
