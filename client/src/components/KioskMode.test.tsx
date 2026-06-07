import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KioskMode, parseMarkdown } from './KioskMode';
import type { AgentAction, DeviceInfo, Utterance, DisplayContent, SessionTtsSettings } from '../types';

// Mock hooks that KioskMode uses
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

// useSpeechSynthesis is no longer used by KioskMode (deprecated in favor of server-side TTS)

// AI state is now passed as props, no need to mock useAI

vi.mock('./QRCode', () => ({
  QRCodeDisplay: ({ size }: { size?: number }) => (
    <div data-testid="qr-code" data-size={size}>QR Code</div>
  ),
}));

// Mock the Oscilloscope so we can assert which color the kiosk passes
// to it (issue #380: must be the user-message blue, not the AI purple).
// The real component renders into a canvas, which is awkward to inspect
// in happy-dom; the data-color attribute round-trips the prop cleanly.
vi.mock('./Oscilloscope', () => ({
  Oscilloscope: ({ color }: { color?: string }) => (
    <div data-testid="oscilloscope-mock" data-color={color} />
  ),
}));

describe('KioskMode', () => {
  // Mock AI state passed from parent (via useAI hook in SessionView)
  const mockAiState = {
    connected: false,
    connecting: false,
    thinking: false,
    degraded: false,
    restarting: false,
    restartError: null,
    conversationId: null,
    error: null,
    restart: vi.fn().mockResolvedValue({ ok: true, status: {
      sessionId: 'test',
      state: 'starting',
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: null,
    } }),
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
    sessionTtsSettings: { enabled: false, outputDeviceId: null } as SessionTtsSettings,
    onSessionTtsSettingsChange: vi.fn(),
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

    it('TTS checkbox toggles correctly and calls onSessionTtsSettingsChange', async () => {
      const onSessionTtsSettingsChange = vi.fn();

      await act(async () => {
        render(<KioskMode {...defaultProps} onSessionTtsSettingsChange={onSessionTtsSettingsChange} />);
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      const checkbox = statusRow?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox).toBeDefined();

      // Initial state should be unchecked (TTS disabled by default via sessionTtsSettings prop)
      expect(checkbox.checked).toBe(false);

      // Toggle the checkbox on - should call onSessionTtsSettingsChange
      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(onSessionTtsSettingsChange).toHaveBeenCalledWith({
        enabled: true,
        outputDeviceId: null,
      });

      // Note: The actual checkbox state update requires the parent to re-render with new sessionTtsSettings
      // Here we verify the callback was invoked with correct values
    });

    it('reflects sessionTtsSettings.enabled state correctly', async () => {
      // Test with enabled=true
      await act(async () => {
        render(
          <KioskMode
            {...defaultProps}
            sessionTtsSettings={{ enabled: true, outputDeviceId: null }}
          />
        );
      });

      const statusRow = document.querySelector('.kiosk-status-row');
      const checkbox = statusRow?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
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
      // Issue #246: QR code should NOT be dismissed by displayContent when no mobile devices
      it('queues displayContent when no mobile devices (QR has priority)', async () => {
        const displayContent: DisplayContent = {
          type: 'markdown',
          content: '# Hello World',
          title: 'Custom Display',
        };
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={[]} displayContent={displayContent} />);
        });
        
        // Should still show QR, not displayContent (fix for issue #246)
        expect(screen.getByText('Join this session')).toBeDefined();
        expect(screen.queryByText('Custom Display')).toBeNull();
      });

      it('shows queued displayContent after QR is dismissed', async () => {
        const displayContent: DisplayContent = {
          type: 'markdown',
          content: '# Hello World',
          title: 'Custom Display',
        };
        await act(async () => {
          render(<KioskMode {...defaultProps} devices={[]} displayContent={displayContent} />);
        });
        
        // Initially should show QR (displayContent is queued)
        expect(screen.getByText('Join this session')).toBeDefined();
        expect(screen.queryByText('Custom Display')).toBeNull();
        
        // Click Skip to dismiss QR
        const skipButton = screen.getByRole('button', { name: /skip qr code screen/i });
        await act(async () => {
          fireEvent.click(skipButton);
        });
        
        // Now should show the previously queued displayContent
        expect(screen.getByText('Custom Display')).toBeDefined();
        expect(screen.queryByText('Join this session')).toBeNull();
      });

      it('shows queued displayContent when mobile device joins', async () => {
        const displayContent: DisplayContent = {
          type: 'markdown',
          content: '# Hello World',
          title: 'Custom Display',
        };
        const { rerender } = await act(async () => {
          return render(<KioskMode {...defaultProps} devices={[]} displayContent={displayContent} />);
        });
        
        // Initially should show QR (displayContent is queued)
        expect(screen.getByText('Join this session')).toBeDefined();
        expect(screen.queryByText('Custom Display')).toBeNull();
        
        // Mobile device joins
        const devices = [createMobileDevice('mobile-1')];
        await act(async () => {
          rerender(<KioskMode {...defaultProps} devices={devices} displayContent={displayContent} />);
        });
        
        // Now should show the displayContent
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
    // Image tests need a mobile device present so QR doesn't have priority
    // (QR has priority when no mobile devices AND qrDismissed is false)
    const mobileDeviceForTests = [createMobileDevice('mobile-1')];
    
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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
            devices={mobileDeviceForTests}
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

  describe('QR Skip Button', () => {
    beforeEach(() => {
      setWindowWidth(1024); // Desktop width
    });

    it('renders Skip button when no mobile devices connected', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={[]} />);
      });

      // Should show large QR screen with Skip button
      const skipButton = screen.getByRole('button', { name: /skip qr code screen/i });
      expect(skipButton).toBeDefined();
      expect(skipButton.textContent).toBe('Skip →');
    });

    it('hides QR and shows greeting when Skip is clicked', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={[]} />);
      });

      // Initially should show large QR screen
      expect(document.querySelector('.display-idle-qr')).toBeDefined();
      expect(document.querySelector('.display-greeting')).toBeNull();

      // Click skip button
      const skipButton = screen.getByRole('button', { name: /skip qr code screen/i });
      await act(async () => {
        fireEvent.click(skipButton);
      });

      // Should now show greeting state
      expect(document.querySelector('.display-idle-qr')).toBeNull();
      expect(document.querySelector('.display-greeting')).toBeDefined();
      expect(screen.getByText('Session Ready')).toBeDefined();
      expect(screen.getByText('No devices connected')).toBeDefined();
    });

    it('shows mini QR overlay after Skip is clicked', async () => {
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={[]} />);
      });

      // Initially mini QR should not be visible
      expect(document.querySelector('.mini-qr-overlay')).toBeNull();

      // Click skip button
      const skipButton = screen.getByRole('button', { name: /skip qr code screen/i });
      await act(async () => {
        fireEvent.click(skipButton);
      });

      // Mini QR should now be visible
      expect(document.querySelector('.mini-qr-overlay')).toBeDefined();
    });

    it('does not show Skip button when mobile devices are connected', async () => {
      const devices = [createMobileDevice('mobile-1')];
      await act(async () => {
        render(<KioskMode {...defaultProps} devices={devices} />);
      });

      // Should not have Skip button (should be in greeting state already)
      const skipButton = screen.queryByRole('button', { name: /skip qr code screen/i });
      expect(skipButton).toBeNull();
    });

    it('shows correct device count after mobile joins post-dismiss', async () => {
      const { rerender } = await act(async () => {
        return render(<KioskMode {...defaultProps} devices={[]} />);
      });

      // Click skip button
      const skipButton = screen.getByRole('button', { name: /skip qr code screen/i });
      await act(async () => {
        fireEvent.click(skipButton);
      });

      // Should show "No devices connected"
      expect(screen.getByText('No devices connected')).toBeDefined();

      // Now a mobile device joins
      const devices = [createMobileDevice('mobile-1')];
      await act(async () => {
        rerender(<KioskMode {...defaultProps} devices={devices} />);
      });

      // Should now show device count
      expect(screen.getByText(/📱 1 device connected/)).toBeDefined();
    });
  });

  // Regression tests for issue #264 — kiosk timeline must interleave
  // utterances and agent events chronologically, even when OH emits naive
  // UTC timestamps and the browser TZ is not UTC.
  describe('timeline interleaving (issue #264)', () => {
    const makeUtterance = (id: string, text: string, receivedAt: Date): Utterance => ({
      id,
      senderId: 'mobile-1',
      senderName: 'User',
      text,
      partial: false,
      receivedAt,
    });

    const makeAction = (id: string, timestamp: string, kind: string = 'CmdRun'): AgentAction => ({
      id,
      timestamp,
      kind,
      source: 'agent',
      summary: `${kind} ${id}`,
    });

    /**
     * Read the DOM order of timeline entries by walking `.kiosk-message` and
     * `.agent-event-card` children of `.kiosk-messages`. Returns an array of
     * tagged ids so the test can assert chronological ordering.
     */
    const readTimelineOrder = (): string[] => {
      const container = document.querySelector('.kiosk-messages');
      if (!container) return [];
      const result: string[] = [];
      for (const child of Array.from(container.children) as HTMLElement[]) {
        if (child.classList.contains('kiosk-message')) {
          const text = child.querySelector('.text')?.textContent || '';
          result.push(`utt:${text}`);
        } else if (child.classList.contains('agent-event-card')) {
          const summary = child.querySelector('.agent-event-summary')?.textContent || '';
          result.push(`evt:${summary}`);
        }
      }
      return result;
    };

    it('places agent events emitted with naive UTC timestamps in the correct slot', () => {
      // Three points in time, in chronological order:
      //   T0 — user says "first"
      //   T1 — agent runs a command  (naive UTC, no `Z` — the bug case)
      //   T2 — user says "second"
      const t0 = new Date('2026-05-21T23:00:00Z');
      const t1Naive = '2026-05-21T23:30:00';
      const t2 = new Date('2026-05-21T23:45:00Z');

      const utterances = new Map<string, Utterance>();
      utterances.set('u1', makeUtterance('u1', 'first', t0));
      utterances.set('u2', makeUtterance('u2', 'second', t2));

      const agentActions: AgentAction[] = [makeAction('a1', t1Naive)];

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            // Render in desktop layout so the timeline is shown.
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            utterances={utterances}
            agentActions={agentActions}
            showAgentActions={true}
          />
        );
      });

      const order = readTimelineOrder();

      // Expect: first → agent event → second. Before the fix, the naive
      // timestamp was parsed as local time and the agent event sorted after
      // every utterance in non-UTC browsers.
      expect(order).toEqual(['utt:first', 'evt:CmdRun a1', 'utt:second']);
    });

    it('handles a mix of naive and Z-suffixed agent timestamps', () => {
      const t0 = new Date('2026-05-21T22:00:00Z');
      const t1Zulu = '2026-05-21T22:15:00.123Z';
      const t2Naive = '2026-05-21T22:30:00.456';
      const t3 = new Date('2026-05-21T22:45:00Z');

      const utterances = new Map<string, Utterance>();
      utterances.set('u1', makeUtterance('u1', 'hello', t0));
      utterances.set('u2', makeUtterance('u2', 'goodbye', t3));

      const agentActions: AgentAction[] = [
        // Intentionally out-of-order in the input to verify sorting:
        makeAction('a-naive', t2Naive, 'FileRead'),
        makeAction('a-zulu', t1Zulu, 'CmdRun'),
      ];

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            utterances={utterances}
            agentActions={agentActions}
            showAgentActions={true}
          />
        );
      });

      expect(readTimelineOrder()).toEqual([
        'utt:hello',
        'evt:CmdRun a-zulu',
        'evt:FileRead a-naive',
        'utt:goodbye',
      ]);
    });

    it('uses serverTimestamp from utterance.receivedAt when set by SessionView', () => {
      // Simulates the post-fix state: SessionView.handleTextMessage has
      // already parsed `message.serverTimestamp` and set utterance.receivedAt
      // to the corresponding Date. With both AI and agent events on OH's
      // clock, an out-of-band reordering of utterances is interleaved
      // correctly with the agent event.
      const utterances = new Map<string, Utterance>();
      utterances.set('u-user', {
        id: 'u-user',
        senderId: 'mobile-1',
        senderName: 'User',
        text: 'question',
        partial: false,
        receivedAt: new Date('2026-05-21T23:00:00Z'),
      });
      utterances.set('u-ai', {
        id: 'u-ai',
        senderId: 'ai',
        senderName: '✨ AI',
        text: 'answer',
        partial: false,
        // OH event timestamp from the moment the AI emitted the response.
        receivedAt: new Date('2026-05-21T23:00:05.234Z'),
      });

      const agentActions: AgentAction[] = [
        // OH-side timestamp BETWEEN the user question and the AI answer.
        makeAction('a-thinking', '2026-05-21T23:00:03', 'CmdRun'),
      ];

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            utterances={utterances}
            agentActions={agentActions}
            showAgentActions={true}
          />
        );
      });

      expect(readTimelineOrder()).toEqual([
        'utt:question',
        'evt:CmdRun a-thinking',
        'utt:answer',
      ]);
    });
  });

  // Regression tests for issue #265 — agent action/observation pairing in
  // the kiosk timeline. The KioskMode component must call pairAgentEvents so
  // a single tool invocation renders as one card (instead of one action card
  // plus a separate bare-"Observation" card).
  describe('agent event pairing (issue #265)', () => {
    const makeAction = (id: string, summary: string, timestamp: string): AgentAction => ({
      id,
      timestamp,
      kind: 'TerminalAction',
      source: 'agent',
      summary,
      command: `echo ${id}`,
    });

    const makeObservation = (id: string, actionId: string, timestamp: string): AgentAction => ({
      id,
      timestamp,
      kind: 'TerminalObservation',
      source: 'environment',
      summary: '',
      action_id: actionId,
      exit_code: 0,
      content: `output for ${actionId}`,
    });

    /** Read summary text from every rendered agent-event card. */
    const readCardSummaries = (): string[] => {
      const cards = document.querySelectorAll('.agent-event-card .agent-event-summary');
      return Array.from(cards).map(el => el.textContent || '');
    };

    it('renders one card per ActionEvent + ObservationEvent pair (not two)', () => {
      // Two tool invocations, four raw events. Expectation: two cards.
      const action1 = makeAction('a1', 'First operation', '2026-05-21T11:46:32Z');
      const obs1 = makeObservation('o1', 'a1', '2026-05-21T11:46:33Z');
      const action2 = makeAction('a2', 'Second operation', '2026-05-21T11:46:34Z');
      const obs2 = makeObservation('o2', 'a2', '2026-05-21T11:46:35Z');

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            agentActions={[action1, obs1, action2, obs2]}
            showAgentActions={true}
          />
        );
      });

      const summaries = readCardSummaries();
      expect(summaries).toEqual(['First operation', 'Second operation']);
    });

    it('a pending action (no observation yet) still renders one card', () => {
      const action = makeAction('a1', 'In-flight operation', '2026-05-21T11:46:32Z');

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            agentActions={[action]}
            showAgentActions={true}
          />
        );
      });

      const summaries = readCardSummaries();
      expect(summaries).toEqual(['In-flight operation']);
      // And it shows the Pending indicator.
      expect(screen.getByTitle('Pending')).toBeDefined();
    });

    it('the paired card uses the action title, not the bare "Observation"', () => {
      const action = makeAction('a1', 'Send greeting to kiosk', '2026-05-21T11:46:32Z');
      const observation = makeObservation('o1', 'a1', '2026-05-21T11:46:33Z');

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            agentActions={[action, observation]}
            showAgentActions={true}
          />
        );
      });

      // Before #265 a separate observation card titled "Observation" would
      // appear; after the fix there is only the action's card.
      expect(screen.getByText('Send greeting to kiosk')).toBeDefined();
      expect(screen.queryByText('Observation')).toBeNull();
    });

    it('orphan observation (no matching action) falls through as its own card', () => {
      const orphan = makeObservation('o-orphan', 'never-seen-action', '2026-05-21T11:46:33Z');
      // Override the empty summary so the orphan card title is non-empty for
      // assertion purposes — the formatActionKind fallback would render
      // "Terminal" otherwise.
      orphan.summary = 'Orphan observation';

      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            agentActions={[orphan]}
            showAgentActions={true}
          />
        );
      });

      const summaries = readCardSummaries();
      expect(summaries).toEqual(['Orphan observation']);
      // Orphan observation reports success.
      expect(screen.getByTitle('Success')).toBeDefined();
    });
  });

  // ====================================================================
  // Issue #340: footer ticker strips
  // ====================================================================
  describe('Footer tickers (issue #340)', () => {
    beforeEach(() => {
      setWindowWidth(1024);
    });

    function makeUtterance(
      partial: Partial<Utterance> & Pick<Utterance, 'id' | 'senderId' | 'text'>
    ): Utterance {
      return {
        senderName: partial.senderId,
        partial: false,
        receivedAt: new Date(),
        ...partial,
      } as Utterance;
    }

    function makeAction(partial: Partial<AgentAction> & Pick<AgentAction, 'id' | 'kind'>): AgentAction {
      return {
        timestamp: new Date().toISOString(),
        source: 'agent',
        summary: '',
        ...partial,
      } as AgentAction;
    }

    it('renders no ticker strips when kioskFooterTickersEnabled is false', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled={false}
          />
        );
      });
      expect(screen.queryByTestId('kiosk-ticker-transcription')).toBeNull();
      expect(screen.queryByTestId('kiosk-ticker-action')).toBeNull();
    });

    it('renders both ticker strips when enabled', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-transcription')).toBeDefined();
      expect(screen.getByTestId('kiosk-ticker-action')).toBeDefined();
    });

    it('shows the most recent foreign utterance text in the transcription ticker', () => {
      const utterances = new Map<string, Utterance>([
        ['u1', makeUtterance({ id: 'u1', senderId: 'mobile-1', text: 'hello world' })],
      ]);
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            utterances={utterances}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-transcription').textContent).toContain('hello world');
    });

    it('ignores own-device utterances in the transcription ticker', () => {
      const utterances = new Map<string, Utterance>([
        ['u1', makeUtterance({ id: 'u1', senderId: 'test-device-123', text: 'self speech' })],
      ]);
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            utterances={utterances}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-transcription').textContent).not.toContain('self speech');
    });

    // ====================================================================
    // Issue #382: speaker prefix on the transcription ticker
    // ====================================================================
    describe('speaker prefix (issue #382)', () => {
      it("prefixes the ticker with '<senderName>: ' for the first foreign utterance", () => {
        const utterances = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: "JP's iPhone SE",
              text: "I'll grab a coffee",
            }),
          ],
        ]);
        act(() => {
          render(
            <KioskMode
              {...defaultProps}
              devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
              kioskFooterTickersEnabled
              utterances={utterances}
            />
          );
        });
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        expect(strip.textContent).toBe("JP's iPhone SE: I'll grab a coffee");
        // The speaker chunk is styled via its own class.
        const speakerSpan = strip.querySelector('.kiosk-ticker-speaker');
        expect(speakerSpan?.textContent).toBe("JP's iPhone SE: ");
      });

      it('omits the prefix on a same-sender follow-up utterance', () => {
        const t0 = new Date(Date.now() - 1_000);
        const t1 = new Date();
        const utterances = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: "JP's iPhone SE",
              text: 'partial',
              receivedAt: t0,
            }),
          ],
        ]);
        const { rerender } = render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            utterances={utterances}
          />
        );
        // First render shows the prefix.
        expect(
          screen.getByTestId('kiosk-ticker-transcription').textContent
        ).toBe("JP's iPhone SE: partial");

        // Same sender, growing partial → prefix should be suppressed.
        const updated = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: "JP's iPhone SE",
              text: 'partial growing into a final',
              receivedAt: t1,
            }),
          ],
        ]);
        act(() => {
          rerender(
            <KioskMode
              {...defaultProps}
              devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
              kioskFooterTickersEnabled
              utterances={updated}
            />
          );
        });
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        expect(strip.textContent).toBe('partial growing into a final');
        expect(strip.querySelector('.kiosk-ticker-speaker')).toBeNull();
      });

      it("re-emits the prefix when the next utterance comes from a different senderId", () => {
        const t0 = new Date(Date.now() - 1_000);
        const t1 = new Date();
        const first = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: "JP's iPhone",
              text: 'yes',
              receivedAt: t0,
            }),
          ],
        ]);
        const { rerender } = render(
          <KioskMode
            {...defaultProps}
            devices={[
              createMobileDevice('mobile-1'),
              createMobileDevice('mobile-2'),
              createKioskDevice('kiosk-1'),
            ]}
            kioskFooterTickersEnabled
            utterances={first}
          />
        );
        expect(
          screen.getByTestId('kiosk-ticker-transcription').textContent
        ).toBe("JP's iPhone: yes");

        // A different sender says the same word back-to-back. The
        // ticker must re-display the speaker label so the viewer can
        // tell the two "yes" lines apart.
        const switched = new Map<string, Utterance>([
          ...first,
          [
            'u2',
            makeUtterance({
              id: 'u2',
              senderId: 'mobile-2',
              senderName: "Mac-7acf1d6",
              text: 'yes',
              receivedAt: t1,
            }),
          ],
        ]);
        act(() => {
          rerender(
            <KioskMode
              {...defaultProps}
              devices={[
                createMobileDevice('mobile-1'),
                createMobileDevice('mobile-2'),
                createKioskDevice('kiosk-1'),
              ]}
              kioskFooterTickersEnabled
              utterances={switched}
            />
          );
        });
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        expect(strip.textContent).toBe('Mac-7acf1d6: yes');
        expect(strip.querySelector('.kiosk-ticker-speaker')?.textContent).toBe(
          'Mac-7acf1d6: '
        );
      });

      // ================================================================
      // Issue #411: hosted-STT engine speaker label prefix
      //
      // When the inbound utterance carries `engineSpeakerLabel`, the
      // ticker prefers it over `senderName` so the kiosk shows e.g.
      // `S1: …` until the label is linked to a real `speakers.id`. The
      // Web-Speech path (no engine label) must continue to render
      // exactly as before — that's the regression guard at the bottom
      // of this block.
      // ================================================================
      it("prefixes the ticker with the engineSpeakerLabel when set (issue #411)", () => {
        const utterances = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: "JP's iPhone SE",
              text: "I'll grab a coffee",
              engineSpeakerLabel: 'S1',
            }),
          ],
        ]);
        act(() => {
          render(
            <KioskMode
              {...defaultProps}
              devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
              kioskFooterTickersEnabled
              utterances={utterances}
            />
          );
        });
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        // Engine label wins over the device's display name.
        expect(strip.textContent).toBe("S1: I'll grab a coffee");
        expect(
          strip.querySelector('.kiosk-ticker-speaker')?.textContent
        ).toBe('S1: ');
      });

      it('falls back to senderName when engineSpeakerLabel is undefined (Web-Speech regression guard, issue #411)', () => {
        // This is the explicit regression guard called out in #411's
        // expansion comment: utterances with no engine label must
        // render exactly as they did before #411 — i.e. prefixed by
        // `senderName: …`, NOT some empty fallback.
        const utterances = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: 'Kitchen iPad',
              text: 'where are the kids',
              // intentionally no engineSpeakerLabel
            }),
          ],
        ]);
        act(() => {
          render(
            <KioskMode
              {...defaultProps}
              devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
              kioskFooterTickersEnabled
              utterances={utterances}
            />
          );
        });
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        expect(strip.textContent).toBe('Kitchen iPad: where are the kids');
        expect(
          strip.querySelector('.kiosk-ticker-speaker')?.textContent
        ).toBe('Kitchen iPad: ');
      });

      it('engine-label prefix flips back to senderName once the server resolves the speaker (issue #411)', () => {
        // Before the server links the engine label to a real speaker,
        // the row carries `engineSpeakerLabel: 'S1'`. After resolution
        // the server substitutes the real speaker on `senderName` and
        // omits `engineSpeakerLabel`. The ticker must follow.
        const utterances = new Map<string, Utterance>([
          [
            'u1',
            makeUtterance({
              id: 'u1',
              senderId: 'mobile-1',
              senderName: "JP's iPhone SE",
              text: 'pre-resolution',
              engineSpeakerLabel: 'S1',
            }),
          ],
        ]);
        const { rerender } = render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            utterances={utterances}
          />
        );
        expect(
          screen.getByTestId('kiosk-ticker-transcription').textContent
        ).toBe('S1: pre-resolution');

        // Same senderId, but now a different utterance whose
        // engineSpeakerLabel was resolved server-side and the row
        // carries the real speaker name as `senderName`.
        const resolved = new Map<string, Utterance>([
          [
            'u2',
            makeUtterance({
              id: 'u2',
              senderId: 'mobile-1',
              senderName: 'Sam',
              text: 'post-resolution',
              receivedAt: new Date(Date.now() + 1_000),
            }),
          ],
        ]);
        act(() => {
          rerender(
            <KioskMode
              {...defaultProps}
              devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
              kioskFooterTickersEnabled
              utterances={resolved}
            />
          );
        });
        // Same senderId → prefix is normally suppressed; assert the
        // *text* updates and the speaker chunk is empty rather than
        // showing a stale `S1:`.
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        expect(strip.textContent).toBe('post-resolution');
        expect(strip.querySelector('.kiosk-ticker-speaker')).toBeNull();
      });

      it("renders an empty strip (no orphan ':') when there is no foreign utterance", () => {
        act(() => {
          render(
            <KioskMode
              {...defaultProps}
              devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
              kioskFooterTickersEnabled
              utterances={new Map<string, Utterance>()}
            />
          );
        });
        const strip = screen.getByTestId('kiosk-ticker-transcription');
        expect(strip.textContent?.trim()).toBe('');
        expect(strip.querySelector('.kiosk-ticker-speaker')).toBeNull();
      });
    });

    it('shows the latest agentAction summary in the action ticker', () => {
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'Running ls' }),
      ];
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('Running ls');
    });

    it("clears the action ticker once an ai-sender utterance arrives after the action", () => {
      const actionTs = new Date(Date.now() - 5_000).toISOString();
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'old action', timestamp: actionTs }),
      ];
      const utterances = new Map<string, Utterance>([
        ['u-ai', makeUtterance({ id: 'u-ai', senderId: 'ai', text: 'all done', receivedAt: new Date() })],
      ]);
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
            utterances={utterances}
          />
        );
      });
      // Per the orchestrator refinement, the AI utterance (senderId === 'ai')
      // clears the action ticker because the AI has handed the floor back.
      expect(screen.getByTestId('kiosk-ticker-action').textContent?.trim()).toBe('');
    });

    it('keeps the action ticker when the AI utterance predates the action', () => {
      const earlyAi = new Date(Date.now() - 10_000);
      const lateAction = new Date(Date.now() - 1_000).toISOString();
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'newer action', timestamp: lateAction }),
      ];
      const utterances = new Map<string, Utterance>([
        ['u-ai', makeUtterance({ id: 'u-ai', senderId: 'ai', text: 'old reply', receivedAt: earlyAi })],
      ]);
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
            utterances={utterances}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('newer action');
    });

    // ====================================================================
    // Issue #346 item 4: emoji prefix + paired-observation checkmark
    // ====================================================================
    it('prefixes the action ticker with the kind-based emoji', () => {
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'Running ls' }),
      ];
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
          />
        );
      });
      // 🔧 is the icon for terminal/Bash actions per getActionIcon().
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('🔧');
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('Running ls');
    });

    it('falls back to formatted kind when summary is empty', () => {
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'FileEditorAction', summary: '' }),
      ];
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('📁');
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('File Editor');
    });

    it('ignores observation-side entries when picking the most recent action', () => {
      // The action stream interleaves action + observation events. The ticker
      // should only render action-side entries; the observation must not
      // shadow the action's title.
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'old action' }),
        makeAction({
          id: 'o1',
          kind: 'ExecuteBashObservation',
          summary: 'observation text',
          action_id: 'a1',
        }),
      ];
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
          />
        );
      });
      const text = screen.getByTestId('kiosk-ticker-action').textContent ?? '';
      expect(text).toContain('old action');
      expect(text).not.toContain('observation text');
    });

    it('appends a green checkmark when the paired observation has arrived', () => {
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'Running ls' }),
        makeAction({ id: 'o1', kind: 'ExecuteBashObservation', summary: '', action_id: 'a1' }),
      ];
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-action').textContent).toContain('✅');
    });

    // ====================================================================
    // Issue #346 item 1: faux oscilloscope indicator
    // ====================================================================
    it('renders the oscilloscope indicator when tickers are enabled', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
          />
        );
      });
      expect(screen.getByTestId('kiosk-oscilloscope-indicator')).toBeDefined();
    });

    // Issue #380: the left indicator visualizes the human user's voice, so
    // the waveform stroke must use the user-message blue accent (#3282b8),
    // not the AI-accent purple. This pairs with the .kiosk-oscilloscope-
    // indicator background/border swap in App.css.
    it('passes the user-message blue accent to the oscilloscope waveform', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
          />
        );
      });
      const oscilloscope = screen.getByTestId('oscilloscope-mock');
      expect(oscilloscope.getAttribute('data-color')).toBe('#3282b8');
    });

    it('does not render the oscilloscope indicator when tickers are disabled', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled={false}
          />
        );
      });
      expect(screen.queryByTestId('kiosk-oscilloscope-indicator')).toBeNull();
    });

    // ====================================================================
    // Issue #388: three-state mic indicator (listening / muted / no-mic)
    // ====================================================================

    // Helper to create a mic-capable mobile, optionally listening.
    const createMicMobile = (id: string, listening: boolean): DeviceInfo => ({
      id,
      mode: 'mobile',
      displayName: `Mic ${id}`,
      listening,
      sttSupported: true,
    });

    it('renders the no-mic state when zero peers are mic-capable', () => {
      // Default test devices (createMobileDevice / createKioskDevice)
      // have no sttSupported / listening — they look like legacy clients
      // that never reported a state. Aggregator treats them as not
      // mic-capable, so the indicator should be no-mic, no glyph.
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
          />
        );
      });
      const indicator = screen.getByTestId('kiosk-oscilloscope-indicator');
      expect(indicator.getAttribute('data-state')).toBe('no-mic');
      expect(indicator.getAttribute('aria-label')).toBe('no microphones');
      // No mute glyph in this state.
      expect(screen.queryByTestId('oscilloscope-mute-icon')).toBeNull();
    });

    it('renders the muted state with the pause glyph when every mic-capable peer is silent', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMicMobile('mobile-1', false), createMicMobile('mobile-2', false)]}
            kioskFooterTickersEnabled
          />
        );
      });
      const indicator = screen.getByTestId('kiosk-oscilloscope-indicator');
      expect(indicator.getAttribute('data-state')).toBe('muted');
      expect(indicator.getAttribute('aria-label')).toBe('microphone muted');
      // Pause glyph is present; underlying waveform mock is NOT.
      expect(screen.getByTestId('oscilloscope-mute-icon')).toBeDefined();
      expect(screen.queryByTestId('oscilloscope-mock')).toBeNull();
    });

    it('renders the listening state with the waveform when at least one peer is listening', () => {
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMicMobile('mobile-1', true), createMicMobile('mobile-2', false)]}
            kioskFooterTickersEnabled
          />
        );
      });
      const indicator = screen.getByTestId('kiosk-oscilloscope-indicator');
      expect(indicator.getAttribute('data-state')).toBe('listening');
      expect(indicator.getAttribute('aria-label')).toBe('microphone active');
      // Waveform mock IS rendered; mute glyph is NOT.
      expect(screen.getByTestId('oscilloscope-mock')).toBeDefined();
      expect(screen.queryByTestId('oscilloscope-mute-icon')).toBeNull();
    });

    it('excludes non-mic-capable devices from the all-muted decision', () => {
      // STT-less mobile + STT-less kiosk — neither is mic-capable so the
      // indicator should report no-mic (issue #388 AC). The mobile is
      // here purely to suppress the idle-QR overlay; without a mobile
      // `qrHasPriority` would short-circuit the indicator render.
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
          />
        );
      });
      const indicator = screen.getByTestId('kiosk-oscilloscope-indicator');
      expect(indicator.getAttribute('data-state')).toBe('no-mic');
    });

    it('counts a mic-capable kiosk with listening:false as muted (not no-mic)', () => {
      // Per the issue's AC: a kiosk with STT enabled and listening:false
      // does count toward "all muted". The legacy mobile is here purely
      // to keep the QR overlay out of the way.
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[
              createMobileDevice('mobile-1'),
              {
                id: 'kiosk-1',
                mode: 'kiosk',
                displayName: 'Mic Kiosk',
                listening: false,
                sttSupported: true,
              },
            ]}
            kioskFooterTickersEnabled
          />
        );
      });
      const indicator = screen.getByTestId('kiosk-oscilloscope-indicator');
      expect(indicator.getAttribute('data-state')).toBe('muted');
    });

    it('reports its own initial listening state on mount via sendListeningState', () => {
      const sendListeningState = vi.fn();
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[]}
            sendListeningState={sendListeningState}
            kioskFooterTickersEnabled
          />
        );
      });
      // useSpeechRecognition mock returns isListening:false / isSupported:true.
      expect(sendListeningState).toHaveBeenCalledWith(false, true);
    });

    it('does not append a checkmark when the observation has not arrived yet', () => {
      const actions: AgentAction[] = [
        makeAction({ id: 'a1', kind: 'ExecuteBashAction', summary: 'Running ls' }),
      ];
      act(() => {
        render(
          <KioskMode
            {...defaultProps}
            devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
            kioskFooterTickersEnabled
            agentActions={actions}
          />
        );
      });
      expect(screen.getByTestId('kiosk-ticker-action').textContent).not.toContain('✅');
    });

    it('renders the connection indicator inside the kiosk display (top-right slot)', () => {
      // The connection dot should be a descendant of `.kiosk-display`, which
      // makes the CSS top-right positioning rule applicable. (Issue #340: dot
      // relocates out of the bottom-left footer area.)
      const { container } = render(
        <KioskMode
          {...defaultProps}
          devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
          kioskFooterTickersEnabled
        />
      );
      const kioskDisplay = container.querySelector('.kiosk-display');
      const dot = kioskDisplay?.querySelector('.connection-indicator');
      expect(dot).not.toBeNull();
    });

    it('App.css overrides position:fixed on .kiosk-display .connection-indicator (regression #434)', () => {
      // Verify the kiosk override resets `position: fixed` so grid-area
      // placement applies. Reading CSS source directly because happy-dom
      // doesn't reliably resolve computed styles across stylesheets;
      // Playwright would catch this too but is far heavier for a CSS-only fix.
      const cssPath = join(__dirname, '..', 'App.css');
      // Strip CSS comments before matching so stray `{` / `}` inside a
      // comment can't truncate the rule body. (`/\*[\s\S]*?\*/` is the
      // standard CSS-block-comment pattern; CSS has no line comments.)
      const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const ruleMatch = css.match(
        /\.kiosk-display\s+\.connection-indicator\s*\{[^}]*\}/
      );
      expect(ruleMatch).not.toBeNull();
      const rule = ruleMatch![0];
      // The override must explicitly neutralize the inherited position.
      // Either `static` (current fix) or `absolute`/`relative` would
      // re-anchor the element into the grid; the only forbidden value
      // is `fixed`, which pins the dot to the viewport.
      expect(rule).toMatch(/position\s*:\s*(?!fixed)(static|absolute|relative)\b/);
      // Sanity: grid-area placement is still wired up.
      expect(rule).toMatch(/grid-area\s*:\s*bl\b/);
    });

    it('sets data-tickers-enabled="true" on .kiosk-display when tickers are on', () => {
      // Gates the CSS rule that relocates the connection dot to the top-right.
      const { container } = render(
        <KioskMode
          {...defaultProps}
          devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
          kioskFooterTickersEnabled
        />
      );
      const kioskDisplay = container.querySelector('.kiosk-display');
      expect(kioskDisplay?.getAttribute('data-tickers-enabled')).toBe('true');
    });

    it('sets data-tickers-enabled="false" on .kiosk-display when tickers are off', () => {
      // Default state — keeps the dot at the original bottom-left position,
      // preventing a breaking visual change for workspaces that haven't opted in.
      const { container } = render(
        <KioskMode
          {...defaultProps}
          devices={[createMobileDevice('mobile-1'), createKioskDevice('kiosk-1')]}
        />
      );
      const kioskDisplay = container.querySelector('.kiosk-display');
      expect(kioskDisplay?.getAttribute('data-tickers-enabled')).toBe('false');
    });
  });

  // Issue #393: kiosk-attention banner.
  describe('kiosk-attention banner (#393)', () => {
    it('renders the banner when attention is set', () => {
      render(
        <KioskMode
          {...defaultProps}
          attention={{
            mobileDeviceId: 'm1',
            mobileDisplayName: 'Jane',
            ttlMs: 5000,
            at: Date.now(),
          }}
        />,
      );
      const banner = screen.getByTestId('kiosk-attention-banner');
      expect(banner).toBeDefined();
      expect(banner.textContent).toMatch('Jane connecting');
    });
    it('does not render the banner when attention is null', () => {
      render(<KioskMode {...defaultProps} attention={null} />);
      expect(screen.queryByTestId('kiosk-attention-banner')).toBeNull();
    });
    it('calls onAttentionDismiss after ttlMs', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(
        <KioskMode
          {...defaultProps}
          attention={{
            mobileDeviceId: 'm1',
            mobileDisplayName: 'Jane',
            ttlMs: 3000,
            at: Date.now(),
          }}
          onAttentionDismiss={onDismiss}
        />,
      );
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(3000); });
      expect(onDismiss).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // Issue #410: engine-selection wrapper. KioskMode now mounts
  // useSttEngine instead of useSpeechRecognition directly. The full
  // dispatch/fallback matrix is exercised in useSttEngine.test.ts;
  // these smoke tests confirm KioskMode accepts and round-trips the
  // sttEngine prop without throwing or violating rules-of-hooks.
  describe('STT engine selection (#410)', () => {
    it('mounts cleanly with the default sttEngine (web-speech)', () => {
      // Default prop value should result in no errors / warnings.
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<KioskMode {...defaultProps} />);
      // No React rules-of-hooks violation has been logged.
      const hooksWarning = errorSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('rendered more hooks'),
      );
      expect(hooksWarning).toBeUndefined();
      errorSpy.mockRestore();
    });

    it('mounts cleanly with sttEngine="deepgram"', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<KioskMode {...defaultProps} sttEngine="deepgram" />);
      const hooksWarning = errorSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('rendered more hooks'),
      );
      expect(hooksWarning).toBeUndefined();
      errorSpy.mockRestore();
    });

    it('does not throw when the sttEngine prop flips between renders', () => {
      // Rules of hooks would catch a conditional call here.
      const { rerender } = render(<KioskMode {...defaultProps} sttEngine="web-speech" />);
      expect(() => rerender(<KioskMode {...defaultProps} sttEngine="deepgram" />)).not.toThrow();
      expect(() => rerender(<KioskMode {...defaultProps} sttEngine="web-speech" />)).not.toThrow();
    });
  });
});
