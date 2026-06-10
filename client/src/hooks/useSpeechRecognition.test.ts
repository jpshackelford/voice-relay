import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from './useSpeechRecognition';
import * as reportClientErrorMod from '../utils/reportClientError';

interface FakeResult {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}

interface FakeResultList extends Array<FakeResult> {
  length: number;
}

interface FakeEvent {
  results: FakeResultList;
  resultIndex: number;
}

class FakeSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: FakeEvent) => void) | null = null;
  onerror: ((event: Event & { error?: string }) => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  static instances: FakeSpeechRecognition[] = [];

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }
}

function installSpeechRecognition(global: 'standard' | 'webkit' | 'none' = 'standard') {
  FakeSpeechRecognition.instances = [];
  Reflect.deleteProperty(window, 'SpeechRecognition');
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  if (global === 'standard') {
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    });
  } else if (global === 'webkit') {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    });
  }
}

function makeResults(parts: Array<{ transcript: string; isFinal: boolean }>): FakeResultList {
  const arr: FakeResult[] = parts.map(({ transcript, isFinal }) => ({
    isFinal,
    0: { transcript, confidence: 1 },
  }));
  // Behaves like SpeechRecognitionResultList for the hook's purposes.
  return arr as unknown as FakeResultList;
}

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    installSpeechRecognition('standard');
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    vi.restoreAllMocks();
  });

  it('reports supported when SpeechRecognition is on window', () => {
    const { result } = renderHook(() => useSpeechRecognition({}));
    expect(result.current.isSupported).toBe(true);
    expect(result.current.isListening).toBe(false);
  });

  it('reports supported when only webkitSpeechRecognition is available', () => {
    installSpeechRecognition('webkit');
    const { result } = renderHook(() => useSpeechRecognition({}));
    expect(result.current.isSupported).toBe(true);
  });

  it('reports unsupported and surfaces an error when starting without API', () => {
    installSpeechRecognition('none');
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));

    expect(result.current.isSupported).toBe(false);
    act(() => result.current.startListening());
    expect(onError).toHaveBeenCalledWith('Speech recognition is not supported in this browser');
    expect(result.current.isListening).toBe(false);
  });

  it('invokes onFinalResult for final transcripts and toggles isListening', () => {
    const onFinalResult = vi.fn();
    const onInterimResult = vi.fn();
    const { result } = renderHook(() =>
      useSpeechRecognition({ onFinalResult, onInterimResult })
    );

    act(() => result.current.startListening());

    const instance = FakeSpeechRecognition.instances[0];
    expect(instance.continuous).toBe(true);
    expect(instance.interimResults).toBe(true);
    expect(instance.lang).toBe('en-US');
    expect(instance.start).toHaveBeenCalled();

    act(() => instance.onstart?.());
    expect(result.current.isListening).toBe(true);

    act(() =>
      instance.onresult?.({
        resultIndex: 0,
        results: makeResults([{ transcript: 'hello world', isFinal: true }]),
      })
    );

    expect(onFinalResult).toHaveBeenCalledWith('hello world');
    expect(onInterimResult).not.toHaveBeenCalled();

    // After onend, the user still wants to listen — the addpipe-style
    // restart loop keeps isListening true and immediately reissues
    // recognition.start() on the same instance. Only an explicit
    // stopListening flips isListening to false.
    act(() => instance.onend?.());
    expect(result.current.isListening).toBe(true);

    act(() => result.current.stopListening());
    expect(result.current.isListening).toBe(false);
  });

  it('invokes onInterimResult when no final transcript exists in the event', () => {
    const onFinalResult = vi.fn();
    const onInterimResult = vi.fn();
    const { result } = renderHook(() =>
      useSpeechRecognition({ onFinalResult, onInterimResult })
    );

    act(() => result.current.startListening());
    const instance = FakeSpeechRecognition.instances[0];

    act(() =>
      instance.onresult?.({
        resultIndex: 0,
        results: makeResults([{ transcript: 'partial...', isFinal: false }]),
      })
    );

    expect(onInterimResult).toHaveBeenCalledWith('partial...');
    expect(onFinalResult).not.toHaveBeenCalled();
  });

  it('maps known error codes to friendly messages and resets listening', () => {
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useSpeechRecognition({ onError }));

    act(() => result.current.startListening());
    const instance = FakeSpeechRecognition.instances[0];
    act(() => instance.onstart?.());
    expect(result.current.isListening).toBe(true);

    act(() =>
      instance.onerror?.({ error: 'not-allowed' } as unknown as Event & { error?: string })
    );

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Microphone access denied'));
    expect(result.current.isListening).toBe(false);
  });

  // Note: `no-speech` is intentionally absent from this matrix. Per the
  // addpipe-pattern fix (see useSpeechRecognition.ts), `no-speech` is a
  // normal silence-timeout signal in continuous mode and is silently
  // ignored at the onerror site; onend handles the restart. Separate
  // test below covers the silent-no-speech contract.
  it.each([
    ['audio-capture', 'No microphone found'],
    ['network', 'Network error'],
    ['service-not-allowed', 'Speech recognition not allowed'],
    [undefined, 'Speech recognition error'],
  ])('error code %s yields the expected message', (code, expected) => {
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useSpeechRecognition({ onError }));
    act(() => result.current.startListening());
    const instance = FakeSpeechRecognition.instances[0];

    act(() => instance.onerror?.({ error: code } as unknown as Event & { error?: string }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining(expected));
  });

  it('forwards onerror to reportClientError when sessionId/workspaceId/deviceId are provided (#455)', () => {
    const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useSpeechRecognition({
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        deviceId: 'dev-1',
      }),
    );
    act(() => result.current.startListening());
    const instance = FakeSpeechRecognition.instances[0];
    // `network` is a canonical hard error — surfaces the banner AND
    // reports to /api/client-errors. `aborted` goes through the
    // suppression branch (covered separately); `no-speech` is now
    // silently ignored. `network` exercises the standard path.
    act(() => instance.onerror?.({ error: 'network' } as unknown as Event & { error?: string }));

    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        deviceId: 'dev-1',
        source: 'useSpeechRecognition',
        errorCode: 'network',
        message: expect.stringContaining('Network error'),
      }),
    );
  });

  it('skips reportClientError when IDs are not provided (#455)', () => {
    const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useSpeechRecognition({}));
    act(() => result.current.startListening());
    const instance = FakeSpeechRecognition.instances[0];
    // `network` exercises the canonical hard-error path. The helper
    // itself no-ops when IDs are missing, but we still call it from
    // the hook for consistency. Assert that it was invoked with
    // undefined IDs (proving the wiring exists) rather than making
    // the hook conditional.
    act(() => instance.onerror?.({ error: 'network' } as unknown as Event & { error?: string }));
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'useSpeechRecognition', errorCode: 'network' }),
    );
  });

  it('stopListening stops the underlying recognition instance', () => {
    const { result } = renderHook(() => useSpeechRecognition({}));
    act(() => result.current.startListening());
    const instance = FakeSpeechRecognition.instances[0];
    act(() => instance.onstart?.());

    act(() => result.current.stopListening());

    expect(instance.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });

  it('stopListening is safe before any startListening call', () => {
    const { result } = renderHook(() => useSpeechRecognition({}));
    expect(() => act(() => result.current.stopListening())).not.toThrow();
    expect(result.current.isListening).toBe(false);
  });

  // Issue #457: regression — on iOS 18 Safari, a sessionId/workspaceId/deviceId
  // change between recognition.start() and onstart caused startListening to
  // be rebuilt, which Safari interpreted as an external stop() on the in-flight
  // recognition instance and synthesized onerror({error:"aborted"}) BEFORE any
  // onstart. The fix reads those IDs through refs so startListening's identity
  // stays stable across ID changes.
  describe('#457 — startListening identity is stable across reporting-ID changes', () => {
    it('keeps startListening reference stable when sessionId changes', () => {
      const onInterimResult = vi.fn();
      const onFinalResult = vi.fn();
      const onError = vi.fn();
      const { result, rerender } = renderHook(
        (props: { sessionId?: string; workspaceId?: string; deviceId?: string }) =>
          useSpeechRecognition({
            onInterimResult,
            onFinalResult,
            onError,
            sessionId: props.sessionId,
            workspaceId: props.workspaceId,
            deviceId: props.deviceId,
          }),
        { initialProps: { sessionId: 'default', workspaceId: 'default', deviceId: 'dev-1' } },
      );

      const startBefore = result.current.startListening;
      rerender({ sessionId: 'real-session-uuid', workspaceId: 'real-ws-uuid', deviceId: 'dev-1' });
      const startAfter = result.current.startListening;

      expect(startAfter).toBe(startBefore);
    });

    it('does NOT tear down recognition when sessionId rerenders between start() and onstart', () => {
      const onError = vi.fn();
      const reportSpy = vi
        .spyOn(reportClientErrorMod, 'reportClientError')
        .mockImplementation(() => {});

      const { result, rerender } = renderHook(
        (props: { sessionId?: string }) =>
          useSpeechRecognition({
            onError,
            sessionId: props.sessionId,
            workspaceId: 'ws-1',
            deviceId: 'dev-1',
          }),
        { initialProps: { sessionId: 'default' } },
      );

      // 1. Start listening — Safari is now waiting for the user to grant mic perm.
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      expect(instance.start).toHaveBeenCalledTimes(1);
      expect(instance.stop).not.toHaveBeenCalled();
      expect(instance.abort).not.toHaveBeenCalled();

      // 2. Mid permission-dialog: the WS registration upgrades from the
      // default-workspace placeholder session id to the real one. This is
      // the exact transition that broke iOS 18 Safari pre-fix.
      rerender({ sessionId: 'real-session-uuid' });

      // 3. The recognition instance must NOT have been stopped or aborted by
      // a re-commit; no error should have been reported. (Lifecycle
      // firehose calls are expected — filter them out; we only care
      // about real errors here.)
      expect(instance.stop).not.toHaveBeenCalled();
      expect(instance.abort).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      const nonLifecycleReports = reportSpy.mock.calls
        .map((c) => c[0])
        .filter((c) => !c.errorCode?.startsWith('lifecycle:'));
      expect(nonLifecycleReports).toHaveLength(0);

      // 4. Now Safari fires onstart — STT proceeds normally.
      act(() => instance.onstart?.());
      expect(result.current.isListening).toBe(true);
    });

    it('reports the LATEST reporting IDs when onerror fires after a rerender', () => {
      // The point of the ref pattern is keeping the deps stable, NOT
      // capturing stale values. When onerror fires after a rerender,
      // reportClientError must see the most-recent sessionId.
      const reportSpy = vi
        .spyOn(reportClientErrorMod, 'reportClientError')
        .mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result, rerender } = renderHook(
        (props: { sessionId?: string }) =>
          useSpeechRecognition({
            sessionId: props.sessionId,
            workspaceId: 'ws-1',
            deviceId: 'dev-1',
          }),
        { initialProps: { sessionId: 'default' } },
      );

      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];

      rerender({ sessionId: 'real-session-uuid' });

      // `network` is a hard error that always reports — exercises the
      // ref-latest contract without depending on the silent-restart
      // behavior of `no-speech` / `aborted`.
      act(() =>
        instance.onerror?.({ error: 'network' } as unknown as Event & { error?: string }),
      );

      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'real-session-uuid',
          workspaceId: 'ws-1',
          deviceId: 'dev-1',
          source: 'useSpeechRecognition',
          errorCode: 'network',
        }),
      );
    });
  });

  // #457 follow-up: PR #460 fixed the deps-churn root cause but the
  // production journal still shows `code="aborted"` events on the same
  // device (e.g. session 7952519e-… on 2026-06-09T21:25Z). The spec
  // says `aborted` only fires on explicit `abort()` — we never call
  // it — so any `aborted` we observe is the browser misbehaving. This
  // block locks in the suppression contract.
  describe('#457 follow-up — aborted errors are suppressed', () => {
    it('does NOT surface aborted to onError or flip isListening on aborted', () => {
      const onError = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useSpeechRecognition({ onError }));
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());
      expect(result.current.isListening).toBe(true);

      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));

      // Banner suppressed, state untouched — onend (if it fires)
      // is the only thing that flips isListening back to false.
      expect(onError).not.toHaveBeenCalled();
      expect(result.current.isListening).toBe(true);
    });

    it('reports a single `aborted-suppressed` diagnostic per startListening cycle', () => {
      const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useSpeechRecognition({ sessionId: 's', workspaceId: 'w', deviceId: 'd' }),
      );
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];

      // Four back-to-back aborts (the production pattern at 21:25Z).
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));

      const abortReports = reportSpy.mock.calls
        .map((c) => c[0])
        .filter((c) => c.errorCode === 'aborted-suppressed');
      expect(abortReports).toHaveLength(1);
      // New lifecycle shape (per-intent rather than per-cycle):
      // `msSinceIntent` replaces `msSinceStart`; `cycleNum` counts
      // onstart firings inside the same intent. `onstartSeen` reflects
      // intent-scoped state too.
      expect(abortReports[0]).toEqual(
        expect.objectContaining({
          source: 'useSpeechRecognition',
          errorCode: 'aborted-suppressed',
          context: expect.objectContaining({
            onstartSeen: false,
            cycleNum: expect.any(Number),
            msSinceIntent: expect.any(Number),
          }),
        }),
      );
    });

    it('resets the once-per-intent guard on the next startListening call', () => {
      // addpipe pattern: the SAME SpeechRecognition instance is reused
      // across onend-restart cycles within one intent. A fresh
      // `startListening()` is treated as a new intent and resets the
      // diagnostic dedup. So: 2 aborts in intent A + 2 aborts in
      // intent B = 2 reports total.
      const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useSpeechRecognition({ sessionId: 's', workspaceId: 'w', deviceId: 'd' }),
      );

      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      // Intent A: 2 aborts -> 1 report (deduped).
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));

      // Stop & re-tap -> new intent. Same instance is reused, but
      // the dedup flag is cleared.
      act(() => result.current.stopListening());
      act(() => result.current.startListening());

      // Intent B: 2 more aborts -> 1 more report.
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));
      act(() => instance.onerror?.({ error: 'aborted' } as unknown as Event & { error?: string }));

      const abortReports = reportSpy.mock.calls
        .map((c) => c[0])
        .filter((c) => c.errorCode === 'aborted-suppressed');
      expect(abortReports).toHaveLength(2);
      // Confirm we did NOT construct a second SpeechRecognition object
      // — the whole point of the addpipe pattern is to keep the same
      // instance across intents.
      expect(FakeSpeechRecognition.instances).toHaveLength(1);
    });

    it('still reports non-aborted errors and includes lifecycle context', () => {
      const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useSpeechRecognition({ sessionId: 's', workspaceId: 'w', deviceId: 'd' }),
      );
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());
      act(() => instance.onerror?.({ error: 'network' } as unknown as Event & { error?: string }));

      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'network',
          context: expect.objectContaining({
            onstartSeen: true,
            cycleNum: expect.any(Number),
            msSinceIntent: expect.any(Number),
          }),
        }),
      );
    });

    it('emits a `no-onstart` diagnostic when onend fires before onstart', () => {
      const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useSpeechRecognition({ sessionId: 's', workspaceId: 'w', deviceId: 'd' }),
      );
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];

      // Safari silently ends the cycle — no onstart was ever seen.
      act(() => instance.onend?.());

      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'useSpeechRecognition',
          errorCode: 'no-onstart',
          context: expect.objectContaining({
            msSinceIntent: expect.any(Number),
            cycleNum: expect.any(Number),
          }),
        }),
      );

      // Cleanup — onend triggered an auto-restart attempt because
      // userWantsListening is still true. Stop so we don't leave
      // recognition wired across test boundaries.
      act(() => result.current.stopListening());
    });

    it('does NOT emit `no-onstart` on a normal onstart -> onend cycle', () => {
      const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useSpeechRecognition({ sessionId: 's', workspaceId: 'w', deviceId: 'd' }),
      );
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());
      act(() => instance.onend?.());

      const noOnstartReports = reportSpy.mock.calls
        .map((c) => c[0])
        .filter((c) => c.errorCode === 'no-onstart');
      expect(noOnstartReports).toHaveLength(0);

      act(() => result.current.stopListening());
    });
  });

  // The actual fix for the iOS 18 Safari "mic icon never lights up,
  // no transcripts" failure: addpipe.com / MDN-style restart loop.
  // After PR #466 we suppressed the `aborted` banner but Safari was
  // still ending the recognition cycle within ~50 ms of onstart with
  // no transcript. The journal showed `onstartSeen:true` on every
  // abort. The cure is the canonical Web Speech pattern used by
  // working iOS demos: keep the SAME SpeechRecognition instance and
  // call `recognition.start()` again inside `onend` whenever the
  // user still wants to listen. This block locks in that contract.
  describe('iOS Safari restart loop (addpipe / MDN pattern)', () => {
    it('restarts the same instance on onend when the user still wants to listen', () => {
      const { result } = renderHook(() => useSpeechRecognition({}));
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      expect(instance.start).toHaveBeenCalledTimes(1);

      act(() => instance.onstart?.());
      // Simulate Safari ending the cycle (silence timeout, spurious
      // aborted-then-end, whatever). userWantsListening is true.
      act(() => instance.onend?.());

      // SAME instance, `.start()` called a second time. No new
      // SpeechRecognition object was constructed.
      expect(FakeSpeechRecognition.instances).toHaveLength(1);
      expect(instance.start).toHaveBeenCalledTimes(2);
      // The kiosk indicator must not flicker — isListening sticks to
      // user intent, not the millisecond-scale cycle churn.
      expect(result.current.isListening).toBe(true);
    });

    it('does NOT restart after onend once stopListening has been called', () => {
      const { result } = renderHook(() => useSpeechRecognition({}));
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());

      act(() => result.current.stopListening());
      // Safari may still fire a final onend after we call stop().
      act(() => instance.onend?.());

      // Only the initial start() call — no restart loop kicked in.
      expect(instance.start).toHaveBeenCalledTimes(1);
      expect(result.current.isListening).toBe(false);
    });

    it('silently restarts on `no-speech` instead of surfacing a banner', () => {
      // addpipe.com explicitly: `if (event.error === "no-speech") return;`
      // We do the same. `no-speech` is a normal silence-timeout signal,
      // not an error worth bothering the user about.
      const onError = vi.fn();
      const reportSpy = vi.spyOn(reportClientErrorMod, 'reportClientError').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useSpeechRecognition({ onError, sessionId: 's', workspaceId: 'w', deviceId: 'd' }),
      );
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());

      act(() => instance.onerror?.({ error: 'no-speech' } as unknown as Event & { error?: string }));
      // The follow-on onend then triggers the restart loop.
      act(() => instance.onend?.());

      expect(onError).not.toHaveBeenCalled();
      // No /api/client-errors POST for `no-speech` — we don't want to
      // flood the journal with every silence interval.
      const noSpeechReports = reportSpy.mock.calls
        .map((c) => c[0])
        .filter((c) => c.errorCode === 'no-speech');
      expect(noSpeechReports).toHaveLength(0);
      // Restart did happen.
      expect(instance.start).toHaveBeenCalledTimes(2);
      expect(result.current.isListening).toBe(true);

      act(() => result.current.stopListening());
    });

    it('hard errors clear the intent and prevent restart', () => {
      const onError = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useSpeechRecognition({ onError }));
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());

      act(() => instance.onerror?.({ error: 'not-allowed' } as unknown as Event & { error?: string }));

      // not-allowed surfaces the banner AND clears userWantsListening.
      expect(onError).toHaveBeenCalled();
      expect(result.current.isListening).toBe(false);

      // Even if Safari fires a stray onend after the hard error,
      // we must NOT restart — that would defeat the user's
      // "Microphone access denied" awareness.
      act(() => instance.onend?.());
      expect(instance.start).toHaveBeenCalledTimes(1);
    });

    it('reuses the same instance across stop -> restart cycles', () => {
      const { result } = renderHook(() => useSpeechRecognition({}));
      act(() => result.current.startListening());
      const instance = FakeSpeechRecognition.instances[0];
      act(() => instance.onstart?.());

      act(() => result.current.stopListening());
      act(() => result.current.startListening());

      // Same instance is reused — addpipe pattern. Constructing a new
      // SpeechRecognition between cycles was implicated in the
      // post-#466 abort cascade (see hook docstring).
      expect(FakeSpeechRecognition.instances).toHaveLength(1);
      expect(instance.start).toHaveBeenCalledTimes(2);
    });
  });
});
