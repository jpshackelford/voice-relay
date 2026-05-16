import { useRef, useCallback, useState, useEffect } from 'react';

interface UseAudioAnalyserOptions {
  fftSize?: number;
}

interface UseAudioAnalyserReturn {
  isActive: boolean;
  analyser: AnalyserNode | null;
  dataArray: Uint8Array<ArrayBuffer> | null;
  start: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

/**
 * Hook to capture microphone audio and provide analyser data for visualization.
 * Returns an AnalyserNode and Uint8Array for drawing oscilloscope/waveform.
 */
export function useAudioAnalyser({
  fftSize = 2048,
}: UseAudioAnalyserOptions = {}): UseAudioAnalyserReturn {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const start = useCallback(async () => {
    if (isActive) return;
    
    setError(null);
    
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Create audio context and nodes
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      await audioCtx.resume();
      
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      
      analyser.fftSize = fftSize;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      source.connect(analyser);
      // Note: NOT connecting to destination to avoid feedback
      
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      dataArrayRef.current = dataArray;
      
      setIsActive(true);
    } catch (err) {
      console.error('[AudioAnalyser] Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
    }
  }, [isActive, fftSize]);

  const stop = useCallback(() => {
    // Stop all tracks on the media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Disconnect source
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    dataArrayRef.current = null;
    setIsActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isActive,
    analyser: analyserRef.current,
    dataArray: dataArrayRef.current,
    start,
    stop,
    error,
  };
}
