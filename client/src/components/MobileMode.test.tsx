import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MobileMode } from './MobileMode';
import type { DeviceInfo, Utterance } from '../types';

// Mock hooks
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  })),
}));

vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: vi.fn(),
    isSupported: true,
  }),
}));

vi.mock('../hooks/useAudioAnalyser', () => ({
  useAudioAnalyser: vi.fn(() => ({
    isActive: false,
    analyser: null,
    dataArray: null,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    error: null,
  })),
}));

vi.mock('../hooks/useAI', () => ({
  useAI: () => ({
    connected: false,
    connecting: false,
    thinking: false,
    error: null,
    checkAvailability: vi.fn().mockResolvedValue({ available: false }),
  }),
}));

// Import after mocking so we can access the mock functions
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser';

describe('MobileMode', () => {
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
    deviceId,
    displayName: 'Test Device',
    connected: true,
    devices: [] as DeviceInfo[],
    utterances: new Map<string, Utterance>(),
    sendText: vi.fn(),
    onModeChange: vi.fn(),
    onAIStatusChange: vi.fn(),
    sessionId: 'test-session',
  };

  let mockStartListening: Mock;
  let mockStopListening: Mock;
  let mockAudioStart: Mock;
  let mockAudioStop: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockStartListening = vi.fn();
    mockStopListening = vi.fn();
    mockAudioStart = vi.fn().mockResolvedValue(undefined);
    mockAudioStop = vi.fn();
    
    vi.mocked(useSpeechRecognition).mockReturnValue({
      isListening: false,
      isSupported: true,
      startListening: mockStartListening,
      stopListening: mockStopListening,
    });
    
    vi.mocked(useAudioAnalyser).mockReturnValue({
      isActive: false,
      analyser: null,
      dataArray: null,
      start: mockAudioStart,
      stop: mockAudioStop,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial render', () => {
    it('renders walkie-talkie UI', () => {
      render(<MobileMode {...defaultProps} />);
      // Should have mic button
      expect(screen.getByRole('button', { name: /start listening/i })).toBeDefined();
      // Should have settings button
      expect(screen.getByRole('button', { name: /open settings/i })).toBeDefined();
      // Should have conversation button
      expect(screen.getByRole('button', { name: /view conversation/i })).toBeDefined();
      // Should have input mode toggle button
      expect(screen.getByRole('button', { name: /switch to visualizer mode/i })).toBeDefined();
    });

    it('shows connection status indicator', () => {
      render(<MobileMode {...defaultProps} connected={true} />);
      const indicator = screen.getByRole('status');
      expect(indicator.getAttribute('aria-label')).toContain('Connected');
    });

    it('shows disconnected status when not connected', () => {
      render(<MobileMode {...defaultProps} connected={false} />);
      const indicator = screen.getByRole('status');
      expect(indicator.getAttribute('aria-label')).toContain('Disconnected');
    });
  });

  describe('header toggle button', () => {
    it('displays voice icon when in voice mode', () => {
      render(<MobileMode {...defaultProps} />);
      const toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(toggleBtn.textContent).toBe('🗣️');
    });

    it('has proper aria-label in voice mode', () => {
      render(<MobileMode {...defaultProps} />);
      const toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(toggleBtn.getAttribute('aria-label')).toBe('Switch to Visualizer mode');
    });

    it('has aria-pressed=false in voice mode', () => {
      render(<MobileMode {...defaultProps} />);
      const toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('switches to visualizer mode when clicked', async () => {
      render(<MobileMode {...defaultProps} />);
      
      const toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      // After clicking, should now show visualizer icon and voice mode label
      const updatedToggleBtn = screen.getByRole('button', { name: /switch to voice mode/i });
      expect(updatedToggleBtn.textContent).toBe('📊');
      expect(updatedToggleBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('switches back to voice mode when clicked again', async () => {
      render(<MobileMode {...defaultProps} />);
      
      // Switch to visualizer
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to visualizer mode/i }));
      });

      // Switch back to voice
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to voice mode/i }));
      });

      // Should be back to voice mode
      const toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(toggleBtn.textContent).toBe('🗣️');
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows oscilloscope when switched to visualizer mode via header toggle', async () => {
      render(<MobileMode {...defaultProps} />);
      
      // Initially no oscilloscope
      expect(document.querySelector('.walkie-oscilloscope')).toBeNull();

      // Click header toggle
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to visualizer mode/i }));
      });

      // Oscilloscope should now be visible
      expect(document.querySelector('.walkie-oscilloscope')).not.toBeNull();
    });

    it('has visualizer-active class when in visualizer mode', async () => {
      render(<MobileMode {...defaultProps} />);
      
      const toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(toggleBtn.classList.contains('visualizer-active')).toBe(false);

      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      const updatedToggleBtn = screen.getByRole('button', { name: /switch to voice mode/i });
      expect(updatedToggleBtn.classList.contains('visualizer-active')).toBe(true);
    });

    it('stops active mic streams when toggling from voice to visualizer', async () => {
      // Start with listening active
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });

      render(<MobileMode {...defaultProps} />);

      // Click header toggle to switch modes
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to visualizer mode/i }));
      });

      // stopListening should have been called when mode changed
      expect(mockStopListening).toHaveBeenCalled();
    });
  });

  describe('input mode switching', () => {
    it('starts in voice mode (no oscilloscope visible)', () => {
      render(<MobileMode {...defaultProps} />);
      // Oscilloscope container should not be present in voice mode
      expect(document.querySelector('.walkie-oscilloscope')).toBeNull();
    });

    it('stops active mic when switching input modes', async () => {
      // Start with listening active
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });

      render(<MobileMode {...defaultProps} />);

      // Verify mic button shows active state
      expect(screen.getByRole('button', { name: /stop listening/i })).toBeDefined();

      // Open settings and switch mode
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
      });

      // Click visualizer mode button
      await act(async () => {
        const vizBtn = screen.getByText('📊 Visualizer');
        fireEvent.click(vizBtn);
      });

      // Close settings to trigger effect
      await act(async () => {
        const closeBtn = screen.getByText('✕');
        fireEvent.click(closeBtn);
      });

      // stopListening should have been called when mode changed
      expect(mockStopListening).toHaveBeenCalled();
    });
  });

  describe('voice mode mic toggle', () => {
    it('calls startListening when mic button clicked in voice mode', async () => {
      render(<MobileMode {...defaultProps} />);
      
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /start listening/i }));
      });

      expect(mockStartListening).toHaveBeenCalled();
    });

    it('calls stopListening when mic is active and clicked', async () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });

      render(<MobileMode {...defaultProps} />);
      
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /stop listening/i }));
      });

      expect(mockStopListening).toHaveBeenCalled();
    });

    it('shows "Listening..." when mic is active', () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });

      render(<MobileMode {...defaultProps} />);
      expect(screen.getByText('Listening...')).toBeDefined();
    });

    it('shows "Tap to speak" when mic is idle', () => {
      render(<MobileMode {...defaultProps} />);
      expect(screen.getByText('Tap to speak')).toBeDefined();
    });
  });

  describe('visualizer mode', () => {
    const renderInVisualizerMode = async () => {
      const result = render(<MobileMode {...defaultProps} />);
      
      // Open settings
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
      });
      
      // Switch to visualizer mode
      await act(async () => {
        const vizBtn = screen.getByText('📊 Visualizer');
        fireEvent.click(vizBtn);
      });
      
      // Close settings
      await act(async () => {
        const closeBtn = screen.getByText('✕');
        fireEvent.click(closeBtn);
        // Wait for modal animation
        await new Promise(resolve => setTimeout(resolve, 250));
      });
      
      return result;
    };

    it('shows oscilloscope container in visualizer mode', async () => {
      await renderInVisualizerMode();
      expect(document.querySelector('.walkie-oscilloscope')).not.toBeNull();
    });

    it('shows text input form in visualizer mode', async () => {
      await renderInVisualizerMode();
      expect(screen.getByPlaceholderText('Type message...')).toBeDefined();
    });

    it('shows "Tap to record" status in visualizer mode', async () => {
      await renderInVisualizerMode();
      expect(screen.getByText('Tap to record')).toBeDefined();
    });

    it('shows "Recording..." when audio analyser is active', async () => {
      vi.mocked(useAudioAnalyser).mockReturnValue({
        isActive: true,
        analyser: null,
        dataArray: null,
        start: mockAudioStart,
        stop: mockAudioStop,
        error: null,
      });

      await renderInVisualizerMode();
      expect(screen.getByText('Recording...')).toBeDefined();
    });

    it('sends text when form is submitted', async () => {
      await renderInVisualizerMode();

      const input = screen.getByPlaceholderText('Type message...') as HTMLInputElement;
      const form = input.closest('form')!;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Hello world' } });
      });

      await act(async () => {
        fireEvent.submit(form);
      });

      expect(defaultProps.sendText).toHaveBeenCalled();
      expect(defaultProps.sendText.mock.calls[0][1]).toBe('Hello world');
      expect(defaultProps.sendText.mock.calls[0][2]).toBe(false); // not partial
    });

    it('clears input after sending', async () => {
      await renderInVisualizerMode();

      const input = screen.getByPlaceholderText('Type message...') as HTMLInputElement;
      const form = input.closest('form')!;

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Hello world' } });
      });

      await act(async () => {
        fireEvent.submit(form);
      });

      expect(input.value).toBe('');
    });

    it('disables send button when input is empty', async () => {
      await renderInVisualizerMode();

      const sendBtn = screen.getByRole('button', { name: /send message/i }) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
    });
  });

  describe('conversation pane', () => {
    it('opens conversation pane when button clicked', async () => {
      render(<MobileMode {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /view conversation/i }));
      });

      expect(screen.getByText('Conversation')).toBeDefined();
    });

    it('shows unread count badge when there are new messages', () => {
      const utterance = createUtterance({
        id: 'msg-1',
        senderId: 'other-device',
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<MobileMode {...defaultProps} utterances={utterances} />);

      // Should show unread badge
      const badge = document.querySelector('.unread-badge');
      expect(badge?.textContent).toBe('1');
    });

    it('clears unread count when conversation pane is opened', async () => {
      const utterance = createUtterance({
        id: 'msg-1',
        senderId: 'other-device',
      });
      const utterances = new Map([['msg-1', utterance]]);

      render(<MobileMode {...defaultProps} utterances={utterances} />);

      // Initially has unread
      expect(document.querySelector('.unread-badge')?.textContent).toBe('1');

      // Open conversation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /view conversation/i }));
      });

      // Close it
      await act(async () => {
        fireEvent.click(screen.getByText('← Back'));
      });

      // Unread should be cleared
      expect(document.querySelector('.unread-badge')).toBeNull();
    });
  });

  describe('settings modal', () => {
    it('opens settings modal when button clicked', async () => {
      render(<MobileMode {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
      });

      expect(screen.getByText('Settings')).toBeDefined();
    });
  });

  describe('device counts', () => {
    it('shows mobile device count when present', () => {
      const devices: DeviceInfo[] = [
        { id: '1', displayName: 'Phone 1', mode: 'mobile' },
        { id: '2', displayName: 'Phone 2', mode: 'mobile' },
      ];

      render(<MobileMode {...defaultProps} devices={devices} />);

      expect(screen.getByText('📱 2')).toBeDefined();
    });

    it('shows kiosk device count when present', () => {
      const devices: DeviceInfo[] = [
        { id: '1', displayName: 'Kiosk 1', mode: 'kiosk' },
      ];

      render(<MobileMode {...defaultProps} devices={devices} />);

      expect(screen.getByText('🖥️ 1')).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('displays STT error when present', async () => {
      render(<MobileMode {...defaultProps} />);

      // Trigger an error by mocking startListening to throw
      mockStartListening.mockImplementation(() => {
        throw new Error('Mic permission denied');
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /start listening/i }));
      });

      expect(screen.getByText(/Mic permission denied/)).toBeDefined();
    });
  });

  describe('accessibility', () => {
    it('has proper aria-label on mic button', () => {
      render(<MobileMode {...defaultProps} />);
      const micBtn = screen.getByRole('button', { name: /start listening/i });
      expect(micBtn.getAttribute('aria-label')).toBeDefined();
    });

    it('has aria-pressed state on mic button', async () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });

      render(<MobileMode {...defaultProps} />);
      const micBtn = screen.getByRole('button', { name: /stop listening/i });
      expect(micBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('has role=status on connection indicator', () => {
      render(<MobileMode {...defaultProps} />);
      const indicator = screen.getByRole('status');
      expect(indicator).toBeDefined();
    });
  });
});
