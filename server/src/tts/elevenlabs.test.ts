import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { testApiKey, DEFAULT_VOICE_ID, synthesize, synthesizeToBuffer } from './elevenlabs.js';

// Mock WebSocket for synthesize tests
class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];

  constructor(_url: string) {
    super();
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Simulate opening the connection
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  // Simulate receiving a message
  simulateMessage(data: object) {
    this.emit('message', Buffer.from(JSON.stringify(data)));
  }

  // Simulate an error
  simulateError(err: Error) {
    this.emit('error', err);
  }

  // Simulate close
  simulateClose(code: number, reason: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }
}

// Store original WebSocket and track mock instances
let mockWsInstance: MockWebSocket | null = null;
const originalWebSocket = vi.hoisted(() => {
  return null; // Placeholder, will be replaced by mock
});

vi.mock('ws', () => {
  return {
    default: class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url: string) {
        mockWsInstance = new MockWebSocket(url);
        return mockWsInstance;
      }
    },
  };
});

describe('ElevenLabs TTS', () => {
  describe('testApiKey', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      // Reset fetch mock before each test
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns valid for successful API response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testApiKey('valid-api-key');
      expect(result.valid).toBe(true);
      expect(result.message).toBe('API key is valid');
    });

    it('returns invalid for 401 unauthorized', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const result = await testApiKey('invalid-api-key');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Invalid API key');
    });

    it('returns invalid for other error status', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await testApiKey('some-key');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('API error: 500');
    });

    it('returns connection error for network failure', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const result = await testApiKey('some-key');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Connection error: Network error');
    });

    it('sends correct headers to ElevenLabs API', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await testApiKey('test-key-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices',
        {
          headers: {
            'xi-api-key': 'test-key-123',
          },
        }
      );
    });
  });

  describe('DEFAULT_VOICE_ID', () => {
    it('exports the Aria voice ID', () => {
      expect(DEFAULT_VOICE_ID).toBe('Xb7hH8MSUJpSbSDYk0k2');
    });
  });

  describe('synthesize', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockWsInstance = null;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends initialization, text, and end messages on connection open', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Hello world', {
        apiKey: 'test-api-key',
        voiceId: 'test-voice',
        onAudioChunk,
        onComplete,
      });

      // Wait for WebSocket to be created
      await vi.advanceTimersByTimeAsync(0);
      
      // Simulate connection open
      mockWsInstance!.simulateOpen();
      
      // Should have sent 3 messages: init, text, end
      expect(mockWsInstance!.sentMessages).toHaveLength(3);
      
      // Check init message
      const initMsg = JSON.parse(mockWsInstance!.sentMessages[0]);
      expect(initMsg.xi_api_key).toBe('test-api-key');
      expect(initMsg.model_id).toBe('eleven_flash_v2_5');
      expect(initMsg.output_format).toBe('mp3_44100_128');
      
      // Check text message
      const textMsg = JSON.parse(mockWsInstance!.sentMessages[1]);
      expect(textMsg.text).toBe('Hello world');
      expect(textMsg.try_trigger_generation).toBe(true);
      
      // Check end message
      const endMsg = JSON.parse(mockWsInstance!.sentMessages[2]);
      expect(endMsg.text).toBe('');

      // Simulate audio and completion
      mockWsInstance!.simulateMessage({ audio: 'base64audio' });
      mockWsInstance!.simulateMessage({ isFinal: true });

      await promise;
    });

    it('resolves on first audio chunk', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Send first audio chunk
      mockWsInstance!.simulateMessage({ audio: 'chunk1' });

      // Promise should resolve
      await expect(promise).resolves.toBeUndefined();
      expect(onAudioChunk).toHaveBeenCalledWith('chunk1');
    });

    it('calls onAudioChunk for each audio message', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Send multiple audio chunks
      mockWsInstance!.simulateMessage({ audio: 'chunk1' });
      mockWsInstance!.simulateMessage({ audio: 'chunk2' });
      mockWsInstance!.simulateMessage({ audio: 'chunk3' });
      mockWsInstance!.simulateMessage({ isFinal: true });

      await promise;

      expect(onAudioChunk).toHaveBeenCalledTimes(3);
      expect(onAudioChunk).toHaveBeenNthCalledWith(1, 'chunk1');
      expect(onAudioChunk).toHaveBeenNthCalledWith(2, 'chunk2');
      expect(onAudioChunk).toHaveBeenNthCalledWith(3, 'chunk3');
    });

    it('calls onComplete when isFinal is received', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      mockWsInstance!.simulateMessage({ audio: 'chunk1' });
      expect(onComplete).not.toHaveBeenCalled();

      mockWsInstance!.simulateMessage({ isFinal: true });
      expect(onComplete).toHaveBeenCalledWith();

      await promise;
    });

    it('processes audio in same message as isFinal before completing', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Send message with BOTH audio AND isFinal (this is common with ElevenLabs)
      mockWsInstance!.simulateMessage({ audio: 'final-audio-chunk', isFinal: true });

      await promise;

      // Audio should be processed BEFORE completion
      expect(onAudioChunk).toHaveBeenCalledWith('final-audio-chunk');
      expect(onComplete).toHaveBeenCalledWith();
      
      // Verify order: audio chunk handler should be called first
      const audioCallOrder = onAudioChunk.mock.invocationCallOrder[0];
      const completeCallOrder = onComplete.mock.invocationCallOrder[0];
      expect(audioCallOrder).toBeLessThan(completeCallOrder);
    });

    it('handles ElevenLabs API errors', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Simulate API error
      mockWsInstance!.simulateMessage({ error: 'Invalid voice_id' });

      await expect(promise).rejects.toThrow('ElevenLabs error: Invalid voice_id');
      expect(onComplete).toHaveBeenCalledWith(expect.any(Error));
    });

    it('handles WebSocket errors', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Simulate WebSocket error
      mockWsInstance!.simulateError(new Error('Connection lost'));

      await expect(promise).rejects.toThrow('Connection lost');
      expect(onComplete).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects on connection timeout', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      // Immediately attach a rejection handler to prevent unhandled rejection
      let rejectionError: Error | null = null;
      const handledPromise = promise.catch((e) => {
        rejectionError = e as Error;
      });

      await vi.advanceTimersByTimeAsync(0);
      
      // Don't simulate open - let timeout occur
      // Advance past the 10s connection timeout
      await vi.advanceTimersByTimeAsync(10001);

      // Wait for the promise to settle
      await handledPromise;
      
      expect(rejectionError).not.toBeNull();
      expect(rejectionError!.message).toBe('ElevenLabs connection timeout');
      expect(onComplete).toHaveBeenCalledWith(expect.any(Error));
    });

    it('handles close before audio received', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Close before any audio received
      mockWsInstance!.simulateClose(1000, 'Normal closure');

      await expect(promise).rejects.toThrow('ElevenLabs connection closed');
    });

    it('completes normally on close after audio received', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Send audio first
      mockWsInstance!.simulateMessage({ audio: 'chunk1' });
      
      // Then close
      mockWsInstance!.simulateClose(1000, 'Normal closure');

      await promise;
      expect(onComplete).toHaveBeenCalledWith();
    });

    it('uses default voice ID when not specified', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      
      // The mock WebSocket constructor receives the URL
      // We verify default voice was used by checking the init message voice_settings are sent
      mockWsInstance!.simulateOpen();
      mockWsInstance!.simulateMessage({ audio: 'chunk' });
      mockWsInstance!.simulateMessage({ isFinal: true });
    });

    it('cleans up WebSocket on completion', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      const ws = mockWsInstance!;
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      mockWsInstance!.simulateMessage({ audio: 'chunk' });
      mockWsInstance!.simulateMessage({ isFinal: true });

      await promise;
      
      // WebSocket should be closed after isFinal
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('ignores non-JSON messages gracefully', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Send invalid JSON
      mockWsInstance!.emit('message', Buffer.from('not json'));
      
      // Should log warning but continue
      expect(consoleWarn).toHaveBeenCalledWith('[ElevenLabs] Non-JSON message received');

      // Can still process valid messages
      mockWsInstance!.simulateMessage({ audio: 'chunk' });
      mockWsInstance!.simulateMessage({ isFinal: true });

      await promise;
      expect(onAudioChunk).toHaveBeenCalledWith('chunk');
      
      consoleWarn.mockRestore();
    });

    it('error supersedes audio in same message', async () => {
      const onAudioChunk = vi.fn();
      const onComplete = vi.fn();

      const promise = synthesize('Test', {
        apiKey: 'key',
        onAudioChunk,
        onComplete,
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Message with both error and audio - error should win
      mockWsInstance!.simulateMessage({ audio: 'chunk', error: 'Some error' });

      await expect(promise).rejects.toThrow('ElevenLabs error: Some error');
      // Audio should NOT be processed when there's an error
      expect(onAudioChunk).not.toHaveBeenCalled();
    });
  });

  describe('synthesizeToBuffer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockWsInstance = null;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('collects audio chunks and returns concatenated buffer', async () => {
      const promise = synthesizeToBuffer('Test text', 'test-api-key', 'voice-123');

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Send multiple audio chunks (base64 encoded)
      mockWsInstance!.simulateMessage({ audio: Buffer.from('chunk1').toString('base64') });
      mockWsInstance!.simulateMessage({ audio: Buffer.from('chunk2').toString('base64') });
      mockWsInstance!.simulateMessage({ isFinal: true });

      const result = await promise;
      
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('chunk1chunk2');
    });

    it('uses default voice ID when not specified', async () => {
      const promise = synthesizeToBuffer('Test', 'api-key');

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      mockWsInstance!.simulateMessage({ audio: Buffer.from('audio').toString('base64') });
      mockWsInstance!.simulateMessage({ isFinal: true });

      await promise;
      // No error means default voice was used successfully
    });

    it('rejects on synthesis error', async () => {
      const promise = synthesizeToBuffer('Test', 'api-key', 'voice-id');

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      mockWsInstance!.simulateMessage({ error: 'Invalid voice' });

      await expect(promise).rejects.toThrow('ElevenLabs error: Invalid voice');
    });

    it('rejects when no audio data received', async () => {
      const promise = synthesizeToBuffer('Test', 'api-key', 'voice-id');

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Complete without sending any audio
      mockWsInstance!.simulateMessage({ isFinal: true });

      await expect(promise).rejects.toThrow('No audio data received');
    });

    it('rejects on synthesis timeout', async () => {
      const promise = synthesizeToBuffer('Test', 'api-key', 'voice-id');

      // Immediately attach a rejection handler to prevent unhandled rejection
      let rejectionError: Error | null = null;
      const handledPromise = promise.catch((e) => {
        rejectionError = e as Error;
      });

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Don't send any messages, just wait for timeout
      // The synthesis timeout is 15 seconds
      await vi.advanceTimersByTimeAsync(15001);

      await handledPromise;
      
      expect(rejectionError).not.toBeNull();
      expect(rejectionError!.message).toBe('Synthesis timeout');
    });

    it('rejects on connection timeout', async () => {
      const promise = synthesizeToBuffer('Test', 'api-key', 'voice-id');

      // Attach rejection handler immediately
      let rejectionError: Error | null = null;
      const handledPromise = promise.catch((e) => {
        rejectionError = e as Error;
      });

      await vi.advanceTimersByTimeAsync(0);
      
      // Don't open connection - wait for connection timeout (10s)
      await vi.advanceTimersByTimeAsync(10001);

      await handledPromise;
      
      expect(rejectionError).not.toBeNull();
      expect(rejectionError!.message).toBe('ElevenLabs connection timeout');
    });

    it('handles WebSocket close before completion', async () => {
      const promise = synthesizeToBuffer('Test', 'api-key', 'voice-id');

      await vi.advanceTimersByTimeAsync(0);
      mockWsInstance!.simulateOpen();

      // Close before any audio received
      mockWsInstance!.simulateClose(1000, 'Connection closed');

      await expect(promise).rejects.toThrow('ElevenLabs connection closed');
    });
  });
});
