import { useState, useRef, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSttEngine } from '../hooks/useSttEngine';
import type { SttEngine } from '../hooks/useKioskConfig';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser';
import { useAI } from '../hooks/useAI';
import { generateUUID } from '../utils/uuid';
import { reportClientError } from '../utils/reportClientError';
import { Oscilloscope } from './Oscilloscope';
import { MobileSettings, type InputMode } from './MobileSettings';
import { ConversationPane } from './ConversationPane';
import { KioskPicker } from './KioskPicker';
import type { DeviceInfo, DeviceMode, Utterance, SessionTtsSettings, DisplayContent } from '../types';

interface MobileModeProps {
  deviceId: string;
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  utterances: Map<string, Utterance>;
  sendText: (utteranceId: string, text: string, partial: boolean) => void;
  /**
   * Issue #388: report this mobile's mic listening state to the server.
   * Optional so existing test fixtures don't have to plumb it through.
   */
  sendListeningState?: (listening: boolean, sttSupported: boolean) => void;
  onModeChange: (mode: DeviceMode) => void;
  onAIStatusChange?: (connected: boolean) => void;
  sessionId?: string;
  /** Session-level TTS settings (synced across all devices) */
  sessionTtsSettings?: SessionTtsSettings | null;
  /** Callback to update session TTS settings */
  onSessionTtsSettingsChange?: (settings: SessionTtsSettings) => void;
  /**
   * Issue #393: when there are ≥2 kiosks in the workspace, the mobile
   * must pick which kiosk drives the new session. The chosen kiosk is
   * lifted to the parent so the WebSocket re-registers and the server
   * resolves to the kiosk-bound session.
   */
  targetKioskDeviceId?: string;
  /** Callback when the user picks (or switches) a kiosk. */
  onTargetKioskChange?: (kioskDeviceId: string) => void;
  /** Most recent kiosk display content — used as preview thumbnail. */
  displayContent?: DisplayContent | null;
  /**
   * Issue #392: workspace ID for the workspace-home shortcut. When provided
   * with `isOwner=true`, a 🏠 button appears in the mobile top bar that
   * navigates to `/workspace/${workspaceId}`.
   */
  workspaceId?: string;
  /** Whether the current user owns this workspace; gates the home shortcut. */
  isOwner?: boolean;
  /**
   * Issue #410: STT engine for this mobile device. Resolved by the
   * page container as `device.config.stt_engine ?? kioskConfig.sttEngine
   * ?? 'web-speech'`. Defaults to `'web-speech'` so workspaces that
   * haven't opted into hosted STT see no change. See `useSttEngine.ts`
   * for the wrapper's React-rules-of-hooks-safe routing and the
   * deepgram→web-speech transparent fallback.
   */
  sttEngine?: SttEngine;
}

export function MobileMode({ 
  deviceId,
  displayName, 
  connected, 
  devices, 
  utterances,
  sendText, 
  sendListeningState,
  onModeChange: _onModeChange,
  onAIStatusChange,
  sessionId,
  sessionTtsSettings,
  onSessionTtsSettingsChange,
  targetKioskDeviceId,
  onTargetKioskChange,
  displayContent,
  workspaceId,
  isOwner,
  sttEngine = 'web-speech',
}: MobileModeProps) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  // Input mode: 'voice' uses Web Speech API only, 'visualizer' uses getUserMedia for oscilloscope only,
  // 'unified' combines both - Web Speech API for transcription AND getUserMedia for oscilloscope visualization
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  
  const utteranceIdRef = useRef(generateUUID());
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const lastViewedCountRef = useRef(0);
  // Separate text state for visualizer mode manual text entry
  const [visualizerText, setVisualizerText] = useState('');
  // Refs for effect optimization (issue #3) - avoid re-running on state changes
  const isListeningRef = useRef(false);
  const audioAnalyserActiveRef = useRef(false);

  const ai = useAI({ sessionId });
  const audioAnalyser = useAudioAnalyser();

  // The legacy `aiAvailable` startup probe (calling `/api/ai/status`)
  // was removed in #404 once per-workspace OpenHands API keys became
  // mandatory. The AI status indicator below now gates purely on
  // `ai.connecting || ai.connected`, both of which are driven by
  // session-state broadcasts.

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

  // Issue #410: wrapper hook that always calls both useSpeechRecognition
  // and useHostedSpeechRecognition under the hood and dispatches to the
  // active engine. Without this, swapping engines at the consumer level
  // would violate React rules of hooks. Fallback semantics
  // (deepgram→web-speech, one-time warn, banner on 402/503) live inside
  // the wrapper — see useSttEngine.ts for the matrix.
  const { isListening, isSupported: sttSupported, startListening, stopListening } = useSttEngine({
    resolvedEngine: sttEngine,
    deviceId,
    workspaceId,
    // Issue #455: plumb sessionId through so the child STT hooks can
    // POST `/api/client-errors` on recognition errors.
    sessionId,
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

  // Issue #388: report the mobile's mic listening state to the server.
  // Mobile's "listening" is the OR of Web Speech (`isListening`) and the
  // raw audio analyser (`audioAnalyser.isActive`) — same expression
  // already used to drive the visualizer UI below. `sttSupported` is
  // the Web Speech support flag; an audio-only "visualizer" mode still
  // counts as mic-capable for aggregation purposes because the user can
  // still emit sound, so we OR the analyser availability in. Re-fires
  // on `connected` so a reconnect re-sends the current state.
  useEffect(() => {
    const listening = isListening || audioAnalyser.isActive;
    // The analyser hook exposes `isActive` only when it has successfully
    // attached to a mic stream; if `sttSupported` is true OR the
    // analyser is currently producing data, the device is mic-capable.
    const micCapable = sttSupported || audioAnalyser.isActive;
    sendListeningState?.(listening, micCapable);
  }, [isListening, audioAnalyser.isActive, sttSupported, connected, sendListeningState]);

  // Helper to clean up the shared audio stream
  const cleanupAudioStream = useCallback(() => {
    if (sharedStreamRef.current) {
      sharedStreamRef.current.getTracks().forEach(track => track.stop());
      sharedStreamRef.current = null;
    }
  }, []);

  // Stop active mic when input mode changes.
  //
  // Bug we're fixing: this effect's stated intent ("only re-run when
  // inputMode changes") didn't match its dep array, which included
  // `stopListening` and `cleanupAudioStream`. Both are unstable
  // because `useSttEngine` returns a fresh `stopListening` callback
  // every render — `useSttEngine`'s own `stopListening` `useCallback`
  // depends on the `hosted` and `ws` *objects* returned by the inner
  // hooks, and those return a new object literal each render. Net
  // effect: every render with a dep-identity shift re-fires this
  // effect; when `setIsListening(true)` ran inside `onstart`, the
  // re-render triggered the effect, the ref guard saw mic active,
  // and stopListening() got called ~2 ms after onstart — killing
  // STT and producing the iOS Safari `aborted/No speech detected`
  // we'd been chasing for two PRs.
  //
  // Fix: gate the body on an actual inputMode change tracked via a
  // ref. Callback deps stay in the dep array (lint compliance, and
  // they're cheap to keep there now that the body short-circuits).
  const prevInputModeRef = useRef(inputMode);
  useEffect(() => {
    if (prevInputModeRef.current === inputMode) return;
    prevInputModeRef.current = inputMode;
    if (isListeningRef.current || audioAnalyserActiveRef.current) {
      stopListening();
      audioAnalyser.stop();
      cleanupAudioStream();
    }
  }, [inputMode, audioAnalyser.stop, stopListening, cleanupAudioStream, audioAnalyser]);

  // Handle microphone toggle based on input mode.
  //
  // INPUT MODE DESIGN:
  //
  // - 'voice' mode: Uses Web Speech API only (browser manages mic internally)
  //   Benefit: Native speech-to-text, no explicit getUserMedia call
  //   Tradeoff: No oscilloscope visualization
  //
  // - 'visualizer' mode: Uses getUserMedia for oscilloscope only
  //   Benefit: Real-time audio visualization
  //   Tradeoff: No speech recognition, manual text input required
  //
  // - 'unified' mode: Uses BOTH Web Speech API AND getUserMedia simultaneously
  //   The Web Speech API manages its own internal mic stream for transcription,
  //   while getUserMedia provides a separate stream for the oscilloscope.
  //   Modern browsers handle two logical mic streams fine - it's the same physical mic.
  //   Benefit: Voice recognition + real-time visualization
  //   Tradeoff: Two mic permission requests on first use
  // Helper to start the audio visualizer (getUserMedia + analyser)
  const startAudioVisualizer = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sharedStreamRef.current = stream;
    await audioAnalyser.start(stream);
  }, [audioAnalyser]);

  const handleMicToggle = useCallback(async () => {
    // Stop current activity
    if (isListening || audioAnalyser.isActive) {
      stopListening();
      audioAnalyser.stop();
      cleanupAudioStream();
      return;
    }

    if (inputMode === 'voice') {
      // Voice mode: Use Web Speech API only (browser manages mic internally)
      try {
        startListening();
      } catch (err) {
        console.error('[MobileMode] Speech recognition error:', err);
        // Surface synchronous startListening() throws — most STT failures
        // fire async via onerror, but a non-conformant browser could raise here.
        reportClientError({
          sessionId,
          workspaceId,
          deviceId,
          source: 'MobileMode.startListening.voice',
          message: err instanceof Error ? err.message : 'Speech recognition failed',
        });
        setSttError(err instanceof Error ? err.message : 'Speech recognition failed');
      }
    } else if (inputMode === 'unified') {
      // Unified mode: Start BOTH Web Speech API AND getUserMedia for oscilloscope
      // These use separate logical streams to the same physical microphone
      try {
        startListening();
      } catch (err) {
        console.error('[MobileMode] Speech recognition error:', err);
        // Distinct `source` so log greps disambiguate this catch from the
        // 'voice' branch above.
        reportClientError({
          sessionId,
          workspaceId,
          deviceId,
          source: 'MobileMode.startListening.unified',
          message: err instanceof Error ? err.message : 'Speech recognition failed',
        });
        setSttError(err instanceof Error ? err.message : 'Speech recognition failed');
        return;
      }
      
      try {
        await startAudioVisualizer();
      } catch (err) {
        console.error('[MobileMode] Microphone access error:', err);
        setSttError(err instanceof Error ? err.message : 'Microphone access denied');
        stopListening(); // Speech is running, clean it up
        cleanupAudioStream();
      }
    } else {
      // Visualizer mode: Use getUserMedia for oscilloscope only
      try {
        await startAudioVisualizer();
      } catch (err) {
        console.error('[MobileMode] Mic access error:', err);
        setSttError(err instanceof Error ? err.message : 'Microphone access denied');
        audioAnalyser.stop();
        cleanupAudioStream();
      }
    }
    // Issue #457: sessionId/workspaceId/deviceId intentionally omitted from
    // deps to prevent rebuilds during WS session-id upgrade. Catch blocks
    // capture IDs synchronously (no async boundary), so dep omission is safe.
  }, [isListening, audioAnalyser, inputMode, startListening, stopListening, cleanupAudioStream, startAudioVisualizer]);

  // Note: Browser-based TTS has been deprecated in favor of server-side ElevenLabs TTS.
  // The session-level ttsEnabled setting controls server-side TTS generation.
  // AI responses are synthesized server-side and streamed to the selected kiosk device(s).
  // Get kiosk devices for the device dropdown in MobileSettings
  const kioskDevices = devices.filter(d => d.mode === 'kiosk');

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

  // Issue #393: the picker is shown only when:
  //   - there are ≥2 kiosks in the workspace, AND
  //   - the user hasn't already picked one (or that pick has disconnected).
  // Single-kiosk and no-kiosk cases fall through unchanged.
  const selectedKioskStillConnected =
    !!targetKioskDeviceId && kioskDevices.some((d) => d.id === targetKioskDeviceId);
  const needsKioskPick =
    !!onTargetKioskChange && kioskDevices.length >= 2 && !selectedKioskStillConnected;

  if (needsKioskPick) {
    return (
      <div className="mobile-mode mobile-walkie">
        <header className="walkie-header">
          <div
            className={`connection-dot ${connectionStatus}`}
            title={connected ? 'Connected' : 'Disconnected'}
            role="status"
            aria-label={connected ? 'Connected to server' : 'Disconnected from server'}
            data-ws-state={connectionStatus}
          />
          <div className="walkie-header-spacer" />
          <div className="walkie-display-name">{displayName}</div>
        </header>
        <KioskPicker
          kiosks={kioskDevices}
          selectedKioskId={targetKioskDeviceId}
          onSelect={(id) => onTargetKioskChange?.(id)}
          displayContent={displayContent}
        />
      </div>
    );
  }

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
          className={`walkie-header-btn input-mode-toggle ${inputMode !== 'voice' ? 'visualizer-active' : ''}`}
          onClick={() => setInputMode(
            inputMode === 'voice' ? 'unified' : 
            inputMode === 'unified' ? 'visualizer' : 'voice'
          )}
          title={
            inputMode === 'voice' ? 'Switch to Unified mode' : 
            inputMode === 'unified' ? 'Switch to Visualizer mode' : 'Switch to Voice mode'
          }
          aria-label={
            inputMode === 'voice' ? 'Switch to Unified mode' : 
            inputMode === 'unified' ? 'Switch to Visualizer mode' : 'Switch to Voice mode'
          }
          aria-pressed={inputMode !== 'voice'}
        >
          {inputMode === 'voice' ? '🗣️' : inputMode === 'unified' ? '✨' : '📊'}
        </button>
        {isOwner && workspaceId && (
          <button
            className="walkie-header-btn"
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            title="Workspace home"
            aria-label="Workspace home"
          >
            🏠
          </button>
        )}
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
        {/* Oscilloscope - shown in visualizer AND unified modes */}
        {(inputMode === 'visualizer' || inputMode === 'unified') && (
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
          ) : inputMode === 'unified' ? (
            interimText ? (
              <span className="walkie-interim">"{interimText}"</span>
            ) : isListening || audioAnalyser.isActive ? (
              <span className="walkie-listening">Listening...</span>
            ) : (
              <span className="walkie-ready">Tap to speak</span>
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
          disabled={(inputMode === 'voice' || inputMode === 'unified') && !sttSupported}
          title={
            inputMode === 'visualizer'
              ? (audioAnalyser.isActive ? 'Stop recording' : 'Start recording')
              : (sttSupported 
                  ? (isListening || audioAnalyser.isActive ? 'Stop listening' : 'Start listening') 
                  : 'Speech recognition not supported')
          }
          aria-label={
            inputMode === 'visualizer'
              ? (audioAnalyser.isActive ? 'Stop recording' : 'Start recording')
              : (sttSupported 
                  ? (isListening || audioAnalyser.isActive ? 'Stop listening' : 'Start listening') 
                  : 'Speech recognition not supported')
          }
          aria-pressed={isListening || audioAnalyser.isActive}
        >
          <span className="mic-icon" aria-hidden="true">{(isListening || audioAnalyser.isActive) ? '🔴' : '🎤'}</span>
        </button>

        {/* AI Status Badge */}
        {(ai.connecting || ai.connected) && (
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
        autoSubmit={autoSubmit}
        inputMode={inputMode}
        onAutoSubmitChange={setAutoSubmit}
        onInputModeChange={setInputMode}
        sessionTtsSettings={sessionTtsSettings}
        onSessionTtsSettingsChange={onSessionTtsSettingsChange}
        kioskDevices={kioskDevices}
        deviceId={deviceId}
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
