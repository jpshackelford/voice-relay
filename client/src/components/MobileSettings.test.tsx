import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MobileSettings, type InputMode } from './MobileSettings';
import type { DeviceInfo, SessionTtsSettings } from '../types';

describe('MobileSettings', () => {
  const mockKioskDevices: DeviceInfo[] = [
    { id: 'kiosk-1', displayName: 'Living Room', mode: 'kiosk' },
    { id: 'kiosk-2', displayName: 'Kitchen', mode: 'kiosk' },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    displayName: 'Test Device',
    autoSubmit: true,
    inputMode: 'voice' as InputMode,
    onAutoSubmitChange: vi.fn(),
    onInputModeChange: vi.fn(),
    sessionTtsSettings: { enabled: false, outputDeviceId: null } as SessionTtsSettings,
    onSessionTtsSettingsChange: vi.fn(),
    kioskDevices: mockKioskDevices,
    deviceId: 'mobile-1',
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

  describe('TTS toggle (session-level)', () => {
    it('shows TTS toggle with correct state when enabled', () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: true, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      const checkbox = screen.getByRole('checkbox', { name: /ai voice responses/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('shows TTS toggle with correct state when disabled', () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: false, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      const checkbox = screen.getByRole('checkbox', { name: /ai voice responses/i }) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('calls onSessionTtsSettingsChange when toggled', async () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: false, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      const checkbox = screen.getByRole('checkbox', { name: /ai voice responses/i });
      
      await act(async () => {
        fireEvent.click(checkbox);
      });

      expect(defaultProps.onSessionTtsSettingsChange).toHaveBeenCalledWith({
        enabled: true,
        outputDeviceId: null,
      });
    });

    it('shows "Synced across all devices" hint', () => {
      render(<MobileSettings {...defaultProps} />);
      expect(screen.getByText('Synced across all devices')).toBeDefined();
    });

    it('shows device dropdown when TTS is enabled', () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: true, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      expect(screen.getByText('Audio Output')).toBeDefined();
      expect(screen.getByRole('combobox')).toBeDefined();
    });

    it('hides device dropdown when TTS is disabled', () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: false, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      expect(screen.queryByText('Audio Output')).toBeNull();
    });

    it('calls onSessionTtsSettingsChange when device is selected', async () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: true, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      const select = screen.getByRole('combobox');
      
      await act(async () => {
        fireEvent.change(select, { target: { value: 'kiosk-1' } });
      });

      expect(defaultProps.onSessionTtsSettingsChange).toHaveBeenCalledWith({
        enabled: true,
        outputDeviceId: 'kiosk-1',
      });
    });

    it('shows device names in dropdown', () => {
      const props = {
        ...defaultProps,
        sessionTtsSettings: { enabled: true, outputDeviceId: null },
      };
      render(<MobileSettings {...props} />);
      expect(screen.getByText('All kiosks')).toBeDefined();
      expect(screen.getByText('Living Room')).toBeDefined();
      expect(screen.getByText('Kitchen')).toBeDefined();
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

  describe('back button', () => {
    it('shows back button', () => {
      render(<MobileSettings {...defaultProps} />);
      const backButton = screen.getByText('← Back');
      expect(backButton).toBeDefined();
    });

    it('calls onClose when back button clicked', async () => {
      render(<MobileSettings {...defaultProps} />);
      const backButton = screen.getByText('← Back');
      
      await act(async () => {
        fireEvent.click(backButton);
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

  describe('input mode selector', () => {
    it('shows input mode buttons', () => {
      render(<MobileSettings {...defaultProps} />);
      expect(screen.getByText('🗣️ Voice')).toBeDefined();
      expect(screen.getByText('✨ Unified')).toBeDefined();
      expect(screen.getByText('📊 Visualizer')).toBeDefined();
    });

    it('shows voice button as active when inputMode is voice', () => {
      render(<MobileSettings {...defaultProps} inputMode="voice" />);
      const voiceBtn = screen.getByText('🗣️ Voice');
      expect(voiceBtn.className).toContain('active');
    });

    it('shows unified button as active when inputMode is unified', () => {
      render(<MobileSettings {...defaultProps} inputMode="unified" />);
      const unifiedBtn = screen.getByText('✨ Unified');
      expect(unifiedBtn.className).toContain('active');
    });

    it('shows visualizer button as active when inputMode is visualizer', () => {
      render(<MobileSettings {...defaultProps} inputMode="visualizer" />);
      const vizBtn = screen.getByText('📊 Visualizer');
      expect(vizBtn.className).toContain('active');
    });

    it('calls onInputModeChange with voice when voice button clicked', async () => {
      render(<MobileSettings {...defaultProps} inputMode="visualizer" />);
      const voiceBtn = screen.getByText('🗣️ Voice');
      
      await act(async () => {
        fireEvent.click(voiceBtn);
      });

      expect(defaultProps.onInputModeChange).toHaveBeenCalledWith('voice');
    });

    it('calls onInputModeChange with unified when unified button clicked', async () => {
      render(<MobileSettings {...defaultProps} inputMode="voice" />);
      const unifiedBtn = screen.getByText('✨ Unified');
      
      await act(async () => {
        fireEvent.click(unifiedBtn);
      });

      expect(defaultProps.onInputModeChange).toHaveBeenCalledWith('unified');
    });

    it('calls onInputModeChange with visualizer when visualizer button clicked', async () => {
      render(<MobileSettings {...defaultProps} inputMode="voice" />);
      const vizBtn = screen.getByText('📊 Visualizer');
      
      await act(async () => {
        fireEvent.click(vizBtn);
      });

      expect(defaultProps.onInputModeChange).toHaveBeenCalledWith('visualizer');
    });

    it('shows correct hint for voice mode', () => {
      render(<MobileSettings {...defaultProps} inputMode="voice" />);
      expect(screen.getByText('Voice recognition (no visualizer)')).toBeDefined();
    });

    it('shows correct hint for unified mode', () => {
      render(<MobileSettings {...defaultProps} inputMode="unified" />);
      expect(screen.getByText('Voice recognition with visualizer')).toBeDefined();
    });

    it('shows correct hint for visualizer mode', () => {
      render(<MobileSettings {...defaultProps} inputMode="visualizer" />);
      expect(screen.getByText('Audio visualizer (manual text entry)')).toBeDefined();
    });

    it('disables auto-submit toggle in visualizer mode', () => {
      render(<MobileSettings {...defaultProps} inputMode="visualizer" />);
      const checkbox = screen.getByRole('checkbox', { name: /auto-send speech/i }) as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });

    it('enables auto-submit toggle in voice mode', () => {
      render(<MobileSettings {...defaultProps} inputMode="voice" />);
      const checkbox = screen.getByRole('checkbox', { name: /auto-send speech/i }) as HTMLInputElement;
      expect(checkbox.disabled).toBe(false);
    });

    it('enables auto-submit toggle in unified mode', () => {
      render(<MobileSettings {...defaultProps} inputMode="unified" />);
      const checkbox = screen.getByRole('checkbox', { name: /auto-send speech/i }) as HTMLInputElement;
      expect(checkbox.disabled).toBe(false);
    });
  });

  describe('verbose STT lifecycle toggle (#470)', () => {
    it('renders the Diagnostics toggle off by default', () => {
      render(<MobileSettings {...defaultProps} />);
      // The toggle uses a checkbox sibling to the styled switch span.
      // Filter by the label text we added.
      expect(screen.getByText(/Verbose STT lifecycle logging/i)).toBeDefined();
      const labels = screen.getAllByText(/Verbose STT lifecycle logging/i);
      expect(labels.length).toBeGreaterThan(0);
    });

    it('fires onVerboseSttLoggingChange when the user toggles it on', () => {
      const onVerboseSttLoggingChange = vi.fn();
      render(
        <MobileSettings
          {...defaultProps}
          verboseSttLogging={false}
          onVerboseSttLoggingChange={onVerboseSttLoggingChange}
        />,
      );
      // Locate the checkbox by walking from the label text.
      const label = screen
        .getByText(/Verbose STT lifecycle logging/i)
        .closest('label') as HTMLLabelElement;
      const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      fireEvent.click(checkbox);
      expect(onVerboseSttLoggingChange).toHaveBeenCalledWith(true);
    });

    it('reflects the current verboseSttLogging value in the checkbox', () => {
      render(<MobileSettings {...defaultProps} verboseSttLogging={true} />);
      const label = screen
        .getByText(/Verbose STT lifecycle logging/i)
        .closest('label') as HTMLLabelElement;
      const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });
  });
});
