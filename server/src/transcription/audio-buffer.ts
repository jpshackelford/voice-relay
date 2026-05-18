import type { WebSocket } from 'ws';
import type { TranscriptionResultMessage, TranscriptionErrorMessage } from '../types.js';

export interface AudioBufferOptions {
  /** Maximum buffer duration in seconds (default: 30s) */
  maxDurationSeconds?: number;
  /** Sample rate of incoming audio (default: 16000) */
  sampleRate?: number;
  /** Callback when transcription is ready to be processed */
  onTranscriptionReady?: (deviceId: string, audioData: Buffer, sampleRate: number) => Promise<{ text: string; confidence?: number } | null>;
}

interface DeviceAudioBuffer {
  deviceId: string;
  ws: WebSocket;
  chunks: Buffer[];
  sampleRate: number;
  totalSamples: number;
  startTime: number;
  lastChunkTime: number;
  chunkCount: number;
}

/**
 * Manages audio buffers for devices streaming audio for transcription.
 * 
 * Audio chunks are accumulated per-device until the device signals end-of-speech
 * or a timeout occurs. The accumulated audio is then sent for transcription.
 * 
 * ## Buffer Lifecycle
 * 1. First chunk: Creates new buffer for device
 * 2. Subsequent chunks: Appends to device buffer
 * 3. audio-input-end: Triggers transcription processing
 * 4. Timeout: Auto-processes if no end signal received
 * 
 * ## Memory Management
 * - Per-device buffers are cleaned up after processing
 * - Maximum buffer size prevents memory exhaustion
 * - Orphaned buffers are cleaned up on disconnect
 */
export class AudioBufferManager {
  private buffers = new Map<string, DeviceAudioBuffer>();
  private maxDurationSeconds: number;
  private defaultSampleRate: number;
  private onTranscriptionReady?: (deviceId: string, audioData: Buffer, sampleRate: number) => Promise<{ text: string; confidence?: number } | null>;
  
  // Timeout for auto-processing if no end signal (10 seconds)
  private readonly AUTO_PROCESS_TIMEOUT_MS = 10000;
  private timeouts = new Map<string, NodeJS.Timeout>();

  constructor(options: AudioBufferOptions = {}) {
    this.maxDurationSeconds = options.maxDurationSeconds ?? 30;
    this.defaultSampleRate = options.sampleRate ?? 16000;
    this.onTranscriptionReady = options.onTranscriptionReady;
  }

  /**
   * Add an audio chunk to the device's buffer.
   * Creates a new buffer if this is the first chunk.
   */
  addChunk(
    deviceId: string,
    ws: WebSocket,
    audioBase64: string,
    chunkIndex: number,
    sampleRate?: number
  ): void {
    const effectiveSampleRate = sampleRate ?? this.defaultSampleRate;
    const audioData = Buffer.from(audioBase64, 'base64');
    const now = Date.now();
    
    let buffer = this.buffers.get(deviceId);
    
    if (!buffer) {
      // First chunk - create new buffer
      buffer = {
        deviceId,
        ws,
        chunks: [],
        sampleRate: effectiveSampleRate,
        totalSamples: 0,
        startTime: now,
        lastChunkTime: now,
        chunkCount: 0,
      };
      this.buffers.set(deviceId, buffer);
      console.log(`[AudioBuffer] Created buffer for device ${deviceId}`);
    }
    
    // Validate sample rate consistency
    if (buffer.sampleRate !== effectiveSampleRate) {
      console.warn(`[AudioBuffer] Sample rate mismatch for ${deviceId}: expected ${buffer.sampleRate}, got ${effectiveSampleRate}`);
    }
    
    // Check max duration
    const maxSamples = this.maxDurationSeconds * buffer.sampleRate;
    const samplesInChunk = audioData.length / 2; // 16-bit PCM = 2 bytes per sample
    
    if (buffer.totalSamples + samplesInChunk > maxSamples) {
      console.warn(`[AudioBuffer] Max duration exceeded for ${deviceId}, processing current buffer`);
      this.processBuffer(deviceId);
      return;
    }
    
    // Add chunk to buffer
    buffer.chunks.push(audioData);
    buffer.totalSamples += samplesInChunk;
    buffer.lastChunkTime = now;
    buffer.chunkCount++;
    
    // Reset auto-process timeout
    this.resetTimeout(deviceId);
    
    // Log progress periodically
    if (chunkIndex % 10 === 0) {
      const durationSec = buffer.totalSamples / buffer.sampleRate;
      console.log(`[AudioBuffer] Device ${deviceId}: ${buffer.chunkCount} chunks, ${durationSec.toFixed(1)}s buffered`);
    }
  }

  /**
   * Signal that audio streaming has ended for this device.
   * Triggers transcription processing.
   */
  async endStream(deviceId: string, totalChunks: number): Promise<void> {
    const buffer = this.buffers.get(deviceId);
    
    if (!buffer) {
      console.warn(`[AudioBuffer] No buffer found for device ${deviceId} on end signal`);
      return;
    }
    
    // Validate chunk count
    if (buffer.chunkCount !== totalChunks) {
      console.warn(`[AudioBuffer] Chunk count mismatch for ${deviceId}: received ${buffer.chunkCount}, expected ${totalChunks}`);
    }
    
    // Clear timeout since we're processing now
    this.clearTimeout(deviceId);
    
    await this.processBuffer(deviceId);
  }

  /**
   * Remove buffer for a disconnecting device.
   */
  removeDevice(deviceId: string): void {
    this.clearTimeout(deviceId);
    const hadBuffer = this.buffers.delete(deviceId);
    if (hadBuffer) {
      console.log(`[AudioBuffer] Removed buffer for disconnected device ${deviceId}`);
    }
  }

  /**
   * Get statistics about current buffers (for debugging/monitoring).
   */
  getStats(): { deviceCount: number; totalSamples: number; totalBytes: number } {
    let totalSamples = 0;
    let totalBytes = 0;
    
    for (const buffer of this.buffers.values()) {
      totalSamples += buffer.totalSamples;
      for (const chunk of buffer.chunks) {
        totalBytes += chunk.length;
      }
    }
    
    return {
      deviceCount: this.buffers.size,
      totalSamples,
      totalBytes,
    };
  }

  /**
   * Set the transcription callback.
   */
  setTranscriptionCallback(
    callback: (deviceId: string, audioData: Buffer, sampleRate: number) => Promise<{ text: string; confidence?: number } | null>
  ): void {
    this.onTranscriptionReady = callback;
  }

  /**
   * Process the audio buffer for a device.
   * Concatenates chunks and sends for transcription.
   */
  private async processBuffer(deviceId: string): Promise<void> {
    const buffer = this.buffers.get(deviceId);
    
    if (!buffer || buffer.chunks.length === 0) {
      this.buffers.delete(deviceId);
      return;
    }
    
    const ws = buffer.ws;
    const sampleRate = buffer.sampleRate;
    const durationSec = buffer.totalSamples / sampleRate;
    
    console.log(`[AudioBuffer] Processing buffer for ${deviceId}: ${buffer.chunkCount} chunks, ${durationSec.toFixed(1)}s`);
    
    // Concatenate all chunks
    const audioData = Buffer.concat(buffer.chunks);
    
    // Clear the buffer
    this.buffers.delete(deviceId);
    
    // Process transcription
    if (this.onTranscriptionReady) {
      try {
        const result = await this.onTranscriptionReady(deviceId, audioData, sampleRate);
        
        if (result && ws.readyState === ws.OPEN) {
          const message: TranscriptionResultMessage = {
            type: 'transcription-result',
            text: result.text,
            isFinal: true,
            confidence: result.confidence,
          };
          ws.send(JSON.stringify(message));
          console.log(`[AudioBuffer] Transcription sent to ${deviceId}: "${result.text.substring(0, 50)}..."`);
        } else if (!result && ws.readyState === ws.OPEN) {
          // No transcription result (e.g., no speech detected)
          const message: TranscriptionErrorMessage = {
            type: 'transcription-error',
            error: 'No speech detected',
            code: 'no-speech',
          };
          ws.send(JSON.stringify(message));
        }
      } catch (err) {
        console.error(`[AudioBuffer] Transcription error for ${deviceId}:`, err);
        
        if (ws.readyState === ws.OPEN) {
          const message: TranscriptionErrorMessage = {
            type: 'transcription-error',
            error: err instanceof Error ? err.message : 'Transcription failed',
            code: 'unknown',
          };
          ws.send(JSON.stringify(message));
        }
      }
    } else {
      // No transcription callback - just log
      console.log(`[AudioBuffer] No transcription callback set, discarding ${audioData.length} bytes for ${deviceId}`);
    }
  }

  /**
   * Reset the auto-process timeout for a device.
   */
  private resetTimeout(deviceId: string): void {
    this.clearTimeout(deviceId);
    
    const timeout = setTimeout(() => {
      console.log(`[AudioBuffer] Auto-processing buffer for ${deviceId} (timeout)`);
      this.processBuffer(deviceId);
    }, this.AUTO_PROCESS_TIMEOUT_MS);
    
    this.timeouts.set(deviceId, timeout);
  }

  /**
   * Clear the timeout for a device.
   */
  private clearTimeout(deviceId: string): void {
    const timeout = this.timeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(deviceId);
    }
  }
}
