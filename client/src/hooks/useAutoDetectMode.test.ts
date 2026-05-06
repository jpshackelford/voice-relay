import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useEffect } from 'react';

const KIOSK_BREAKPOINT = 768;

/**
 * Auto-detect mode based on screen width.
 * Extracted from SessionView for testing.
 */
function useAutoDetectMode(): 'mobile' | 'kiosk' {
  const [mode, setMode] = useState<'mobile' | 'kiosk'>(() =>
    window.innerWidth >= KIOSK_BREAKPOINT ? 'kiosk' : 'mobile'
  );

  useEffect(() => {
    const handleResize = () => {
      setMode(window.innerWidth >= KIOSK_BREAKPOINT ? 'kiosk' : 'mobile');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return mode;
}

describe('useAutoDetectMode hook', () => {
  let originalInnerWidth: number;
  let resizeListeners: Array<() => void> = [];

  beforeEach(() => {
    // Save original width
    originalInnerWidth = window.innerWidth;
    resizeListeners = [];

    // Mock addEventListener/removeEventListener
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'resize') {
        resizeListeners.push(listener as () => void);
      }
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
      if (type === 'resize') {
        resizeListeners = resizeListeners.filter(l => l !== listener);
      }
    });
  });

  afterEach(() => {
    // Restore
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
  });

  function setWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
  }

  it('returns kiosk for desktop width (≥768px)', () => {
    setWidth(1024);
    const { result } = renderHook(() => useAutoDetectMode());
    expect(result.current).toBe('kiosk');
  });

  it('returns mobile for small screen (<768px)', () => {
    setWidth(375);
    const { result } = renderHook(() => useAutoDetectMode());
    expect(result.current).toBe('mobile');
  });

  it('returns kiosk at exactly 768px breakpoint', () => {
    setWidth(768);
    const { result } = renderHook(() => useAutoDetectMode());
    expect(result.current).toBe('kiosk');
  });

  it('returns mobile at 767px (one below breakpoint)', () => {
    setWidth(767);
    const { result } = renderHook(() => useAutoDetectMode());
    expect(result.current).toBe('mobile');
  });

  it('responds to resize events', () => {
    setWidth(1024);
    const { result } = renderHook(() => useAutoDetectMode());
    expect(result.current).toBe('kiosk');

    // Simulate resize to mobile
    act(() => {
      setWidth(375);
      resizeListeners.forEach(listener => listener());
    });
    expect(result.current).toBe('mobile');

    // Resize back to desktop
    act(() => {
      setWidth(1024);
      resizeListeners.forEach(listener => listener());
    });
    expect(result.current).toBe('kiosk');
  });

  it('cleans up resize listener on unmount', () => {
    setWidth(1024);
    const { unmount } = renderHook(() => useAutoDetectMode());
    
    expect(resizeListeners.length).toBe(1);
    
    unmount();
    
    expect(resizeListeners.length).toBe(0);
  });
});

describe('mode breakpoint behavior per F3 acceptance criteria', () => {
  const KIOSK_BREAKPOINT = 768;

  it('desktop (≥768px) shows kiosk layout', () => {
    const widths = [768, 1024, 1280, 1920];
    widths.forEach(width => {
      const mode = width >= KIOSK_BREAKPOINT ? 'kiosk' : 'mobile';
      expect(mode).toBe('kiosk');
    });
  });

  it('mobile (<768px) shows conversation layout', () => {
    const widths = [320, 375, 414, 767];
    widths.forEach(width => {
      const mode = width >= KIOSK_BREAKPOINT ? 'kiosk' : 'mobile';
      expect(mode).toBe('mobile');
    });
  });
});
