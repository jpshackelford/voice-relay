import { useState, useEffect } from 'react';
import { ReleaseNotes } from './ReleaseNotes';
import type { DeviceInfo, SessionTtsSettings } from '../types';

export type InputMode = 'voice' | 'visualizer' | 'unified';

interface MobileSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  autoSubmit: boolean;
  inputMode: InputMode;
  onAutoSubmitChange: (enabled: boolean) => void;
  onInputModeChange: (mode: InputMode) => void;
  /** Session-level TTS settings (synced across all devices) */
  sessionTtsSettings?: SessionTtsSettings | null;
  /** Callback to update session TTS settings */
  onSessionTtsSettingsChange?: (settings: SessionTtsSettings) => void;
  /** Kiosk devices in session (for device dropdown) */
  kioskDevices?: DeviceInfo[];
  /** Current device ID (to mark as "This device" in dropdown) */
  deviceId?: string;
}

/**
 * Settings modal for mobile mode.
 * Contains TTS toggle (session-level), auto-submit toggle, and input mode selector.
 */
export function MobileSettings({
  isOpen,
  onClose,
  displayName,
  autoSubmit,
  inputMode,
  onAutoSubmitChange,
  onInputModeChange,
  sessionTtsSettings,
  onSessionTtsSettingsChange,
  kioskDevices = [],
  deviceId,
}: MobileSettingsProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  
  // Derive TTS enabled state from session settings (default to false if not set)
  const ttsEnabled = sessionTtsSettings?.enabled ?? false;

  // Validate selected device exists (gracefully fall back to 'all' if device disconnected)
  const selectedDeviceId = sessionTtsSettings?.outputDeviceId ?? null;
  const deviceExists = selectedDeviceId === null || kioskDevices.some(d => d.id === selectedDeviceId);
  const effectiveTtsDeviceValue = deviceExists ? (selectedDeviceId ?? 'all') : 'all';

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      const timer = setTimeout(() => setIsVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isVisible) return null;

  return (
    <div 
      className={`mobile-settings-overlay ${isOpen ? 'open' : ''}`}
      onClick={onClose}
    >
      <div 
        className={`mobile-settings-modal ${isOpen ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-settings-header">
          <button className="mobile-settings-back" onClick={onClose}>
            ← Back
          </button>
          <h3>Settings</h3>
        </div>

        <div className="mobile-settings-content">
          <div className="mobile-settings-section">
            <div className="mobile-settings-device-name">
              📱 {displayName}
            </div>
          </div>

          <div className="mobile-settings-section">
            <label className="mobile-settings-toggle">
              <span className="toggle-label">
                🔊 AI Voice Responses
                <span className="toggle-hint">Synced across all devices</span>
              </span>
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => onSessionTtsSettingsChange?.({
                  enabled: e.target.checked,
                  outputDeviceId: sessionTtsSettings?.outputDeviceId ?? null,
                })}
              />
              <span className="toggle-switch" />
            </label>
            {ttsEnabled && kioskDevices.length > 0 && (
              <div className="mobile-settings-tts-device">
                <span className="toggle-label">Audio Output</span>
                <select
                  className="mobile-settings-select"
                  value={effectiveTtsDeviceValue}
                  onChange={(e) => onSessionTtsSettingsChange?.({
                    enabled: ttsEnabled,
                    outputDeviceId: e.target.value === 'all' ? null : e.target.value,
                  })}
                >
                  <option value="all">All kiosks</option>
                  {kioskDevices.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.id === deviceId ? '📍 This device' : d.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mobile-settings-section">
            <label className="mobile-settings-toggle">
              <span className="toggle-label">
                ⚡ Auto-send speech
                <span className="toggle-hint">
                  {autoSubmit ? 'Speech sends immediately' : 'Edit before sending'}
                </span>
              </span>
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(e) => onAutoSubmitChange(e.target.checked)}
                disabled={inputMode === 'visualizer'} // Only disable in visualizer-only mode
              />
              <span className="toggle-switch" />
            </label>
          </div>

          <div className="mobile-settings-divider" />

          {/* Input Mode Selector */}
          <div className="mobile-settings-section">
            <div className="mobile-settings-input-mode">
              <span className="input-mode-label">🎤 Input Mode</span>
              <span className="input-mode-hint">
                {inputMode === 'voice' 
                  ? 'Voice recognition (no visualizer)' 
                  : inputMode === 'visualizer'
                    ? 'Audio visualizer (manual text entry)'
                    : 'Voice recognition with visualizer'}
              </span>
              <div className="input-mode-buttons">
                <button
                  className={`input-mode-btn ${inputMode === 'voice' ? 'active' : ''}`}
                  onClick={() => onInputModeChange('voice')}
                  aria-pressed={inputMode === 'voice'}
                >
                  🗣️ Voice
                </button>
                <button
                  className={`input-mode-btn ${inputMode === 'unified' ? 'active' : ''}`}
                  onClick={() => onInputModeChange('unified')}
                  aria-pressed={inputMode === 'unified'}
                >
                  ✨ Unified
                </button>
                <button
                  className={`input-mode-btn ${inputMode === 'visualizer' ? 'active' : ''}`}
                  onClick={() => onInputModeChange('visualizer')}
                  aria-pressed={inputMode === 'visualizer'}
                >
                  📊 Visualizer
                </button>
              </div>
            </div>
          </div>

          <div className="mobile-settings-divider" />

          {/* What's New - Release Notes */}
          <div className="mobile-settings-section">
            <button
              className="mobile-settings-link"
              onClick={() => setWhatsNewOpen(true)}
            >
              📦 What's New
            </button>
          </div>
        </div>
      </div>

      {/* Release Notes Modal */}
      <ReleaseNotes isOpen={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
    </div>
  );
}
