import { useState, useRef, useCallback, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { generateUUID } from '../utils/uuid';
import { QRCodeDisplay } from './QRCode';
import type { DeviceInfo, DeviceMode, Utterance, DisplayContent, DisplayResultMessage, SessionTtsSettings } from '../types';
import type { AIState } from '../hooks/useAI';

// Configure marked for GitHub Flavored Markdown with line breaks
marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Default timeout for image loading (10 seconds) */
const IMAGE_LOAD_TIMEOUT_MS = 10000;

interface KioskModeProps {
  deviceId: string;
  displayName: string;
  connected: boolean;
  devices: DeviceInfo[];
  utterances: Map<string, Utterance>;
  displayContent: DisplayContent | null;
  sendText: (utteranceId: string, text: string, partial: boolean) => void;
  onModeChange: (mode: DeviceMode) => void;
  onAIStatusChange?: (connected: boolean) => void;
  onExit?: () => void;  // Navigate back to workspace home
  workspaceId?: string;
  sessionId?: string;
  ai?: AIState;  // AI state from parent (via useAI hook)
  /** Whether server-side TTS audio is currently playing */
  isAudioPlaying?: boolean;
  /** Callback to report display result (success/failure) */
  onDisplayResult?: (result: Omit<DisplayResultMessage, 'type'>) => void;
  /** Session-level TTS settings (synced across all devices) */
  sessionTtsSettings?: SessionTtsSettings | null;
  /** Callback to update session TTS settings */
  onSessionTtsSettingsChange?: (settings: SessionTtsSettings) => void;
}

// Hook to detect mobile devices
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  return isMobile;
}

export function KioskMode({ 
  deviceId,
  displayName, 
  connected, 
  devices, 
  utterances,
  displayContent,
  sendText, 
  onModeChange: _onModeChange,  // Kept for future "compact view" toggle
  onAIStatusChange,
  onExit,
  workspaceId,
  sessionId,
  ai,
  isAudioPlaying = false,
  onDisplayResult,
  sessionTtsSettings,
  onSessionTtsSettingsChange,
}: KioskModeProps) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);  // Start collapsed per F3
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [qrDismissed, setQrDismissed] = useState(false);  // Allow dismissing QR screen without mobile scan

  // Derive TTS enabled state from session settings (default to false if not set)
  const ttsEnabled = sessionTtsSettings?.enabled ?? false;
  
  const isMobile = useIsMobile();
  
  const utteranceIdRef = useRef(generateUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the current display content URL to prevent duplicate result sends
  const lastReportedDisplayRef = useRef<string | null>(null);

  // AI state is now passed from parent via props (wired to WebSocket in SessionView)

  // Check AI availability on mount
  useEffect(() => {
    ai?.checkAvailability().then(status => setAiAvailable(status.available));
  }, [ai]);

  // Notify parent of AI status changes
  useEffect(() => {
    onAIStatusChange?.(ai?.connected ?? false);
  }, [ai?.connected, onAIStatusChange]);

  const generateNewUtteranceId = useCallback(() => {
    utteranceIdRef.current = generateUUID();
  }, []);

  // Dismiss QR screen and show greeting state
  const handleDismissQr = useCallback(() => {
    setQrDismissed(true);
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
      // AI messages are forwarded server-side via session WebSocket
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

  // Image load handlers for display feedback
  const handleImageLoad = useCallback(() => {
    // Clear timeout since image loaded successfully
    if (imageTimeoutRef.current) {
      clearTimeout(imageTimeoutRef.current);
      imageTimeoutRef.current = null;
    }
    setImageLoadError(null);
    
    // Only send if this is a new display (prevent duplicates)
    const currentUrl = displayContent?.content;
    if (currentUrl && lastReportedDisplayRef.current !== currentUrl) {
      lastReportedDisplayRef.current = currentUrl;
      onDisplayResult?.({
        success: true,
        displayType: 'image',
      });
    }
  }, [displayContent?.content, onDisplayResult]);

  const handleImageError = useCallback(() => {
    // Clear timeout since we're already reporting an error
    if (imageTimeoutRef.current) {
      clearTimeout(imageTimeoutRef.current);
      imageTimeoutRef.current = null;
    }
    setImageLoadError('load-failed');
    
    // Only send if this is a new display (prevent duplicates)
    const currentUrl = displayContent?.content;
    if (currentUrl && lastReportedDisplayRef.current !== currentUrl) {
      lastReportedDisplayRef.current = currentUrl;
      onDisplayResult?.({
        success: false,
        error: 'load-failed',
        displayType: 'image',
      });
    }
  }, [displayContent?.content, onDisplayResult]);

  // Set up timeout for slow-loading images
  useEffect(() => {
    // Only set timeout for image content
    if (displayContent?.type === 'image' && displayContent.content) {
      // Clear any existing timeout
      if (imageTimeoutRef.current) {
        clearTimeout(imageTimeoutRef.current);
      }
      
      // Reset error state for new image
      setImageLoadError(null);
      
      // Reset tracking for new display - this allows the same URL to be reported
      // again when retried (e.g., after a network issue or user navigation)
      lastReportedDisplayRef.current = null;
      
      // Set timeout for image load
      imageTimeoutRef.current = setTimeout(() => {
        const currentUrl = displayContent.content;
        // Only report timeout if we haven't already reported for this URL
        if (currentUrl && lastReportedDisplayRef.current !== currentUrl) {
          lastReportedDisplayRef.current = currentUrl;
          setImageLoadError('timeout');
          onDisplayResult?.({
            success: false,
            error: 'timeout',
            displayType: 'image',
          });
        }
      }, IMAGE_LOAD_TIMEOUT_MS);
    } else {
      // Clear timeout and reset tracking for non-image content
      if (imageTimeoutRef.current) {
        clearTimeout(imageTimeoutRef.current);
        imageTimeoutRef.current = null;
      }
      lastReportedDisplayRef.current = null;
    }
    
    // Cleanup on unmount or display change
    return () => {
      if (imageTimeoutRef.current) {
        clearTimeout(imageTimeoutRef.current);
        imageTimeoutRef.current = null;
      }
    };
  }, [displayContent?.type, displayContent?.content, onDisplayResult]);

  // Note: Browser-based TTS has been deprecated in favor of server-side ElevenLabs TTS.
  // The session-level ttsEnabled setting controls server-side TTS generation.
  // AI responses are synthesized server-side and streamed to the selected kiosk device(s).

  // Auto-scroll chat to bottom
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

  const kioskDevices = devices.filter(d => d.mode === 'kiosk');
  // useWebSocket preserves devices during reconnection, so we can simply filter here
  // without needing additional state preservation logic in KioskMode
  const mobileDevices = devices.filter(d => d.mode === 'mobile');

  // Validate selected device exists (gracefully fall back to 'all' if device disconnected)
  const selectedDeviceId = sessionTtsSettings?.outputDeviceId ?? null;
  const deviceExists = selectedDeviceId === null || kioskDevices.some(d => d.id === selectedDeviceId);
  const effectiveTtsDeviceValue = deviceExists ? (selectedDeviceId ?? 'all') : 'all';

  // On mobile, render a simplified conversation-only view
  if (isMobile) {
    return (
      <div className="kiosk-mode mobile">
        <header className="kiosk-header">
          <div className="device-info">
            <span className="device-name">🖥️ {displayName}</span>
          </div>
          <button className="exit-kiosk" onClick={() => onExit?.()} title="Exit to workspace">
            ✕
          </button>
        </header>
        
        {/* Connection indicator - always visible in lower-right */}
        <div 
          className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        >
          🔌
        </div>

        <div className="kiosk-messages">
          {sortedUtterances.length === 0 ? (
            <div className="no-messages">No messages yet</div>
          ) : (
            sortedUtterances.map((utterance) => {
              const isOwnMessage = utterance.senderId === deviceId;
              return (
                <div 
                  key={utterance.id} 
                  className={`kiosk-message ${utterance.partial ? 'partial' : 'final'} ${isOwnMessage ? 'own-message' : ''}`}
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

        <div className="kiosk-input-area">
          {interimText && (
            <div className="interim-text">
              <em>{interimText}</em>
            </div>
          )}
          <div className="kiosk-input-row">
            {/* AI status indicator (display only - AI auto-connects to session) */}
            {aiAvailable && (ai?.connecting || ai?.connected) && (
              <div
                className={`ai-status ${ai?.connected ? 'active' : ''} ${ai?.connecting ? 'connecting' : ''} ${ai?.thinking ? 'thinking' : ''}`}
                title={ai?.connecting ? 'AI connecting...' : ai?.thinking ? 'AI thinking...' : 'AI connected'}
              >
                {ai?.connecting ? '🔗' : ai?.thinking ? '🤔' : '✨'}
              </div>
            )}
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
              placeholder={ai?.connected ? "Ask AI..." : "Type..."}
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

        {sttError && <div className="stt-error">⚠️ {sttError}</div>}
        {ai?.error && <div className="ai-error">⚠️ AI: {ai?.error}</div>}

        {/* Mobile AI status indicator */}
        {(ai?.connecting || ai?.connected || ai?.thinking) && (
          <div className={`ai-status-indicator ${
            ai?.connecting ? 'connecting' :
            ai?.thinking ? 'thinking' :
            'connected'
          }`}>
            {ai?.connecting ? '🔗' : ai?.thinking ? '🤔' : '✨'}
          </div>
        )}
      </div>
    );
  }

  // Desktop kiosk view with drawer
  return (
    <div className="kiosk-mode">
      {/* Left sidebar - Chat (now a drawer) */}
      <aside className={`kiosk-sidebar ${drawerOpen ? 'open' : 'closed'}`}>
        <header className="kiosk-header">
          <div className="device-info">
            <span className="device-name">🖥️ {displayName}</span>
          </div>
          <div className="header-buttons">
            <button className="drawer-toggle" onClick={() => setDrawerOpen(false)} title="Close drawer">
              ◀
            </button>
            <button className="exit-kiosk" onClick={() => onExit?.()} title="Exit to workspace">
              ✕
            </button>
          </div>
        </header>

        <div className="kiosk-status-row">
          <div className="kiosk-participants">
            {kioskDevices.length > 0 && (
              <span className="participant-group">🖥️ {kioskDevices.length}</span>
            )}
            {mobileDevices.length > 0 && (
              <span className="participant-group">📱 {mobileDevices.length}</span>
            )}
          </div>
          <div className="kiosk-tts-controls">
            <label title="Enable AI voice responses (server-side TTS)">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => onSessionTtsSettingsChange?.({
                  enabled: e.target.checked,
                  outputDeviceId: sessionTtsSettings?.outputDeviceId ?? null,
                })}
              />
              🔊 TTS {isAudioPlaying && '(speaking...)'}
            </label>
            {ttsEnabled && kioskDevices.length > 0 && (
              <select
                className="kiosk-tts-device-select"
                value={effectiveTtsDeviceValue}
                onChange={(e) => onSessionTtsSettingsChange?.({
                  enabled: ttsEnabled,
                  outputDeviceId: e.target.value === 'all' ? null : e.target.value,
                })}
                title="Select which device plays audio"
              >
                <option value="all">All kiosks</option>
                {kioskDevices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.id === deviceId ? '📍 This device' : d.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="kiosk-messages">
          {sortedUtterances.length === 0 ? (
            <div className="no-messages">No messages yet</div>
          ) : (
            sortedUtterances.map((utterance) => {
              const isOwnMessage = utterance.senderId === deviceId;
              return (
                <div 
                  key={utterance.id} 
                  className={`kiosk-message ${utterance.partial ? 'partial' : 'final'} ${isOwnMessage ? 'own-message' : ''}`}
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

        <div className="kiosk-input-area">
          {interimText && (
            <div className="interim-text">
              <em>{interimText}</em>
            </div>
          )}
          <div className="kiosk-input-row">
            {/* AI status indicator (display only - AI auto-connects to session) */}
            {aiAvailable && (ai?.connecting || ai?.connected) && (
              <div
                className={`ai-status ${ai?.connected ? 'active' : ''} ${ai?.connecting ? 'connecting' : ''} ${ai?.thinking ? 'thinking' : ''}`}
                title={ai?.connecting ? 'AI connecting...' : ai?.thinking ? 'AI thinking...' : 'AI connected'}
              >
                {ai?.connecting ? '🔗' : ai?.thinking ? '🤔' : '✨'}
              </div>
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
              title={autoSubmit ? 'Auto-send on' : 'Auto-send off'}
            >
              {autoSubmit ? '⚡' : '✏️'}
            </button>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={ai?.connected ? "Ask AI..." : "Type..."}
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
          <div className="stt-error">⚠️ {sttError}</div>
        )}

        {ai?.error && (
          <div className="ai-error">⚠️ AI: {ai?.error}</div>
        )}
      </aside>

      {/* Drawer open button (visible when closed) */}
      {!drawerOpen && (
        <button className="drawer-open-btn" onClick={() => setDrawerOpen(true)} title="Open conversation">
          ▶
        </button>
      )}

      {/* Right side - Display area */}
      <main className={`kiosk-display ${drawerOpen ? '' : 'full-width'}`}>
        {displayContent ? (
          displayContent.type === 'image' ? (
            <div className="display-image">
              {displayContent.title && <h1 className="display-title">{displayContent.title}</h1>}
              <img 
                src={displayContent.content} 
                alt={displayContent.title || 'Display'} 
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
              {imageLoadError && (
                <div className="image-error-indicator">
                  {imageLoadError === 'timeout' ? '⏱️ Image loading slowly...' : '⚠️ Image failed to load'}
                </div>
              )}
            </div>
          ) : displayContent.type === 'markdown' ? (
            <div className="display-markdown">
              {displayContent.title && <h1 className="display-title">{displayContent.title}</h1>}
              <div className="markdown-content" dangerouslySetInnerHTML={{ __html: parseMarkdown(displayContent.content || '') }} />
            </div>
          ) : null
        ) : mobileDevices.length > 0 || qrDismissed ? (
          // Connected state OR QR dismissed: show greeting + mini QR in corner
          <div className="display-greeting">
            <div className="greeting-content">
              <h1 className="greeting-title">Session Ready</h1>
              <p className="greeting-subtitle">
                {mobileDevices.length > 0
                  ? `📱 ${mobileDevices.length} device${mobileDevices.length > 1 ? 's' : ''} connected`
                  : 'No devices connected'}
              </p>
            </div>
            {/* Mini QR code in lower-right corner */}
            <div 
              className="mini-qr-overlay"
              onClick={() => setQrModalOpen(true)}
              title="Click to enlarge QR code"
            >
              <QRCodeDisplay 
                size={90} 
                workspaceId={workspaceId} 
                sessionId={sessionId} 
                showUrl={false}
              />
              <span className="mini-qr-hint">+ Add device</span>
            </div>
          </div>
        ) : (
          // Idle state: show large QR code for joining with Skip option
          <div className="display-idle-qr">
            <button 
              className="qr-skip-button" 
              onClick={handleDismissQr}
              aria-label="Skip QR code screen"
            >
              Skip →
            </button>
            <h2 className="idle-qr-title">Join this session</h2>
            <QRCodeDisplay 
              size={280} 
              workspaceId={workspaceId} 
              sessionId={sessionId} 
              showUrl={true}
              label="Scan to join on your phone"
            />
          </div>
        )}

        {/* Connection status indicator - plug icon (always visible, bottom-right) */}
        <div 
          className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        >
          🔌
        </div>

        {/* AI status indicator (above connection indicator when active) */}
        {(ai?.connecting || ai?.connected || ai?.thinking) && (
          <div className={`kiosk-ai-status ${
            ai?.connecting ? 'connecting' :
            ai?.thinking ? 'thinking' :
            'connected'
          }`}>
            {ai?.connecting ? '🔗' : ai?.thinking ? '🤔' : '✨'}
          </div>
        )}
      </main>

      {/* QR Code Modal (for manual trigger) */}
      {qrModalOpen && (
        <div className="qr-modal-overlay" onClick={() => setQrModalOpen(false)}>
          <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setQrModalOpen(false)}>✕</button>
            <h2>Scan to connect</h2>
            <QRCodeDisplay size={250} workspaceId={workspaceId} sessionId={sessionId} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Parse markdown to sanitized HTML using marked + DOMPurify.
 * Supports GFM tables, images, headers, bold/italic, code blocks, and links.
 * All output is sanitized to prevent XSS attacks.
 */
export function parseMarkdown(text: string): string {
  const rawHtml = marked.parse(text) as string;
  return DOMPurify.sanitize(rawHtml);
}
