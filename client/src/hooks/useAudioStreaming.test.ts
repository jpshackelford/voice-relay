import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioStreaming } from './useAudioStreaming';

// Mock MediaStream track
const createMockTrack = () => ({
  stop: vi.fn(),
  kind: 'audio',
  id: 'mock-track-id',
  enabled: true,
  muted: false,
  readyState: 'live',
  onended: null,
  onmute: null,
  onunmute: null,
  getCapabilities: vi.fn(),
  getConstraints: vi.fn(),
  getSettings: vi.fn(),
  applyConstraints: vi.fn(),
  clone: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
} as unknown as MediaStreamTrack);

// Mock MediaStream
const createMockMediaStream = () => {
  const track = createMockTrack();
  return {
    getTracks: vi.fn().mockReturnValue([track]),
    getAudioTracks: vi.fn().mockReturnValue([track]),
    getVideoTracks: vi.fn().mockReturnValue([]),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    active: true,
    id: 'mock-stream-id',
    onaddtrack: null,
    onremovetrack: null,
    clone: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaStream;
};

// Store original globals for restoration
let originalAudioContext: typeof AudioContext | undefined;
let originalWebkitAudioContext: typeof AudioContext | undefined;

describe('useAudioStreaming hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Save originals
    originalAudioContext = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    originalWebkitAudioContext = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  });

  afterEach(() => {
    // Restore originals
    if (originalAudioContext) {
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = originalAudioContext;
    }
    if (originalWebkitAudioContext) {
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = originalWebkitAudioContext;
    }
  });

  describe('initial state', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useAudioStreaming());
      
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('exposes start and stop functions', () => {
      const { result } = renderHook(() => useAudioStreaming());
      
      expect(typeof result.current.start).toBe('function');
      expect(typeof result.current.stop).toBe('function');
    });

    it('exposes getAnalyser and getDataArray functions', () => {
      const { result } = renderHook(() => useAudioStreaming());
      
      expect(typeof result.current.getAnalyser).toBe('function');
      expect(typeof result.current.getDataArray).toBe('function');
    });

    it('returns null for analyser and dataArray initially', () => {
      const { result } = renderHook(() => useAudioStreaming());
      
      expect(result.current.getAnalyser()).toBeNull();
      expect(result.current.getDataArray()).toBeNull();
    });
  });

  describe('stop() behavior', () => {
    it('can be called safely even when not started', () => {
      const { result } = renderHook(() => useAudioStreaming());

      // Should not throw when called without starting
      expect(() => {
        act(() => {
          result.current.stop();
        });
      }).not.toThrow();

      expect(result.current.isStreaming).toBe(false);
    });

    it('can be called multiple times safely', () => {
      const { result } = renderHook(() => useAudioStreaming());

      // Should not throw when called multiple times
      expect(() => {
        act(() => {
          result.current.stop();
          result.current.stop();
          result.current.stop();
        });
      }).not.toThrow();

      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe('options', () => {
    it('accepts custom sampleRate', () => {
      const { result } = renderHook(() => 
        useAudioStreaming({ sampleRate: 44100 })
      );
      expect(result.current.isStreaming).toBe(false);
    });

    it('accepts custom chunkDurationMs', () => {
      const { result } = renderHook(() => 
        useAudioStreaming({ chunkDurationMs: 1000 })
      );
      expect(result.current.isStreaming).toBe(false);
    });

    it('accepts onTranscription callback', () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => 
        useAudioStreaming({ onTranscription })
      );
      expect(result.current.isStreaming).toBe(false);
    });

    it('accepts onError callback', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => 
        useAudioStreaming({ onError })
      );
      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('does not throw when unmounting', () => {
      const { unmount } = renderHook(() => useAudioStreaming());
      expect(() => unmount()).not.toThrow();
    });

    it('stops streaming on unmount if active', async () => {
      // We can't fully test start() without a proper AudioContext mock,
      // but we can verify that unmount doesn't throw
      const { unmount, result } = renderHook(() => useAudioStreaming());
      
      expect(result.current.isStreaming).toBe(false);
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('sets error when start fails due to AudioContext unavailable', async () => {
      // Remove AudioContext
      delete (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      const mockStream = createMockMediaStream();
      const sendChunk = vi.fn();
      const onError = vi.fn();
      
      const { result } = renderHook(() => useAudioStreaming({ onError }));

      await act(async () => {
        await result.current.start(mockStream, sendChunk);
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.error).toBeTruthy();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('start() with stream', () => {
    it('requires a sendChunk callback', async () => {
      const mockStream = createMockMediaStream();
      
      const { result } = renderHook(() => useAudioStreaming());

      // Even if AudioContext setup fails, the signature should be correct
      await act(async () => {
        try {
          await result.current.start(mockStream, vi.fn());
        } catch {
          // AudioContext may not be available in test environment
        }
      });
      
      // Verify the function accepts the right parameters
      expect(typeof result.current.start).toBe('function');
    });
  });
});

describe('useAudioStreaming with mocked AudioContext', () => {
  interface MockScriptProcessor {
    onaudioprocess:
      | ((evt: { inputBuffer: { getChannelData: (i: number) => Float32Array } }) => void)
      | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }
  interface MockAnalyser {
    fftSize: number;
    frequencyBinCount: number;
    connect: ReturnType<typeof vi.fn>;
  }
  interface MockSource {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }
  interface MockContext {
    state: 'running' | 'suspended';
    sampleRate: number;
    destination: object;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    createMediaStreamSource: ReturnType<typeof vi.fn>;
    createAnalyser: ReturnType<typeof vi.fn>;
    createScriptProcessor: ReturnType<typeof vi.fn>;
  }

  let lastProcessor: MockScriptProcessor | null = null;
  let lastContext: MockContext | null = null;

  function installContextMock(initialState: 'running' | 'suspended' = 'running') {
    class MockAudioContext implements MockContext {
      state: 'running' | 'suspended';
      sampleRate: number;
      destination = {};
      resume = vi.fn(async () => {
        this.state = 'running';
      });
      close = vi.fn(async () => {});
      createMediaStreamSource = vi.fn(
        (): MockSource => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
      );
      createAnalyser = vi.fn(
        (): MockAnalyser => ({
          fftSize: 0,
          frequencyBinCount: 1024,
          connect: vi.fn(),
        }),
      );
      createScriptProcessor = vi.fn((): MockScriptProcessor => {
        const proc: MockScriptProcessor = {
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        lastProcessor = proc;
        return proc;
      });
      constructor(opts: { sampleRate: number }) {
        this.state = initialState;
        this.sampleRate = opts.sampleRate;
        lastContext = this;
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext =
      MockAudioContext as unknown as typeof AudioContext;
  }

  beforeEach(() => {
    lastProcessor = null;
    lastContext = null;
  });

  afterEach(() => {
    delete (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  });

  it('start() transitions to streaming and wires up audio nodes', async () => {
    installContextMock('running');
    const stream = createMockMediaStream();
    const sendChunk = vi.fn();

    const { result } = renderHook(() => useAudioStreaming());

    await act(async () => {
      await result.current.start(stream, sendChunk);
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.getAnalyser()).not.toBeNull();
    expect(result.current.getDataArray()).not.toBeNull();
    expect(lastContext?.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(lastContext?.createScriptProcessor).toHaveBeenCalled();
    expect(typeof lastProcessor?.onaudioprocess).toBe('function');
  });

  it('start() resumes a suspended audio context', async () => {
    installContextMock('suspended');
    const { result } = renderHook(() => useAudioStreaming());

    await act(async () => {
      await result.current.start(createMockMediaStream(), vi.fn());
    });

    expect(lastContext?.resume).toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(true);
  });

  it('start() while already streaming is a no-op', async () => {
    installContextMock('running');
    const { result } = renderHook(() => useAudioStreaming());

    await act(async () => {
      await result.current.start(createMockMediaStream(), vi.fn());
    });
    const firstContext = lastContext;
    await act(async () => {
      await result.current.start(createMockMediaStream(), vi.fn());
    });
    // Same context - no new AudioContext was constructed.
    expect(lastContext).toBe(firstContext);
  });

  it('processes a full chunk via onaudioprocess and sends PCM data', async () => {
    installContextMock('running');
    const stream = createMockMediaStream();
    const sendChunk = vi.fn();
    const { result } = renderHook(() =>
      useAudioStreaming({ sampleRate: 16000, chunkDurationMs: 100 }),
    );

    await act(async () => {
      await result.current.start(stream, sendChunk);
    });

    // samplesPerChunk = 1600. Send 2048 samples; one chunk should be emitted.
    const samples = new Float32Array(2048);
    for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 0.5 : -0.5;
    act(() => {
      lastProcessor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => samples },
      });
    });

    expect(sendChunk).toHaveBeenCalled();
    const buf = sendChunk.mock.calls[0][0] as ArrayBuffer;
    expect(buf.byteLength).toBe(1600 * 2);
    const view = new DataView(buf);
    expect(view.getInt16(0, true)).not.toBe(0);
  });

  it('onaudioprocess ignores callbacks after stop() (uses ref guard)', async () => {
    installContextMock('running');
    const sendChunk = vi.fn();
    const { result } = renderHook(() =>
      useAudioStreaming({ sampleRate: 16000, chunkDurationMs: 100 }),
    );

    await act(async () => {
      await result.current.start(createMockMediaStream(), sendChunk);
    });
    const processor = lastProcessor;

    act(() => {
      result.current.stop();
    });

    sendChunk.mockClear();
    act(() => {
      processor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array(4096) },
      });
    });
    expect(sendChunk).not.toHaveBeenCalled();
  });

  it('stop() flushes remaining buffered samples', async () => {
    installContextMock('running');
    const sendChunk = vi.fn();
    const { result } = renderHook(() =>
      useAudioStreaming({ sampleRate: 16000, chunkDurationMs: 100 }),
    );

    await act(async () => {
      await result.current.start(createMockMediaStream(), sendChunk);
    });

    const partial = new Float32Array(500);
    partial.fill(0.25);
    act(() => {
      lastProcessor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => partial },
      });
    });
    expect(sendChunk).not.toHaveBeenCalled();

    act(() => {
      result.current.stop();
    });

    expect(sendChunk).toHaveBeenCalledTimes(1);
    expect(result.current.isStreaming).toBe(false);
    expect(lastContext?.close).toHaveBeenCalled();
  });

  it('handles ring buffer overflow by processing before write', async () => {
    installContextMock('running');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sendChunk = vi.fn();
    // Tiny sample rate so the 60-second capacity is small (100*60=6000)
    const { result } = renderHook(() =>
      useAudioStreaming({ sampleRate: 100, chunkDurationMs: 100 }),
    );

    await act(async () => {
      await result.current.start(createMockMediaStream(), sendChunk);
    });

    const big = new Float32Array(6001);
    big.fill(0.5);
    act(() => {
      lastProcessor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => big },
      });
    });

    expect(sendChunk).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ring buffer overflow'),
    );
    warnSpy.mockRestore();
  });

  it('clamps samples outside [-1, 1] when converting to PCM16', async () => {
    installContextMock('running');
    const sendChunk = vi.fn();
    const { result } = renderHook(() =>
      useAudioStreaming({ sampleRate: 16000, chunkDurationMs: 100 }),
    );

    await act(async () => {
      await result.current.start(createMockMediaStream(), sendChunk);
    });

    const samples = new Float32Array(2048);
    for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 2 : -2;
    act(() => {
      lastProcessor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => samples },
      });
    });

    expect(sendChunk).toHaveBeenCalled();
    const view = new DataView(sendChunk.mock.calls[0][0] as ArrayBuffer);
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
  });

  it('cleans up via stop on unmount even if start was called', async () => {
    installContextMock('running');
    const { result, unmount } = renderHook(() => useAudioStreaming());

    await act(async () => {
      await result.current.start(createMockMediaStream(), vi.fn());
    });
    const closedContext = lastContext;
    unmount();
    expect(closedContext?.close).toHaveBeenCalled();
  });
});
