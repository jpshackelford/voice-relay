import { useRef, useEffect } from 'react';

interface OscilloscopeProps {
  analyser: AnalyserNode | null;
  dataArray: Uint8Array<ArrayBuffer> | null;
  isActive: boolean;
  width?: number;
  height?: number;
  color?: string;
  lineWidth?: number;
  glowIntensity?: number;
}

/**
 * Canvas-based oscilloscope component that visualizes audio waveform data.
 * Displays a phosphor-style glowing waveform when active, flat line when idle.
 */
export function Oscilloscope({
  analyser,
  dataArray,
  isActive,
  width = 300,
  height = 120,
  color = '#00b4ff',
  lineWidth = 2.5,
  glowIntensity = 10,
}: OscilloscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Configure line style with glow
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.shadowBlur = glowIntensity;
      ctx.shadowColor = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();

      if (isActive && analyser && dataArray) {
        // Get current waveform data
        analyser.getByteTimeDomainData(dataArray);
        
        const bufferLength = dataArray.length;
        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          // Normalize byte data (0-255) to canvas height
          // 128 = silence/center, 0 = min, 255 = max
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
      } else {
        // Draw flat baseline when not active
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
      }

      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, dataArray, isActive, width, height, color, lineWidth, glowIntensity]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="oscilloscope-canvas"
    />
  );
}
