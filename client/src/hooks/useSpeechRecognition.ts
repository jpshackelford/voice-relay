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

    recognition.onstart = () => {
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
      console.error('[STT] Error:', event);
      const errorType = event.error || 'unknown';
      
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
      });

      onError?.(errorMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
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
