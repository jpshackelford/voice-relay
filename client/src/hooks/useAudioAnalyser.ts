import { useRef, useCallback, useState, useEffect } from 'react';

interface UseAudioAnalyserOptions {
  fftSize?: number;
}

interface UseAudioAnalyserReturn {
  isActive: boolean;
  analyser: AnalyserNode | null;
  dataArray: Uint8Array<ArrayBuffer> | null;
  start: (existingStream?: MediaStream) => Promise<MediaStream | undefined>;
  stop: () => void;
  error: string | null;
}

/**
 * Hook to capture microphone audio and provide analyser data for visualization.
 * Returns an AnalyserNode and Uint8Array for drawing oscilloscope/waveform.
 * 
 * Supports sharing a MediaStream: pass an existing stream to start(), or let it create one.
 * Returns the MediaStream so it can be shared with other consumers (e.g., speech recognition).
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
  const ownsStreamRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);

  const start = useCallback(async (existingStream?: MediaStream): Promise<MediaStream | undefined> => {
    if (isActive) return streamRef.current ?? undefined;
    
    cancelledRef.current = false;
    setError(null);
    
    try {
      // Use existing stream or request microphone access
      let stream: MediaStream;
      if (existingStream) {
        stream = existingStream;
        ownsStreamRef.current = false;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ownsStreamRef.current = true;
      }
      
      // Check if cancelled during async operation
      if (cancelledRef.current) {
        if (ownsStreamRef.current) {
          stream.getTracks().forEach(track => track.stop());
        }
        return undefined;
      }
      
      streamRef.current = stream;
      
      // Create audio context and nodes
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      await audioCtx.resume();
      
      // Check if cancelled during async operation
      if (cancelledRef.current) {
        audioCtx.close();
        if (ownsStreamRef.current) {
          stream.getTracks().forEach(track => track.stop());
        }
        return undefined;
      }
      
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
      return stream;
    } catch (err) {
      if (cancelledRef.current) return undefined;
      console.error('[AudioAnalyser] Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
      return undefined;
    }
  }, [isActive, fftSize]);

  const stop = useCallback(() => {
    // Set cancellation flag for any in-flight async operations
    cancelledRef.current = true;
    
    // Only stop tracks if we own the stream
    if (streamRef.current && ownsStreamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    streamRef.current = null;
    ownsStreamRef.current = false;
    
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
      cancelledRef.current = true;
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
