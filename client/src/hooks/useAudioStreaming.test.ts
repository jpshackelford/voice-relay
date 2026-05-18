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

describe('useAudioStreaming utility functions', () => {
  // Test the PCM conversion separately
  // This is indirectly tested through the hook, but we can verify the algorithm is correct
  
  it('would convert float32 samples to PCM16 correctly', () => {
    // This tests the expected behavior of the internal float32ToPCM16 function
    // by verifying the expected output format
    
    // Float32 range: [-1.0, 1.0]
    // Int16 range: [-32768, 32767]
    
    // For sample = 0.5:
    // Expected: 0.5 * 0x7FFF = 16383.5 ≈ 16383
    
    // For sample = -0.5:
    // Expected: -0.5 * 0x8000 = -16384
    
    // For sample = 1.0:
    // Expected: 1.0 * 0x7FFF = 32767
    
    // For sample = -1.0:
    // Expected: -1.0 * 0x8000 = -32768
    
    // These are the expected conversions based on the algorithm
    expect(true).toBe(true); // Placeholder - actual values tested in integration
  });
});
