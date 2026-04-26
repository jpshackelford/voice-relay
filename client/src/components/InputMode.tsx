import { useState, useRef, useCallback, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { generateUUID } from '../utils/uuid';
import type { DeviceInfo } from '../types';

interface InputModeProps {
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  sendText: (utteranceId: string, text: string, partial: boolean) => void;
  onModeChange: () => void;
}

export function InputMode({ displayName, connected, devices, sendText, onModeChange }: InputModeProps) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const utteranceIdRef = useRef(generateUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Generate new utterance ID when text is committed
  const generateNewUtteranceId = useCallback(() => {
    utteranceIdRef.current = generateUUID();
  }, []);

  // Debounced send for typing
  const sendDebounced = useCallback((currentText: string, partial: boolean) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!partial) {
      // Send immediately for final
      sendText(utteranceIdRef.current, currentText, false);
      return;
    }

    // Debounce partials
    debounceRef.current = setTimeout(() => {
      sendText(utteranceIdRef.current, currentText, true);
    }, 100);
  }, [sendText]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    sendDebounced(newText, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        sendText(utteranceIdRef.current, text, false);
        setText('');
        generateNewUtteranceId();
      }
    }
  };

  const handleSend = () => {
    if (text.trim()) {
      sendText(utteranceIdRef.current, text, false);
      setText('');
      generateNewUtteranceId();
    }
  };

  const [sttError, setSttError] = useState<string | null>(null);

  // Speech recognition handlers
  const handleInterimResult = useCallback((transcript: string) => {
    setInterimText(transcript);
    sendText(utteranceIdRef.current, text + transcript, true);
  }, [text, sendText]);

  const handleFinalResult = useCallback((transcript: string) => {
    const newText = text + transcript + ' ';
    setText(newText);
    setInterimText('');
    sendText(utteranceIdRef.current, newText, true);
  }, [text, sendText]);

  const handleSttError = useCallback((err: string) => {
    console.error('[STT]', err);
    setSttError(err);
    // Clear error after 5 seconds
    setTimeout(() => setSttError(null), 5000);
  }, []);

  const { isListening, isSupported: sttSupported, startListening, stopListening } = useSpeechRecognition({
    onInterimResult: handleInterimResult,
    onFinalResult: handleFinalResult,
    onError: handleSttError,
  });

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const outputDevices = devices.filter(d => d.mode === 'output');

  return (
    <div className="input-mode">
      <header>
        <div className="device-info">
          <span className="device-name">📤 {displayName}</span>
          <span className={`connection-status ${connected ? 'connected' : ''}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
        <button className="mode-switch" onClick={onModeChange}>
          Switch to Output
        </button>
      </header>

      <div className="output-devices">
        <h3>Broadcasting to {outputDevices.length} device{outputDevices.length !== 1 ? 's' : ''}</h3>
        {outputDevices.length > 0 && (
          <ul>
            {outputDevices.map(d => (
              <li key={d.id}>📥 {d.displayName}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="input-area">
        <textarea
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={4}
        />
        {interimText && (
          <div className="interim-text">
            <em>{interimText}</em>
          </div>
        )}
      </div>

      <div className="input-controls">
        <button 
          className={`stt-btn ${isListening ? 'listening' : ''}`}
          onClick={isListening ? stopListening : startListening}
          disabled={!sttSupported}
          title={sttSupported ? (isListening ? 'Stop listening' : 'Start speech-to-text') : 'Speech recognition not supported'}
        >
          {isListening ? '🔴 Stop' : '🎤 Speak'}
        </button>
        <button 
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send ➤
        </button>
      </div>

      {sttError && (
        <div className="stt-error">
          ⚠️ {sttError}
        </div>
      )}
    </div>
  );
}
