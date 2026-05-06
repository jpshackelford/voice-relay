import { useState, useRef, useCallback, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useAI } from '../hooks/useAI';
import { generateUUID } from '../utils/uuid';
import { ConnectionIndicator } from './ConnectionIndicator';
import type { DeviceInfo, Utterance } from '../types';

interface ConversationLayoutProps {
  deviceId: string;
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  utterances: Map<string, Utterance>;
  sendText: (utteranceId: string, text: string, partial: boolean) => void;
}

export function ConversationLayout({
  deviceId,
  displayName,
  connected,
  devices,
  utterances,
  sendText,
}: ConversationLayoutProps) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  const utteranceIdRef = useRef(generateUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spokenUtterancesRef = useRef(new Set<string>());
  const aiForwardedRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { speak, isSpeaking, isSupported: ttsSupported } = useSpeechSynthesis();
  const ai = useAI({ deviceId, mode: 'mobile' });

  // Check AI availability on mount
  useEffect(() => {
    ai.checkAvailability().then(status => setAiAvailable(status.available));
  }, [ai.checkAvailability]);

  const generateNewUtteranceId = useCallback(() => {
    utteranceIdRef.current = generateUUID();
  }, []);

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
      if (ai.connected) {
        ai.sendMessage(text);
      }
      setText('');
      generateNewUtteranceId();
    }
  };

  const handleInterimResult = useCallback((transcript: string) => {
    setInterimText(transcript);
    sendText(utteranceIdRef.current, text + transcript, true);
  }, [text, sendText]);

  const handleFinalResult = useCallback((transcript: string) => {
    const newText = text + transcript;
    setInterimText('');

    if (autoSubmit) {
      sendText(utteranceIdRef.current, newText.trim(), false);
      setText('');
      utteranceIdRef.current = generateUUID();
    } else {
      setText(newText + ' ');
      sendText(utteranceIdRef.current, newText + ' ', true);
    }
  }, [text, sendText, autoSubmit]);

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
      if (utterance.senderId !== deviceId && !utterance.partial && !spokenUtterancesRef.current.has(id)) {
        spokenUtterancesRef.current.add(id);
        speak(utterance.text);
      }
    }
  }, [utterances, ttsEnabled, speak, deviceId]);

  // Forward new messages from other devices to AI (if connected)
  useEffect(() => {
    if (!ai.connected) return;

    for (const [id, utterance] of utterances) {
      if (
        utterance.senderId !== deviceId &&
        utterance.senderId !== 'openhands-ai' &&
        !utterance.partial &&
        !aiForwardedRef.current.has(id)
      ) {
        aiForwardedRef.current.add(id);
        ai.sendMessage(utterance.text);
      }
    }
  }, [utterances, ai.connected, ai.sendMessage, deviceId]);

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

  const sortedUtterances = [...utterances.values()].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  );

  const mobileDevices = devices.filter(d => d.mode === 'mobile');
  const kioskDevices = devices.filter(d => d.mode === 'kiosk');

  return (
    <div className="conversation-layout">
      <header className="conversation-header">
        <div className="device-info">
          <span className="device-name">📱 {displayName}</span>
        </div>
      </header>

      <div className="conversation-participants">
        {mobileDevices.length > 0 && (
          <span className="participant-group">
            📱 {mobileDevices.length} mobile{mobileDevices.length !== 1 ? 's' : ''}
          </span>
        )}
        {kioskDevices.length > 0 && (
          <span className="participant-group">
            🖥️ {kioskDevices.length} kiosk{kioskDevices.length !== 1 ? 's' : ''}
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

      <div className="messages conversation-messages">
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

      <div className="conversation-input-area">
        {interimText && (
          <div className="interim-text">
            <em>{interimText}</em>
          </div>
        )}
        <div className="conversation-input-row">
          {aiAvailable && (
            <button
              className={`ai-toggle ${ai.connected ? 'active' : ''} ${ai.connecting ? 'connecting' : ''}`}
              onClick={ai.toggle}
              disabled={ai.connecting}
              title={ai.connected ? 'Disconnect AI' : ai.connecting ? 'Connecting...' : 'Connect AI assistant'}
            >
              {ai.connecting ? '⏳' : '✨'}
            </button>
          )}
          <button
            className={`stt-btn-small ${isListening ? 'listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
            disabled={!sttSupported}
            title={sttSupported ? (isListening ? 'Stop listening' : 'Start speech-to-text') : 'Speech recognition not supported'}
          >
            {isListening ? '🔴' : '🎤'}
          </button>
          <button
            className={`auto-submit-toggle ${autoSubmit ? 'active' : ''}`}
            onClick={() => setAutoSubmit(!autoSubmit)}
            title={autoSubmit ? 'Auto-send on: speech sends immediately' : 'Auto-send off: edit before sending'}
          >
            {autoSubmit ? '⚡' : '✏️'}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={ai.connected ? 'Ask the AI...' : 'Type a message...'}
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

      {ai.error && (
        <div className="ai-error">
          ⚠️ AI: {ai.error}
        </div>
      )}

      {(ai.connecting || ai.connected) && (
        <div className={`ai-status-indicator ${ai.connecting ? 'thinking' : 'connected'}`}>
          {ai.connecting ? '🤔' : '✨'}
        </div>
      )}

      {/* Connection status plug icon - always visible, lower-right corner */}
      <ConnectionIndicator connected={connected} />
    </div>
  );
}
