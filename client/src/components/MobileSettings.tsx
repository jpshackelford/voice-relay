import { useState, useEffect } from 'react';
import type { DeviceMode } from '../types';

interface MobileSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  ttsEnabled: boolean;
  ttsSupported: boolean;
  autoSubmit: boolean;
  onTtsChange: (enabled: boolean) => void;
  onAutoSubmitChange: (enabled: boolean) => void;
  onModeChange: (mode: DeviceMode) => void;
}

/**
 * Settings modal for mobile mode.
 * Contains TTS toggle, auto-submit toggle, and mode switch.
 */
export function MobileSettings({
  isOpen,
  onClose,
  displayName,
  ttsEnabled,
  ttsSupported,
  autoSubmit,
  onTtsChange,
  onAutoSubmitChange,
  onModeChange,
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
              />
              <span className="toggle-switch" />
            </label>
          </div>

          <div className="mobile-settings-divider" />

          <div className="mobile-settings-section">
            <button 
              className="mobile-settings-mode-switch"
              onClick={() => onModeChange('kiosk')}
            >
              🖥️ Switch to Kiosk Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
