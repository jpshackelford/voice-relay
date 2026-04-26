import { useState, useRef, useCallback, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { generateUUID } from '../utils/uuid';
import type { DeviceInfo, DeviceMode, Utterance } from '../types';

interface ChatModeProps {
  deviceId: string;
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  utterances: Map<string, Utterance>;
  sendText: (utteranceId: string, text: string, partial: boolean) => void;
  onModeChange: (mode: DeviceMode) => void;
}

export function ChatMode({ 
  deviceId,
  displayName, 
  connected, 
  devices, 
  utterances,
  sendText, 
  onModeChange 
}: ChatModeProps) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  
  const utteranceIdRef = useRef(generateUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spokenUtterancesRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { speak, isSpeaking, isSupported: ttsSupported } = useSpeechSynthesis();

  const generateNewUtteranceId = useCallback(() => {
    utteranceIdRef.current = generateUUID();
  }, []);

  // Debounced send for typing
  const sendDebounced = useCallback((currentText: string, partial: boolean) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!partial) {
      sendText(utteranceIdRef.current, currentText, false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      sendText(utteranceIdRef.current, currentText, true);
    }, 100);
  }, [sendText]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setText(newText);
    sendDebounced(newText, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (text.trim()) {
      sendText(utteranceIdRef.current, text, false);
      setText('');
      generateNewUtteranceId();
    }
  };

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
    setTimeout(() => setSttError(null), 5000);
  }, []);

  const { isListening, isSupported: sttSupported, startListening, stopListening } = useSpeechRecognition({
    onInterimResult: handleInterimResult,
    onFinalResult: handleFinalResult,
    onError: handleSttError,
  });

  // Speak new final utterances when TTS is enabled (only from others)
  useEffect(() => {
    if (!ttsEnabled) return;

    for (const [id, utterance] of utterances) {
      // Only speak messages from others
      if (utterance.senderId !== deviceId && !utterance.partial && !spokenUtterancesRef.current.has(id)) {
        spokenUtterancesRef.current.add(id);
        speak(utterance.text);
      }
    }
  }, [utterances, ttsEnabled, speak, deviceId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Sort utterances by received time
  const sortedUtterances = [...utterances.values()].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  );

  const chatDevices = devices.filter(d => d.mode === 'chat');
  const inputDevices = devices.filter(d => d.mode === 'input');
  const outputDevices = devices.filter(d => d.mode === 'output');

  return (
    <div className="chat-mode">
      <header>
        <div className="device-info">
          <span className="device-name">💬 {displayName}</span>
          <span className={`connection-status ${connected ? 'connected' : ''}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
        <div className="mode-buttons">
          <button className="mode-switch" onClick={() => onModeChange('input')}>
            📤 Input
          </button>
          <button className="mode-switch" onClick={() => onModeChange('output')}>
            📥 Output
          </button>
        </div>
      </header>

      <div className="chat-participants">
        {chatDevices.length > 0 && (
          <span className="participant-group">
            💬 {chatDevices.length} chatter{chatDevices.length !== 1 ? 's' : ''}
          </span>
        )}
        {inputDevices.length > 0 && (
          <span className="participant-group">
            📤 {inputDevices.length} sender{inputDevices.length !== 1 ? 's' : ''}
          </span>
        )}
        {outputDevices.length > 0 && (
          <span className="participant-group">
            📥 {outputDevices.length} receiver{outputDevices.length !== 1 ? 's' : ''}
          </span>
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
          🔊 Read messages aloud {isSpeaking && '(speaking...)'}
        </label>
        {!ttsSupported && <span className="not-supported">(not supported)</span>}
      </div>

      <div className="messages chat-messages">
        {sortedUtterances.length === 0 ? (
          <div className="no-messages">
            No messages yet. Start the conversation!
          </div>
        ) : (
          sortedUtterances.map((utterance) => {
            const isOwnMessage = utterance.senderId === deviceId;
            return (
              <div 
                key={utterance.id} 
                className={`message ${utterance.partial ? 'partial' : 'final'} ${isOwnMessage ? 'own-message' : ''}`}
              >
                <span className="sender">{isOwnMessage ? 'You' : utterance.senderName}:</span>
                <span className="text">{utterance.text}</span>
                {utterance.partial && <span className="typing-indicator">...</span>}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {interimText && (
          <div className="interim-text">
            <em>{interimText}</em>
          </div>
        )}
        <div className="chat-input-row">
          <button 
            className={`stt-btn-small ${isListening ? 'listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
            disabled={!sttSupported}
            title={sttSupported ? (isListening ? 'Stop listening' : 'Start speech-to-text') : 'Speech recognition not supported'}
          >
            {isListening ? '🔴' : '🎤'}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
          />
          <button 
            className="send-btn-small"
            onClick={handleSend}
            disabled={!text.trim()}
          >
            ➤
          </button>
        </div>
      </div>

      {sttError && (
        <div className="stt-error">
          ⚠️ {sttError}
        </div>
      )}
    </div>
  );
}
