/**
 * ElevenLabs TTS WebSocket client for streaming text-to-speech.
 * 
 * Uses the ElevenLabs WebSocket API for low-latency streaming audio.
 * Output format: MP3 44.1kHz 128kbps for good quality with reasonable size.
 * Model: eleven_flash_v2_5 for lowest latency.
 */

import WebSocket from 'ws';

/** Default ElevenLabs voice (Aria - optimized for conversational AI) */
export const DEFAULT_VOICE_ID = 'Xb7hH8MSUJpSbSDYk0k2';

/** ElevenLabs WebSocket URL template */
const WS_URL_TEMPLATE = 'wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input';

/** Model optimized for low latency */
const MODEL_ID = 'eleven_flash_v2_5';

/** Output format: MP3 44.1kHz 128kbps */
const OUTPUT_FORMAT = 'mp3_44100_128';

/** Connection timeout in milliseconds */
const CONNECTION_TIMEOUT_MS = 10000;

/** Interface for audio chunk callbacks */
export interface AudioChunkCallback {
  (audioBase64: string): void;
}

/** Interface for completion callback */
export interface CompletionCallback {
  (error?: Error): void;
}

/**
 * ElevenLabs TTS streaming options
 */
export interface ElevenLabsTtsOptions {
  apiKey: string;
  voiceId?: string;
  /** Callback for each audio chunk (base64 MP3 data) */
  onAudioChunk: AudioChunkCallback;
  /** Callback when synthesis is complete or errors */
  onComplete: CompletionCallback;
}

/**
 * Synthesize text to speech using ElevenLabs WebSocket API.
 * 
 * Streams audio chunks as they're generated for minimal latency.
 * Returns a Promise that resolves when the first audio chunk is received,
 * allowing parallel processing of audio playback and further chunks.
 * 
 * @param text - Text to synthesize
 * @param options - TTS options including API key and callbacks
 * @returns Promise that resolves when streaming starts or rejects on error
 */
export function synthesize(text: string, options: ElevenLabsTtsOptions): Promise<void> {
  const { apiKey, voiceId = DEFAULT_VOICE_ID, onAudioChunk, onComplete } = options;

  return new Promise((resolve, reject) => {
    const wsUrl = WS_URL_TEMPLATE.replace('{voice_id}', voiceId);
    let ws: WebSocket | null = null;
    let resolved = false;
    let connectionTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
      }
      if (ws) {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        ws = null;
      }
    };

    const handleError = (err: Error) => {
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(err);
      }
      onComplete(err);
    };

    try {
      ws = new WebSocket(wsUrl);

      // Connection timeout
      connectionTimer = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          handleError(new Error('ElevenLabs connection timeout'));
        }
      }, CONNECTION_TIMEOUT_MS);

      ws.on('open', () => {
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }

        // Send initial configuration
        const initMsg = {
          text: ' ', // Initial space to start the stream
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          xi_api_key: apiKey,
          model_id: MODEL_ID,
          output_format: OUTPUT_FORMAT,
        };
        ws?.send(JSON.stringify(initMsg));

        // Send the actual text
        const textMsg = {
          text: text,
          try_trigger_generation: true,
        };
        ws?.send(JSON.stringify(textMsg));

        // Send end-of-stream marker
        const endMsg = {
          text: '',
        };
        ws?.send(JSON.stringify(endMsg));
      });

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle audio chunk
          if (message.audio) {
            // Resolve on first chunk - streaming has started successfully
            if (!resolved) {
              resolved = true;
              resolve();
            }
            onAudioChunk(message.audio);
          }

          // Handle completion
          if (message.isFinal === true) {
            cleanup();
            onComplete();
          }

          // Handle errors from ElevenLabs
          if (message.error) {
            handleError(new Error(`ElevenLabs error: ${message.error}`));
          }
        } catch (err) {
          // Not JSON - might be raw audio or other data
          console.warn('[ElevenLabs] Non-JSON message received');
        }
      });

      ws.on('error', (err) => {
        handleError(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on('close', (code, reason) => {
        const wasOpen = resolved;
        cleanup();
        
        // If closed before we received any audio, that's an error
        if (!wasOpen) {
          reject(new Error(`ElevenLabs connection closed: ${code} ${reason.toString()}`));
        } else {
          // Normal closure after audio received
          onComplete();
        }
      });
    } catch (err) {
      handleError(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Test ElevenLabs API key validity by making a test request.
 * 
 * @param apiKey - ElevenLabs API key to test
 * @returns Promise that resolves with validity status and message
 */
export async function testApiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
  try {
    // Use the voices endpoint to verify the key
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (response.ok) {
      return { valid: true, message: 'API key is valid' };
    } else if (response.status === 401) {
      return { valid: false, message: 'Invalid API key' };
    } else {
      return { valid: false, message: `API error: ${response.status}` };
    }
  } catch (err) {
    return { valid: false, message: `Connection error: ${(err as Error).message}` };
  }
}

/**
 * Fetch available voices from ElevenLabs.
 * 
 * @param apiKey - ElevenLabs API key
 * @returns Promise with array of voice objects
 */
export async function fetchVoices(apiKey: string): Promise<Array<{ voice_id: string; name: string; labels?: Record<string, string> }>> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voices: ${response.status}`);
  }

  const data = await response.json();
  return data.voices || [];
}
