import { useState, useRef, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser';
import { useAI } from '../hooks/useAI';
import { generateUUID } from '../utils/uuid';
import { Oscilloscope } from './Oscilloscope';
import { MobileSettings, type InputMode } from './MobileSettings';
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
  onModeChange: _onModeChange,
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
  // Input mode: 'voice' uses Web Speech API only, 'visualizer' uses getUserMedia for oscilloscope only
  // This eliminates the dual microphone stream issue by making them mutually exclusive
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  
  const utteranceIdRef = useRef(generateUUID());
  const spokenUtterancesRef = useRef(new Set<string>());
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const lastViewedCountRef = useRef(0);
  // Separate text state for visualizer mode manual text entry
  const [visualizerText, setVisualizerText] = useState('');
  // Refs for effect optimization (issue #3) - avoid re-running on state changes
  const isListeningRef = useRef(false);
  const audioAnalyserActiveRef = useRef(false);

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

  // Keep refs in sync with state for effect optimization
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    audioAnalyserActiveRef.current = audioAnalyser.isActive;
  }, [audioAnalyser.isActive]);

  // Stop active mic when input mode changes
  // This ensures clean state transition when user switches modes in settings
  // Uses refs to read current state inside the effect, only re-running when inputMode changes
  // (Optimization: avoids unnecessary effect runs when isListening/isActive change)
  useEffect(() => {
    if (isListeningRef.current || audioAnalyserActiveRef.current) {
      stopListening();
      audioAnalyser.stop();
      if (sharedStreamRef.current) {
        sharedStreamRef.current.getTracks().forEach(track => track.stop());
        sharedStreamRef.current = null;
      }
    }
  }, [inputMode, audioAnalyser.stop, stopListening]);

  // Handle microphone toggle based on input mode.
  //
  // INPUT MODE DESIGN: To eliminate the dual microphone stream issue, speech recognition
  // and audio visualization are mutually exclusive:
  //
  // - 'voice' mode: Uses Web Speech API only (browser manages mic internally)
  //   Benefit: Native speech-to-text, no explicit getUserMedia call
  //   Tradeoff: No oscilloscope visualization
  //
  // - 'visualizer' mode: Uses getUserMedia for oscilloscope only
  //   Benefit: Real-time audio visualization
  //   Tradeoff: No speech recognition, manual text input required
  //
  // This design ensures only ONE microphone stream is active at any time,
  // eliminating resource waste and potential permission conflicts on mobile devices.
  const handleMicToggle = useCallback(async () => {
    // Stop current activity
    if (isListening || audioAnalyser.isActive) {
      stopListening();
      audioAnalyser.stop();
      if (sharedStreamRef.current) {
        sharedStreamRef.current.getTracks().forEach(track => track.stop());
        sharedStreamRef.current = null;
      }
      return;
    }

    if (inputMode === 'voice') {
      // Voice mode: Use Web Speech API only (browser manages mic internally)
      try {
        startListening();
      } catch (err) {
        console.error('[MobileMode] Speech recognition error:', err);
        setSttError(err instanceof Error ? err.message : 'Speech recognition failed');
      }
    } else {
      // Visualizer mode: Use getUserMedia for oscilloscope only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        sharedStreamRef.current = stream;
        await audioAnalyser.start(stream);
      } catch (err) {
        console.error('[MobileMode] Mic access error:', err);
        setSttError(err instanceof Error ? err.message : 'Microphone access denied');
        audioAnalyser.stop();
        if (sharedStreamRef.current) {
          sharedStreamRef.current.getTracks().forEach(track => track.stop());
          sharedStreamRef.current = null;
        }
      }
    }
  }, [isListening, audioAnalyser, inputMode, startListening, stopListening]);

  // Speak new final utterances when TTS is enabled (only from others)
  useEffect(() => {
    if (!ttsEnabled) return;

    for (const [id, utterance] of utterances) {
      if (utterance.senderId !== deviceId && !utterance.partial && !spokenUtterancesRef.current.has(id)) {
        spokenUtterancesRef.current.add(id);
        // Prevent unbounded growth: keep only recent IDs
        if (spokenUtterancesRef.current.size > 100) {
          const entries = Array.from(spokenUtterancesRef.current);
          spokenUtterancesRef.current = new Set(entries.slice(-50));
        }
        speak(utterance.text);
      }
    }
  }, [utterances, ttsEnabled, speak, deviceId]);

  // Handle manual text submission in visualizer mode
  const handleVisualizerSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    const trimmed = visualizerText.trim();
    if (!trimmed) return;
    
    sendText(utteranceIdRef.current, trimmed, false);
    setVisualizerText('');
    utteranceIdRef.current = generateUUID();
  }, [visualizerText, sendText]);

  // Connection status indicator
  const connectionStatus = connected ? 'connected' : 'disconnected';

  // Count unread messages (messages from others since last view)
  const totalOtherMessages = useMemo(() => 
    [...utterances.values()].filter(
      u => u.senderId !== deviceId && !u.partial
    ).length,
    [utterances.size, deviceId]
  );
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
          data-ws-state={connectionStatus}
        />
        <div className="walkie-header-spacer" />
        <button
          className={`walkie-header-btn input-mode-toggle ${inputMode === 'visualizer' ? 'visualizer-active' : ''}`}
          onClick={() => setInputMode(inputMode === 'voice' ? 'visualizer' : 'voice')}
          title={inputMode === 'voice' ? 'Switch to Visualizer mode' : 'Switch to Voice mode'}
          aria-label={inputMode === 'voice' ? 'Switch to Visualizer mode' : 'Switch to Voice mode'}
          aria-pressed={inputMode === 'visualizer'}
        >
          {inputMode === 'voice' ? '🗣️' : '📊'}
        </button>
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
        {/* Oscilloscope - only shown in visualizer mode */}
        {inputMode === 'visualizer' && (
          <div className="walkie-oscilloscope">
            <Oscilloscope
              analyser={audioAnalyser.analyser}
              dataArray={audioAnalyser.dataArray}
              isActive={audioAnalyser.isActive}
              width={280}
              height={100}
            />
          </div>
        )}

        {/* Status Text */}
        <div className="walkie-status">
          {sttError ? (
            <span className="walkie-error">⚠️ {sttError}</span>
          ) : inputMode === 'visualizer' ? (
            audioAnalyser.isActive ? (
              <span className="walkie-listening">Recording...</span>
            ) : (
              <span className="walkie-ready">Tap to record</span>
            )
          ) : interimText ? (
            <span className="walkie-interim">"{interimText}"</span>
          ) : isListening ? (
            <span className="walkie-listening">Listening...</span>
          ) : (
            <span className="walkie-ready">Tap to speak</span>
          )}
        </div>

        {/* Text input for visualizer mode (manual text entry) */}
        {inputMode === 'visualizer' && (
          <form className="walkie-text-form" onSubmit={handleVisualizerSubmit}>
            <input
              type="text"
              className="walkie-text-input"
              placeholder="Type message..."
              value={visualizerText}
              onChange={(e) => setVisualizerText(e.target.value)}
              aria-label="Type message to send"
            />
            <button
              type="submit"
              className="walkie-send-btn"
              disabled={!visualizerText.trim()}
              aria-label="Send message"
            >
              ➤
            </button>
          </form>
        )}

        {/* Large Mic Button */}
        <button
          className={`walkie-mic-btn ${(isListening || audioAnalyser.isActive) ? 'active' : ''}`}
          onClick={handleMicToggle}
          disabled={inputMode === 'voice' && !sttSupported}
          title={
            inputMode === 'visualizer'
              ? (audioAnalyser.isActive ? 'Stop recording' : 'Start recording')
              : (sttSupported ? (isListening ? 'Stop listening' : 'Start listening') : 'Speech recognition not supported')
          }
          aria-label={
            inputMode === 'visualizer'
              ? (audioAnalyser.isActive ? 'Stop recording' : 'Start recording')
              : (sttSupported ? (isListening ? 'Stop listening' : 'Start listening') : 'Speech recognition not supported')
          }
          aria-pressed={isListening || audioAnalyser.isActive}
        >
          <span className="mic-icon" aria-hidden="true">{(isListening || audioAnalyser.isActive) ? '🔴' : '🎤'}</span>
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
        inputMode={inputMode}
        onTtsChange={setTtsEnabled}
        onAutoSubmitChange={setAutoSubmit}
        onInputModeChange={setInputMode}
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
