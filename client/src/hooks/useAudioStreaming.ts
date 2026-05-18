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
  
  // Ref to track streaming state in callbacks (avoids stale closure issues)
  const isStreamingRef = useRef(false);
  
  // Buffer for accumulating samples before sending - using ring buffer for performance
  const ringBufferRef = useRef<{ data: Float32Array; writeIndex: number; length: number }>({
    data: new Float32Array(0),
    writeIndex: 0,
    length: 0,
  });
  
  // Ref for samplesPerChunk to avoid stale closures in callbacks
  const samplesPerChunkRef = useRef(Math.floor(sampleRate * (chunkDurationMs / 1000)));
  
  useEffect(() => {
    samplesPerChunkRef.current = Math.floor(sampleRate * (chunkDurationMs / 1000));
  }, [sampleRate, chunkDurationMs]);

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
   * Uses ring buffer for efficient memory management.
   */
  const processAudioBuffer = useCallback(() => {
    if (!sendChunkRef.current) return;
    
    const ringBuffer = ringBufferRef.current;
    const samplesPerChunk = samplesPerChunkRef.current;
    
    while (ringBuffer.length >= samplesPerChunk) {
      // Extract a chunk's worth of samples from ring buffer
      const chunk = new Float32Array(samplesPerChunk);
      const bufferCapacity = ringBuffer.data.length;
      const readIndex = (ringBuffer.writeIndex - ringBuffer.length + bufferCapacity) % bufferCapacity;
      
      for (let i = 0; i < samplesPerChunk; i++) {
        chunk[i] = ringBuffer.data[(readIndex + i) % bufferCapacity];
      }
      
      ringBuffer.length -= samplesPerChunk;
      
      // Convert to PCM16 and send
      const pcmData = float32ToPCM16(chunk);
      sendChunkRef.current!(pcmData);
    }
  }, [float32ToPCM16]);

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
    if (isStreamingRef.current) return;
    
    setError(null);
    sendChunkRef.current = sendAudioChunk;
    
    // Initialize ring buffer with capacity for ~60 seconds of audio at target sample rate
    // This pre-allocation avoids memory allocations during audio processing
    const bufferCapacity = sampleRate * 60;
    ringBufferRef.current = {
      data: new Float32Array(bufferCapacity),
      writeIndex: 0,
      length: 0,
    };

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
        // Use ref to avoid stale closure - isStreaming state is captured at callback creation
        if (!isStreamingRef.current) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        const ringBuffer = ringBufferRef.current;
        const capacity = ringBuffer.data.length;
        
        // Check if we have room for new data - process first if overflow would occur
        const availableSpace = capacity - ringBuffer.length;
        if (inputData.length > availableSpace) {
          console.warn('[AudioStreaming] Ring buffer overflow, processing before write');
          processAudioBuffer();
        }
        
        // Write to ring buffer (no allocation, just index update)
        for (let i = 0; i < inputData.length; i++) {
          ringBuffer.data[ringBuffer.writeIndex] = inputData[i];
          ringBuffer.writeIndex = (ringBuffer.writeIndex + 1) % capacity;
        }
        ringBuffer.length = Math.min(ringBuffer.length + inputData.length, capacity);
        
        // Process if we have enough samples for a chunk
        processAudioBuffer();
      };

      // Connect the processing chain
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      
      // Store reference for cleanup
      workletNodeRef.current = scriptProcessor as unknown as AudioWorkletNode;
      
      // Update both ref and state - ref for callbacks, state for UI
      isStreamingRef.current = true;
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
  }, [sampleRate, processAudioBuffer]);

  /**
   * Stop streaming audio.
   */
  const stop = useCallback(() => {
    // Send any remaining buffered audio from ring buffer
    const ringBuffer = ringBufferRef.current;
    if (sendChunkRef.current && ringBuffer.length > 0) {
      // Extract remaining samples from ring buffer
      const remaining = new Float32Array(ringBuffer.length);
      const capacity = ringBuffer.data.length;
      const readIndex = (ringBuffer.writeIndex - ringBuffer.length + capacity) % capacity;
      
      for (let i = 0; i < ringBuffer.length; i++) {
        remaining[i] = ringBuffer.data[(readIndex + i) % capacity];
      }
      
      const pcmData = float32ToPCM16(remaining);
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
    ringBufferRef.current = { data: new Float32Array(0), writeIndex: 0, length: 0 };
    
    // Update both ref and state
    isStreamingRef.current = false;
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
