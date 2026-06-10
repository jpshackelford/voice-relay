/**
 * Unit tests for {@link useSttEngine}.
 *
 * On mocking the two child hooks:
 *   The wrapper's job is routing — pick which child hook drives the
 *   user-facing callbacks, plumb fallback semantics — and the two
 *   children (`useSpeechRecognition`, `useHostedSpeechRecognition`)
 *   are exhaustively unit-tested in their own files against real
 *   browser-API fakes. Re-mounting that full Fake infrastructure here
 *   would test the children twice while obscuring what we actually
 *   care about (the routing logic). Mocking the two children at the
 *   module boundary keeps the test focused, and we still exercise the
 *   wrapper's real code path end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type {
  HostedSpeechRecognitionError,
  UseHostedSpeechRecognitionOptions,
  UseHostedSpeechRecognitionReturn,
} from './useHostedSpeechRecognition';

// Captured live so each test can drive callbacks directly.
let wsOptions: { onInterimResult?: (t: string) => void; onFinalResult?: (t: string) => void; onError?: (e: string) => void } = {};
let hostedOptions: UseHostedSpeechRecognitionOptions | null = null;
let wsState = { isListening: false, isSupported: true };
let hostedState = { isListening: false, isSupported: true };
const wsStart = vi.fn(() => {
  wsState.isListening = true;
});
const wsStop = vi.fn(() => {
  wsState.isListening = false;
});
const hostedStart = vi.fn(async () => {
  hostedState.isListening = true;
});
const hostedStop = vi.fn(() => {
  hostedState.isListening = false;
});

vi.mock('./useSpeechRecognition', () => ({
  useSpeechRecognition: (opts: typeof wsOptions) => {
    wsOptions = opts;
    return {
      isListening: wsState.isListening,
      isSupported: wsState.isSupported,
      startListening: wsStart,
      stopListening: wsStop,
    };
  },
}));

vi.mock('./useHostedSpeechRecognition', () => ({
  useHostedSpeechRecognition: (opts: UseHostedSpeechRecognitionOptions): UseHostedSpeechRecognitionReturn => {
    hostedOptions = opts;
    return {
      isListening: hostedState.isListening,
      isSupported: hostedState.isSupported,
      startListening: hostedStart,
      stopListening: hostedStop,
      error: null,
    };
  },
}));

// Import after the mocks are registered.
import { useSttEngine } from './useSttEngine';

function resetSharedState() {
  wsOptions = {};
  hostedOptions = null;
  wsState = { isListening: false, isSupported: true };
  hostedState = { isListening: false, isSupported: true };
  wsStart.mockClear();
  wsStop.mockClear();
  hostedStart.mockClear();
  hostedStop.mockClear();
}

function makeHostedError(
  fallbackEligible: boolean,
  message: string,
  cause: HostedSpeechRecognitionError['cause'] = 'token-mint',
  bannerEligible = false,
): HostedSpeechRecognitionError {
  return { fallbackEligible, message, cause, bannerEligible };
}

describe('useSttEngine (issue #410)', () => {
  beforeEach(() => {
    resetSharedState();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('engine routing', () => {
    it('routes callbacks to Web Speech when resolvedEngine is web-speech', () => {
      const onInterim = vi.fn();
      const onFinal = vi.fn();
      const onError = vi.fn();
      renderHook(() =>
        useSttEngine({
          resolvedEngine: 'web-speech',
          deviceId: 'dev-1',
          onInterimResult: onInterim,
          onFinalResult: onFinal,
          onError,
        }),
      );

      // Web Speech receives the callbacks.
      expect(wsOptions.onInterimResult).toBe(onInterim);
      expect(wsOptions.onFinalResult).toBe(onFinal);
      expect(wsOptions.onError).toBe(onError);
      // Hosted receives undefined for the user callbacks (the
      // wrapper still handles its own error callback for fallback).
      expect(hostedOptions?.onInterimResult).toBeUndefined();
      expect(hostedOptions?.onFinalResult).toBeUndefined();
      // The hosted hook is still mounted (no conditional-hook violation).
      expect(hostedOptions).not.toBeNull();
    });

    it('routes callbacks to the hosted engine when resolvedEngine is deepgram', () => {
      const onInterim = vi.fn();
      const onFinal = vi.fn();
      const onError = vi.fn();
      renderHook(() =>
        useSttEngine({
          resolvedEngine: 'deepgram',
          deviceId: 'dev-1',
          onInterimResult: onInterim,
          onFinalResult: onFinal,
          onError,
        }),
      );

      expect(hostedOptions?.onInterimResult).toBe(onInterim);
      expect(hostedOptions?.onFinalResult).toBe(onFinal);
      // Web Speech receives undefined so it doesn't double-fire.
      expect(wsOptions.onInterimResult).toBeUndefined();
      expect(wsOptions.onFinalResult).toBeUndefined();
      // Web Speech is still mounted (rules of hooks).
      expect(wsStart).not.toHaveBeenCalled(); // not auto-started
    });

    it('startListening dispatches to the active engine', () => {
      type Engine = 'web-speech' | 'deepgram';
      const { result, rerender } = renderHook(
        ({ engine }: { engine: Engine }) =>
          useSttEngine({ resolvedEngine: engine, deviceId: 'dev-1' }),
        { initialProps: { engine: 'web-speech' as Engine } },
      );

      act(() => result.current.startListening());
      expect(wsStart).toHaveBeenCalledTimes(1);
      expect(hostedStart).not.toHaveBeenCalled();

      // Switch to hosted, restart.
      act(() => result.current.stopListening());
      rerender({ engine: 'deepgram' });
      act(() => result.current.startListening());
      expect(hostedStart).toHaveBeenCalledTimes(1);
    });

    it('stopListening stops both engines (so a downgrade mid-session is clean)', () => {
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );
      act(() => result.current.startListening());
      act(() => result.current.stopListening());
      expect(hostedStop).toHaveBeenCalledTimes(1);
      expect(wsStop).toHaveBeenCalledTimes(1);
    });

    it('exposes activeEngine = resolvedEngine before any fallback', () => {
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );
      expect(result.current.activeEngine).toBe('deepgram');
    });
  });

  describe('isListening / isSupported follow the active engine', () => {
    it('reads from the hosted hook when resolved=deepgram', () => {
      hostedState = { isListening: true, isSupported: true };
      wsState = { isListening: false, isSupported: false };
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );
      expect(result.current.isListening).toBe(true);
      expect(result.current.isSupported).toBe(true);
    });

    it('reads from the Web Speech hook when resolved=web-speech', () => {
      hostedState = { isListening: true, isSupported: true };
      wsState = { isListening: false, isSupported: false };
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'web-speech', deviceId: 'dev-1' }),
      );
      expect(result.current.isListening).toBe(false);
      expect(result.current.isSupported).toBe(false);
    });
  });

  describe('transparent fallback (deepgram → web-speech)', () => {
    it('downgrades and logs warn once on a fallback-eligible error', () => {
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1', onError }),
      );
      expect(result.current.activeEngine).toBe('deepgram');

      // Simulate the hosted hook surfacing an error (ws-close).
      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT connection closed (1006).', 'ws-close')),
      );

      expect(result.current.activeEngine).toBe('web-speech');
      expect(console.warn).toHaveBeenCalledTimes(1);
      // ws-close isn't in the banner set, so onError isn't called.
      expect(onError).not.toHaveBeenCalled();
    });

    it('dedupes the warning across multiple subsequent failures', () => {
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );

      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT connection closed (1006).', 'ws-close')),
      );
      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT upstream (Deepgram) error.')),
      );
      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT temporarily unavailable.')),
      );

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(result.current.activeEngine).toBe('web-speech');
    });

    it('surfaces 402 (cap-exhausted) to the banner via onError', () => {
      const onError = vi.fn();
      renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1', onError }),
      );
      act(() =>
        hostedOptions!.onError!(
          makeHostedError(true, 'Hosted STT monthly minute cap reached.', 'token-mint', true),
        ),
      );
      expect(onError).toHaveBeenCalledWith('Hosted STT monthly minute cap reached.');
    });

    it('surfaces 503 (missing-key) to the banner via onError', () => {
      const onError = vi.fn();
      renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1', onError }),
      );
      act(() =>
        hostedOptions!.onError!(
          makeHostedError(true, 'Hosted STT temporarily unavailable.', 'token-mint', true),
        ),
      );
      expect(onError).toHaveBeenCalledWith('Hosted STT temporarily unavailable.');
    });

    it('does not banner fallback-eligible errors that are not banner-eligible', () => {
      // Belt-and-suspenders: ws-close, transient 5xx, etc. carry
      // `bannerEligible: false` and must remain silent in the UI even
      // though the message itself happens to contain banner-eligible
      // substrings. This pins the contract to the explicit flag and
      // not to the message text.
      const onError = vi.fn();
      renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1', onError }),
      );
      act(() =>
        hostedOptions!.onError!(
          makeHostedError(true, 'Hosted STT monthly minute cap reached.', 'token-mint', false),
        ),
      );
      expect(onError).not.toHaveBeenCalled();
    });

    it('passes non-fallback-eligible errors through to onError without downgrade', () => {
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1', onError }),
      );
      act(() =>
        hostedOptions!.onError!(
          makeHostedError(false, 'Microphone access denied: NotAllowedError', 'mic-permission'),
        ),
      );
      expect(onError).toHaveBeenCalledWith('Microphone access denied: NotAllowedError');
      // No downgrade — the user has to fix permissions.
      expect(result.current.activeEngine).toBe('deepgram');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('auto-starts Web Speech after fallback if the user had clicked start', () => {
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );
      act(() => result.current.startListening());
      expect(hostedStart).toHaveBeenCalledTimes(1);
      expect(wsStart).not.toHaveBeenCalled();

      // Simulate a token-mint failure mid-session.
      act(() =>
        hostedOptions!.onError!(
          makeHostedError(true, 'Hosted STT token request failed: network error'),
        ),
      );
      // Fallback uses setTimeout(0) to defer the restart until the
      // hosted cleanup has settled.
      act(() => {
        vi.runAllTimers();
      });
      expect(wsStart).toHaveBeenCalledTimes(1);
    });

    it('does not auto-start Web Speech if the user has stopped before the failure', () => {
      const { result } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );
      act(() => result.current.startListening());
      act(() => result.current.stopListening());

      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT connection closed (1006).', 'ws-close')),
      );
      act(() => {
        vi.runAllTimers();
      });
      expect(wsStart).not.toHaveBeenCalled();
    });

    it('does not call wsStartRef after the component unmounts (race-condition guard)', () => {
      const { result, unmount } = renderHook(() =>
        useSttEngine({ resolvedEngine: 'deepgram', deviceId: 'dev-1' }),
      );
      act(() => result.current.startListening());
      // Fallback fires (auto-restart scheduled via setTimeout(0)) and
      // the component unmounts before the timer flushes.
      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT connection closed (1006).', 'ws-close')),
      );
      unmount();
      act(() => {
        vi.runAllTimers();
      });
      // The pending setTimeout must not call into Web Speech once the
      // component is gone — otherwise it would trigger state updates on
      // an unmounted child hook.
      expect(wsStart).not.toHaveBeenCalled();
    });

    it('stays on web-speech across renders after a fallback (no auto-upgrade)', () => {
      type Engine = 'web-speech' | 'deepgram';
      const { result, rerender } = renderHook(
        ({ engine }: { engine: Engine }) =>
          useSttEngine({ resolvedEngine: engine, deviceId: 'dev-1' }),
        { initialProps: { engine: 'deepgram' as Engine } },
      );
      act(() =>
        hostedOptions!.onError!(makeHostedError(true, 'Hosted STT connection closed (1006).', 'ws-close')),
      );
      expect(result.current.activeEngine).toBe('web-speech');

      // Even with the caller still passing 'deepgram', we stay downgraded.
      rerender({ engine: 'deepgram' });
      expect(result.current.activeEngine).toBe('web-speech');
    });
  });

  // Regression coverage for issue #471 — the root cause behind
  // #457 / #469. These two tests pin the contract: `useSttEngine`'s
  // public `startListening` / `stopListening` must keep their
  // identities stable across renders, *even when* the inner
  // `useSpeechRecognition` / `useHostedSpeechRecognition` hooks
  // return a fresh object literal each call (which they do in
  // production — see the comments above the ref block in
  // useSttEngine.ts).
  //
  // The vi.mock factories at the top of this file already return a
  // fresh `{ ... }` literal on every render — exactly the production
  // failure mode — so these tests exercise the real Option A path
  // without any extra mock setup.
  describe('callback identity stability (issue #471)', () => {
    // A factory so each call returns a fresh options object (the
    // same shape, different identity) — mirrors how `MobileMode` /
    // `KioskMode` re-build their options object on every render.
    const makeOptions = (overrides: Partial<Parameters<typeof useSttEngine>[0]> = {}) => ({
      resolvedEngine: 'deepgram' as const,
      deviceId: 'dev-1',
      ...overrides,
    });

    it('keeps startListening / stopListening identity stable across ≥5 renders with the same options', () => {
      const { result, rerender } = renderHook((props) => useSttEngine(props), {
        initialProps: makeOptions(),
      });
      const start0 = result.current.startListening;
      const stop0 = result.current.stopListening;

      // Force five re-renders with fresh-but-equivalent options
      // literals — exactly the pattern that triggered #457 before
      // #469's belt-and-suspenders patch and #471's structural fix.
      for (let i = 0; i < 5; i++) {
        rerender(makeOptions());
      }

      expect(result.current.startListening).toBe(start0);
      expect(result.current.stopListening).toBe(stop0);
    });

    it('keeps public callback identity stable even when inner-hook return identities change', () => {
      // The vi.mock factories already return a fresh literal each
      // call — that's the production failure mode this test pins
      // against. Here we additionally flip the mocked inner state so
      // React schedules a real re-render and re-invokes the inner
      // hooks (which return yet another fresh literal). Option A's
      // ref-indirection means the wrapper's public callbacks must
      // still point at the same function references.
      const { result, rerender } = renderHook((props) => useSttEngine(props), {
        initialProps: makeOptions(),
      });
      const start0 = result.current.startListening;
      const stop0 = result.current.stopListening;

      act(() => {
        wsState = { isListening: true, isSupported: true };
        hostedState = { isListening: true, isSupported: true };
      });
      rerender(makeOptions());

      expect(result.current.startListening).toBe(start0);
      expect(result.current.stopListening).toBe(stop0);
    });

    it('still dispatches to the active engine after re-renders (refs see latest state)', () => {
      // Sanity check: identity stability must not regress the
      // routing behavior. After multiple re-renders, calling the
      // (same-identity) startListening must still reach the
      // correct inner hook.
      const { result, rerender } = renderHook((props) => useSttEngine(props), {
        initialProps: makeOptions({ resolvedEngine: 'web-speech' }),
      });
      for (let i = 0; i < 3; i++) rerender(makeOptions({ resolvedEngine: 'web-speech' }));
      act(() => result.current.startListening());
      expect(wsStart).toHaveBeenCalledTimes(1);
      expect(hostedStart).not.toHaveBeenCalled();
    });

    it('reads the current engine via ref so a switch-then-start dispatches to the new engine', () => {
      // The `effectiveEngineRef` mirror is the subtle bit: callback
      // dispatch must see the *current* engine, not a stale
      // closure. This test would fail if `effectiveEngine` were
      // captured directly inside the stable `useCallback`.
      type Engine = 'web-speech' | 'deepgram';
      const { result, rerender } = renderHook(
        ({ engine }: { engine: Engine }) =>
          useSttEngine({ resolvedEngine: engine, deviceId: 'dev-1' }),
        { initialProps: { engine: 'web-speech' as Engine } },
      );
      const start0 = result.current.startListening;

      rerender({ engine: 'deepgram' });
      expect(result.current.startListening).toBe(start0); // still stable

      act(() => result.current.startListening());
      expect(hostedStart).toHaveBeenCalledTimes(1);
      expect(wsStart).not.toHaveBeenCalled();
    });
  });
});
