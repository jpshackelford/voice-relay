import { useState, useRef, useCallback, useEffect } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser';
import { useAI } from '../hooks/useAI';
import { generateUUID } from '../utils/uuid';
import { Oscilloscope } from './Oscilloscope';
import { MobileSettings } from './MobileSettings';
import { ConversationPane } from './ConversationPane';
import type { DeviceInfo, DeviceMode, Utterance } from '../types';

interface MobileModeProps {
  deviceId: string;
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  utterances: Map<string, Utterance>;
  sendText: (utteranceId: string, text: string, partial: boolean) => void;
  onModeChange: (mode: DeviceMode) => void;
  onAIStatusChange?: (connected: boolean) => void;
  sessionId?: string;
}

export function MobileMode({ 
  deviceId,
  displayName, 
  connected, 
  devices, 
  utterances,
  sendText, 
  onModeChange,
  onAIStatusChange,
  sessionId
}: MobileModeProps) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  
  const utteranceIdRef = useRef(generateUUID());
  const spokenUtterancesRef = useRef(new Set<string>());
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const lastViewedCountRef = useRef(0);

  const { speak, isSupported: ttsSupported } = useSpeechSynthesis();
  const ai = useAI({ sessionId });
  const audioAnalyser = useAudioAnalyser();

  // Memoize checkAvailability to avoid unstable dependency
  const checkAvailability = ai.checkAvailability;

  // Check AI availability on mount
  useEffect(() => {
    checkAvailability().then(status => setAiAvailable(status.available));
  }, [checkAvailability]);

  // Notify parent of AI status changes
  useEffect(() => {
    onAIStatusChange?.(ai.connected);
  }, [ai.connected, onAIStatusChange]);

  // Cleanup shared stream on unmount
  useEffect(() => {
    return () => {
      if (sharedStreamRef.current) {
        sharedStreamRef.current.getTracks().forEach(track => track.stop());
        sharedStreamRef.current = null;
      }
    };
  }, []);

  // Speech recognition handlers
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

  // Sync audio analyser with speech recognition state
  // Share a single MediaStream between analyser and speech recognition
  const handleMicToggle = useCallback(async () => {
    if (isListening) {
      stopListening();
      audioAnalyser.stop();
      // Stop shared stream tracks when done
      if (sharedStreamRef.current) {
        sharedStreamRef.current.getTracks().forEach(track => track.stop());
        sharedStreamRef.current = null;
      }
    } else {
      // Request mic once and share the stream
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        sharedStreamRef.current = stream;
        // Pass stream to analyser (it won't create its own)
        await audioAnalyser.start(stream);
        // Start speech recognition (browser caches mic permission)
        startListening();
      } catch (err) {
        console.error('[MobileMode] Mic access error:', err);
        setSttError(err instanceof Error ? err.message : 'Microphone access denied');
      }
    }
  }, [isListening, startListening, stopListening, audioAnalyser]);

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

  // Connection status indicator
  const connectionStatus = connected ? 'connected' : 'disconnected';

  // Count unread messages (messages from others since last view)
  const totalOtherMessages = [...utterances.values()].filter(
    u => u.senderId !== deviceId && !u.partial
  ).length;
  const unreadCount = Math.max(0, totalOtherMessages - lastViewedCountRef.current);

  // Reset unread count when conversation pane opens
  const handleConversationOpen = useCallback(() => {
    setConversationOpen(true);
    lastViewedCountRef.current = totalOtherMessages;
  }, [totalOtherMessages]);

  const handleConversationClose = useCallback(() => {
    setConversationOpen(false);
  }, []);

  // Device counts for settings
  const mobileCount = devices.filter(d => d.mode === 'mobile').length;
  const kioskCount = devices.filter(d => d.mode === 'kiosk').length;

  return (
    <div className="mobile-mode mobile-walkie">
      {/* Minimal Header */}
      <header className="walkie-header">
        <div 
          className={`connection-dot ${connectionStatus}`} 
          title={connected ? 'Connected' : 'Disconnected'}
          role="status"
          aria-label={connected ? 'Connected to server' : 'Disconnected from server'}
        />
        <div className="walkie-header-spacer" />
        <button 
          className="walkie-header-btn" 
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Open settings"
        >
          ⚙️
        </button>
        <button 
          className="walkie-header-btn conversation-btn" 
          onClick={handleConversationOpen}
          title="View conversation"
          aria-label={`View conversation${unreadCount > 0 ? `, ${unreadCount} unread messages` : ''}`}
        >
          💬
          {unreadCount > 0 && <span className="unread-badge" aria-hidden="true">{unreadCount}</span>}
        </button>
      </header>

      {/* Main Content */}
      <div className="walkie-content">
        {/* Oscilloscope */}
        <div className="walkie-oscilloscope">
          <Oscilloscope
            analyser={audioAnalyser.analyser}
            dataArray={audioAnalyser.dataArray}
            isActive={audioAnalyser.isActive}
            width={280}
            height={100}
          />
        </div>

        {/* Status Text */}
        <div className="walkie-status">
          {sttError ? (
            <span className="walkie-error">⚠️ {sttError}</span>
          ) : interimText ? (
            <span className="walkie-interim">"{interimText}"</span>
          ) : isListening ? (
            <span className="walkie-listening">Listening...</span>
          ) : (
            <span className="walkie-ready">Tap to speak</span>
          )}
        </div>

        {/* Large Mic Button */}
        <button
          className={`walkie-mic-btn ${isListening ? 'active' : ''}`}
          onClick={handleMicToggle}
          disabled={!sttSupported}
          title={sttSupported ? (isListening ? 'Stop listening' : 'Start listening') : 'Speech recognition not supported'}
          aria-label={sttSupported ? (isListening ? 'Stop listening' : 'Start listening') : 'Speech recognition not supported'}
          aria-pressed={isListening}
        >
          <span className="mic-icon" aria-hidden="true">{isListening ? '🔴' : '🎤'}</span>
        </button>

        {/* AI Status Badge */}
        {aiAvailable && (ai.connecting || ai.connected) && (
          <div className={`walkie-ai-badge ${ai.thinking ? 'thinking' : ''}`}>
            {ai.connecting ? '🔗 Connecting...' : ai.thinking ? '🤔 Thinking...' : '✨ AI Connected'}
          </div>
        )}

        {/* Device counts (subtle) */}
        <div className="walkie-devices">
          {mobileCount > 0 && <span>📱 {mobileCount}</span>}
          {kioskCount > 0 && <span>🖥️ {kioskCount}</span>}
        </div>
      </div>

      {/* Settings Modal */}
      <MobileSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        displayName={displayName}
        ttsEnabled={ttsEnabled}
        ttsSupported={ttsSupported}
        autoSubmit={autoSubmit}
        onTtsChange={setTtsEnabled}
        onAutoSubmitChange={setAutoSubmit}
        onModeChange={onModeChange}
      />

      {/* Conversation Pane */}
      <ConversationPane
        isOpen={conversationOpen}
        onClose={handleConversationClose}
        utterances={utterances}
        deviceId={deviceId}
      />

      {/* AI Error Toast */}
      {ai.error && (
        <div className="walkie-toast error">
          ⚠️ AI: {ai.error}
        </div>
      )}
    </div>
  );
}
