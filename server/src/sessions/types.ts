/**
 * Session status
 */
export type SessionStatus = 'active' | 'ended' | 'archived';

/**
 * Session-level TTS settings (synced across all devices in session)
 */
export interface SessionTtsSettings {
  /** Whether TTS is enabled for this session */
  enabled: boolean;
  /** Which device should play audio (null = all kiosks) */
  outputDeviceId: string | null;
}

/**
 * Session metadata (stored as JSON)
 */
export interface SessionMetadata {
  aiConversationId?: string;
  /**
   * Last upstream OpenHands conversation id that was attached to this
   * session before the fresh-create fallback in #348 spawned a new one.
   *
   * Why retain it?
   * - Issue #349 wires `buildReplaySuffix` into the fresh-create path so
   *   the new conversation can carry forward context from the old one.
   *   It needs to know which id to read from, and the live
   *   `aiConversationId` will already point at the new conversation by
   *   then.
   * - Diagnostics: when a session shows up "fresh-created at boot," the
   *   previous id is exactly what an operator needs to grep for in OH
   *   logs to understand why attach failed.
   *
   * Stability: read by `agent-attach-or-create.ts` and (eventually) the
   * carry-forward replay path. No other writer should mutate this field.
   */
  previousAiConversationId?: string;
  displayContent?: {
    type: 'markdown' | 'image';
    content: string;
    title?: string;
  };
  stats?: {
    messageCount: number;
    deviceCount: number;
  };
  /** Session-level TTS settings (synced across all devices) */
  ttsSettings?: SessionTtsSettings;
}

/**
 * Session record in database
 */
export interface Session {
  id: string;
  workspaceId: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  metadata: SessionMetadata | null;
  /** Encrypted display API secret (base64) */
  displayApiSecretEncrypted: string | null;
  /** IV for display API secret encryption (base64) */
  displayApiSecretIv: string | null;
  /** Auth tag for display API secret encryption (base64) */
  displayApiSecretTag: string | null;
}

/**
 * Input for creating a session
 */
export interface SessionCreateInput {
  workspaceId: string;
  name?: string;
}

/**
 * Input for updating a session
 */
export interface SessionUpdateInput {
  name?: string;
  status?: SessionStatus;
  metadata?: SessionMetadata;
}

/**
 * Session device membership
 */
export interface SessionDevice {
  sessionId: string;
  deviceId: string;
  joinedAt: string;
}

/**
 * Session summary for listing
 */
export interface SessionSummary {
  id: string;
  workspaceId: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  deviceCount: number;
  /** Last message timestamp in this session, or startedAt if no messages */
  lastActiveAt: string;
}
