/**
 * Engine-selection wrapper that the Kiosk and Mobile modes mount in
 * place of a direct `useSpeechRecognition` call (issue #410, umbrella
 * #386).
 *
 * Why a wrapper at all?
 *   - The kiosk/mobile components must not change which hooks they
 *     call across re-renders, but the active STT implementation is a
 *     runtime configuration (workspace setting + optional per-device
 *     override).
 *   - This wrapper **always** calls both `useSpeechRecognition` (Web
 *     Speech) and `useHostedSpeechRecognition` (Deepgram). The
 *     inactive one is simply never asked to start, so it doesn't open
 *     a mic or a WebSocket — it just sits as a no-op subscriber. That
 *     keeps the hook order stable and the React rules of hooks
 *     happy without any conditional-hook tricks.
 *
 * Transparent fallback:
 *   - When the hosted engine emits an error with `fallbackEligible: true`
 *     (token mint 5xx, WS close, missing-key 503, cap-exhausted 402;
 *     see {@link ./useHostedSpeechRecognition.ts}), the wrapper flips
 *     its internal `effectiveEngine` to `'web-speech'` for the rest of
 *     the session and logs a single `console.warn`. Subsequent failures
 *     don't re-log (the AC's "one-time warning" requirement).
 *   - If the user was actively listening, the wrapper re-starts the
 *     Web Speech path so the device keeps transcribing without a
 *     visible interruption.
 *   - Cap-exhausted (402) and missing-key (503) messages additionally
 *     pass through to `onError` so the existing kiosk/mobile
 *     `sttError` banner surfaces them. Operators see a yellow banner
 *     in addition to the fallback being silent in audio.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechRecognition } from './useSpeechRecognition';
import {
  useHostedSpeechRecognition,
  type HostedSpeechRecognitionError,
} from './useHostedSpeechRecognition';
import type { SttEngine } from './useKioskConfig';

export interface UseSttEngineOptions {
  /**
   * Engine resolved by the caller — typically
   * `device.config.stt_engine ?? kioskConfig.sttEngine ?? 'web-speech'`.
   * Re-renders with a new value are honored, but a fallback
   * downgrade to `'web-speech'` always wins over a `'deepgram'`
   * caller value for the rest of the session.
   */
  resolvedEngine: SttEngine;
  /** Required when `resolvedEngine === 'deepgram'`. Forwarded to the hosted hook. */
  deviceId: string;
  /** Optional. Forwarded to the hosted hook for usage reporting. */
  workspaceId?: string;
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (message: string) => void;
  /**
   * Test injection — both child hooks are passed this when relevant.
   * Production callers leave it unset.
   */
  fetchImpl?: typeof fetch;
  /** Test injection — forwarded to the hosted hook. */
  deepgramWsUrl?: string;
}

export interface UseSttEngineReturn {
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  /**
   * The engine actually in use right now. Differs from
   * `options.resolvedEngine` when a fallback has fired
   * (`'deepgram'` → `'web-speech'`). Useful for tests / debug UI.
   */
  activeEngine: SttEngine;
}

export function useSttEngine(options: UseSttEngineOptions): UseSttEngineReturn {
  const {
    resolvedEngine,
    deviceId,
    workspaceId,
    onInterimResult,
    onFinalResult,
    onError,
    fetchImpl,
    deepgramWsUrl,
  } = options;

  // `effectiveEngine` follows `resolvedEngine` until a session-scoped
  // fallback fires. Once `hasFallenBackRef` is set, we ignore caller
  // attempts to re-mount the hosted engine until the component
  // unmounts — that matches the AC's session-scoped dedupe semantics
  // and prevents thrash if the caller's prop oscillates.
  const hasFallenBackRef = useRef(false);
  const [effectiveEngine, setEffectiveEngine] = useState<SttEngine>(resolvedEngine);
  const warnedRef = useRef(false);
  // Tracks whether the user has clicked "start" — needed to decide
  // whether a fallback should transparently kick off Web Speech.
  const userWantsListeningRef = useRef(false);
  // Guards the deferred Web Speech restart in `handleHostedError`
  // from firing after the component has unmounted (the setTimeout(0)
  // hop is enough of a window for unmount to land in between).
  const isMountedRef = useRef(true);
  const fallbackRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (fallbackRestartTimerRef.current !== null) {
        clearTimeout(fallbackRestartTimerRef.current);
        fallbackRestartTimerRef.current = null;
      }
    };
  }, []);

  // Follow caller's `resolvedEngine` unless we've already fallen back
  // for this session. Using a layout-style sync ensures the render
  // that observes a new `resolvedEngine` also observes the new
  // `effectiveEngine`, so `startListening` called in the same tick
  // dispatches to the right child hook.
  if (!hasFallenBackRef.current && effectiveEngine !== resolvedEngine) {
    setEffectiveEngine(resolvedEngine);
  }

  // Web Speech is always wired; it just never runs unless the
  // effective engine is web-speech.
  const ws = useSpeechRecognition({
    onInterimResult: effectiveEngine === 'web-speech' ? onInterimResult : undefined,
    onFinalResult: effectiveEngine === 'web-speech' ? onFinalResult : undefined,
    onError: effectiveEngine === 'web-speech' ? onError : undefined,
  });

  // Latest copies for the hosted-error handler — avoids stale-closure
  // bugs when the wrapper's onError changes mid-session.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const wsStartRef = useRef(ws.startListening);
  useEffect(() => {
    wsStartRef.current = ws.startListening;
  }, [ws.startListening]);

  const handleHostedError = useCallback((err: HostedSpeechRecognitionError) => {
    if (err.fallbackEligible) {
      // One-time warning per session — the AC says "logs a one-time
      // warning", not per fallback-cause. Subsequent failures stay silent.
      if (!warnedRef.current) {
        warnedRef.current = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[STT] Hosted engine failed — falling back to Web Speech for the rest of this session:',
          err.message,
        );
      }
      // Surface operator-actionable causes (cap-exhausted / missing-key)
      // to the kiosk/mobile sttError banner; see the bannerEligible
      // docstring on HostedSpeechRecognitionError.
      if (err.bannerEligible) {
        onErrorRef.current?.(err.message);
      }
      hasFallenBackRef.current = true;
      setEffectiveEngine('web-speech');
      // If the user clicked start before this failure, restart on
      // Web Speech so they don't have to click again.
      if (userWantsListeningRef.current) {
        // Defer to next tick so the hosted cleanup completes first.
        // setTimeout 0 is fine here — we just need to escape the
        // current render/onError callstack before mutating Web Speech.
        // Guard against unmount: a 0ms hop is enough to land after
        // the component has gone away, which would otherwise trigger
        // a setState-on-unmounted-component warning from Web Speech.
        fallbackRestartTimerRef.current = setTimeout(() => {
          fallbackRestartTimerRef.current = null;
          if (!isMountedRef.current) return;
          if (userWantsListeningRef.current) wsStartRef.current();
        }, 0);
      }
    } else {
      // Hard error: pass to caller so the banner shows; don't downgrade.
      onErrorRef.current?.(err.message);
    }
  }, []);

  const hosted = useHostedSpeechRecognition({
    deviceId,
    workspaceId,
    onInterimResult: effectiveEngine === 'deepgram' ? onInterimResult : undefined,
    onFinalResult: effectiveEngine === 'deepgram' ? onFinalResult : undefined,
    onError: handleHostedError,
    fetchImpl,
    deepgramWsUrl,
  });

  const startListening = useCallback(() => {
    userWantsListeningRef.current = true;
    if (effectiveEngine === 'deepgram') {
      // hosted.startListening is async, but the wrapper's signature
      // mirrors useSpeechRecognition (sync); fire-and-forget.
      void hosted.startListening();
    } else {
      ws.startListening();
    }
  }, [effectiveEngine, hosted, ws]);

  const stopListening = useCallback(() => {
    userWantsListeningRef.current = false;
    // Stop both — whichever isn't actually running treats stop as a
    // no-op. Cheaper than tracking "which one is mounted".
    hosted.stopListening();
    ws.stopListening();
  }, [hosted, ws]);

  return {
    isListening: effectiveEngine === 'deepgram' ? hosted.isListening : ws.isListening,
    // For "is this device capable of STT at all?" the right answer is
    // the active engine's support flag. When we've fallen back to Web
    // Speech but the device has no Web Speech (e.g. Firefox), the
    // button correctly disables.
    isSupported: effectiveEngine === 'deepgram' ? hosted.isSupported : ws.isSupported,
    startListening,
    stopListening,
    activeEngine: effectiveEngine,
  };
}
