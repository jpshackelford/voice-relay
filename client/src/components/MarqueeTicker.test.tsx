import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MarqueeTicker } from './MarqueeTicker';

/**
 * MarqueeTicker tests.
 *
 * happy-dom does not perform real layout, so `scrollWidth` and `clientWidth`
 * are both 0 by default. We stub those getters per-test to simulate the
 * "fits" vs "overflows" cases and assert the transform is computed
 * correctly.
 */

describe('MarqueeTicker', () => {
  // Saves the original descriptors so we can restore after each test
  // (other suites rely on the default 0 values).
  const originalScrollWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollWidth'
  );
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth'
  );

  function stubWidths(scrollWidth: number, clientWidth: number) {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        // Inner span (the measured one) reports `scrollWidth`. The wrapper
        // also has a scrollWidth but isn't read by the component.
        return scrollWidth;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return clientWidth;
      },
    });
  }

  afterEach(() => {
    if (originalScrollWidth) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
    }
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    vi.restoreAllMocks();
  });

  it('renders the provided text', () => {
    render(<MarqueeTicker text="hello world" data-testid="m" />);
    expect(screen.getByTestId('m').textContent).toBe('hello world');
  });

  it('applies no horizontal translation when the text fits inside the wrapper', () => {
    // scrollWidth (100) <= clientWidth (200) → fits, no overflow
    stubWidths(100, 200);
    const { getByTestId } = render(<MarqueeTicker text="short" data-testid="m" />);
    const inner = getByTestId('m').querySelector('span');
    expect(inner?.style.transform).toBe('translateX(0)');
  });

  it('translates the inner span left by the overflowed pixel count', () => {
    // scrollWidth (500) > clientWidth (200) → 300px overflow
    stubWidths(500, 200);
    const { getByTestId } = render(
      <MarqueeTicker text="lots and lots of overflowing words" data-testid="m" />
    );
    const inner = getByTestId('m').querySelector('span');
    expect(inner?.style.transform).toBe('translateX(-300px)');
  });

  it('resets the transform when text becomes empty', () => {
    stubWidths(500, 200);
    const { getByTestId, rerender } = render(
      <MarqueeTicker text="overflowing content" data-testid="m" />
    );
    const inner = getByTestId('m').querySelector('span');
    expect(inner?.style.transform).toBe('translateX(-300px)');

    // Idle/stale clear: parent resets to empty string.
    act(() => {
      rerender(<MarqueeTicker text="" data-testid="m" />);
    });
    expect(inner?.style.transform).toBe('translateX(0)');
  });

  it('recomputes the transform when text changes', () => {
    // Start with overflow…
    stubWidths(400, 200);
    const { getByTestId, rerender } = render(
      <MarqueeTicker text="first chunk" data-testid="m" />
    );
    const inner = getByTestId('m').querySelector('span');
    expect(inner?.style.transform).toBe('translateX(-200px)');

    // …growing text increases the overflow.
    stubWidths(700, 200);
    act(() => {
      rerender(<MarqueeTicker text="first chunk plus more arriving words" data-testid="m" />);
    });
    expect(inner?.style.transform).toBe('translateX(-500px)');
  });

  it('applies a CSS transition so new content slides in', () => {
    stubWidths(0, 0);
    const { getByTestId } = render(
      <MarqueeTicker text="hi" data-testid="m" transitionMs={350} />
    );
    const inner = getByTestId('m').querySelector('span');
    expect(inner?.style.transition).toBe('transform 350ms linear');
  });

  it('forwards className to the outer wrapper', () => {
    render(<MarqueeTicker text="x" data-testid="m" className="custom-class" />);
    expect(screen.getByTestId('m').classList.contains('custom-class')).toBe(true);
  });
});
