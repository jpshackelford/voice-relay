import { useCallback, useEffect, useRef, useState } from 'react';
import { reportClientError } from '../utils/reportClientError';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface UseSpeechRecognitionOptions {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  /**
   * Issue #455: optional session / workspace / device IDs. When all
   * three are present, `recognition.onerror` events are forwarded to
   * `POST /api/client-errors` via {@link reportClientError}. Absent
   * any of them, error reporting is silently skipped — the hook still
   * works exactly as it did before.
   */
  sessionId?: string;
  workspaceId?: string;
  deviceId?: string;
}

export function useSpeechRecognition({
  onInterimResult,
  onFinalResult,
  onError,
  sessionId,
  workspaceId,
  deviceId,
}: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isSupported] = useState(() => {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  });

  // IDs in refs so changes don't rebuild startListening (#457 / PR #460).
  const sessionIdRef = useRef(sessionId);
  const workspaceIdRef = useRef(workspaceId);
  const deviceIdRef = useRef(deviceId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
    workspaceIdRef.current = workspaceId;
    deviceIdRef.current = deviceId;
  }, [sessionId, workspaceId, deviceId]);

  // Latest callback refs — keeps the long-lived SpeechRecognition
  // event handlers from capturing a stale `onError` etc. across the
  // many `onend` -> `recognition.start()` restart cycles below.
  const onInterimResultRef = useRef(onInterimResult);
  const onFinalResultRef = useRef(onFinalResult);
  const onErrorRef = useRef(onError);
  useEffect(() => { onInterimResultRef.current = onInterimResult; }, [onInterimResult]);
  useEffect(() => { onFinalResultRef.current = onFinalResult; }, [onFinalResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // The user-intent flag — `true` from the moment `startListening` is
  // called until `stopListening` (or a hard error) flips it. This is
  // what gates the iOS Safari onend-restart loop. Critical: this is
  // NOT the same as `isListening`. `isListening` mirrors the actual
  // recognition state (briefly false between cycles); `userWantsListeningRef`
  // mirrors what the user clicked. The kiosk indicator wants the
  // latter, not the former.
  const userWantsListeningRef = useRef(false);
  // Backoff for retrying `recognition.start()` if it throws (e.g.
  // InvalidStateError when called while the previous cycle hasn't
  // fully ended). Tracked so unmount/stop can cancel cleanly.
  const restartRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRestartRetryTimer = useCallback(() => {
    if (restartRetryTimerRef.current !== null) {
      clearTimeout(restartRetryTimerRef.current);
      restartRetryTimerRef.current = null;
    }
  }, []);

  // Per-INTENT (one user tap -> one stop/hard-error) diagnostic dedup.
  // We don't want a wedged Safari to spam `/api/client-errors` once
  // per restart loop iteration. Reset by `startListening` (new intent)
  // and on a successful final result (proves Safari is healthy this
  // intent — re-arm so a later wedge still surfaces).
  const abortReportedThisIntentRef = useRef(false);
  const noOnstartReportedThisIntentRef = useRef(false);
  const intentStartedAtRef = useRef(0);
  const cycleNumRef = useRef(0);
  const onstartSeenThisIntentRef = useRef(false);

  const msSinceIntent = () =>
    Math.round(
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - intentStartedAtRef.current,
    );

  // Restart the SAME recognition instance — addpipe's pattern.
  // Constructing a new SpeechRecognition object between cycles is what
  // triggered the rapid post-onstart abort cascade we saw in the
  // post-#466 production journal.
  const tryRestart = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.start();
    } catch (_e) {
      // Common case: InvalidStateError because the previous cycle is
      // still in teardown. addpipe's demo silently retries; we do the
      // same with a tiny backoff so we don't busy-loop.
      clearRestartRetryTimer();
      restartRetryTimerRef.current = setTimeout(() => {
        restartRetryTimerRef.current = null;
        if (!userWantsListeningRef.current) return;
        try {
          recognitionRef.current?.start();
        } catch (e2) {
          // Give up — flip isListening false so the user knows.
          // eslint-disable-next-line no-console
          console.warn('[STT] restart retry failed', e2);
          userWantsListeningRef.current = false;
          setIsListening(false);
          reportClientError({
            sessionId: sessionIdRef.current,
            workspaceId: workspaceIdRef.current,
            deviceId: deviceIdRef.current,
            source: 'useSpeechRecognition',
            errorCode: 'restart-failed',
            message: e2 instanceof Error ? e2.message : 'recognition.start() retry failed',
            context: { msSinceIntent: msSinceIntent(), cycleNum: cycleNumRef.current },
          });
        }
      }, 100);
    }
  }, [clearRestartRetryTimer]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      onErrorRef.current?.('Speech recognition is not supported in this browser');
      return;
    }
    // New intent — reset per-intent dedup, cycle counter, lifecycle markers.
    userWantsListeningRef.current = true;
    abortReportedThisIntentRef.current = false;
    noOnstartReportedThisIntentRef.current = false;
    onstartSeenThisIntentRef.current = false;
    cycleNumRef.current = 0;
    intentStartedAtRef.current =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    clearRestartRetryTimer();

    // Reuse the existing instance if we have one — addpipe pattern.
    // Constructing a new object between cycles is what triggered the
    // rapid abort cascade in the post-#466 journal.
    if (recognitionRef.current) {
      tryRestart();
      return;
    }

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      onstartSeenThisIntentRef.current = true;
      cycleNumRef.current += 1;
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      if (finalTranscript) {
        // A real result means Safari is healthy this intent. Re-arm
        // the diagnostic dedup flags so a later wedge can still surface.
        abortReportedThisIntentRef.current = false;
        onFinalResultRef.current?.(finalTranscript);
      } else if (interimTranscript) {
        onInterimResultRef.current?.(interimTranscript);
      }
    };

    recognition.onerror = (event: Event & { error?: string }) => {
      const errorType = event.error || 'unknown';
      const lifecycle = {
        msSinceIntent: msSinceIntent(),
        cycleNum: cycleNumRef.current,
        onstartSeen: onstartSeenThisIntentRef.current,
      };

      // `no-speech` is a normal silence-timeout signal in continuous
      // mode — addpipe's working demo ignores it. Let onend handle
      // the restart (or not, depending on user intent).
      if (errorType === 'no-speech') {
        return;
      }

      // WebKit Bug 225298 spurious `aborted`: don't surface, dedupe
      // diagnostic to one per intent. onend will run next and restart
      // if the user still wants to listen.
      if (errorType === 'aborted') {
        if (!abortReportedThisIntentRef.current) {
          abortReportedThisIntentRef.current = true;
          // eslint-disable-next-line no-console
          console.warn('[STT] aborted (suppressed)', lifecycle);
          reportClientError({
            sessionId: sessionIdRef.current,
            workspaceId: workspaceIdRef.current,
            deviceId: deviceIdRef.current,
            source: 'useSpeechRecognition',
            errorCode: 'aborted-suppressed',
            message: 'iOS Safari spurious aborted (suppressed)',
            context: lifecycle,
          });
        }
        return;
      }

      // Hard error: surface, clear intent, no restart.
      console.error('[STT] Error:', event);
      let errorMessage = 'Speech recognition error';
      switch (errorType) {
        case 'not-allowed':
          errorMessage = 'Microphone access denied. Please allow microphone access in your browser settings.';
          break;
        case 'audio-capture':
          errorMessage = 'No microphone found. Please connect a microphone.';
          break;
        case 'network':
          errorMessage = 'Network error. Speech recognition requires an internet connection.';
          break;
        case 'service-not-allowed':
          errorMessage = 'Speech recognition not allowed. This may require HTTPS or localhost.';
          break;
      }

      reportClientError({
        sessionId: sessionIdRef.current,
        workspaceId: workspaceIdRef.current,
        deviceId: deviceIdRef.current,
        source: 'useSpeechRecognition',
        errorCode: errorType,
        message: errorMessage,
        context: lifecycle,
      });

      userWantsListeningRef.current = false;
      clearRestartRetryTimer();
      onErrorRef.current?.(errorMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
      // `onend` without `onstart` ever firing this intent is the
      // documented iOS Safari "silently dropped" pattern
      // (WebAudio/web-speech-api#96). Worth one diagnostic per intent.
      if (
        !onstartSeenThisIntentRef.current &&
        !noOnstartReportedThisIntentRef.current
      ) {
        noOnstartReportedThisIntentRef.current = true;
        // eslint-disable-next-line no-console
        console.warn('[STT] onend before onstart', { msSinceIntent: msSinceIntent() });
        reportClientError({
          sessionId: sessionIdRef.current,
          workspaceId: workspaceIdRef.current,
          deviceId: deviceIdRef.current,
          source: 'useSpeechRecognition',
          errorCode: 'no-onstart',
          message: 'Recognition ended before onstart fired',
          context: { msSinceIntent: msSinceIntent(), cycleNum: cycleNumRef.current },
        });
      }

      // The addpipe pattern: if the user still wants to listen,
      // restart the SAME instance. `setIsListening(true)` stays
      // sticky across cycles (the kiosk indicator must reflect user
      // intent, not the millisecond-scale recognition state churn).
      if (userWantsListeningRef.current) {
        tryRestart();
        return;
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[STT] initial start() threw, retrying', e);
      tryRestart();
    }
  }, [isSupported, tryRestart, clearRestartRetryTimer]);

  const stopListening = useCallback(() => {
    userWantsListeningRef.current = false;
    clearRestartRetryTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch (_e) {
        // ignore — stop() can throw if already stopped
      }
    }
    setIsListening(false);
  }, [clearRestartRetryTimer]);

  // Cleanup on unmount — kill the long-lived recognition so it
  // doesn't keep the mic alive after the React tree is gone.
  useEffect(() => {
    return () => {
      userWantsListeningRef.current = false;
      clearRestartRetryTimer();
      const rec = recognitionRef.current;
      if (rec) {
        try { rec.abort(); } catch (_e) { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, [clearRestartRetryTimer]);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
  };
}
