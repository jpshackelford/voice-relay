import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useSttEngine } from '../hooks/useSttEngine';
import type { SttEngine } from '../hooks/useKioskConfig';
import { generateUUID } from '../utils/uuid';
import { parseOhTimestamp } from '../utils/parseOhTimestamp';
import { pairAgentEvents } from '../utils/pairAgentEvents';
import { QRCodeDisplay } from './QRCode';
import { AgentEventCard } from './AgentEventCard';
import { MarqueeTicker } from './MarqueeTicker';
import { OscilloscopeIndicator, deriveIndicatorState } from './OscilloscopeIndicator';
import { useFauxAudioActivity } from '../hooks/useFauxAudioActivity';
import { AgentHistoryStatus } from './AgentHistoryStatus';
import { AIRestartButton } from './AIRestartButton';
import { formatActionKind, isObservationKind } from '../utils/formatActionKind';
import { getActionIcon } from '../hooks/useAgentActions';
import type { DeviceInfo, DeviceMode, Utterance, DisplayContent, DisplayResultMessage, SessionTtsSettings, AgentAction, TimelineEntry } from '../types';
import type { AIState } from '../hooks/useAI';

/** Issue #340: clear the transcription ticker after this many ms of no new partials. */
const TRANSCRIPTION_TICKER_IDLE_MS = 5000;

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
  /**
   * Issue #388: report this kiosk's mic listening state to the server
   * so peers can aggregate the three-state indicator
   * (listening / muted / no-mic). Optional so tests and Storybook
   * fixtures don't have to plumb it through; when omitted, the kiosk
   * skips the outbound send but still renders the indicator from the
   * incoming `devices` list.
   */
  sendListeningState?: (listening: boolean, sttSupported: boolean) => void;
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
  /** Agent actions from OpenHands event stream */
  agentActions?: AgentAction[];
  /** Whether to show the agent actions panel */
  showAgentActions?: boolean;
  /** Callback to toggle agent actions visibility */
  onToggleAgentActions?: () => void;
  // === Issue #269: agent-event history hydration status ===
  /** True while the initial agent-event history fetch is in flight. */
  agentHistoryLoading?: boolean;
  /** True when the most recent server-side rehydration completed. */
  agentHistoryRehydrationComplete?: boolean;
  /** User-friendly error message from the history fetch (null on success). */
  agentHistoryError?: string | null;
  /** OH conversation id mapped to this session, or `null` if unmapped. */
  agentHistoryConversationId?: string | null;
  /** Retry the history fetch with `rehydrate=force`. */
  onRetryAgentHistory?: () => void;
  /**
   * Issue #340: when true, the kiosk renders two one-line ticker strips
   * along the bottom of the display:
   *   - bottom-left: live transcription of the active (non-self, non-AI) speaker
   *   - bottom-right: most recent AI agent action title
   * Defaults to false so workspaces that haven't opted in see no change.
   */
  kioskFooterTickersEnabled?: boolean;
  /**
   * Issue #410: STT engine for this kiosk. Resolved by the page
   * container as `device.config.stt_engine ?? kioskConfig.sttEngine ??
   * 'web-speech'`. The kiosk always mounts the wrapper hook
   * `useSttEngine`, which calls both `useSpeechRecognition` and
   * `useHostedSpeechRecognition` for React-rules-of-hooks safety and
   * routes the active engine based on this prop. Defaults to
   * `'web-speech'` so workspaces that haven't opted into hosted STT
   * see no change.
   */
  sttEngine?: SttEngine;
  /**
   * Issue #393: most recent kiosk-attention payload. When present, the
   * kiosk renders a transient `📱 <mobileDisplayName> connecting…`
   * banner so the user can confirm they targeted the right physical
   * screen in rooms with multiple visible kiosks.
   */
  attention?: { mobileDeviceId: string; mobileDisplayName: string; ttlMs: number; at: number } | null;
  /** Called by the kiosk after the banner has auto-dismissed. */
  onAttentionDismiss?: () => void;
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
  sendListeningState,
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
  agentActions = [],
  showAgentActions = false,
  onToggleAgentActions,
  agentHistoryLoading = false,
  agentHistoryRehydrationComplete = true,
  agentHistoryError = null,
  agentHistoryConversationId,
  onRetryAgentHistory,
  kioskFooterTickersEnabled = false,
  sttEngine = 'web-speech',
  attention = null,
  onAttentionDismiss,
}: KioskModeProps) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);  // Start collapsed per F3
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [qrDismissed, setQrDismissed] = useState(false);  // Allow dismissing QR screen without mobile scan
  // Queue display content when QR has priority (fixes #246)
  const [queuedDisplayContent, setQueuedDisplayContent] = useState<DisplayContent | null>(null);

  // Derive TTS enabled state from session settings (default to false if not set)
  const ttsEnabled = sessionTtsSettings?.enabled ?? false;
  
  const isMobile = useIsMobile();
  
  // Centralize mobileDevices and qrHasPriority calculation (used in multiple places)
  const mobileDevices = useMemo(() => devices.filter(d => d.mode === 'mobile'), [devices]);
  const qrHasPriority = useMemo(() => mobileDevices.length === 0 && !qrDismissed, [mobileDevices.length, qrDismissed]);
  
  const utteranceIdRef = useRef(generateUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the current display content URL to prevent duplicate result sends
  const lastReportedDisplayRef = useRef<string | null>(null);
  // Ref for auto-scrolling agent actions panel
  const actionsEndRef = useRef<HTMLDivElement>(null);

  // AI state is now passed from parent via props (wired to WebSocket in SessionView)
  //
  // The legacy `aiAvailable` startup probe was removed in #404 — the
  // `/api/ai/status` endpoint answered "is a process-wide OpenHands key
  // set?" which has no meaning once per-workspace keys are mandatory.
  // The AI status indicator below now gates purely on `ai.connecting ||
  // ai.connected`, both of which are driven by `session-state` broadcasts.

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
    onInterimResult: handleInterimResult,
    onFinalResult: handleFinalResult,
    onError: handleSttError,
  });

  // Issue #388: report this kiosk's mic listening state to the server so
  // peer devices see the same aggregate. Kiosks don't run getUserMedia
  // (only Web Speech), so `listening === isListening`. The effect fires
  // on mount (with the initial value) and on every flip; `connected` is
  // in the dep list so a reconnect re-sends the current state. The
  // `sendListeningState` helper is a no-op when the WS is not yet
  // registered, so a stale send during reconnect is harmless.
  useEffect(() => {
    sendListeningState?.(isListening, sttSupported);
  }, [isListening, sttSupported, connected, sendListeningState]);

  // Image load handlers for display feedback
  // Note: These use displayContent (the server-sent content) for tracking/reporting,
  // since handlers are only called when effectiveDisplayContent is actually rendered
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

  // Compute effective display content for image timeout effect
  const effectiveDisplayForTimeout = qrHasPriority ? null : (displayContent ?? queuedDisplayContent);

  // Set up timeout for slow-loading images (only when content is actually displayed)
  useEffect(() => {
    // Only set timeout for image content that's actually being displayed
    if (effectiveDisplayForTimeout?.type === 'image' && effectiveDisplayForTimeout.content) {
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
      const contentUrl = effectiveDisplayForTimeout.content;
      imageTimeoutRef.current = setTimeout(() => {
        // Only report timeout if we haven't already reported for this URL
        if (contentUrl && lastReportedDisplayRef.current !== contentUrl) {
          lastReportedDisplayRef.current = contentUrl;
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
  }, [effectiveDisplayForTimeout?.type, effectiveDisplayForTimeout?.content, onDisplayResult]);

  // Note: Browser-based TTS has been deprecated in favor of server-side ElevenLabs TTS.
  // The session-level ttsEnabled setting controls server-side TTS generation.
  // AI responses are synthesized server-side and streamed to the selected kiosk device(s).

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances]);

  // Auto-scroll agent actions panel to bottom
  useEffect(() => {
    if (showAgentActions) {
      actionsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [agentActions, showAgentActions]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Queue display content when QR has priority (fixes #246)
  // When QR is showing and new display content arrives, queue it for later.
  // When new displayContent arrives without QR priority, clear the queue.
  // Note: We intentionally don't clear queuedDisplayContent when QR priority ends - 
  // effectiveDisplayContent will use it via the fallback (displayContent ?? queuedDisplayContent).
  // This preserves queued content across the QR→content transition.
  useEffect(() => {
    if (qrHasPriority && displayContent) {
      // Queue the incoming display content while QR is showing
      setQueuedDisplayContent(displayContent);
    } else if (!qrHasPriority && displayContent) {
      // New displayContent arrived when QR doesn't have priority - clear queue
      setQueuedDisplayContent(null);
    }
    // When !qrHasPriority && !displayContent && queuedDisplayContent: 
    // Intentionally preserve queue - effectiveDisplayContent will show it
  }, [displayContent, qrHasPriority]);

  // Sort utterances by received time
  const sortedUtterances = [...utterances.values()].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  );

  // Create unified timeline by merging utterances and agent events.
  // Compute full timeline unconditionally - visibility filtering happens during render
  // (avoids re-sorting when toggling agent actions visibility).
  //
  // Agent events are paired before sorting: each ActionEvent is matched to its
  // matching ObservationEvent by `observation.action_id === action.id`, so the
  // sidebar renders one card per logical tool invocation (issue #265). The
  // paired entry sorts by the action's timestamp so the response stays under
  // the request that produced it even if the observation arrives milliseconds
  // later.
  const timeline: TimelineEntry[] = useMemo(() => {
    // Pre-compute timestamps to avoid creating Date objects on every sort comparison
    const entriesWithTime: Array<{ entry: TimelineEntry; time: number }> = [];

    // Add utterances with pre-computed timestamps
    for (const utterance of utterances.values()) {
      entriesWithTime.push({
        entry: { type: 'utterance', data: utterance },
        time: utterance.receivedAt.getTime(),
      });
    }

    // Pair agent events first, then add to the timeline. The pairing is
    // order-independent so it tolerates the WebSocket emitting the observation
    // immediately after the action with the same wall-clock timestamp
    // (issue #265).
    //
    // Use `parseOhTimestamp` instead of `new Date(...)` directly: OH historically
    // emits naive UTC ISO strings (no `Z`), which `new Date()` interprets as
    // local time in non-UTC browsers and pushes every agent event forward by
    // the local UTC offset (issue #264). The server now normalizes these on
    // the way out, but this is defense-in-depth in case a stray naive value
    // sneaks through (e.g. cross-version deploys).
    const pairedEvents = pairAgentEvents(agentActions);
    for (const { action, observation } of pairedEvents) {
      const parsed = parseOhTimestamp(action.timestamp);
      const actionTime = parsed ? parsed.getTime() : Date.now();
      entriesWithTime.push({
        entry: { type: 'agent-event', data: action, observation },
        time: actionTime,
      });
    }

    // Sort by pre-computed timestamps, then extract entries
    return entriesWithTime
      .sort((a, b) => a.time - b.time)
      .map(({ entry }) => entry);
  }, [utterances, agentActions]);

  // Filter timeline based on visibility - cheap operation compared to re-sorting
  const visibleTimeline = showAgentActions 
    ? timeline 
    : timeline.filter(e => e.type === 'utterance');

  // ============================================================
  // Issue #340: footer ticker derived state
  // ============================================================
  //
  // Transcription ticker: most recent utterance whose `senderId` is neither
  //   our own device nor the synthetic AI utterance. We follow the most
  //   recent message (partial or final) and clear it after
  //   `TRANSCRIPTION_TICKER_IDLE_MS` of staleness.
  // Action ticker: most recent `agentActions[]` entry's `summary` (or its
  //   formatted `kind` as a fallback). Cleared when an AI-sender utterance
  //   arrives _after_ the most recent action (the AI has handed the floor
  //   back to the human).
  const mostRecentForeignUtterance = useMemo<Utterance | null>(() => {
    let best: Utterance | null = null;
    for (const u of utterances.values()) {
      if (u.senderId === deviceId || u.senderId === 'ai') continue;
      if (!best || u.receivedAt.getTime() > best.receivedAt.getTime()) {
        best = u;
      }
    }
    return best;
  }, [utterances, deviceId]);

  // Idle-clear for the transcription ticker so the strip doesn't get stuck on a
  // final message from a speaker who has gone quiet. We use a piece of state +
  // setTimeout rather than referencing wall-clock in render so React stays
  // declarative.
  const [transcriptionStale, setTranscriptionStale] = useState(false);
  useEffect(() => {
    if (!mostRecentForeignUtterance) {
      setTranscriptionStale(true);
      return;
    }
    setTranscriptionStale(false);
    const timeout = window.setTimeout(
      () => setTranscriptionStale(true),
      TRANSCRIPTION_TICKER_IDLE_MS
    );
    return () => window.clearTimeout(timeout);
  }, [mostRecentForeignUtterance]);

  // Issue #382: the ticker now identifies the sender so a viewer can tell
  // which device said what. We carry the sender name through as a
  // separate `prefix` so MarqueeTicker can style it distinctly (heavier
  // weight, muted color via `.kiosk-ticker-speaker`) without touching the
  // existing overflow math.
  //
  // Same-sender suppression: when consecutive utterances come from the
  // same `senderId` (e.g. a partial growing into a final, or a speaker
  // saying two things back-to-back), we omit the prefix so the marquee
  // doesn't restart with a redundant "<name>: " on every frame. The ref
  // is updated inside an effect, never inside the memo, so React's
  // purity rules are preserved.
  const lastRenderedSenderIdRef = useRef<string | null>(null);
  const transcriptionTicker = useMemo<{ prefix: string; text: string }>(() => {
    if (!kioskFooterTickersEnabled || transcriptionStale) {
      return { prefix: '', text: '' };
    }
    const u = mostRecentForeignUtterance;
    if (!u) return { prefix: '', text: '' };
    // Issue #411: Prefer engine label (e.g. S1) over device name until
    // speaker resolves. Same-sender suppression stays on senderId.
    const speakerLabel = u.engineSpeakerLabel ?? u.senderName;
    const prefix =
      u.senderId === lastRenderedSenderIdRef.current ? '' : `${speakerLabel}: `;
    return { prefix, text: u.text };
  }, [kioskFooterTickersEnabled, transcriptionStale, mostRecentForeignUtterance]);

  // Track the last-rendered senderId after the render commits so the
  // next memo evaluation can compare against it. We also reset to null
  // when the strip clears so the next speaker's prefix re-appears even
  // if they happen to be the same sender as before the idle.
  useEffect(() => {
    if (transcriptionTicker.text.length === 0) {
      lastRenderedSenderIdRef.current = null;
      return;
    }
    lastRenderedSenderIdRef.current = mostRecentForeignUtterance?.senderId ?? null;
  }, [transcriptionTicker, mostRecentForeignUtterance]);

  // Issue #346 item 1 — faux audio activity for the left-side oscilloscope.
  // We don't have a real mic stream on the kiosk, so we derive a "pulse"
  // signal from transcription event arrival: any time the visible
  // transcription text changes (new partial, new utterance), bump the
  // pulse counter. The useFauxAudioActivity hook reads pulse and produces
  // a sine-wave dataArray whose amplitude decays back to flat-line.
  //
  // We key the pulse off `transcriptionTicker.text` so a same-sender
  // partial update still fires the pulse, and a prefix appearing /
  // disappearing on its own does not.
  const [fauxPulse, setFauxPulse] = useState(0);
  useEffect(() => {
    if (transcriptionTicker.text.length === 0) return;
    setFauxPulse((p) => p + 1);
  }, [transcriptionTicker.text]);
  const fauxAudio = useFauxAudioActivity({ pulse: fauxPulse });

  // Issue #388: three-state aggregation across mic-capable peers, recomputed
  // whenever the `device-list` payload changes. `deriveIndicatorState` is a
  // pure function (see OscilloscopeIndicator.ts) so it's cheap and easy
  // to unit-test from this component's test suite.
  const indicatorState = useMemo(() => deriveIndicatorState(devices), [devices]);
  const indicatorAriaLabel =
    indicatorState === 'listening' ? 'microphone active' :
    indicatorState === 'muted'     ? 'microphone muted'
                                   : 'no microphones';

  // Refinement 1 from the expansion: MessageEvent is filtered out before it
  // reaches `agentActions`. The AI reply lands in the utterance stream as a
  // synthetic `senderId === 'ai'` row instead, so that's where we look.
  // Memoized separately so we only re-scan the utterance map when it changes,
  // not on every render or when `agentActions` updates.
  const mostRecentAiUtteranceTime = useMemo(() => {
    let max = 0;
    for (const u of utterances.values()) {
      if (u.senderId !== 'ai') continue;
      const t = u.receivedAt.getTime();
      if (t > max) max = t;
    }
    return max;
  }, [utterances]);

  // Issue #346 item 4: mirror the sidebar AgentEventCard pattern in the ticker:
  //   - Skip observation-side entries entirely (their corresponding action
  //     already represents the work).
  //   - Prefix the action's display string with the kind-based emoji from
  //     `getActionIcon(kind)` for at-a-glance visual parity with the card view.
  //   - Append a green checkmark once the matching observation has arrived,
  //     correlated via `observation.action_id === action.id` — the canonical
  //     pairing key documented in `pairAgentEvents.ts`. We only need the
  //     most-recent-action's status here, not the full paired-timeline build,
  //     so we do a single linear scan instead of calling `pairAgentEvents()`.
  const actionTickerText = useMemo(() => {
    if (!kioskFooterTickersEnabled) return '';
    if (agentActions.length === 0) return '';

    // Find the most recent action-side entry (walk backwards, skipping
    // observations). The "most recent" semantic stays the same as before;
    // we just filter the observation half of each pair out of consideration.
    let lastAction: AgentAction | null = null;
    for (let i = agentActions.length - 1; i >= 0; i--) {
      const candidate = agentActions[i];
      if (isObservationKind(candidate.kind)) continue;
      lastAction = candidate;
      break;
    }
    if (!lastAction) return '';

    // Preserve the existing staleness gate: if the AI has spoken (synthetic
    // 'ai'-sender utterance) after this action, the AI handed the floor back
    // and the ticker should clear.
    const actionTime = parseOhTimestamp(lastAction.timestamp)?.getTime() ?? 0;
    if (mostRecentAiUtteranceTime > actionTime) return '';

    // Has the matching observation arrived? Scan once for any entry whose
    // `action_id` points at this action's id.
    let completed = false;
    for (const a of agentActions) {
      if (a.action_id === lastAction.id) {
        completed = true;
        break;
      }
    }

    const icon = getActionIcon(lastAction.kind);
    const title = lastAction.summary || formatActionKind(lastAction.kind);
    return `${icon} ${title}${completed ? ' ✅' : ''}`;
  }, [kioskFooterTickersEnabled, agentActions, mostRecentAiUtteranceTime]);

  const kioskDevices = devices.filter(d => d.mode === 'kiosk');

  // Effective display content: show queued content only when QR no longer has priority
  // This prevents AI greeting messages from dismissing the QR code before user can scan
  const effectiveDisplayContent = qrHasPriority ? null : (displayContent ?? queuedDisplayContent);

  // Validate selected device exists (gracefully fall back to 'all' if device disconnected)
  const selectedDeviceId = sessionTtsSettings?.outputDeviceId ?? null;
  const deviceExists = selectedDeviceId === null || kioskDevices.some(d => d.id === selectedDeviceId);
  const effectiveTtsDeviceValue = deviceExists ? (selectedDeviceId ?? 'all') : 'all';

  // Issue #393: auto-dismiss the kiosk-attention banner after ttlMs.
  useEffect(() => {
    if (!attention) return;
    const elapsed = Date.now() - attention.at;
    const remaining = Math.max(0, attention.ttlMs - elapsed);
    const t = window.setTimeout(() => onAttentionDismiss?.(), remaining);
    return () => window.clearTimeout(t);
  }, [attention, onAttentionDismiss]);

  // Banner rendered into both mobile + desktop kiosk layouts.
  const attentionBanner = attention ? (
    <div
      className="kiosk-attention-banner"
      role="status"
      aria-live="polite"
      data-testid="kiosk-attention-banner"
    >
      📱 {attention.mobileDisplayName} connecting…
    </div>
  ) : null;

  // On mobile, render a simplified conversation-only view
  if (isMobile) {
    return (
      <div className="kiosk-mode mobile">
        {attentionBanner}
        <header className="kiosk-header">
          <div className="device-info">
            <span className="device-name">🖥️ {displayName}</span>
          </div>
          <button className="exit-kiosk" onClick={() => onExit?.()} title="Exit to workspace">
            ✕
          </button>
        </header>
        
        {/* Connection indicator - solid dot in lower-left */}
        <div 
          className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />

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
            {(ai?.connecting || ai?.connected) && (
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
        <AIRestartButton ai={ai} />

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
      {attentionBanner}
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

        {/* Agent Events Toggle - Shows/hides agent events inline with messages */}
        <div className="kiosk-agent-toggle">
          <button
            className={`agent-events-toggle ${showAgentActions ? 'active' : ''}`}
            onClick={onToggleAgentActions}
            title={showAgentActions ? 'Hide agent events' : 'Show agent events inline'}
          >
            {showAgentActions ? '🔍 Hide Actions' : '🔍 Show Actions'}
            {!showAgentActions && agentActions.length > 0 && (
              <span className="action-badge">{agentActions.length}</span>
            )}
          </button>
        </div>
        {/* Issue #269: subtle inline status for the persisted-history hydration.
            Rendered only when relevant so the empty case stays clean. The live
            WS path is unaffected by any of these states. */}
        {showAgentActions && (
          <AgentHistoryStatus
            loading={agentHistoryLoading}
            error={agentHistoryError}
            rehydrationComplete={agentHistoryRehydrationComplete}
            conversationId={agentHistoryConversationId}
            actionCount={agentActions.length}
            onRetry={onRetryAgentHistory}
          />
        )}

        {/* Unified Timeline - Messages and agent events interleaved */}
        <div className="kiosk-messages">
          {visibleTimeline.length === 0 ? (
            <div className="no-messages">No messages yet</div>
          ) : (
            visibleTimeline.map((entry) => {
              if (entry.type === 'utterance') {
                const utterance = entry.data;
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
              } else {
                // Agent event - render as a single collapsible card that
                // combines the action with its paired observation when one
                // has arrived (issue #265).
                return (
                  <AgentEventCard
                    key={entry.data.id}
                    action={entry.data}
                    observation={entry.observation}
                  />
                );
              }
            })
          )}
          <div ref={messagesEndRef} />
          <div ref={actionsEndRef} />
        </div>

        <div className="kiosk-input-area">
          {interimText && (
            <div className="interim-text">
              <em>{interimText}</em>
            </div>
          )}
          <div className="kiosk-input-row">
            {/* AI status indicator (display only - AI auto-connects to session) */}
            {(ai?.connecting || ai?.connected) && (
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
        <AIRestartButton ai={ai} />
      </aside>

      {/* Drawer open button (visible when closed) */}
      {!drawerOpen && (
        <button className="drawer-open-btn" onClick={() => setDrawerOpen(true)} title="Open conversation">
          ▶
        </button>
      )}

      {/* Right side - Display area */}
      <main
        className={`kiosk-display ${drawerOpen ? '' : 'full-width'}`}
        data-tickers-enabled={kioskFooterTickersEnabled ? 'true' : 'false'}
      >
        {effectiveDisplayContent ? (
          effectiveDisplayContent.type === 'image' ? (
            <div className="display-image">
              {effectiveDisplayContent.title && <h1 className="display-title">{effectiveDisplayContent.title}</h1>}
              <img 
                src={effectiveDisplayContent.content} 
                alt={effectiveDisplayContent.title || 'Display'} 
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
              {imageLoadError && (
                <div className="image-error-indicator">
                  {imageLoadError === 'timeout' ? '⏱️ Image loading slowly...' : '⚠️ Image failed to load'}
                </div>
              )}
            </div>
          ) : effectiveDisplayContent.type === 'markdown' ? (
            <div className="display-markdown">
              {effectiveDisplayContent.title && <h1 className="display-title">{effectiveDisplayContent.title}</h1>}
              <div className="markdown-content" dangerouslySetInnerHTML={{ __html: parseMarkdown(effectiveDisplayContent.content || '') }} />
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

        {/*
          Connection status indicator. Issue #340 relocates this from
          bottom-left to upper-right (CSS-only change in App.css); the markup
          stays here so existing tests that look for `.connection-indicator`
          continue to work.
        */}
        <div 
          className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />

        {/* AI status indicator - bottom-right corner */}
        {(ai?.connecting || ai?.connected || ai?.thinking) && (
          <div className={`kiosk-ai-status ${
            ai?.connecting ? 'connecting' :
            ai?.thinking ? 'thinking' :
            'connected'
          }`}>
            {ai?.connecting ? '🔗' : ai?.thinking ? '🤔' : '✨'}
          </div>
        )}

        {/*
          Issue #340: footer ticker strips. Hidden when the workspace setting
          is off OR while the QR idle overlay is up (no visible kiosk content
          underneath them anyway). aria-live="off" on both — they double-
          announce with the existing message list otherwise.
        */}
        {kioskFooterTickersEnabled && !qrHasPriority && (
          <>
            {/*
              Issue #346 item 1: faux oscilloscope indicator anchored at the
              bottom-left of .kiosk-display. Visual counterpart to the
              .kiosk-ai-status sparkle on the bottom-right.

              Issue #388: the indicator is now three-state. The state is
              derived from the broadcast device list — `'listening'` keeps
              the original animated waveform, `'muted'` hides the waveform
              and renders a centered pause glyph, and `'no-mic'` dims the
              circle entirely (CSS via the data-state attribute). The
              "muted overrides faux pulse" rule lives inside
              `OscilloscopeIndicator` — when state is `'muted'` we render
              the glyph instead of the canvas, so the transcription pulse
              counter is ignored for that render.
            */}
            <div
              className="kiosk-oscilloscope-indicator"
              data-testid="kiosk-oscilloscope-indicator"
              data-state={indicatorState}
              aria-label={indicatorAriaLabel}
            >
              <OscilloscopeIndicator
                state={indicatorState}
                dataArray={fauxAudio.dataArray}
                isActive={fauxAudio.isActive}
                color="#3282b8"
              />
            </div>
            <div
              className="kiosk-ticker kiosk-ticker-transcription"
              aria-live="off"
            >
              {/*
                Issue #346 item 2: the transcription strip is a fixed-width
                marquee. As partial-update text grows, older content scrolls
                off the left edge instead of being ellipsis-truncated. The
                MarqueeTicker component owns the measure-and-translate math;
                we just feed it the latest text.
              */}
              <MarqueeTicker
                text={transcriptionTicker.text}
                prefix={transcriptionTicker.prefix}
                data-testid="kiosk-ticker-transcription"
                className="kiosk-ticker-text"
              />
            </div>
            <div
              className="kiosk-ticker kiosk-ticker-action"
              data-testid="kiosk-ticker-action"
              aria-live="off"
            >
              <span className="kiosk-ticker-text">{actionTickerText}</span>
            </div>
          </>
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
