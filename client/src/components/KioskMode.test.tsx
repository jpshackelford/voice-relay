import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { KioskMode } from './KioskMode';
import type { DeviceInfo, Utterance, DisplayContent } from '../types';

// Mock hooks that KioskMode uses
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: vi.fn(),
    isSpeaking: false,
    isSupported: true,
  }),
}));

vi.mock('../hooks/useAI', () => ({
  useAI: () => ({
    connected: false,
    connecting: false,
    error: null,
    toggle: vi.fn(),
    sendMessage: vi.fn(),
    // Mock checkAvailability to return immediately
    checkAvailability: vi.fn().mockImplementation(() => Promise.resolve({ available: false })),
  }),
}));

vi.mock('./QRCode', () => ({
  QRCodeDisplay: () => <div data-testid="qr-code">QR Code</div>,
}));

describe('KioskMode', () => {
  const defaultProps = {
    deviceId: 'test-device-123',
    displayName: 'Test Device',
    connected: true,
    devices: [] as DeviceInfo[],
    utterances: new Map<string, Utterance>(),
    displayContent: null as DisplayContent | null,
    sendText: vi.fn(),
    onModeChange: vi.fn(),
    onAIStatusChange: vi.fn(),
    onExit: vi.fn(),
    workspaceId: 'test-workspace',
    sessionId: 'test-session',
  };

  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: originalInnerWidth,
    });
  });

  function setWindowWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
    // Trigger resize event for hooks that listen to it
    window.dispatchEvent(new Event('resize'));
  }

  describe('Desktop kiosk mode', () => {
    beforeEach(() => {
      setWindowWidth(1024); // Desktop width
    });

    it('renders exit button with correct title', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      expect(exitButton).toBeDefined();
      expect(exitButton.textContent).toBe('✕');
    });

    it('calls onExit when exit button is clicked', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      await act(async () => {
        fireEvent.click(exitButton);
      });
      expect(defaultProps.onExit).toHaveBeenCalledTimes(1);
    });

    it('does not call onModeChange when exit button is clicked', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      await act(async () => {
        fireEvent.click(exitButton);
      });
      expect(defaultProps.onModeChange).not.toHaveBeenCalled();
    });

    it('handles missing onExit gracefully', async () => {
      const propsWithoutExit = { ...defaultProps, onExit: undefined };
      await act(async () => {
        render(<KioskMode {...propsWithoutExit} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      // Should not throw when clicked
      await act(async () => {
        expect(() => fireEvent.click(exitButton)).not.toThrow();
      });
    });
  });

  describe('Mobile kiosk mode', () => {
    beforeEach(() => {
      setWindowWidth(375); // Mobile width
    });

    it('renders exit button with correct title', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      expect(exitButton).toBeDefined();
      expect(exitButton.textContent).toBe('✕');
    });

    it('calls onExit when exit button is clicked', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      await act(async () => {
        fireEvent.click(exitButton);
      });
      expect(defaultProps.onExit).toHaveBeenCalledTimes(1);
    });

    it('does not call onModeChange when exit button is clicked', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });
      const exitButton = screen.getByTitle('Exit to workspace');
      await act(async () => {
        fireEvent.click(exitButton);
      });
      expect(defaultProps.onModeChange).not.toHaveBeenCalled();
    });
  });
});
