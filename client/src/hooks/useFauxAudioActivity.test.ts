import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFauxAudioActivity } from './useFauxAudioActivity';

/**
 * useFauxAudioActivity tests.
 *
 * We control the RAF loop by stubbing requestAnimationFrame so each test
 * can advance frames deterministically. performance.now() is also stubbed
 * so the decay timing is predictable.
 */

describe('useFauxAudioActivity', () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let originalRaf: typeof requestAnimationFrame;
  let originalCancelRaf: typeof cancelAnimationFrame;
  let nowValue = 0;
  let originalPerformanceNow: typeof performance.now;

  beforeEach(() => {
    rafCallbacks = [];
    nowValue = 1000;

    originalRaf = global.requestAnimationFrame;
    originalCancelRaf = global.cancelAnimationFrame;
    originalPerformanceNow = performance.now;

    let nextId = 1;
    global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return nextId++;
    });
    global.cancelAnimationFrame = vi.fn();

    performance.now = vi.fn(() => nowValue);
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancelRaf;
    performance.now = originalPerformanceNow;
  });

  function flushOneFrame() {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    cbs.forEach((cb) => cb(nowValue));
  }

  it('returns a Uint8Array buffer of the requested size', () => {
    const { result } = renderHook(() =>
      useFauxAudioActivity({ pulse: 0, bufferSize: 128 })
    );
    expect(result.current.dataArray).toBeInstanceOf(Uint8Array);
    expect(result.current.dataArray.length).toBe(128);
  });

  it('starts inactive and the buffer is silence (128) after the first idle frame', () => {
    const { result } = renderHook(() => useFauxAudioActivity({ pulse: 0 }));

    // First frame: no pulses yet, decay = 0 → fills with 128.
    act(() => {
      flushOneFrame();
    });

    expect(result.current.isActive).toBe(false);
    // Sample a few elements to confirm silence.
    expect(result.current.dataArray[0]).toBe(128);
    expect(result.current.dataArray[100]).toBe(128);
  });

  it('becomes active and produces non-silence samples after a pulse', () => {
    const { result, rerender } = renderHook(
      ({ pulse }: { pulse: number }) => useFauxAudioActivity({ pulse, decayMs: 1000 }),
      { initialProps: { pulse: 0 } }
    );

    // Bump the pulse — this resets energy to 1.0 and lastPulseTs to "now".
    act(() => {
      rerender({ pulse: 1 });
    });

    // Advance one frame; decay isn't elapsed so the wave should be drawn.
    act(() => {
      flushOneFrame();
    });

    expect(result.current.isActive).toBe(true);
    // At least one sample should differ from the silence baseline. The
    // synthetic sine wave centered at 128 will produce values both above
    // and below 128 across the buffer.
    const buf = result.current.dataArray;
    let hasNonSilence = false;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 128) {
        hasNonSilence = true;
        break;
      }
    }
    expect(hasNonSilence).toBe(true);
  });

  it('decays back to silence after decayMs has elapsed without further pulses', () => {
    const { result, rerender } = renderHook(
      ({ pulse }: { pulse: number }) => useFauxAudioActivity({ pulse, decayMs: 500 }),
      { initialProps: { pulse: 0 } }
    );

    // Bump pulse and run a frame at t=1000.
    act(() => {
      rerender({ pulse: 1 });
    });
    act(() => {
      flushOneFrame();
    });
    expect(result.current.isActive).toBe(true);

    // Advance time past decayMs and run another frame.
    nowValue = 2000;
    act(() => {
      flushOneFrame();
    });

    // Should now be back to idle and silence.
    expect(result.current.isActive).toBe(false);
    expect(result.current.dataArray[0]).toBe(128);
    expect(result.current.dataArray[50]).toBe(128);
  });

  it('resets energy when pulse increments again before decay completes', () => {
    const { result, rerender } = renderHook(
      ({ pulse }: { pulse: number }) => useFauxAudioActivity({ pulse, decayMs: 1000 }),
      { initialProps: { pulse: 0 } }
    );

    // First pulse at t=1000.
    act(() => {
      rerender({ pulse: 1 });
    });
    act(() => {
      flushOneFrame();
    });

    // Advance partway through decay (500ms = half-way through 1000ms decay).
    nowValue = 1500;
    act(() => {
      flushOneFrame();
    });
    expect(result.current.isActive).toBe(true);

    // New pulse at t=1500 resets energy to 1.0 again.
    act(() => {
      rerender({ pulse: 2 });
    });

    // Advance just past the original decay window (would have been done
    // at t=2000 without the second pulse). With the reset we expect to
    // still be active at t=2000 (only 500ms into the second decay).
    nowValue = 2000;
    act(() => {
      flushOneFrame();
    });
    expect(result.current.isActive).toBe(true);
  });

  it('cancels the RAF loop on unmount', () => {
    const { unmount } = renderHook(() => useFauxAudioActivity({ pulse: 0 }));
    unmount();
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });
});
