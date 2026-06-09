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

  // Issue #457: IDs stored in refs to prevent startListening rebuilds
  // when sessionId/workspaceId/deviceId change (iOS 18+ Safari treats
  // mid-start() rebuilds as external stop()). Mirrors useHostedSpeechRecognition.
  const sessionIdRef = useRef(sessionId);
  const workspaceIdRef = useRef(workspaceId);
  const deviceIdRef = useRef(deviceId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
    workspaceIdRef.current = workspaceId;
    deviceIdRef.current = deviceId;
  }, [sessionId, workspaceId, deviceId]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      onError?.('Speech recognition is not supported in this browser');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    // Per-cycle lifecycle markers, captured in the handler closures.
    // These let us attach actionable context to every [ClientError]
    // line: "did onstart ever fire?", "how long after start() did
    // this happen?", "did onend already run?". Critical for
    // diagnosing the iOS 18 Safari STT-abort pattern (#457): the
    // spurious aborts arrive before onstart and look identical to
    // a real abort in the journal without this context.
    const cycleStartedAt =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    let onstartSeen = false;
    let onendSeen = false;
    let abortReportedThisCycle = false;
    const msSince = () =>
      Math.round(
        (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()) - cycleStartedAt,
      );

    recognition.onstart = () => {
      onstartSeen = true;
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
        onFinalResult?.(finalTranscript);
      } else if (interimTranscript) {
        onInterimResult?.(interimTranscript);
      }
    };

    recognition.onerror = (event: Event & { error?: string }) => {
      const errorType = event.error || 'unknown';
      const lifecycle = {
        msSinceStart: msSince(),
        onstartSeen,
        onendSeen,
      };

      // WebKit Bug 225298: iOS Safari fires spurious `aborted` events
      // without explicit abort() calls (marked RESOLVED LATER upstream).
      // Suppress the user-facing banner and preserve isListening state
      // to prevent wedging STT. Emit one diagnostic per cycle for
      // production correlation.
      if (errorType === 'aborted') {
        if (!abortReportedThisCycle) {
          abortReportedThisCycle = true;
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

      console.error('[STT] Error:', event);

      let errorMessage = 'Speech recognition error';
      switch (errorType) {
        case 'not-allowed':
          errorMessage = 'Microphone access denied. Please allow microphone access in your browser settings.';
          break;
        case 'no-speech':
          errorMessage = 'No speech detected. Please try again.';
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

      onError?.(errorMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
      const sawStart = onstartSeen;
      onendSeen = true;
      // #457 follow-up diagnostic: `onend` firing without `onstart`
      // is the iOS Safari "STT silently failed" pattern. Distinct
      // from `aborted` (which fires on `onerror`) — this is the
      // browser ending the cycle quietly. Worth a single log line
      // per cycle so the journal can distinguish "Safari ate it"
      // from "user stopped intentionally".
      if (!sawStart) {
        // eslint-disable-next-line no-console
        console.warn('[STT] onend before onstart', { msSinceStart: msSince() });
        reportClientError({
          sessionId: sessionIdRef.current,
          workspaceId: workspaceIdRef.current,
          deviceId: deviceIdRef.current,
          source: 'useSpeechRecognition',
          errorCode: 'no-onstart',
          message: 'Recognition ended before onstart fired',
          context: { msSinceStart: msSince() },
        });
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported, onInterimResult, onFinalResult, onError]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
  };
}
