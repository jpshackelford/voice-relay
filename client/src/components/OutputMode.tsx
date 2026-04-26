import { useState, useEffect, useRef } from 'react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import type { DeviceInfo, Utterance } from '../types';

interface OutputModeProps {
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  utterances: Map<string, Utterance>;
  onModeChange: () => void;
}

export function OutputMode({ displayName, connected, devices, utterances, onModeChange }: OutputModeProps) {
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const { speak, isSpeaking, isSupported: ttsSupported } = useSpeechSynthesis();
  const spokenUtterancesRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Speak new final utterances when TTS is enabled
  useEffect(() => {
    if (!ttsEnabled) return;

    for (const [id, utterance] of utterances) {
      if (!utterance.partial && !spokenUtterancesRef.current.has(id)) {
        spokenUtterancesRef.current.add(id);
        speak(utterance.text);
      }
    }
  }, [utterances, ttsEnabled, speak]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances]);

  const inputDevices = devices.filter(d => d.mode === 'input');

  // Sort utterances by received time
  const sortedUtterances = [...utterances.values()].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  );

  return (
    <div className="output-mode">
      <header>
        <div className="device-info">
          <span className="device-name">📥 {displayName}</span>
          <span className={`connection-status ${connected ? 'connected' : ''}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
        <button className="mode-switch" onClick={onModeChange}>
          Switch to Input
        </button>
      </header>

      <div className="input-devices">
        <h3>Receiving from {inputDevices.length} device{inputDevices.length !== 1 ? 's' : ''}</h3>
        {inputDevices.length > 0 && (
          <ul>
            {inputDevices.map(d => (
              <li key={d.id}>📤 {d.displayName}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="tts-toggle">
        <label>
          <input
            type="checkbox"
            checked={ttsEnabled}
            onChange={(e) => setTtsEnabled(e.target.checked)}
            disabled={!ttsSupported}
          />
          🔊 Text-to-Speech {isSpeaking && '(speaking...)'}
        </label>
        {!ttsSupported && <span className="not-supported">(not supported)</span>}
      </div>

      <div className="messages">
        {sortedUtterances.length === 0 ? (
          <div className="no-messages">
            Waiting for messages from input devices...
          </div>
        ) : (
          sortedUtterances.map((utterance) => (
            <div 
              key={utterance.id} 
              className={`message ${utterance.partial ? 'partial' : 'final'}`}
            >
              <span className="sender">{utterance.senderName}:</span>
              <span className="text">{utterance.text}</span>
              {utterance.partial && <span className="typing-indicator">...</span>}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
