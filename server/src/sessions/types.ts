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
 * How the session's mobile device collects user input. Server-persisted
 * (issue #378) so REST and WS observe the same value; previously this
 * was local React state in `MobileMode.tsx` / `KioskMode.tsx`.
 *
 * - `voice`: voice-only input mode.
 * - `unified`: text + voice combined into one input.
 * - `visualizer`: visualizer-only (no input affordance).
 */
export type SessionInputMode = 'voice' | 'unified' | 'visualizer';

/** Valid `SessionInputMode` values for runtime validation. */
export const VALID_SESSION_INPUT_MODES: readonly SessionInputMode[] = [
  'voice',
  'unified',
  'visualizer',
] as const;

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
  /**
   * Server-persisted mobile input mode (issue #378). Hydrated by the
   * client on connect; mutated via REST PATCH or WS `session-tts-settings`
   * delegates that flow through `settings-service.applyPatch`.
   */
  inputMode?: SessionInputMode;
  /**
   * Whether transcription auto-submits on silence (issue #378). Same
   * lifecycle as `inputMode`.
   */
  autoSubmit?: boolean;
  /**
   * Per-session agent system-prompt override (issue #378). When present
   * and non-empty, replaces the workspace default and the built-in
   * `system-prompt.md` body for new OpenHands conversations bound to this
   * session. Capped at 8192 characters by `settings-service`.
   */
  agentPrompt?: string;
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
