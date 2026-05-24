import type { WebSocket } from 'ws';

export type DeviceMode = 'mobile' | 'kiosk';

export interface Device {
  id: string;
  workspaceId: string;
  sessionId?: string;  // Current session device is in
  displayName: string;
  mode: DeviceMode;
  ws: WebSocket;
  connectedAt: Date;
  ttsEnabled?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  displayLines?: number;  // Calculated max lines for kiosk display
  /** Platform identifier (optional, for analytics/debugging) */
  platform?: DevicePlatform;
}

export interface DisplayContent {
  type: 'markdown' | 'image' | 'clear';
  content?: string;
  title?: string;
}

/**
 * Client → Server: Update session TTS settings.
 * Changes are broadcast to all devices in the session.
 */
export interface SessionTtsSettingsMessage {
  type: 'session-tts-settings';
  enabled: boolean;
  outputDeviceId: string | null;
}

/** Mobile → Server: Audio chunk for server-side transcription */
export interface AudioInputChunkMessage {
  type: 'audio-input-chunk';
  /** Sequential chunk number (for ordering/debugging) */
  chunkIndex: number;
  /** Base64-encoded PCM16 audio data */
  audio: string;
  /** Sample rate of the audio (e.g., 16000) */
  sampleRate: number;
}

/** Mobile → Server: Audio stream ended (ready for final transcription) */
export interface AudioInputEndMessage {
  type: 'audio-input-end';
  /** Total number of chunks sent */
  totalChunks: number;
}

// Messages from client to server
export type ClientMessage =
  | RegisterMessage
  | UpdateDeviceMessage
  | TextMessage
  | JoinResponseMessage
  | DisplayResultMessage
  | SessionTtsSettingsMessage
  | AudioInputChunkMessage
  | AudioInputEndMessage;

/**
 * Kiosk → Server: Report display result (image load success/failure).
 * Used to provide feedback when images fail to load on the kiosk display.
 */
export interface DisplayResultMessage {
  type: 'display-result';
  success: boolean;
  error?: 'load-failed' | 'timeout' | 'cors';
  displayType: 'image' | 'markdown';
}

/** Platform identifier for analytics and debugging */
export type DevicePlatform = 'web' | 'ios' | 'android' | 'tvos' | 'macos' | 'windows' | 'linux';

/** Valid platform values for runtime validation */
export const VALID_PLATFORMS: readonly DevicePlatform[] = ['web', 'ios', 'android', 'tvos', 'macos', 'windows', 'linux'] as const;

/**
 * Validate that a value is a valid DevicePlatform.
 * Use this to sanitize untrusted input before logging to prevent log injection.
 */
export function isValidPlatform(platform: unknown): platform is DevicePlatform {
  return typeof platform === 'string' && VALID_PLATFORMS.includes(platform as DevicePlatform);
}

export interface RegisterMessage {
  type: 'register';
  deviceId: string;
  workspaceId?: string;  // Optional for backward compatibility; defaults to anonymous mode
  sessionId?: string;    // Optional; auto-assigns to active session if omitted
  displayName: string;
  mode: DeviceMode;
  screenWidth?: number;
  screenHeight?: number;
  /** Platform identifier (optional, for analytics/debugging). Defaults to 'web' if not provided. */
  platform?: DevicePlatform;
}

/**
 * Request payload for POST /api/display endpoint.
 * Extends DisplayContent with session/workspace targeting.
 * 
 * Authentication: Requires Authorization: Bearer <secret> header.
 * The secret is per-session and passed to the AI via the DISPLAY_API_SECRET env var.
 */
export interface DisplayRequest extends DisplayContent {
  /** Session ID (preferred - secrets are per-session) */
  sessionId?: string;
  /** @deprecated Use sessionId instead. Kept for backward compatibility. */
  workspaceId?: string;
}

export interface UpdateDeviceMessage {
  type: 'update-device';
  displayName?: string;
  mode?: DeviceMode;
  ttsEnabled?: boolean;
}

export interface TextMessage {
  type: 'text';
  utteranceId: string;
  text: string;
  partial: boolean;
}

/**
 * Owner device → Server: Approve/deny a join request.
 * Sent from kiosk when owner clicks approve/deny button.
 */
export interface JoinResponseMessage {
  type: 'join-response';
  requestId: string;
  approved: boolean;
}

/**
 * Server → Device: Notification that this device was removed from the workspace.
 * Sent immediately before disconnecting the WebSocket.
 */
export interface DeviceRemovedMessage {
  type: 'device-removed';
  deviceId: string;
  reason: 'removed-from-workspace';
}

/**
 * Server → All devices in workspace: Workspace has been deleted.
 * Sent to all devices before disconnecting their WebSockets.
 */
export interface WorkspaceDeletedMessage {
  type: 'workspace-deleted';
  reason?: string;
}

/**
 * Server → Kiosk devices: Audio chunk for TTS playback.
 * Base64-encoded audio data in MP3 format.
 */
export interface AudioChunkMessage {
  type: 'audio-chunk';
  sessionId: string;
  utteranceId: string;
  /** Base64-encoded audio data */
  audio: string;
  /** Audio format (always 'mp3' for ElevenLabs) */
  format: 'mp3';
}

/**
 * Server → Kiosk devices: Audio synthesis completed.
 * Sent when TTS generation finishes (successfully or with error).
 */
export interface AudioEndMessage {
  type: 'audio-end';
  sessionId: string;
  utteranceId: string;
  /** Error message if synthesis failed */
  error?: string;
}

/**
 * Server → All devices in session: TTS settings changed.
 * Broadcast when any device updates session TTS settings.
 */
export interface SessionTtsSettingsChangedMessage {
  type: 'session-tts-settings-changed';
  sessionId: string;
  enabled: boolean;
  outputDeviceId: string | null;
}

/** Server → Mobile: Transcription result from audio input */
export interface TranscriptionResultMessage {
  type: 'transcription-result';
  /** The transcribed text */
  text: string;
  /** Whether this is a final result (vs interim/partial) */
  isFinal: boolean;
  /** Confidence score (0-1) if available */
  confidence?: number;
}

/** Server → Mobile: Error during transcription */
export interface TranscriptionErrorMessage {
  type: 'transcription-error';
  /** Error message */
  error: string;
  /** Error code for programmatic handling */
  code?: 'no-speech' | 'service-unavailable' | 'rate-limited' | 'unknown';
}

// Messages from server to client
export type ServerMessage =
  | RegisteredMessage
  | DeviceListMessage
  | RelayedTextMessage
  | HistoryMessage
  | DisplayMessage
  | JoinRequestMessage
  | JoinResolvedMessage
  | DeviceRemovedMessage
  | WorkspaceDeletedMessage
  | AIThinkingMessage
  | SessionAIStatusMessage
  | AgentActionMessage
  | AudioChunkMessage
  | AudioEndMessage
  | SessionTtsSettingsChangedMessage
  | TranscriptionResultMessage
  | TranscriptionErrorMessage;

export interface DisplayMessage {
  type: 'display';
  display: DisplayContent;
}

export interface SessionInfo {
  id: string;
  name: string | null;
}

export interface RegisteredMessage {
  type: 'registered';
  deviceId: string;
  session: SessionInfo;
  /** Device token for reconnection (only sent on first registration) */
  deviceToken?: string;
  /** Token expiration timestamp (only sent on first registration) */
  tokenExpiresAt?: string;
}

export interface HistoryMessage {
  type: 'history';
  messages: RelayedTextMessage[];
}

export interface DeviceListMessage {
  type: 'device-list';
  devices: DeviceInfo[];
}

export interface DeviceInfo {
  id: string;
  workspaceId: string;
  displayName: string;
  mode: DeviceMode;
}

export interface RelayedTextMessage {
  type: 'text';
  utteranceId: string;
  workspaceId: string;
  sessionId?: string;  // Optional for backward compatibility
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
  /**
   * For AI utterances: the OpenHands-server-emitted event timestamp (ISO Zulu).
   * Lets the client place the AI message on the same clock as agent events
   * so the kiosk timeline interleaves correctly (issue #264).
   * Undefined for user-authored messages and when OH did not provide one.
   */
  serverTimestamp?: string;
  /**
   * For persisted messages: when the row was created in the message store
   * (ISO Zulu). Replaces page-load `new Date()` on reconnect so that
   * historical messages keep their original ordering relative to live
   * agent events (issue #264).
   */
  createdAt?: string;
}

/**
 * Server → Owner's kiosk devices: New join request notification.
 * Sent when a user requests to join a workspace where allowAutoJoin=false.
 */
export interface JoinRequestMessage {
  type: 'join-request';
  request: {
    id: string;
    workspaceId: string;
    user: {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
    createdAt: string;
  };
}

/**
 * Server → Requesting user: Join request resolved (approved/denied/expired).
 * Sent to the mobile device that initiated the join request.
 */
export interface JoinResolvedMessage {
  type: 'join-resolved';
  requestId: string;
  approved: boolean;
  /** Workspace info, only if approved */
  workspace?: {
    id: string;
    name: string;
    slug: string;
  };
  /** Error message, only if denied/expired */
  error?: string;
}

/**
 * Server → All devices in session: AI is processing a response.
 * Broadcast when the AI starts or finishes processing a message.
 */
export interface AIThinkingMessage {
  type: 'ai-thinking';
  sessionId: string;
  thinking: boolean;
  /**
   * ISO timestamp when the current thinking state began (when `thinking` is
   * true). Optional for backward compatibility with clients that ignore it.
   * Populated by the register-time AI resync (issue #290); transition-time
   * broadcasts may omit it.
   */
  thinkingSince?: string;
}

/**
 * Server → All devices in session: Session-level AI connection status.
 * Broadcast when the session AI connects, disconnects, or encounters an error.
 */
export interface SessionAIStatusMessage {
  type: 'session-ai-status';
  sessionId: string;
  connected: boolean;
  connecting?: boolean;
  conversationId?: string;
  error?: string;
}

/**
 * Content part in OpenHands observations (text or image).
 * Uses OpenHands field naming conventions for client portability.
 * See: https://github.com/All-Hands-AI/OpenHands/blob/main/frontend/src/types/v1/core/base/common.ts
 */
export interface ContentPart {
  type: 'text' | 'image';
  text?: string;
  image_urls?: string[];  // snake_case per OpenHands convention
}

/**
 * Task in a task tracker action/observation.
 * Uses OpenHands field naming conventions.
 */
export interface TaskItem {
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  notes?: string;
}

/**
 * Agent action event from OpenHands event stream.
 * Represents actions the AI agent performs (running commands, reading files, etc.)
 * 
 * IMPORTANT: Field names use snake_case to match OpenHands conventions exactly.
 * This is intentional for client portability - the client will port rendering
 * functions directly from OpenHands that expect these exact field names.
 * See issue #252 for context on why we adopted OpenHands naming conventions.
 * 
 * References:
 * - https://github.com/All-Hands-AI/OpenHands/blob/main/frontend/src/types/v1/core/base/observation.ts
 * - https://github.com/All-Hands-AI/OpenHands/blob/main/frontend/src/types/v1/core/base/action.ts
 */
export interface AgentAction {
  id: string;
  timestamp: string;
  kind: string;  // Exact V1Event kind, e.g., "ExecuteBashObservation"
  source: string;  // Event source: agent, user, environment, hook
  summary: string;  // Human-readable description

  // === Terminal actions/observations ===
  command?: string;
  /**
   * Content from observations. Can be:
   * - Array of ContentPart objects (native OpenHands format)
   * - String (flattened for convenience)
   * Client code should handle both formats.
   */
  content?: ContentPart[] | string;
  exit_code?: number;      // snake_case per OpenHands convention
  timeout?: boolean;

  // === File actions/observations ===
  path?: string;
  file_text?: string;      // snake_case per OpenHands convention
  old_str?: string;
  new_str?: string;
  error?: string;

  // === MCP actions/observations ===
  tool_name?: string;      // snake_case per OpenHands convention
  data?: Record<string, unknown>;
  is_error?: boolean;      // snake_case per OpenHands convention

  // === Browser actions ===
  url?: string;
  index?: number;
  text?: string;
  direction?: string;
  tab_id?: string;         // snake_case per OpenHands convention
  new_tab?: boolean;       // snake_case per OpenHands convention
  include_screenshot?: boolean;
  extract_links?: boolean;
  start_from_char?: number;

  // === Search actions/observations ===
  pattern?: string;
  include?: string;
  search_path?: string;
  files?: string[];        // Glob results
  matches?: string[];      // Grep results

  // === Think/Finish actions ===
  thought?: string;
  message?: string;

  // === Task tracker ===
  task_list?: TaskItem[];

  // === Observation linkage ===
  action_id?: string;  // For observations, links to corresponding action
}

/**
 * Server → All devices in session: Agent performed an action.
 * Broadcast when the AI agent performs an action (running commands, reading files, etc.)
 */
export interface AgentActionMessage {
  type: 'agent-action';
  sessionId: string;
  action: AgentAction;
}
