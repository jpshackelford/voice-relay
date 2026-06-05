import { useEffect, useLayoutEffect, useRef } from 'react';

interface MarqueeTickerProps {
  /**
   * Current text to display. The component renders the entire string and
   * lets the marquee math scroll the overflow off the left edge.
   *
   * Callers (e.g. KioskMode's transcription ticker) own the lifecycle of
   * the buffer: pass an empty string to reset the strip, or update with
   * the latest utterance text as new partials arrive.
   */
  text: string;
  /**
   * Issue #382: optional speaker prefix (e.g. `"JP's iPhone SE: "`).
   * Rendered as a sibling span before `text` inside the same measured
   * inner span so the marquee math (`scrollWidth - clientWidth`) still
   * accounts for both chunks. The prefix span gets its own
   * `.kiosk-ticker-speaker` class so callers can style "who" distinct
   * from "what".
   *
   * The caller (KioskMode) owns the suppression rule: pass an empty
   * string to omit the prefix on same-sender follow-ups.
   */
  prefix?: string;
  /**
   * Test hook for the JSX wrapper. Forwarded to the outer `<span>` so
   * `screen.getByTestId(...)` can find it from KioskMode tests.
   */
  'data-testid'?: string;
  /**
   * Transition duration for the slide-in animation. Defaults to 200ms so
   * new content slides smoothly from the right rather than teleporting
   * into place.
   */
  transitionMs?: number;
  /**
   * Optional className applied to the outer wrapper. Useful when the
   * parent wants to keep its existing ticker styling (e.g.
   * `.kiosk-ticker-text`) without re-implementing it.
   */
  className?: string;
}

/**
 * Issue #346 item 2: fixed-width marquee for the transcription ticker.
 *
 * Renders `text` inside an overflow-hidden wrapper. After each render the
 * inner span is measured and translated left by exactly the overflowed
 * pixel count so the most recent characters are flush against the right
 * edge of the wrapper. A short CSS transition produces the right→left
 * "words slide in" motion.
 *
 * Why measured-pixel-width rather than character-counting:
 * - Fonts mix proportional and monospace glyphs; character counts give
 *   visually uneven cropping.
 * - The strip width is a percentage of the kiosk display, not a fixed px
 *   value, so a layout-driven approach naturally adapts to viewport
 *   changes.
 *
 * Behavior contracts:
 * - When `text` fits inside the wrapper, no transform is applied.
 * - When `text` overflows, the span is translated by `-(scrollWidth -
 *   clientWidth)` px so the right edge of the text aligns with the right
 *   edge of the wrapper.
 * - When `text` becomes empty (idle/stale clear in the parent), the
 *   transform resets to 0 so the next utterance starts fresh.
 */
export function MarqueeTicker({
  text,
  prefix,
  'data-testid': dataTestId,
  transitionMs = 200,
  className,
}: MarqueeTickerProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  // useLayoutEffect so the measure-and-translate happens synchronously
  // before the browser paints — avoids a one-frame flash of "text on the
  // left edge before scrolling".
  //
  // The inner span includes both the optional `.kiosk-ticker-speaker`
  // prefix and the utterance text, so `scrollWidth` already accounts for
  // the combined width — no math changes are needed for issue #382.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner) return;

    // The strip is treated as "empty" whenever `text` is empty: even if a
    // prefix is non-empty, the JSX below suppresses it in that case (see
    // the `text.length > 0 && prefix` guard), so the inner span has no
    // content to scroll. A standalone prefix without text shouldn't
    // happen in normal flow (KioskMode clears both on stale/idle), but
    // we handle it defensively to avoid showing an orphan "<name>: "
    // sitting on a stale strip.
    if (text.length === 0) {
      inner.style.transform = 'translateX(0)';
      return;
    }

    const overflow = inner.scrollWidth - wrapper.clientWidth;
    if (overflow > 0) {
      inner.style.transform = `translateX(${-overflow}px)`;
    } else {
      inner.style.transform = 'translateX(0)';
    }
  }, [text, prefix]);

  // Set the transition once. We do it in a separate effect rather than
  // inline style so the first render doesn't animate from a default 0
  // position (which would look like the initial text "flying in").
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    inner.style.transition = `transform ${transitionMs}ms linear`;
  }, [transitionMs]);

  return (
    <span
      ref={wrapperRef}
      data-testid={dataTestId}
      className={className}
      style={{
        display: 'inline-block',
        width: '100%',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      <span
        ref={innerRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          willChange: 'transform',
        }}
      >
        {text.length > 0 && prefix ? (
          <span className="kiosk-ticker-speaker">{prefix}</span>
        ) : null}
        {text}
      </span>
    </span>
  );
}
