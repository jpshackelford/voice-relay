import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAudioPlayback } from './useAudioPlayback';
import type { AudioChunkMessage, AudioEndMessage } from '../types';

/** Bytes -> base64 (uses btoa available in happy-dom) */
function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

interface MockAudio {
  src: string;
  onended: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

let mockAudios: MockAudio[] = [];
let originalAudio: typeof Audio;
let createObjectURLSpy: ReturnType<typeof vi.fn>;
let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

function setupAudioMock(opts: { playRejects?: boolean } = {}) {
  mockAudios = [];
  const playFn = opts.playRejects
    ? vi.fn().mockRejectedValue(new Error('play failed'))
    : vi.fn().mockResolvedValue(undefined);

  // Replace global Audio constructor with a class that records instances.
  class MockAudioCtor {
    src: string;
    onended: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    play = playFn;
    pause = vi.fn();
    constructor(url: string) {
      this.src = url;
      mockAudios.push(this as unknown as MockAudio);
    }
  }
  (globalThis as unknown as { Audio: unknown }).Audio = MockAudioCtor as unknown as typeof Audio;
}

describe('useAudioPlayback hook', () => {
  beforeEach(() => {
    originalAudio = globalThis.Audio;
    setupAudioMock();
    createObjectURLSpy = vi.fn(() => `blob:${Math.random().toString(36).slice(2)}`);
    revokeObjectURLSpy = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    vi.restoreAllMocks();
  });

  it('starts with no playback active', () => {
    const { result } = renderHook(() => useAudioPlayback());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentUtteranceId).toBeNull();
  });

  it('queues a chunk silently before audio-end', () => {
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      const message: AudioChunkMessage = {
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1, 2, 3])),
        format: 'mp3',
      };
      result.current.handleAudioChunk(message);
    });

    // Just receiving a chunk should not start playback.
    expect(result.current.isPlaying).toBe(false);
    expect(mockAudios).toHaveLength(0);
  });

  it('plays audio after audio-end is received', async () => {
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([10, 20])),
        format: 'mp3',
      });
    });
    act(() => {
      const end: AudioEndMessage = {
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      };
      result.current.handleAudioEnd(end);
    });

    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    expect(result.current.currentUtteranceId).toBe('u1');
    expect(mockAudios).toHaveLength(1);
    expect(mockAudios[0].play).toHaveBeenCalled();
    expect(createObjectURLSpy).toHaveBeenCalled();
  });

  it('combines multiple chunks for the same utterance into one playback', async () => {
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1, 2])),
        format: 'mp3',
      });
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([3, 4])),
        format: 'mp3',
      });
    });

    // No Audio instance yet
    expect(mockAudios).toHaveLength(0);

    act(() => {
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => {
      expect(mockAudios).toHaveLength(1);
    });
    // Should call createObjectURL exactly once for the combined blob
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
  });

  it('plays queued utterances sequentially via onended', async () => {
    const { result } = renderHook(() => useAudioPlayback());

    // Queue two complete utterances
    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => {
      expect(mockAudios).toHaveLength(1);
    });

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u2',
        audio: bytesToBase64(new Uint8Array([2])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u2',
      });
    });

    // Simulate the first audio finishing.
    act(() => {
      mockAudios[0].onended?.();
    });

    await waitFor(() => {
      expect(mockAudios.length).toBeGreaterThanOrEqual(2);
    });
    expect(result.current.currentUtteranceId).toBe('u2');
  });

  it('transitions to not playing when the queue empties', async () => {
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => expect(mockAudios).toHaveLength(1));

    act(() => {
      mockAudios[0].onended?.();
    });

    await waitFor(() => {
      expect(result.current.isPlaying).toBe(false);
      expect(result.current.currentUtteranceId).toBeNull();
    });
  });

  it('handles audio-end with error by dropping buffered chunks without playback', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
        error: 'tts failed',
      });
    });

    expect(mockAudios).toHaveLength(0);
    expect(result.current.isPlaying).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('handles audio-end with no buffered chunks (no playback, warning)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'never-sent',
      });
    });

    expect(mockAudios).toHaveLength(0);
    expect(result.current.isPlaying).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('handles invalid base64 audio in handleAudioChunk gracefully', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAudioPlayback());

    // Mock atob to throw for this test
    const originalAtob = globalThis.atob;
    globalThis.atob = vi.fn().mockImplementation(() => {
      throw new Error('Invalid base64');
    }) as unknown as typeof atob;

    try {
      act(() => {
        result.current.handleAudioChunk({
          type: 'audio-chunk',
          sessionId: 's1',
          utteranceId: 'u1',
          audio: '!!!not-base64!!!',
          format: 'mp3',
        });
      });
      expect(errSpy).toHaveBeenCalled();
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it('cleans up chunks after CHUNK_TIMEOUT_MS without audio-end', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useAudioPlayback());

    try {
      act(() => {
        result.current.handleAudioChunk({
          type: 'audio-chunk',
          sessionId: 's1',
          utteranceId: 'u1',
          audio: bytesToBase64(new Uint8Array([1])),
          format: 'mp3',
        });
      });

      // Advance past the 30s timeout
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Timeout waiting for audio-end'),
        'u1',
      );

      // Sending audio-end now should warn that no chunks remain.
      act(() => {
        result.current.handleAudioEnd({
          type: 'audio-end',
          sessionId: 's1',
          utteranceId: 'u1',
        });
      });
      expect(mockAudios).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() halts playback and resets state', async () => {
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => expect(mockAudios).toHaveLength(1));

    act(() => {
      result.current.stop();
    });

    expect(mockAudios[0].pause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentUtteranceId).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });

  it('falls through to next chunk when audio.play() rejects', async () => {
    setupAudioMock({ playRejects: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => {
      expect(errSpy).toHaveBeenCalled();
    });
    // After rejection, the queue is drained -> not playing again.
    await waitFor(() => expect(result.current.isPlaying).toBe(false));
  });

  it('reports audio element errors and continues queue', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => expect(mockAudios).toHaveLength(1));
    act(() => {
      mockAudios[0].onerror?.(new Event('error'));
    });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error playing audio'),
      expect.anything(),
    );
  });

  it('unmount revokes any in-flight blob URL and pauses current audio', async () => {
    const { result, unmount } = renderHook(() => useAudioPlayback());

    act(() => {
      result.current.handleAudioChunk({
        type: 'audio-chunk',
        sessionId: 's1',
        utteranceId: 'u1',
        audio: bytesToBase64(new Uint8Array([1])),
        format: 'mp3',
      });
      result.current.handleAudioEnd({
        type: 'audio-end',
        sessionId: 's1',
        utteranceId: 'u1',
      });
    });

    await waitFor(() => expect(mockAudios).toHaveLength(1));
    const playedAudio = mockAudios[0];
    revokeObjectURLSpy.mockClear();

    unmount();
    expect(playedAudio.pause).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });
});
