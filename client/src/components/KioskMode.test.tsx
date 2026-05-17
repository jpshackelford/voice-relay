import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { KioskMode, parseMarkdown } from './KioskMode';
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

  describe('Sidebar status row layout', () => {
    beforeEach(() => {
      setWindowWidth(1024); // Desktop width
    });

    it('renders device counts and TTS toggle in same container', async () => {
      const devices = [createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      // Find the status row container
      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow).toBeDefined();

      // Verify both participants and TTS toggle are inside the status row
      const participants = statusRow?.querySelector('.kiosk-participants');
      const ttsToggle = statusRow?.querySelector('.kiosk-tts-toggle');
      expect(participants).toBeDefined();
      expect(ttsToggle).toBeDefined();
    });

    it('displays kiosk device count correctly', async () => {
      const devices = [createKioskDevice('kiosk-1'), createKioskDevice('kiosk-2')];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow?.textContent).toContain('🖥️ 2');
    });

    it('displays mobile device count correctly', async () => {
      const devices = [createMobileDevice('mobile-1'), createMobileDevice('mobile-2'), createMobileDevice('mobile-3')];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow?.textContent).toContain('📱 3');
    });

    it('displays both kiosk and mobile counts when both types connected', async () => {
      const devices = [
        createKioskDevice('kiosk-1'),
        createMobileDevice('mobile-1'),
        createMobileDevice('mobile-2'),
      ];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow?.textContent).toContain('🖥️ 1');
      expect(statusRow?.textContent).toContain('📱 2');
    });

    it('hides kiosk count when no kiosk devices', async () => {
      const devices = [createMobileDevice('mobile-1')];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow?.textContent).not.toContain('🖥️');
    });

    it('hides mobile count when no mobile devices', async () => {
      const devices = [createKioskDevice('kiosk-1')];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow?.textContent).not.toContain('📱');
    });

    it('renders TTS checkbox inside status row', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      const checkbox = statusRow?.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeDefined();
    });

    it('renders TTS speaker emoji inside status row', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      expect(statusRow?.textContent).toContain('🔊');
    });

    it('TTS checkbox toggles correctly', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      const checkbox = statusRow?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox).toBeDefined();

      // Initial state should be unchecked (TTS disabled by default - server-side TTS handles AI responses)
      expect(checkbox.checked).toBe(false);

      // Toggle the checkbox on
      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(checkbox.checked).toBe(true);

      // Toggle the checkbox off again
      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(checkbox.checked).toBe(false);
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

  describe('parseMarkdown', () => {
    describe('image rendering', () => {
      it('renders standalone images correctly', () => {
        const input = '![apple](https://example.com/apple.png)';
        const output = parseMarkdown(input);
        expect(output).toContain('<img');
        expect(output).toContain('src="https://example.com/apple.png"');
        expect(output).toContain('alt="apple"');
        // Should NOT have leftover exclamation mark
        expect(output).not.toMatch(/!\s*<a/);
      });

      it('renders images with empty alt text', () => {
        const input = '![](https://example.com/image.png)';
        const output = parseMarkdown(input);
        expect(output).toContain('<img');
        expect(output).toContain('src="https://example.com/image.png"');
      });

      it('renders multiple images', () => {
        const input = '![a](a.png) ![b](b.png)';
        const output = parseMarkdown(input);
        const imgMatches = output.match(/<img/g);
        expect(imgMatches?.length).toBe(2);
      });
    });

    describe('table rendering', () => {
      it('renders simple tables', () => {
        const input = `| A | B |
|---|---|
| 1 | 2 |`;
        const output = parseMarkdown(input);
        expect(output).toContain('<table>');
        expect(output).toContain('<th>');
        expect(output).toContain('<td>');
      });

      it('renders tables with images inside cells', () => {
        const input = `| Icon | Name |
|------|------|
| ![x](x.png) | Apple |`;
        const output = parseMarkdown(input);
        expect(output).toContain('<table>');
        expect(output).toContain('<img');
        expect(output).toContain('src="x.png"');
      });

      it('renders tables with multiple rows', () => {
        const input = `| Col1 | Col2 |
|------|------|
| a | b |
| c | d |
| e | f |`;
        const output = parseMarkdown(input);
        expect(output).toContain('<table>');
        // 3 data rows = 3 <tr> in tbody
        const trMatches = output.match(/<tr>/g);
        expect(trMatches?.length).toBeGreaterThanOrEqual(4); // 1 header + 3 data rows
      });
    });

    describe('existing features preserved', () => {
      it('renders headers correctly', () => {
        expect(parseMarkdown('# Heading 1')).toContain('<h1>');
        expect(parseMarkdown('## Heading 2')).toContain('<h2>');
        expect(parseMarkdown('### Heading 3')).toContain('<h3>');
      });

      it('renders bold text', () => {
        const output = parseMarkdown('**bold text**');
        expect(output).toContain('<strong>bold text</strong>');
      });

      it('renders italic text', () => {
        const output = parseMarkdown('*italic text*');
        expect(output).toContain('<em>italic text</em>');
      });

      it('renders code blocks', () => {
        const output = parseMarkdown('```js\nconsole.log("hi")\n```');
        expect(output).toContain('<pre>');
        expect(output).toContain('<code');
      });

      it('renders inline code', () => {
        const output = parseMarkdown('Use `npm install`');
        expect(output).toContain('<code>npm install</code>');
      });

      it('renders links correctly', () => {
        const output = parseMarkdown('[Click here](https://example.com)');
        expect(output).toContain('<a href="https://example.com"');
        expect(output).toContain('>Click here</a>');
      });

      it('renders line breaks', () => {
        const output = parseMarkdown('Line 1\nLine 2');
        expect(output).toContain('<br');
      });
    });

    describe('XSS protection', () => {
      it('strips script tags', () => {
        const input = '<script>alert("xss")</script>';
        const output = parseMarkdown(input);
        expect(output).not.toContain('<script>');
        expect(output).not.toContain('alert');
      });

      it('strips onerror attributes from images', () => {
        const input = '<img src=x onerror=alert(1)>';
        const output = parseMarkdown(input);
        expect(output).not.toContain('onerror');
      });

      it('strips javascript: URLs from links', () => {
        const input = '[click](javascript:alert(1))';
        const output = parseMarkdown(input);
        expect(output).not.toContain('javascript:');
      });

      it('strips onclick attributes', () => {
        const input = '<div onclick="alert(1)">test</div>';
        const output = parseMarkdown(input);
        expect(output).not.toContain('onclick');
      });

      it('preserves safe HTML content', () => {
        const input = '<strong>Bold HTML</strong>';
        const output = parseMarkdown(input);
        expect(output).toContain('<strong>Bold HTML</strong>');
      });
    });

    describe('complex markdown scenarios', () => {
      it('renders mixed content: headers, tables, and images', () => {
        const input = `# Recipe

| Ingredient | Amount |
|------------|--------|
| ![apple](apple.png) Apple | 2 cups |

## Instructions
**Step 1**: Prepare ingredients`;
        const output = parseMarkdown(input);
        expect(output).toContain('<h1>');
        expect(output).toContain('<table>');
        expect(output).toContain('<img');
        expect(output).toContain('<h2>');
        expect(output).toContain('<strong>');
      });

      it('handles HTML tables (passthrough)', () => {
        const input = `<table>
<tr><td><img src="icon.png" alt="Icon"></td></tr>
</table>`;
        const output = parseMarkdown(input);
        expect(output).toContain('<table>');
        expect(output).toContain('<img');
      });
    });
  });

  describe('image display feedback', () => {
    beforeEach(() => {
      setWindowWidth(1024); // Desktop width
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls onDisplayResult with success when image loads', async () => {
      const onDisplayResult = vi.fn();
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/test.png',
        title: 'Test Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      // Find the img element and trigger onLoad
      const img = document.querySelector('img[src="https://example.com/test.png"]');
      expect(img).toBeDefined();
      
      await act(async () => {
        fireEvent.load(img!);
      });

      expect(onDisplayResult).toHaveBeenCalledWith({
        success: true,
        displayType: 'image',
      });
    });

    it('calls onDisplayResult with error when image fails to load', async () => {
      const onDisplayResult = vi.fn();
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/broken.png',
        title: 'Broken Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      // Find the img element and trigger onError
      const img = document.querySelector('img[src="https://example.com/broken.png"]');
      expect(img).toBeDefined();
      
      await act(async () => {
        fireEvent.error(img!);
      });

      expect(onDisplayResult).toHaveBeenCalledWith({
        success: false,
        error: 'load-failed',
        displayType: 'image',
      });
    });

    it('calls onDisplayResult with timeout error after 10 seconds', async () => {
      const onDisplayResult = vi.fn();
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/slow.png',
        title: 'Slow Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      // Fast-forward 10 seconds
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(onDisplayResult).toHaveBeenCalledWith({
        success: false,
        error: 'timeout',
        displayType: 'image',
      });
    });

    it('does not report timeout if image loads before timeout', async () => {
      const onDisplayResult = vi.fn();
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/fast.png',
        title: 'Fast Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      // Image loads after 5 seconds (before timeout)
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      const img = document.querySelector('img[src="https://example.com/fast.png"]');
      await act(async () => {
        fireEvent.load(img!);
      });

      // Now advance past the timeout
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      // Should only have called once with success
      expect(onDisplayResult).toHaveBeenCalledTimes(1);
      expect(onDisplayResult).toHaveBeenCalledWith({
        success: true,
        displayType: 'image',
      });
    });

    it('displays error indicator when image fails to load', async () => {
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/broken.png',
        title: 'Broken Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
          />
        );
      });

      const img = document.querySelector('img[src="https://example.com/broken.png"]');
      await act(async () => {
        fireEvent.error(img!);
      });

      expect(screen.getByText('⚠️ Image failed to load')).toBeDefined();
    });

    it('displays timeout indicator when image times out', async () => {
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/slow.png',
        title: 'Slow Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
          />
        );
      });

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(screen.getByText('⏱️ Image loading slowly...')).toBeDefined();
    });

    it('does not send duplicate results for same image URL', async () => {
      const onDisplayResult = vi.fn();
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/test.png',
        title: 'Test Image',
      };

      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      const img = document.querySelector('img[src="https://example.com/test.png"]');
      
      // Trigger load multiple times
      await act(async () => {
        fireEvent.load(img!);
        fireEvent.load(img!);
        fireEvent.load(img!);
      });

      // Should only be called once
      expect(onDisplayResult).toHaveBeenCalledTimes(1);
    });

    it('handles gracefully when onDisplayResult is not provided', async () => {
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/test.png',
        title: 'Test Image',
      };

      // Should not throw
      await act(async () => {
        render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            // onDisplayResult not provided
          />
        );
      });

      const img = document.querySelector('img[src="https://example.com/test.png"]');
      
      await act(async () => {
        expect(() => fireEvent.load(img!)).not.toThrow();
        expect(() => fireEvent.error(img!)).not.toThrow();
      });
    });

    it('reports results when same URL is displayed multiple times (intentional retry)', async () => {
      const onDisplayResult = vi.fn();
      const displayContent: DisplayContent = {
        type: 'image',
        content: 'https://example.com/test.png',
        title: 'Test Image',
      };

      // First display
      const { rerender } = await act(async () => {
        return render(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      let img = document.querySelector('img[src="https://example.com/test.png"]');
      await act(async () => {
        fireEvent.load(img!);
      });

      expect(onDisplayResult).toHaveBeenCalledTimes(1);
      expect(onDisplayResult).toHaveBeenLastCalledWith({
        success: true,
        displayType: 'image',
      });

      // Display something else in between (simulate user navigation)
      await act(async () => {
        rerender(
          <KioskMode 
            {...defaultProps} 
            displayContent={{ type: 'markdown', content: '# Test' }}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      // Display same URL again (intentional retry)
      await act(async () => {
        rerender(
          <KioskMode 
            {...defaultProps} 
            displayContent={displayContent}
            onDisplayResult={onDisplayResult}
          />
        );
      });

      img = document.querySelector('img[src="https://example.com/test.png"]');
      await act(async () => {
        fireEvent.load(img!);
      });

      // Should be called again for the second display
      expect(onDisplayResult).toHaveBeenCalledTimes(2);
      expect(onDisplayResult).toHaveBeenLastCalledWith({
        success: true,
        displayType: 'image',
      });
    });
  });
});
