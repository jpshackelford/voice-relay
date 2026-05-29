import { useEffect, useRef, useState } from 'react';

interface UseFauxAudioActivityOptions {
  /**
   * Monotonically-increasing counter or any value that changes whenever a
   * new transcription event lands. Each change resets the internal energy
   * level back to 1.0, which decays to 0 over `decayMs` ms.
   */
  pulse: number;
  /**
   * Decay duration in milliseconds. Defaults to 800ms, matching the
   * orchestrator's expansion comment for #346 — short enough that the
   * waveform feels responsive, long enough that consecutive partials
   * during continuous speech produce a sustained wave rather than a
   * stroboscopic flicker.
   */
  decayMs?: number;
  /**
   * Number of samples in the returned buffer. Defaults to 256. The
   * Oscilloscope component renders one line segment per sample, so this
   * controls the visual smoothness of the waveform.
   */
  bufferSize?: number;
  /**
   * Frequency multiplier for the synthetic sine wave (cycles across the
   * buffer at full energy). Defaults to 3 so the rendered waveform looks
   * like a few oscillations across the 3rem indicator at peak energy.
   */
  cyclesPerBuffer?: number;
}

interface UseFauxAudioActivityReturn {
  /**
   * Uint8Array suitable for passing to Oscilloscope's `dataArray` prop.
   * The same buffer instance is reused across frames — only its contents
   * change — so re-rendering is cheap and there's no churn for the GC.
   */
  dataArray: Uint8Array<ArrayBuffer>;
  /** True whenever energy > 0 (i.e. a recent pulse hasn't decayed yet). */
  isActive: boolean;
}

/**
 * Issue #346 item 1 — faux audio activity source for the kiosk's left-side
 * oscilloscope indicator.
 *
 * The kiosk never opens a microphone stream (see KioskMode.tsx — there's
 * no `getUserMedia` call), so we have no real AnalyserNode to feed the
 * Oscilloscope. Plumbing real audio levels from the *speaker's* device
 * over WebSocket is a larger change captured as a follow-up. For v1 we
 * generate a synthetic sine-wave whose amplitude tracks transcription
 * event arrival rate:
 *
 *   - Each time `pulse` changes, energy is set to 1.0.
 *   - Energy decays exponentially toward 0 over `decayMs`.
 *   - A requestAnimationFrame loop continuously re-fills the buffer with
 *     samples for a sine wave at the current energy level.
 *
 * The result: flat line during silence, waveform that ramps up + decays
 * with each new partial utterance. The amplitude is uncorrelated with
 * actual speaker volume but matches the visual rhythm of a real
 * mic-driven oscilloscope.
 */
export function useFauxAudioActivity({
  pulse,
  decayMs = 800,
  bufferSize = 256,
  cyclesPerBuffer = 3,
}: UseFauxAudioActivityOptions): UseFauxAudioActivityReturn {
  // The buffer is stable across renders — Oscilloscope only reads from it
  // during its own RAF loop, so we just mutate in place.
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer>>(
    new Uint8Array(new ArrayBuffer(bufferSize))
  );
  // Initialize at silence (128 = center) so the flat-line baseline matches
  // the Oscilloscope's idle render.
  if (dataArrayRef.current.length !== bufferSize) {
    dataArrayRef.current = new Uint8Array(new ArrayBuffer(bufferSize));
  }

  const energyRef = useRef(0);
  const lastPulseTsRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  // `isActive` is the only externally-visible piece of reactive state.
  // We keep it as state (not a ref) so the parent can re-render when
  // activity starts/stops (e.g. to swap the Oscilloscope's `isActive`
  // prop), but we only flip it when the boolean actually changes —
  // avoiding a render per frame.
  const [isActive, setIsActive] = useState(false);
  const isActiveRef = useRef(false);

  // Bump energy each time `pulse` changes. We track the timestamp here
  // rather than computing it in the RAF loop so a burst of pulses
  // (multiple partials within one frame) still ratchets the decay clock
  // forward.
  //
  // We intentionally skip the first render (effect fires on mount with
  // the initial pulse value, but no transcription event has happened
  // yet) so the indicator stays flat-line until a real change occurs.
  const previousPulseRef = useRef(pulse);
  useEffect(() => {
    if (pulse === previousPulseRef.current) return;
    previousPulseRef.current = pulse;
    energyRef.current = 1.0;
    lastPulseTsRef.current = performance.now();
    if (!isActiveRef.current) {
      isActiveRef.current = true;
      setIsActive(true);
    }
  }, [pulse]);

  useEffect(() => {
    const buf = dataArrayRef.current;

    function draw(now: number) {
      // Exponential decay: energy halves every (decayMs / log2(e)) ms.
      // For simplicity we use linear decay scaled to decayMs — visually
      // equivalent for the short windows we care about, and a single
      // subtraction per frame is cheaper.
      const elapsed = now - lastPulseTsRef.current;
      const decay = decayMs > 0 ? Math.max(0, 1 - elapsed / decayMs) : 0;
      energyRef.current = decay;

      // Advance the sine-wave phase. Two-pi per `bufferSize / cyclesPerBuffer`
      // samples; phase rotates so the wave appears to scroll.
      phaseRef.current += 0.15;

      if (decay <= 0) {
        // Idle — write the silence centerline so a stale buffer doesn't
        // leave a ghost waveform on screen the next time Oscilloscope
        // renders.
        buf.fill(128);
        if (isActiveRef.current) {
          isActiveRef.current = false;
          setIsActive(false);
        }
      } else {
        const amplitude = decay * 80; // peak ±80 around the 128 center
        for (let i = 0; i < buf.length; i++) {
          const angle =
            (i / buf.length) * cyclesPerBuffer * Math.PI * 2 + phaseRef.current;
          buf[i] = 128 + Math.sin(angle) * amplitude;
        }
        if (!isActiveRef.current) {
          isActiveRef.current = true;
          setIsActive(true);
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    }

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [decayMs, cyclesPerBuffer]);

  return {
    dataArray: dataArrayRef.current,
    isActive,
  };
}
