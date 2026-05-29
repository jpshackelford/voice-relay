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
