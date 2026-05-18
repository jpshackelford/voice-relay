import { useRef, useCallback, useState, useEffect } from 'react';

export interface AudioStreamingOptions {
  /** Callback when transcription is received from server */
  onTranscription?: (text: string, isFinal: boolean) => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
  /** Audio sample rate (default: 16000 Hz for Whisper compatibility) */
  sampleRate?: number;
  /** Chunk duration in milliseconds (default: 500ms) */
  chunkDurationMs?: number;
}

export interface AudioStreamingReturn {
  /** Whether audio streaming is currently active */
  isStreaming: boolean;
  /** Current error message, if any */
  error: string | null;
  /** Start streaming audio from the provided MediaStream */
  start: (stream: MediaStream, sendAudioChunk: (chunk: ArrayBuffer) => void) => Promise<void>;
  /** Stop streaming audio */
  stop: () => void;
  /** Get the current audio analyser node (for visualization) */
  getAnalyser: () => AnalyserNode | null;
  /** Get the data array for visualization */
  getDataArray: () => Uint8Array | null;
}

/**
 * Hook for streaming audio chunks over WebSocket for server-side transcription.
 * 
 * This hook captures audio from a MediaStream, processes it into PCM chunks
 * suitable for speech recognition, and sends them via a callback function.
 * 
 * The stream is NOT owned by this hook - the caller is responsible for
 * stopping the MediaStream tracks when done.
 * 
 * ## Audio Processing
 * - Resamples to 16kHz (Whisper-compatible)
 * - Converts to 16-bit PCM (linear)
 * - Chunks audio at configurable intervals
 * 
 * ## Usage with useAudioAnalyser
 * This hook can share a MediaStream with useAudioAnalyser for visualization.
 * Create the stream once, pass to both hooks.
 */
export function useAudioStreaming(options: AudioStreamingOptions = {}): AudioStreamingReturn {
  const {
    onTranscription,
    onError,
    sampleRate = 16000,
    chunkDurationMs = 500,
  } = options;

  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const sendChunkRef = useRef<((chunk: ArrayBuffer) => void) | null>(null);
  
  // Buffer for accumulating samples before sending
  const sampleBufferRef = useRef<Float32Array>(new Float32Array(0));
  const samplesPerChunk = Math.floor(sampleRate * (chunkDurationMs / 1000));

  // Keep callbacks in refs to avoid stale closures
  const onTranscriptionRef = useRef(onTranscription);
  const onErrorRef = useRef(onError);
  
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
    onErrorRef.current = onError;
  }, [onTranscription, onError]);

  /**
   * Convert Float32Array audio samples to 16-bit PCM ArrayBuffer.
   * This is the format expected by most speech recognition services.
   */
  const float32ToPCM16 = useCallback((float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp the value to [-1, 1] range
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit signed integer
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(i * 2, int16, true); // little-endian
    }
    
    return buffer;
  }, []);

  /**
   * Process accumulated audio samples and send as chunks.
   */
  const processAudioBuffer = useCallback(() => {
    if (!sendChunkRef.current) return;
    
    const buffer = sampleBufferRef.current;
    if (buffer.length < samplesPerChunk) return;
    
    // Extract a chunk's worth of samples
    const chunk = buffer.slice(0, samplesPerChunk);
    sampleBufferRef.current = buffer.slice(samplesPerChunk);
    
    // Convert to PCM16 and send
    const pcmData = float32ToPCM16(chunk);
    sendChunkRef.current(pcmData);
  }, [samplesPerChunk, float32ToPCM16]);

  /**
   * Start streaming audio from the provided MediaStream.
   * 
   * @param stream - MediaStream to capture audio from (not owned - caller must stop tracks)
   * @param sendAudioChunk - Callback to send audio chunks to server
   */
  const start = useCallback(async (
    stream: MediaStream,
    sendAudioChunk: (chunk: ArrayBuffer) => void
  ): Promise<void> => {
    if (isStreaming) return;
    
    setError(null);
    sendChunkRef.current = sendAudioChunk;
    sampleBufferRef.current = new Float32Array(0);

    try {
      // Create audio context with target sample rate
      const AudioContextClass = window.AudioContext || 
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      
      const audioContext = new AudioContextClass({ sampleRate });
      audioContextRef.current = audioContext;
      
      // Resume context if suspended (required for some browsers)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Create source from stream
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create analyser for visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      
      source.connect(analyser);

      // Use ScriptProcessorNode for audio capture (AudioWorklet would be better but requires more setup)
      // Note: ScriptProcessorNode is deprecated but widely supported; 
      // we can migrate to AudioWorklet in a future iteration
      const bufferSize = 4096;
      const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      scriptProcessor.onaudioprocess = (event) => {
        if (!isStreaming) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Append to buffer
        const currentBuffer = sampleBufferRef.current;
        const newBuffer = new Float32Array(currentBuffer.length + inputData.length);
        newBuffer.set(currentBuffer);
        newBuffer.set(inputData, currentBuffer.length);
        sampleBufferRef.current = newBuffer;
        
        // Process if we have enough samples
        processAudioBuffer();
      };

      // Connect the processing chain
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      
      // Store reference for cleanup
      workletNodeRef.current = scriptProcessor as unknown as AudioWorkletNode;
      
      setIsStreaming(true);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start audio streaming';
      setError(message);
      onErrorRef.current?.(message);
      
      // Cleanup on error
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    }
  }, [isStreaming, sampleRate, processAudioBuffer]);

  /**
   * Stop streaming audio.
   */
  const stop = useCallback(() => {
    // Send any remaining buffered audio
    if (sendChunkRef.current && sampleBufferRef.current.length > 0) {
      const pcmData = float32ToPCM16(sampleBufferRef.current);
      sendChunkRef.current(pcmData);
    }
    
    // Disconnect and clean up
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    dataArrayRef.current = null;
    sendChunkRef.current = null;
    sampleBufferRef.current = new Float32Array(0);
    
    setIsStreaming(false);
  }, [float32ToPCM16]);

  /**
   * Get the analyser node for visualization.
   */
  const getAnalyser = useCallback((): AnalyserNode | null => {
    return analyserRef.current;
  }, []);

  /**
   * Get the data array for visualization.
   */
  const getDataArray = useCallback((): Uint8Array | null => {
    return dataArrayRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isStreaming,
    error,
    start,
    stop,
    getAnalyser,
    getDataArray,
  };
}
