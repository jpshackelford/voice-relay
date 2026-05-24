import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from './useSpeechRecognition';

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

    act(() => instance.onend?.());
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

  it.each([
    ['no-speech', 'No speech detected'],
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
});
