/**
 * Auto-connect AI logic - creates AI conversation when first device joins a session
 * 
 * Extracted to a separate module for testability.
 */

import type { DeviceRegistry } from './registry.js';
import type { SessionRepository } from './sessions/index.js';
import type { WorkspaceRepository } from './workspaces/index.js';
import type { MessageStore } from './storage/index.js';
import type { AISessionManager } from './openhands.js';
import type { TtsService } from './tts/index.js';
import type { RelayedTextMessage, SessionAIStatusMessage } from './types.js';
import { isAnonymousSession } from './constants.js';

/**
 * Dependencies required by autoConnectAI function.
 * Allows injection of real or mock implementations for testing.
 */
export interface AutoConnectDependencies {
  registry: DeviceRegistry;
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository | null;
  aiSessionManager: AISessionManager;
  store: MessageStore;
  /** Function to get workspace API key (handles decryption) */
  getWorkspaceApiKey: (workspaceId: string) => Promise<string | null>;
  /** Optional TTS service for generating speech from AI responses */
  ttsService?: TtsService;
}

/**
 * Auto-connect AI when first device joins a session.
 * Creates an AI conversation for the session and broadcasts status to all devices.
 * 
 * @param sessionId - The session ID to connect AI to
 * @param workspaceId - The workspace ID containing the session
 * @param deps - Dependencies for the operation
 */
export async function autoConnectAI(
  sessionId: string,
  workspaceId: string,
  deps: AutoConnectDependencies
): Promise<void> {
  const { registry, sessionRepository, workspaceRepository, aiSessionManager, store, getWorkspaceApiKey, ttsService } = deps;
  
  console.log(`[AI] Auto-connecting AI for session ${sessionId}`);

  // Broadcast connecting status to all devices in session
  const connectingStatus: SessionAIStatusMessage = {
    type: 'session-ai-status',
    sessionId,
    connecting: true,
    connected: false,
  };
  registry.broadcastMessageToSession(sessionId, connectingStatus);

  try {
    // Get workspace API key (if configured)
    const apiKey = workspaceRepository
      ? await getWorkspaceApiKey(workspaceId)
      : null;

    // Check if AI is available (workspace key or env key)
    if (!apiKey && !aiSessionManager.isAvailable()) {
      console.log(`[AI] Auto-connect skipped for session ${sessionId}: No API key available`);
      const unavailableStatus: SessionAIStatusMessage = {
        type: 'session-ai-status',
        sessionId,
        connecting: false,
        connected: false,
        error: 'OpenHands API not configured',
      };
      registry.broadcastMessageToSession(sessionId, unavailableStatus);
      return;
    }

    // Get or create display secret for the session
    let displayApiSecret = sessionRepository.getDisplaySecret(sessionId);
    if (!displayApiSecret) {
      displayApiSecret = sessionRepository.setDisplaySecret(sessionId);
    }

    // Get min display lines from connected kiosks
    const displayLines = registry.getMinKioskDisplayLines(workspaceId);

    // Create AI session using session-centric method
    const aiSession = await aiSessionManager.getOrCreateForSession(
      sessionId,
      workspaceId,
      (text: string, serverTimestamp?: string) => {
        // Relay AI responses to all devices in session.
        // `serverTimestamp` is the upstream OH event.timestamp normalized to
        // tz-aware UTC; the client uses it to put AI utterances on the same
        // timeline clock as agent-action events. See #264.
        const utteranceId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const aiMessage: RelayedTextMessage = {
          type: 'text',
          utteranceId,
          workspaceId,
          sessionId,
          senderId: 'ai',
          senderName: '✨ AI',
          text,
          partial: false,
          ...(serverTimestamp ? { serverTimestamp } : {}),
        };
        store.append(aiMessage);
        registry.broadcastToSession(aiMessage, sessionId);

        // Generate TTS for AI response (only if TTS service is available and enabled)
        if (ttsService && ttsService.isEnabled(workspaceId)) {
          // Get session-level TTS settings (if any) for device targeting
          const session = sessionRepository.findById(sessionId);
          const sessionTtsSettings = session?.metadata?.ttsSettings;
          
          ttsService.synthesizeForSession(text, workspaceId, sessionId, utteranceId, sessionTtsSettings).catch(err => {
            console.error(`[TTS] Failed to synthesize for session ${sessionId}:`, err);
          });
        }
      },
      {
        displayLines,
        ...(apiKey && { apiKey }),
        ...(displayApiSecret && { displayApiSecret }),
      }
    );

    // Broadcast connected status
    const connectedStatus: SessionAIStatusMessage = {
      type: 'session-ai-status',
      sessionId,
      connecting: false,
      connected: true,
      conversationId: aiSession.conversationId,
    };
    registry.broadcastMessageToSession(sessionId, connectedStatus);
    console.log(`[AI] Auto-connected AI for session ${sessionId}, conversation: ${aiSession.conversationId}`);
  } catch (err) {
    // Log full error server-side for debugging
    console.error(`[AI] Auto-connect failed for session ${sessionId}:`, err);
    // Sanitize error message for clients to avoid leaking internal details
    const errorStatus: SessionAIStatusMessage = {
      type: 'session-ai-status',
      sessionId,
      connecting: false,
      connected: false,
      error: 'Failed to connect AI assistant',
    };
    registry.broadcastMessageToSession(sessionId, errorStatus);
  }
}

/**
 * Check if auto-connect should be triggered for a session.
 * Returns true if this is the first device and no AI session exists.
 * 
 * @param sessionId - The session ID to check
 * @param sessionRepository - Repository to get devices in session
 * @param aiSessionManager - AI session manager to check for existing sessions
 */
export function shouldAutoConnect(
  sessionId: string,
  sessionRepository: SessionRepository,
  aiSessionManager: AISessionManager
): boolean {
  if (isAnonymousSession(sessionId)) {
    return false;
  }
  
  const devicesInSession = sessionRepository.getDevices(sessionId);
  const isFirstDevice = devicesInSession.length === 1;
  // Note: Race condition possible if two devices join simultaneously.
  // Both might trigger auto-connect, but getOrCreateForSession() deduplicates.
  
  return isFirstDevice && !aiSessionManager.hasSessionAI(sessionId);
}
