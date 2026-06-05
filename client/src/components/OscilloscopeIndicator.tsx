import { Oscilloscope } from './Oscilloscope';
import type { DeviceInfo } from '../types';

/**
 * Three mutually-exclusive visual states for the kiosk bottom-left
 * mic indicator (issue #388):
 *
 * - `'listening'`: at least one mic-capable peer is producing audio →
 *   render today's animated faux waveform.
 * - `'muted'`: at least one mic-capable peer, but every one of them is
 *   currently `listening: false` → hide the waveform and overlay the
 *   centered pause glyph (two vertical bars). Carries the "muted"
 *   semantic the issue refines from the original mic-with-slash idea.
 * - `'no-mic'`: zero mic-capable peers in the workspace → dim the
 *   circle (`opacity: 0.3` via CSS) with neither waveform nor glyph,
 *   so a user without a mic isn't visually blamed for being muted.
 */
export type IndicatorState = 'listening' | 'muted' | 'no-mic';

/**
 * Issue #388: aggregate per-device mic state into the three indicator
 * states above. Pure function — no React, easy to unit-test from the
 * KioskMode test suite.
 *
 * Rules (mirrors the issue's Acceptance Criteria):
 *   - "mic-capable" === `sttSupported === true`. `undefined` is
 *     intentionally NOT mic-capable: legacy clients that have not yet
 *     sent `device-listening-state` are excluded from the decision so
 *     they don't silently flip the indicator to muted.
 *   - 0 mic-capable peers → `'no-mic'`.
 *   - >= 1 mic-capable peer, at least one `listening === true` →
 *     `'listening'`.
 *   - >= 1 mic-capable peer, none `listening === true` → `'muted'`.
 */
export function deriveIndicatorState(devices: DeviceInfo[]): IndicatorState {
  const micCapable = devices.filter((d) => d.sttSupported === true);
  if (micCapable.length === 0) return 'no-mic';
  const anyListening = micCapable.some((d) => d.listening === true);
  return anyListening ? 'listening' : 'muted';
}

interface OscilloscopeIndicatorProps {
  state: IndicatorState;
  /** Faux-audio buffer driven by `useFauxAudioActivity`. Required for `'listening'`. */
  dataArray: Uint8Array<ArrayBuffer> | null;
  /** Whether the faux-audio buffer is currently animating. */
  isActive: boolean;
  /**
   * Stroke / glyph color. Driven by issue #380's blue token in
   * production; tests assert this prop reaches the inner
   * `Oscilloscope`. The pause glyph uses the same color via
   * `currentColor`.
   */
  color?: string;
}

/**
 * Inline muted-mic glyph SVG. A simplified microphone capsule + stand
 * with a diagonal slash through it, centered in a `viewBox="0 0 48 48"`
 * square so it fills ~60% of the 3rem circle without manual sizing
 * math. Uses `currentColor` so the surrounding indicator's color
 * drives the stroke — see the design comment in #388.
 *
 * Visual: a rounded capsule (mic body) above a short cradle and base,
 * crossed by a diagonal stroke from bottom-left to top-right. The slash
 * carries the same stroke width as the capsule outline so the symbol
 * reads as a single coherent "no microphone" glyph from across the
 * room, satisfying the issue's three-state requirement that **muted**
 * be visually distinct from both **listening** and **no-mic**.
 *
 * Marked `aria-hidden` because the parent
 * `.kiosk-oscilloscope-indicator` already carries the announcement
 * (`aria-label="microphone muted"`); doubling up would be noisy.
 */
function MutedMicGlyph() {
  return (
    <svg
      className="oscilloscope-mute-icon"
      data-testid="oscilloscope-mute-icon"
      viewBox="0 0 48 48"
      width="48"
      height="48"
      stroke="currentColor"
      fill="none"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Mic capsule */}
      <rect x="18" y="8" width="12" height="20" rx="6" />
      {/* Cradle */}
      <path d="M12 22 v3 a12 12 0 0 0 24 0 v-3" />
      {/* Stand */}
      <line x1="24" y1="37" x2="24" y2="42" />
      <line x1="18" y1="42" x2="30" y2="42" />
      {/* Slash — drawn last so it sits on top of the capsule */}
      <line x1="10" y1="42" x2="38" y2="6" />
    </svg>
  );
}

/**
 * Three-state mic indicator for the kiosk oscilloscope circle
 * (issue #388). The container `.kiosk-oscilloscope-indicator` div is
 * owned by the caller so it can keep its existing
 * `data-testid` / grid placement; this component fills the inner area
 * based on `state` and lets the parent style via the `data-state`
 * attribute.
 */
export function OscilloscopeIndicator({ state, dataArray, isActive, color }: OscilloscopeIndicatorProps) {
  if (state === 'muted') {
    return <MutedMicGlyph />;
  }
  // 'listening' and 'no-mic' both render the underlying Oscilloscope.
  // For 'no-mic' the parent CSS sets opacity: 0.3 via the data-state
  // attribute, so we still mount the canvas (the indicator footprint
  // stays consistent across states) but force `isActive={false}` so
  // the RAF loop doesn't run when there's no audible audio.
  return (
    <Oscilloscope
      analyser={null}
      dataArray={dataArray}
      isActive={state === 'listening' ? isActive : false}
      width={48}
      height={48}
      color={color}
      lineWidth={1.5}
      glowIntensity={6}
    />
  );
}
