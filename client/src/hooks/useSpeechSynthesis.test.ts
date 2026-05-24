import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSpeechSynthesis } from './useSpeechSynthesis';

interface FakeUtterance {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

let cancelMock: ReturnType<typeof vi.fn>;
let speakMock: ReturnType<typeof vi.fn>;
let lastUtterance: FakeUtterance | null;

class FakeUtteranceCtor implements FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    lastUtterance = this;
  }
}

function installSpeechSynthesis() {
  cancelMock = vi.fn();
  speakMock = vi.fn();
  lastUtterance = null;
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: { cancel: cancelMock, speak: speakMock },
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    writable: true,
    value: FakeUtteranceCtor,
  });
}

describe('useSpeechSynthesis', () => {
  beforeEach(() => {
    installSpeechSynthesis();
  });

  afterEach(() => {
    // Tear down React trees BEFORE removing the speechSynthesis stub so the
    // hook's cleanup effect (which calls window.speechSynthesis.cancel()) does
    // not throw on a deleted global.
    cleanup();
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');
    vi.restoreAllMocks();
  });

  it('reports supported when speechSynthesis is on window', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.isSpeaking).toBe(false);
  });

  it('speak() cancels prior utterance, configures rate/pitch/volume, and toggles isSpeaking', () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => {
      result.current.speak('hello world');
    });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(lastUtterance).not.toBeNull();
    expect(lastUtterance?.text).toBe('hello world');
    expect(lastUtterance?.rate).toBe(1);
    expect(lastUtterance?.pitch).toBe(1);
    expect(lastUtterance?.volume).toBe(1);

    act(() => lastUtterance?.onstart?.());
    expect(result.current.isSpeaking).toBe(true);

    act(() => lastUtterance?.onend?.());
    expect(result.current.isSpeaking).toBe(false);
  });

  it('error handler resets isSpeaking', () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => result.current.speak('boom'));
    act(() => lastUtterance?.onstart?.());
    expect(result.current.isSpeaking).toBe(true);

    act(() => lastUtterance?.onerror?.());
    expect(result.current.isSpeaking).toBe(false);
  });

  it('ignores empty/whitespace text and never calls speak()', () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => result.current.speak(''));
    act(() => result.current.speak('   '));

    expect(speakMock).not.toHaveBeenCalled();
  });

  it('cancel() invokes speechSynthesis.cancel and clears speaking state', () => {
    const { result } = renderHook(() => useSpeechSynthesis());
    act(() => result.current.speak('hi'));
    act(() => lastUtterance?.onstart?.());

    cancelMock.mockClear();
    act(() => result.current.cancel());

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(result.current.isSpeaking).toBe(false);
  });

  it('cancels any ongoing speech on unmount', () => {
    const { unmount } = renderHook(() => useSpeechSynthesis());
    cancelMock.mockClear();

    unmount();

    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported and no-ops when speechSynthesis is missing', () => {
    // Remove the stub installed by beforeEach to simulate an unsupported browser.
    Reflect.deleteProperty(window, 'speechSynthesis');

    const { result, unmount } = renderHook(() => useSpeechSynthesis());
    expect(result.current.isSupported).toBe(false);

    // speak()/cancel() must not throw when unsupported.
    act(() => {
      result.current.speak('x');
      result.current.cancel();
    });
    expect(result.current.isSpeaking).toBe(false);

    // Unmount before afterEach reaches cleanup so the missing-API state is
    // localized to this test.
    unmount();
  });
});
