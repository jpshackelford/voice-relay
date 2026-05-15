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

// AI state is now passed as props, no need to mock useAI

vi.mock('./QRCode', () => ({
  QRCodeDisplay: ({ size }: { size?: number }) => (
    <div data-testid="qr-code" data-size={size}>QR Code</div>
  ),
}));

describe('KioskMode', () => {
  // Mock AI state passed from parent (via useAI hook in SessionView)
  const mockAiState = {
    connected: false,
    connecting: false,
    thinking: false,
    conversationId: null,
    error: null,
    checkAvailability: vi.fn().mockResolvedValue({ available: false, message: 'Not configured' }),
  };

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
    ai: mockAiState,
  };

  // Helper to create a mobile device
  const createMobileDevice = (id: string = 'mobile-1'): DeviceInfo => ({
    id,
    mode: 'mobile',
    displayName: `Mobile ${id}`,
  });

  // Helper to create a kiosk device
  const createKioskDevice = (id: string = 'kiosk-1'): DeviceInfo => ({
    id,
    mode: 'kiosk',
    displayName: `Kiosk ${id}`,
  });

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

  describe('QR code display state transitions', () => {
    beforeEach(() => {
      setWindowWidth(1024); // Desktop width for display tests
    });

    describe('when no mobile devices are connected', () => {
      it('displays large centered QR code with "Join this session" title', async () => {
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={[]} />);
        });
        
        // Should show large QR title
        expect(screen.getByText('Join this session')).toBeDefined();
        
        // Should show QR code with large size (280px)
        const qrCode = screen.getByTestId('qr-code');
        expect(qrCode).toBeDefined();
        expect(qrCode.getAttribute('data-size')).toBe('280');
      });

      it('shows large QR code when only kiosk devices are connected', async () => {
        const devices = [createKioskDevice('kiosk-1')];
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} />);
        });
        
        expect(screen.getByText('Join this session')).toBeDefined();
      });
    });

    describe('when mobile devices are connected', () => {
      it('displays greeting with device count when one mobile device joins', async () => {
        const devices = [createMobileDevice('mobile-1')];
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} />);
        });
        
        // Should show greeting title
        expect(screen.getByText('Session Ready')).toBeDefined();
        
        // Should show device count (singular)
        expect(screen.getByText(/📱 1 device connected/)).toBeDefined();
      });

      it('displays plural device count when multiple mobile devices join', async () => {
        const devices = [
          createMobileDevice('mobile-1'),
          createMobileDevice('mobile-2'),
          createMobileDevice('mobile-3'),
        ];
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} />);
        });
        
        expect(screen.getByText('Session Ready')).toBeDefined();
        expect(screen.getByText(/📱 3 devices connected/)).toBeDefined();
      });

      it('shows mini QR code overlay when mobile devices are connected', async () => {
        const devices = [createMobileDevice('mobile-1')];
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} />);
        });
        
        // Should show mini QR code (90px size)
        const qrCode = screen.getByTestId('qr-code');
        expect(qrCode.getAttribute('data-size')).toBe('90');
        
        // Should show "+ Add device" hint
        expect(screen.getByText('+ Add device')).toBeDefined();
      });

      it('mini QR overlay is clickable to expand', async () => {
        const devices = [createMobileDevice('mobile-1')];
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} />);
        });
        
        // Find the mini QR overlay by its title
        const miniQrOverlay = screen.getByTitle('Click to enlarge QR code');
        expect(miniQrOverlay).toBeDefined();
        
        // Click should open the modal
        await act(async () => {
          fireEvent.click(miniQrOverlay);
        });
        
        // Modal should be open now - look for modal title
        expect(screen.getByText('Scan to connect')).toBeDefined();
      });

      it('ignores kiosk devices when counting mobile devices', async () => {
        const devices = [
          createKioskDevice('kiosk-1'),
          createMobileDevice('mobile-1'),
          createKioskDevice('kiosk-2'),
        ];
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} />);
        });
        
        // Should show greeting (because mobile devices exist)
        expect(screen.getByText('Session Ready')).toBeDefined();
        
        // Should only count mobile devices
        expect(screen.getByText(/📱 1 device connected/)).toBeDefined();
      });
    });

    describe('state transitions', () => {
      it('transitions from large QR to greeting when first mobile device joins', async () => {
        const { rerender } = render(<KioskMode {...defaultProps} devices={[]} />);
        
        // Wait for initial render
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        // Initially should show large QR
        expect(screen.getByText('Join this session')).toBeDefined();
        
        // Add a mobile device
        const devicesWithMobile = [createMobileDevice('mobile-1')];
        await act(async () => {
          rerender(<KioskMode {...defaultProps} devices={devicesWithMobile} />);
        });
        
        // Should now show greeting
        expect(screen.getByText('Session Ready')).toBeDefined();
        expect(screen.queryByText('Join this session')).toBeNull();
      });

      it('transitions back to large QR when all mobile devices disconnect', async () => {
        const devicesWithMobile = [createMobileDevice('mobile-1')];
        const { rerender } = render(<KioskMode {...defaultProps} devices={devicesWithMobile} />);
        
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        // Initially should show greeting
        expect(screen.getByText('Session Ready')).toBeDefined();
        
        // Remove all mobile devices
        await act(async () => {
          rerender(<KioskMode {...defaultProps} devices={[]} />);
        });
        
        // Should go back to large QR
        expect(screen.getByText('Join this session')).toBeDefined();
        expect(screen.queryByText('Session Ready')).toBeNull();
      });
    });

    describe('displayContent priority', () => {
      it('shows displayContent over large QR when no mobile devices', async () => {
        const displayContent: DisplayContent = {
          type: 'markdown',
          content: '# Hello World',
          title: 'Custom Display',
        };
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={[]} displayContent={displayContent} />);
        });
        
        // Should show custom content, not QR
        expect(screen.getByText('Custom Display')).toBeDefined();
        expect(screen.queryByText('Join this session')).toBeNull();
      });

      it('shows displayContent over greeting when mobile devices connected', async () => {
        const devices = [createMobileDevice('mobile-1')];
        const displayContent: DisplayContent = {
          type: 'markdown',
          content: '# Important Message',
          title: 'AI Response',
        };
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={devices} displayContent={displayContent} />);
        });
        
        // Should show custom content, not greeting
        expect(screen.getByText('AI Response')).toBeDefined();
        expect(screen.queryByText('Session Ready')).toBeNull();
      });
    });
  });
});
