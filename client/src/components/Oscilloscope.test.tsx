import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { Oscilloscope } from './Oscilloscope';

// Mock canvas context
const mockCanvasContext = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  lineWidth: 0,
  strokeStyle: '',
  shadowBlur: 0,
  shadowColor: '',
  lineCap: '' as CanvasLineCap,
  lineJoin: '' as CanvasLineJoin,
};

describe('Oscilloscope', () => {
  let mockAnalyser: {
    getByteTimeDomainData: ReturnType<typeof vi.fn>;
  };
  let mockDataArray: Uint8Array<ArrayBuffer>;
  let originalRequestAnimationFrame: typeof requestAnimationFrame;
  let animationFrameCallback: FrameRequestCallback | null = null;
  let animationFrameId = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock canvas getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCanvasContext);

    // Mock requestAnimationFrame
    originalRequestAnimationFrame = global.requestAnimationFrame;
    global.requestAnimationFrame = vi.fn((callback) => {
      animationFrameCallback = callback;
      return ++animationFrameId;
    });
    global.cancelAnimationFrame = vi.fn();

    // Create mock analyser and data
    mockAnalyser = {
      getByteTimeDomainData: vi.fn(),
    };
    const buffer = new ArrayBuffer(1024);
    mockDataArray = new Uint8Array(buffer);
    // Fill with center value (silence)
    mockDataArray.fill(128);
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    animationFrameCallback = null;
  });

  describe('rendering', () => {
    it('renders canvas element', () => {
      const { container } = render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
        />
      );
      
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeDefined();
    });

    it('applies oscilloscope-canvas class', () => {
      const { container } = render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
        />
      );
      
      const canvas = container.querySelector('.oscilloscope-canvas');
      expect(canvas).toBeDefined();
    });

    it('sets canvas dimensions from props', () => {
      const { container } = render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
          width={400}
          height={150}
        />
      );
      
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      expect(canvas.width).toBe(400);
      expect(canvas.height).toBe(150);
    });
  });

  describe('inactive state', () => {
    it('draws flat baseline when not active', async () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
          width={300}
          height={120}
        />
      );

      // Trigger animation frame
      await act(async () => {
        animationFrameCallback?.(0);
      });

      // Should draw flat line at center (height/2 = 60)
      expect(mockCanvasContext.moveTo).toHaveBeenCalledWith(0, 60);
      expect(mockCanvasContext.lineTo).toHaveBeenCalledWith(300, 60);
      expect(mockCanvasContext.stroke).toHaveBeenCalled();
    });
  });

  describe('active state', () => {
    it('calls getByteTimeDomainData when active', async () => {
      render(
        <Oscilloscope
          analyser={mockAnalyser as unknown as AnalyserNode}
          dataArray={mockDataArray}
          isActive={true}
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      expect(mockAnalyser.getByteTimeDomainData).toHaveBeenCalledWith(mockDataArray);
    });

    it('draws waveform data when active', async () => {
      // Set up varying audio data
      mockDataArray[0] = 128; // center
      mockDataArray[1] = 255; // max
      mockDataArray[2] = 0;   // min

      render(
        <Oscilloscope
          analyser={mockAnalyser as unknown as AnalyserNode}
          dataArray={mockDataArray}
          isActive={true}
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      // Should have called moveTo for first point and lineTo for rest
      expect(mockCanvasContext.moveTo).toHaveBeenCalled();
      expect(mockCanvasContext.lineTo).toHaveBeenCalled();
      expect(mockCanvasContext.stroke).toHaveBeenCalled();
    });
  });

  describe('styling', () => {
    it('applies custom color', async () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
          color="#ff0000"
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      expect(mockCanvasContext.strokeStyle).toBe('#ff0000');
      expect(mockCanvasContext.shadowColor).toBe('#ff0000');
    });

    it('applies custom line width', async () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
          lineWidth={5}
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      expect(mockCanvasContext.lineWidth).toBe(5);
    });

    it('applies custom glow intensity', async () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
          glowIntensity={20}
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      expect(mockCanvasContext.shadowBlur).toBe(20);
    });

    it('uses default values when not specified', async () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      // Check defaults: color=#00b4ff, lineWidth=2.5, glowIntensity=10
      expect(mockCanvasContext.strokeStyle).toBe('#00b4ff');
      expect(mockCanvasContext.lineWidth).toBe(2.5);
      expect(mockCanvasContext.shadowBlur).toBe(10);
    });
  });

  describe('animation loop', () => {
    it('starts animation loop on mount', () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
        />
      );

      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });

    it('cancels animation frame on unmount', () => {
      const { unmount } = render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
        />
      );

      unmount();

      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });
  });

  describe('canvas clearing', () => {
    it('clears canvas before each draw', async () => {
      render(
        <Oscilloscope
          analyser={null}
          dataArray={null}
          isActive={false}
          width={300}
          height={120}
        />
      );

      await act(async () => {
        animationFrameCallback?.(0);
      });

      expect(mockCanvasContext.clearRect).toHaveBeenCalledWith(0, 0, 300, 120);
    });
  });
});
