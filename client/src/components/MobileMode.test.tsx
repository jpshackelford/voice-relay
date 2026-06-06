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
  }),
}));

// Issue #392: MobileMode now uses useNavigate; mock react-router-dom so tests
// don't need to wrap the component in a Router.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
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
      // Should have input mode toggle button (starts in voice mode, shows switch to unified)
      expect(screen.getByRole('button', { name: /switch to unified mode/i })).toBeDefined();
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
      const toggleBtn = screen.getByRole('button', { name: /switch to unified mode/i });
      expect(toggleBtn.textContent).toBe('🗣️');
    });

    it('has proper aria-label in voice mode', () => {
      render(<MobileMode {...defaultProps} />);
      const toggleBtn = screen.getByRole('button', { name: /switch to unified mode/i });
      expect(toggleBtn.getAttribute('aria-label')).toBe('Switch to Unified mode');
    });

    it('has aria-pressed=false in voice mode', () => {
      render(<MobileMode {...defaultProps} />);
      const toggleBtn = screen.getByRole('button', { name: /switch to unified mode/i });
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('cycles through modes: voice -> unified -> visualizer -> voice', async () => {
      render(<MobileMode {...defaultProps} />);
      
      // Start in voice mode
      let toggleBtn = screen.getByRole('button', { name: /switch to unified mode/i });
      expect(toggleBtn.textContent).toBe('🗣️');
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

      // Click to switch to unified mode
      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      // Now in unified mode
      toggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(toggleBtn.textContent).toBe('✨');
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

      // Click to switch to visualizer mode
      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      // Now in visualizer mode
      toggleBtn = screen.getByRole('button', { name: /switch to voice mode/i });
      expect(toggleBtn.textContent).toBe('📊');
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

      // Click to switch back to voice mode
      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      // Back to voice mode
      toggleBtn = screen.getByRole('button', { name: /switch to unified mode/i });
      expect(toggleBtn.textContent).toBe('🗣️');
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows oscilloscope when in unified mode', async () => {
      render(<MobileMode {...defaultProps} />);
      
      // Initially no oscilloscope
      expect(document.querySelector('.walkie-oscilloscope')).toBeNull();

      // Click header toggle to switch to unified mode
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to unified mode/i }));
      });

      // Oscilloscope should now be visible
      expect(document.querySelector('.walkie-oscilloscope')).not.toBeNull();
    });

    it('shows oscilloscope when in visualizer mode', async () => {
      render(<MobileMode {...defaultProps} />);
      
      // Initially no oscilloscope
      expect(document.querySelector('.walkie-oscilloscope')).toBeNull();

      // Click twice to get to visualizer mode (voice -> unified -> visualizer)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to unified mode/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /switch to visualizer mode/i }));
      });

      // Oscilloscope should be visible
      expect(document.querySelector('.walkie-oscilloscope')).not.toBeNull();
    });

    it('has visualizer-active class when in unified or visualizer mode', async () => {
      render(<MobileMode {...defaultProps} />);
      
      const toggleBtn = screen.getByRole('button', { name: /switch to unified mode/i });
      expect(toggleBtn.classList.contains('visualizer-active')).toBe(false);

      // Switch to unified mode
      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      let updatedToggleBtn = screen.getByRole('button', { name: /switch to visualizer mode/i });
      expect(updatedToggleBtn.classList.contains('visualizer-active')).toBe(true);

      // Switch to visualizer mode
      await act(async () => {
        fireEvent.click(updatedToggleBtn);
      });

      updatedToggleBtn = screen.getByRole('button', { name: /switch to voice mode/i });
      expect(updatedToggleBtn.classList.contains('visualizer-active')).toBe(true);
    });

    it('stops active mic streams when toggling from voice to unified', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: /switch to unified mode/i }));
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
        const closeBtn = document.querySelector('.mobile-settings-back') as HTMLButtonElement;
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
      
      // Close settings by clicking the settings modal back button
      await act(async () => {
        const closeBtn = document.querySelector('.mobile-settings-back') as HTMLButtonElement;
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

  describe('unified mode', () => {
    const renderInUnifiedMode = async () => {
      const result = render(<MobileMode {...defaultProps} />);
      
      // Open settings
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
      });
      
      // Switch to unified mode
      await act(async () => {
        const unifiedBtn = screen.getByText('✨ Unified');
        fireEvent.click(unifiedBtn);
      });
      
      // Close settings by clicking the settings modal back button
      await act(async () => {
        const closeBtn = document.querySelector('.mobile-settings-back') as HTMLButtonElement;
        fireEvent.click(closeBtn);
        // Wait for modal animation
        await new Promise(resolve => setTimeout(resolve, 250));
      });
      
      return result;
    };

    it('shows oscilloscope container in unified mode', async () => {
      await renderInUnifiedMode();
      expect(document.querySelector('.walkie-oscilloscope')).not.toBeNull();
    });

    it('does NOT show text input form in unified mode (uses speech)', async () => {
      await renderInUnifiedMode();
      expect(screen.queryByPlaceholderText('Type message...')).toBeNull();
    });

    it('shows "Tap to speak" status in unified mode', async () => {
      await renderInUnifiedMode();
      expect(screen.getByText('Tap to speak')).toBeDefined();
    });

    it('shows "Listening..." when active in unified mode', async () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });
      vi.mocked(useAudioAnalyser).mockReturnValue({
        isActive: true,
        analyser: null,
        dataArray: null,
        start: mockAudioStart,
        stop: mockAudioStop,
        error: null,
      });

      await renderInUnifiedMode();
      expect(screen.getByText('Listening...')).toBeDefined();
    });

    it('mic button is active when both speech and audio are active in unified mode', async () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });
      vi.mocked(useAudioAnalyser).mockReturnValue({
        isActive: true,
        analyser: null,
        dataArray: null,
        start: mockAudioStart,
        stop: mockAudioStop,
        error: null,
      });

      await renderInUnifiedMode();
      const micBtn = screen.getByRole('button', { name: /stop listening/i });
      expect(micBtn.classList.contains('active')).toBe(true);
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

  // Issue #393: kiosk picker gate.
  describe('kiosk picker gate (#393)', () => {
    const kiosk = (id: string, name: string, extras = {}) => ({
      id, displayName: name, mode: 'kiosk' as const, ...extras,
    });

    it('shows the picker when there are 2+ kiosks and no target chosen', () => {
      const onTargetKioskChange = vi.fn();
      render(
        <MobileMode
          {...defaultProps}
          devices={[kiosk('k1', 'Alpha'), kiosk('k2', 'Bravo')]}
          targetKioskDeviceId={undefined}
          onTargetKioskChange={onTargetKioskChange}
        />,
      );
      expect(screen.getByTestId('kiosk-picker')).toBeDefined();
    });

    it('skips the picker when there is only one kiosk', () => {
      render(
        <MobileMode
          {...defaultProps}
          devices={[kiosk('k1', 'Solo')]}
          onTargetKioskChange={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('kiosk-picker')).toBeNull();
    });

    it('skips the picker once a target is chosen and the kiosk is connected', () => {
      render(
        <MobileMode
          {...defaultProps}
          devices={[kiosk('k1', 'Alpha'), kiosk('k2', 'Bravo')]}
          targetKioskDeviceId="k1"
          onTargetKioskChange={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('kiosk-picker')).toBeNull();
    });

    it('re-shows the picker when the previously chosen kiosk disconnects', () => {
      render(
        <MobileMode
          {...defaultProps}
          devices={[kiosk('k2', 'Bravo'), kiosk('k3', 'Charlie')]}
          targetKioskDeviceId="k1"
          onTargetKioskChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('kiosk-picker')).toBeDefined();
    });

    it('clicking a card calls onTargetKioskChange with the kiosk id', () => {
      const onTargetKioskChange = vi.fn();
      render(
        <MobileMode
          {...defaultProps}
          devices={[kiosk('k1', 'Alpha'), kiosk('k2', 'Bravo')]}
          onTargetKioskChange={onTargetKioskChange}
        />,
      );
      fireEvent.click(screen.getByTestId('kiosk-picker-card-k2'));
      expect(onTargetKioskChange).toHaveBeenCalledWith('k2');
    });
  });

  describe('workspace-home shortcut (#392)', () => {
    it('renders workspace-home button when isOwner=true and navigates on click', () => {
      render(
        <MobileMode
          {...defaultProps}
          workspaceId="ws-abc"
          isOwner={true}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Workspace home' });
      expect(btn).toBeDefined();
      fireEvent.click(btn);
      expect(mockNavigate).toHaveBeenCalledWith('/workspace/ws-abc');
    });

    it('does NOT render workspace-home button when isOwner=false', () => {
      render(
        <MobileMode
          {...defaultProps}
          workspaceId="ws-abc"
          isOwner={false}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Workspace home' })).toBeNull();
    });
  });

  // ====================================================================
  // Issue #388: per-device mic listening state reporting
  // ====================================================================
  describe('sendListeningState (issue #388)', () => {
    it('reports initial idle state on mount', () => {
      const sendListeningState = vi.fn();
      render(
        <MobileMode
          {...defaultProps}
          sendListeningState={sendListeningState}
        />,
      );
      // Default mocks: isListening=false, audioAnalyser.isActive=false,
      // isSupported=true → (false, true).
      expect(sendListeningState).toHaveBeenCalledWith(false, true);
    });

    it('reports (true, true) when speech recognition is active', () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: true,
        isSupported: true,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });
      const sendListeningState = vi.fn();
      render(
        <MobileMode
          {...defaultProps}
          sendListeningState={sendListeningState}
        />,
      );
      expect(sendListeningState).toHaveBeenCalledWith(true, true);
    });

    it('reports mic-capable when the analyser is active even without STT', () => {
      // Visualizer-only mode: Web Speech not supported but the raw mic
      // is open. The mobile must still report listening=true & micCapable=true.
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: false,
        isSupported: false,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });
      vi.mocked(useAudioAnalyser).mockReturnValue({
        isActive: true,
        analyser: null,
        dataArray: null,
        start: mockAudioStart,
        stop: mockAudioStop,
        error: null,
      });
      const sendListeningState = vi.fn();
      render(
        <MobileMode
          {...defaultProps}
          sendListeningState={sendListeningState}
        />,
      );
      expect(sendListeningState).toHaveBeenCalledWith(true, true);
    });

    it('reports not-mic-capable when STT is unsupported and analyser is idle', () => {
      vi.mocked(useSpeechRecognition).mockReturnValue({
        isListening: false,
        isSupported: false,
        startListening: mockStartListening,
        stopListening: mockStopListening,
      });
      const sendListeningState = vi.fn();
      render(
        <MobileMode
          {...defaultProps}
          sendListeningState={sendListeningState}
        />,
      );
      expect(sendListeningState).toHaveBeenCalledWith(false, false);
    });

    it('renders without crashing when sendListeningState is omitted', () => {
      // Backwards compat: the prop is optional.
      expect(() => render(<MobileMode {...defaultProps} />)).not.toThrow();
    });
  });
});
