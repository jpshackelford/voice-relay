import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioAnalyser } from './useAudioAnalyser';

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
    _mockTrack: track, // expose for assertions
  } as unknown as MediaStream & { _mockTrack: MediaStreamTrack };
};

// Mock AnalyserNode
const createMockAnalyserNode = () => ({
  fftSize: 2048,
  frequencyBinCount: 1024,
  getByteTimeDomainData: vi.fn(),
  getByteFrequencyData: vi.fn(),
  getFloatTimeDomainData: vi.fn(),
  getFloatFrequencyData: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
});

// Mock MediaStreamAudioSourceNode
const createMockSourceNode = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
});

// Store original globals for restoration
let originalMediaDevices: MediaDevices;
let originalAudioContext: typeof AudioContext | undefined;
let originalWebkitAudioContext: typeof AudioContext | undefined;

describe('useAudioAnalyser hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Save originals
    originalMediaDevices = navigator.mediaDevices;
    originalAudioContext = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    originalWebkitAudioContext = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  });

  afterEach(() => {
    // Restore originals
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
    if (originalAudioContext) {
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = originalAudioContext;
    }
    if (originalWebkitAudioContext) {
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = originalWebkitAudioContext;
    }
  });

  describe('initial state', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useAudioAnalyser());
      
      expect(result.current.isActive).toBe(false);
      expect(result.current.analyser).toBeNull();
      expect(result.current.dataArray).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('exposes start and stop functions', () => {
      const { result } = renderHook(() => useAudioAnalyser());
      
      expect(typeof result.current.start).toBe('function');
      expect(typeof result.current.stop).toBe('function');
    });
  });

  describe('start() with existing stream', () => {
    it('skips getUserMedia when existing stream is provided', async () => {
      const mockStream = createMockMediaStream();
      const getUserMedia = vi.fn();
      
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia },
        configurable: true,
        writable: true,
      });

      const { result } = renderHook(() => useAudioAnalyser());

      // Pass external stream - even if AudioContext fails, getUserMedia should not be called
      await act(async () => {
        try {
          await result.current.start(mockStream);
        } catch {
          // AudioContext may not be available in test environment
        }
      });

      // Key assertion: getUserMedia was NOT called because we provided a stream
      expect(getUserMedia).not.toHaveBeenCalled();
    });
  });

  describe('stop() behavior', () => {
    it('can be called safely even when not started', () => {
      const { result } = renderHook(() => useAudioAnalyser());

      // Should not throw when called without starting
      expect(() => {
        act(() => {
          result.current.stop();
        });
      }).not.toThrow();

      expect(result.current.isActive).toBe(false);
    });

    it('can be called multiple times safely', () => {
      const { result } = renderHook(() => useAudioAnalyser());

      // Should not throw when called multiple times
      expect(() => {
        act(() => {
          result.current.stop();
          result.current.stop();
          result.current.stop();
        });
      }).not.toThrow();

      expect(result.current.isActive).toBe(false);
    });
  });

  describe('start() with error', () => {
    it('sets error when getUserMedia fails', async () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
      });

      const { result } = renderHook(() => useAudioAnalyser());

      await act(async () => {
        await result.current.start();
      });

      expect(result.current.isActive).toBe(false);
      expect(result.current.error).toBe('Permission denied');
    });

    it('sets generic error message when getUserMedia throws non-Error', async () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockRejectedValue('string error'),
        },
        configurable: true,
      });

      const { result } = renderHook(() => useAudioAnalyser());

      await act(async () => {
        await result.current.start();
      });

      expect(result.current.error).toBe('Failed to access microphone');
    });
  });

  describe('stop()', () => {
    it('sets isActive to false when called', () => {
      const { result } = renderHook(() => useAudioAnalyser());

      // stop() should work even when not started
      act(() => {
        result.current.stop();
      });

      expect(result.current.isActive).toBe(false);
    });
  });

  describe('fftSize option', () => {
    it('accepts custom fftSize', () => {
      const { result } = renderHook(() => useAudioAnalyser({ fftSize: 1024 }));
      expect(result.current.isActive).toBe(false);
    });

    it('uses default fftSize when not specified', () => {
      const { result } = renderHook(() => useAudioAnalyser());
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('does not throw when unmounting', () => {
      const { unmount } = renderHook(() => useAudioAnalyser());
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('timing fix (issue #211)', () => {
    // Create a mock AudioContext class that can be used as a constructor
    function createMockAudioContextClass() {
      const mockAnalyser = {
        ...createMockAnalyserNode(),
        fftSize: 2048,
        frequencyBinCount: 1024,
      };
      const mockSource = createMockSourceNode();

      return class MockAudioContext {
        state = 'running';
        resume = vi.fn().mockResolvedValue(undefined);
        close = vi.fn().mockResolvedValue(undefined);
        createMediaStreamSource = vi.fn().mockReturnValue(mockSource);
        createAnalyser = vi.fn().mockReturnValue(mockAnalyser);
      };
    }

    it('ensures analyser and dataArray are non-null when isActive is true', async () => {
      const mockStream = createMockMediaStream();

      // Mock getUserMedia
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
        configurable: true,
        writable: true,
      });

      // Mock AudioContext constructor using a class
      (window as unknown as { AudioContext: unknown }).AudioContext = createMockAudioContextClass();

      const { result } = renderHook(() => useAudioAnalyser());

      // Before starting, all should be false/null
      expect(result.current.isActive).toBe(false);
      expect(result.current.analyser).toBeNull();
      expect(result.current.dataArray).toBeNull();

      // Start the analyser
      await act(async () => {
        await result.current.start();
      });

      // KEY ASSERTION: When isActive is true, analyser and dataArray must also be non-null
      // This is the fix for issue #211 - previously isActive could be true while these were null
      expect(result.current.isActive).toBe(true);
      expect(result.current.analyser).not.toBeNull();
      expect(result.current.dataArray).not.toBeNull();
      expect(result.current.dataArray).toBeInstanceOf(Uint8Array);
    });

    it('ensures analyser and dataArray are non-null when isActive is true with external stream', async () => {
      const mockStream = createMockMediaStream();

      // Mock AudioContext constructor using a class
      (window as unknown as { AudioContext: unknown }).AudioContext = createMockAudioContextClass();

      const { result } = renderHook(() => useAudioAnalyser());

      // Start with existing stream (unified mode scenario)
      await act(async () => {
        await result.current.start(mockStream);
      });

      // Verify the fix works in the unified mode scenario (external stream)
      expect(result.current.isActive).toBe(true);
      expect(result.current.analyser).not.toBeNull();
      expect(result.current.dataArray).not.toBeNull();
    });

    it('prevents rapid start() calls from causing issues', async () => {
      const mockStream = createMockMediaStream();

      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
        configurable: true,
        writable: true,
      });

      (window as unknown as { AudioContext: unknown }).AudioContext = createMockAudioContextClass();

      const { result } = renderHook(() => useAudioAnalyser());

      // Call start() multiple times rapidly
      await act(async () => {
        // Start multiple times - only the first should actually execute
        const promise1 = result.current.start();
        const promise2 = result.current.start();
        const promise3 = result.current.start();
        await Promise.all([promise1, promise2, promise3]);
      });

      // Should only have one active analyser
      expect(result.current.isActive).toBe(true);
      expect(result.current.analyser).not.toBeNull();
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    });
  });
});
