/**
 * TTS Service - manages text-to-speech for workspaces
 * 
 * Provides server-side TTS generation using ElevenLabs, streaming audio
 * to kiosk devices in real-time.
 */

import { synthesize, testApiKey, fetchVoices, synthesizeToBuffer, DEFAULT_VOICE_ID } from './elevenlabs.js';
import type { WorkspaceSettings } from '../workspaces/types.js';
import type { SessionTtsSettings } from '../sessions/types.js';
import type { DeviceRegistry } from '../registry.js';
import type { AudioChunkMessage, AudioEndMessage } from '../types.js';

export { testApiKey, fetchVoices, synthesizeToBuffer, DEFAULT_VOICE_ID };
export { getRandomJoke, DAD_JOKES } from './dad-jokes.js';

/**
 * TTS Service configuration
 */
export interface TtsServiceConfig {
  registry: DeviceRegistry;
  getWorkspaceSettings: (workspaceId: string) => WorkspaceSettings | null;
  decryptApiKey: (encrypted: { encrypted: string; iv: string; tag: string }) => string;
}

/**
 * TTS Service for managing text-to-speech across workspaces
 */
export class TtsService {
  private registry: DeviceRegistry;
  private getWorkspaceSettings: (workspaceId: string) => WorkspaceSettings | null;
  private decryptApiKey: (encrypted: { encrypted: string; iv: string; tag: string }) => string;

  constructor(config: TtsServiceConfig) {
    this.registry = config.registry;
    this.getWorkspaceSettings = config.getWorkspaceSettings;
    this.decryptApiKey = config.decryptApiKey;
  }

  /**
   * Check if TTS is enabled and configured for a workspace.
   */
  isEnabled(workspaceId: string): boolean {
    const settings = this.getWorkspaceSettings(workspaceId);
    if (!settings) return false;

    // TTS must be explicitly enabled AND have an API key configured
    return (
      settings.elevenlabsTtsEnabled &&
      !!settings.elevenlabsApiKeyEncrypted &&
      !!settings.elevenlabsApiKeyIv &&
      !!settings.elevenlabsApiKeyTag
    );
  }

  /**
   * Synthesize text and stream audio to kiosk devices in a session.
   * 
   * @param text - Text to synthesize
   * @param workspaceId - Workspace ID for settings and routing
   * @param sessionId - Session ID for routing audio to correct devices
   * @param utteranceId - Unique identifier for this synthesis request
   * @param sessionTtsSettings - Optional session-level TTS settings (for device targeting)
   */
  async synthesizeForSession(
    text: string,
    workspaceId: string,
    sessionId: string,
    utteranceId: string,
    sessionTtsSettings?: SessionTtsSettings
  ): Promise<void> {
    // Check session-level TTS enabled setting (default to disabled if not set)
    if (!sessionTtsSettings?.enabled) {
      console.log(`[TTS] Disabled for session ${sessionId} (session setting${!sessionTtsSettings ? ' not set' : ''})`);
      return;
    }

    const settings = this.getWorkspaceSettings(workspaceId);
    if (!settings) {
      console.log(`[TTS] No settings for workspace ${workspaceId}`);
      return;
    }

    if (!this.isEnabled(workspaceId)) {
      console.log(`[TTS] Not enabled for workspace ${workspaceId}`);
      return;
    }

    // Decrypt the API key
    const apiKey = this.decryptApiKey({
      encrypted: settings.elevenlabsApiKeyEncrypted!,
      iv: settings.elevenlabsApiKeyIv!,
      tag: settings.elevenlabsApiKeyTag!,
    });

    const voiceId = settings.elevenlabsVoiceId || DEFAULT_VOICE_ID;
    
    // Get target device from session settings (null = all kiosks)
    const targetDeviceId = sessionTtsSettings?.outputDeviceId ?? null;

    console.log(`[TTS] Synthesizing for session ${sessionId}: "${text.substring(0, 50)}..."${targetDeviceId ? ` (target: ${targetDeviceId})` : ''}`);

    // Guard against duplicate audio-end messages: onComplete may fire and then
    // the Promise can still reject, which would trigger the catch block.
    let audioEndSent = false;

    try {
      await synthesize(text, {
        apiKey,
        voiceId,
        onAudioChunk: (audioBase64: string) => {
          const message: AudioChunkMessage = {
            type: 'audio-chunk',
            sessionId,
            utteranceId,
            audio: audioBase64,
            format: 'mp3',
          };
          this.registry.broadcastAudioToKiosks(sessionId, message, targetDeviceId);
        },
        onComplete: (error?: Error) => {
          if (audioEndSent) return;
          audioEndSent = true;

          if (error) {
            console.error(`[TTS] Synthesis error for session ${sessionId}:`, error.message);
          } else {
            console.log(`[TTS] Synthesis complete for session ${sessionId}`);
          }
          
          // Send end marker
          const endMessage: AudioEndMessage = {
            type: 'audio-end',
            sessionId,
            utteranceId,
            error: error?.message,
          };
          this.registry.broadcastAudioToKiosks(sessionId, endMessage, targetDeviceId);
        },
      });
    } catch (err) {
      if (!audioEndSent) {
        audioEndSent = true;
        console.error(`[TTS] Failed to start synthesis for session ${sessionId}:`, err);
        
        // Send error marker
        const endMessage: AudioEndMessage = {
          type: 'audio-end',
          sessionId,
          utteranceId,
          error: (err as Error).message,
        };
        this.registry.broadcastAudioToKiosks(sessionId, endMessage, targetDeviceId);
      }
    }
  }
}
