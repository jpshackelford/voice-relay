import { useState, useEffect } from 'react';

export type InputMode = 'voice' | 'visualizer';

interface MobileSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  ttsEnabled: boolean;
  ttsSupported: boolean;
  autoSubmit: boolean;
  inputMode: InputMode;
  onTtsChange: (enabled: boolean) => void;
  onAutoSubmitChange: (enabled: boolean) => void;
  onInputModeChange: (mode: InputMode) => void;
}

/**
 * Settings modal for mobile mode.
 * Contains TTS toggle, auto-submit toggle, and input mode selector.
 */
export function MobileSettings({
  isOpen,
  onClose,
  displayName,
  ttsEnabled,
  ttsSupported,
  autoSubmit,
  inputMode,
  onTtsChange,
  onAutoSubmitChange,
  onInputModeChange,
}: MobileSettingsProps) {
  const [isVisible, setIsVisible] = useState(false);

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
          <h3>Settings</h3>
          <button className="mobile-settings-close" onClick={onClose}>
            ✕
          </button>
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
                🔊 Read messages aloud
                {!ttsSupported && <span className="not-supported">(not supported)</span>}
              </span>
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => onTtsChange(e.target.checked)}
                disabled={!ttsSupported}
              />
              <span className="toggle-switch" />
            </label>
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
                disabled={inputMode === 'visualizer'}
              />
              <span className="toggle-switch" />
            </label>
          </div>

          <div className="mobile-settings-divider" />

          {/* Input Mode Selector - prevents dual microphone streams */}
          <div className="mobile-settings-section">
            <div className="mobile-settings-input-mode">
              <span className="input-mode-label">🎤 Input Mode</span>
              <span className="input-mode-hint">
                {inputMode === 'voice' 
                  ? 'Voice recognition (no visualizer)' 
                  : 'Audio visualizer (manual text entry)'}
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
                  className={`input-mode-btn ${inputMode === 'visualizer' ? 'active' : ''}`}
                  onClick={() => onInputModeChange('visualizer')}
                  aria-pressed={inputMode === 'visualizer'}
                >
                  📊 Visualizer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
