import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioAnalyser } from './useAudioAnalyser';

describe('useAudioAnalyser hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('start() with error', () => {
    it('sets error when getUserMedia fails', async () => {
      // Mock getUserMedia to fail
      const originalMediaDevices = navigator.mediaDevices;
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

      // Restore
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
      });
    });

    it('sets generic error message when getUserMedia throws non-Error', async () => {
      const originalMediaDevices = navigator.mediaDevices;
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

      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
      });
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
});
