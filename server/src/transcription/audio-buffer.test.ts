import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioBufferManager } from './audio-buffer.js';

// Create a mock WebSocket
function createMockWebSocket(): {
  ws: { readyState: number; OPEN: number; send: ReturnType<typeof vi.fn> };
  messages: string[];
} {
  const messages: string[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: vi.fn((data: string) => {
      messages.push(data);
    }),
  };
  return { ws, messages };
}

// Create base64-encoded PCM16 audio data (silence)
function createSilentAudioChunk(samples: number): string {
  const buffer = Buffer.alloc(samples * 2); // 16-bit = 2 bytes per sample
  return buffer.toString('base64');
}

describe('AudioBufferManager', () => {
  let manager: AudioBufferManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new AudioBufferManager({
      maxDurationSeconds: 30,
      sampleRate: 16000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addChunk', () => {
    it('creates a new buffer for first chunk', () => {
      const { ws } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000); // 0.5s at 16kHz

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);

      const stats = manager.getStats();
      expect(stats.deviceCount).toBe(1);
      expect(stats.totalSamples).toBe(8000);
    });

    it('appends to existing buffer', () => {
      const { ws } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);
      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 1, 16000);

      const stats = manager.getStats();
      expect(stats.deviceCount).toBe(1);
      expect(stats.totalSamples).toBe(16000);
    });

    it('handles multiple devices independently', () => {
      const { ws: ws1 } = createMockWebSocket();
      const { ws: ws2 } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.addChunk('device-1', ws1 as unknown as import('ws').WebSocket, audioData, 0, 16000);
      manager.addChunk('device-2', ws2 as unknown as import('ws').WebSocket, audioData, 0, 16000);

      const stats = manager.getStats();
      expect(stats.deviceCount).toBe(2);
      expect(stats.totalSamples).toBe(16000);
    });

    it('warns on sample rate mismatch', () => {
      const { ws } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);
      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 1, 44100);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sample rate mismatch'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('endStream', () => {
    it('processes buffer and clears it', async () => {
      const { ws, messages } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);
      let processedAudio: Buffer | null = null;

      manager.setTranscriptionCallback(async (_deviceId, audio) => {
        processedAudio = audio;
        return { text: 'test transcription' };
      });

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);
      await manager.endStream('device-1', 1);

      expect(processedAudio).not.toBeNull();
      expect(processedAudio!.length).toBe(16000); // 8000 samples * 2 bytes

      // Check transcription result was sent
      expect(messages.length).toBe(1);
      const result = JSON.parse(messages[0]);
      expect(result.type).toBe('transcription-result');
      expect(result.text).toBe('test transcription');
      expect(result.isFinal).toBe(true);

      // Buffer should be cleared
      const stats = manager.getStats();
      expect(stats.deviceCount).toBe(0);
    });

    it('warns when no buffer exists', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await manager.endStream('nonexistent-device', 5);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No buffer found'),
      );

      warnSpy.mockRestore();
    });

    it('sends error message when transcription fails', async () => {
      const { ws, messages } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.setTranscriptionCallback(async () => {
        throw new Error('Transcription service unavailable');
      });

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);
      await manager.endStream('device-1', 1);

      expect(messages.length).toBe(1);
      const result = JSON.parse(messages[0]);
      expect(result.type).toBe('transcription-error');
      expect(result.error).toBe('Transcription service unavailable');
    });

    it('sends no-speech error when transcription returns null', async () => {
      const { ws, messages } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.setTranscriptionCallback(async () => {
        return null;
      });

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);
      await manager.endStream('device-1', 1);

      expect(messages.length).toBe(1);
      const result = JSON.parse(messages[0]);
      expect(result.type).toBe('transcription-error');
      expect(result.code).toBe('no-speech');
    });
  });

  describe('removeDevice', () => {
    it('removes buffer for disconnected device', () => {
      const { ws } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);
      expect(manager.getStats().deviceCount).toBe(1);

      manager.removeDevice('device-1');
      expect(manager.getStats().deviceCount).toBe(0);
    });

    it('handles removing non-existent device gracefully', () => {
      expect(() => manager.removeDevice('nonexistent')).not.toThrow();
    });
  });

  describe('auto-processing timeout', () => {
    it('auto-processes buffer after timeout', async () => {
      const { ws, messages } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.setTranscriptionCallback(async () => {
        return { text: 'timeout transcription' };
      });

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);

      // Fast-forward past the timeout (10 seconds)
      vi.advanceTimersByTime(11000);

      // Need to flush promises
      await vi.runAllTimersAsync();

      expect(messages.length).toBe(1);
      const result = JSON.parse(messages[0]);
      expect(result.type).toBe('transcription-result');
      expect(result.text).toBe('timeout transcription');
    });

    it('resets timeout on each new chunk', async () => {
      const { ws, messages } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.setTranscriptionCallback(async () => {
        return { text: 'delayed transcription' };
      });

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);

      // Advance 5 seconds (half the timeout)
      await vi.advanceTimersByTimeAsync(5000);

      // Add another chunk - should reset timeout
      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 1, 16000);

      // Advance 9 seconds - still within the 10 second timeout from the second chunk
      await vi.advanceTimersByTimeAsync(9000);

      // Should not have processed yet since timeout reset to 10s from second chunk
      expect(messages.length).toBe(0);

      // Advance past the full timeout from second chunk (another 2 seconds)
      await vi.advanceTimersByTimeAsync(2000);

      // Now it should be processed
      expect(messages.length).toBe(1);
    });
  });

  describe('max duration limit', () => {
    it('processes buffer when max duration exceeded', async () => {
      const { ws, messages } = createMockWebSocket();
      // Create a chunk that's 31 seconds at 16kHz (exceeds 30s limit)
      const largeSamples = 31 * 16000;
      const largeAudioData = createSilentAudioChunk(largeSamples);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      manager.setTranscriptionCallback(async () => {
        return { text: 'truncated' };
      });

      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, largeAudioData, 0, 16000);
      
      // Wait for async processing
      await vi.runAllTimersAsync();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Max duration exceeded'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      const { ws: ws1 } = createMockWebSocket();
      const { ws: ws2 } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      manager.addChunk('device-1', ws1 as unknown as import('ws').WebSocket, audioData, 0, 16000);
      manager.addChunk('device-1', ws1 as unknown as import('ws').WebSocket, audioData, 1, 16000);
      manager.addChunk('device-2', ws2 as unknown as import('ws').WebSocket, audioData, 0, 16000);

      const stats = manager.getStats();
      expect(stats.deviceCount).toBe(2);
      expect(stats.totalSamples).toBe(24000);
      expect(stats.totalBytes).toBe(48000); // 24000 samples * 2 bytes
    });

    it('returns zeros when no buffers', () => {
      const stats = manager.getStats();
      expect(stats.deviceCount).toBe(0);
      expect(stats.totalSamples).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });
  });

  describe('setTranscriptionCallback', () => {
    it('uses new callback after being set', async () => {
      const { ws, messages } = createMockWebSocket();
      const audioData = createSilentAudioChunk(8000);

      // Add chunk before callback is set
      manager.addChunk('device-1', ws as unknown as import('ws').WebSocket, audioData, 0, 16000);

      // Set callback
      manager.setTranscriptionCallback(async () => {
        return { text: 'late callback' };
      });

      await manager.endStream('device-1', 1);

      expect(messages.length).toBe(1);
      const result = JSON.parse(messages[0]);
      expect(result.text).toBe('late callback');
    });
  });
});
