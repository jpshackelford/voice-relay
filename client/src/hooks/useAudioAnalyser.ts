import { useRef, useCallback, useState, useEffect, useMemo } from 'react';

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
 * ## Stream Ownership Model
 * 
 * This hook supports two modes:
 * 
 * 1. **External stream (borrowed)** - `start(existingStream)`:
 *    - The caller owns and manages the MediaStream lifecycle
 *    - Hook will NOT stop tracks on `stop()` - caller is responsible
 *    - Use when sharing a stream across multiple consumers
 *    - Example: MobileMode passes its visualizer stream to avoid duplicate getUserMedia
 * 
 * 2. **Internal stream (owned)** - `start()` with no args:
 *    - Hook requests getUserMedia and owns the resulting stream
 *    - Hook WILL stop tracks on `stop()` or unmount
 *    - Use when this hook is the only stream consumer
 * 
 * The `ownsStreamRef` internal flag tracks which mode is active to ensure
 * proper cleanup behavior. This dual-ownership design enables stream sharing
 * while maintaining correct resource cleanup in simpler use cases.
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
  // Track ownership: true = we created the stream and must stop it; false = caller owns it
  const ownsStreamRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);

  // Ref to track active state for the guard check - avoids stale closure issue
  const isActiveRef = useRef(false);
  
  // Keep ref in sync with state
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const start = useCallback(async (existingStream?: MediaStream): Promise<MediaStream | undefined> => {
    // Use ref for guard check to avoid stale closure - state is set immediately below
    if (isActiveRef.current || cancelledRef.current) return streamRef.current ?? undefined;
    
    cancelledRef.current = false;
    setError(null);
    setIsActive(true); // Set immediately to prevent race condition with rapid start() calls
    isActiveRef.current = true; // Keep ref in sync
    
    // Track resources for cleanup on error - fixes resource leak if error occurs before refs are set
    let audioCtx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    
    try {
      // Use existing stream or request microphone access
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
        setIsActive(false);
        isActiveRef.current = false;
        return undefined;
      }
      
      streamRef.current = stream;
      
      // Create audio context and nodes
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioContextClass();
      await audioCtx.resume();
      
      // Check if cancelled during async operation
      if (cancelledRef.current) {
        audioCtx.close();
        if (ownsStreamRef.current) {
          stream.getTracks().forEach(track => track.stop());
        }
        setIsActive(false);
        isActiveRef.current = false;
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
      
      // isActive already set to true at start of this function
      return stream;
    } catch (err) {
      // Clean up resources created before the error
      if (audioCtx) {
        audioCtx.close();
      }
      if (stream && ownsStreamRef.current) {
        stream.getTracks().forEach(track => track.stop());
      }
      streamRef.current = null;
      
      if (cancelledRef.current) return undefined;
      console.error('[AudioAnalyser] Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
      setIsActive(false); // Reset state on error since we set it immediately at start
      isActiveRef.current = false;
      return undefined;
    }
  }, [fftSize]); // Removed isActive - using isActiveRef to avoid stale closure

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
    isActiveRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stop();
    };
  }, [stop]);

  // Memoize return object to prevent unnecessary re-renders in consumers
  return useMemo(() => ({
    isActive,
    analyser: analyserRef.current,
    dataArray: dataArrayRef.current,
    start,
    stop,
    error,
  }), [isActive, start, stop, error]);
}
