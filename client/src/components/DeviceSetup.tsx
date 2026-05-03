import { useState } from 'react';
import type { DeviceMode } from '../types';
import { QRCodeDisplay } from './QRCode';

interface DeviceSetupProps {
  initialName: string;
  onSubmit: (displayName: string, mode: DeviceMode) => void;
}

export function DeviceSetup({ initialName, onSubmit }: DeviceSetupProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [mode, setMode] = useState<DeviceMode>('output');
  const [showQR, setShowQR] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.trim()) {
      onSubmit(displayName.trim(), mode);
    }
  };

  return (
    <div className="device-setup">
      <h1>🔊 Voice Relay</h1>
      <p>Connect this device to the relay network</p>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="displayName">Device Name</label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g., Kitchen iPad, John's Laptop"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>Device Mode</label>
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-btn ${mode === 'input' ? 'active' : ''}`}
              onClick={() => setMode('input')}
            >
              📤 Input
              <span className="mode-desc">Send text & speech</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'output' ? 'active' : ''}`}
              onClick={() => setMode('output')}
            >
              📥 Output
              <span className="mode-desc">Receive & display</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
              onClick={() => setMode('chat')}
            >
              💬 Chat
              <span className="mode-desc">Send & receive</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'kiosk' ? 'active' : ''}`}
              onClick={() => setMode('kiosk')}
            >
              🖥️ Kiosk
              <span className="mode-desc">Large display + chat</span>
            </button>
          </div>
        </div>

        <button type="submit" className="submit-btn" disabled={!displayName.trim()}>
          Connect
        </button>
      </form>

      <div className="qr-section">
        <button 
          type="button" 
          className="qr-toggle"
          onClick={() => setShowQR(!showQR)}
        >
          {showQR ? '▼ Hide QR Code' : '▶ Connect another device'}
        </button>
        {showQR && <QRCodeDisplay size={180} />}
      </div>
    </div>
  );
}
