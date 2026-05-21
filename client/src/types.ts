export type DeviceMode = 'mobile' | 'kiosk';

export interface DeviceInfo {
  id: string;
  displayName: string;
  mode: DeviceMode;
}

/** Session-level TTS settings (synced across all devices in session) */
export interface SessionTtsSettings {
  /** Whether TTS is enabled for this session */
  enabled: boolean;
  /** Which device should play audio (null = all kiosks) */
  outputDeviceId: string | null;
}

export interface DisplayContent {
  type: 'markdown' | 'image' | 'clear';
  content?: string;  // Markdown text or image URL
  title?: string;    // Optional title
}

// Messages from client to server
export interface RegisterMessage {
  type: 'register';
  deviceId: string;
  displayName: string;
  mode: DeviceMode;
  workspaceId?: string;
  sessionId?: string;  // Optional; auto-assigns to active session if omitted
  screenWidth?: number;
  screenHeight?: number;
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

/** Owner device → Server: Approve/deny a join request */
export interface JoinResponseMessage {
  type: 'join-response';
  requestId: string;
  approved: boolean;
}

/** Kiosk → Server: Report display result (image load success/failure) */
export interface DisplayResultMessage {
  type: 'display-result';
  success: boolean;
  error?: 'load-failed' | 'timeout' | 'cors';
  displayType: 'image' | 'markdown';
}

/** Client → Server: Update session TTS settings */
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

export type ClientMessage = RegisterMessage | UpdateDeviceMessage | TextMessage | JoinResponseMessage | DisplayResultMessage | SessionTtsSettingsMessage | AudioInputChunkMessage | AudioInputEndMessage;

// Messages from server to client
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

export interface DeviceListMessage {
  type: 'device-list';
  devices: DeviceInfo[];
}

export interface RelayedTextMessage {
  type: 'text';
  utteranceId: string;
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
  sessionId?: string;  // Session the message belongs to
}

export interface HistoryMessage {
  type: 'history';
  messages: RelayedTextMessage[];
}

export interface DisplayMessage {
  type: 'display';
  display: DisplayContent;
}

export interface AIStatusMessage {
  type: 'ai-status';
  connected: boolean;
  conversationId?: string;
}

/** Server → All devices in session: AI is processing a response */
export interface AIThinkingMessage {
  type: 'ai-thinking';
  sessionId: string;
  thinking: boolean;
}

/** Server → All devices in session: Session-level AI connection status */
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

/** Server → All devices in session: Agent performed an action */
export interface AgentActionMessage {
  type: 'agent-action';
  sessionId: string;
  action: AgentAction;
}

/** Server → Owner's kiosk devices: New join request notification */
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

/** Server → Requesting user: Join request resolved */
export interface JoinResolvedMessage {
  type: 'join-resolved';
  requestId: string;
  approved: boolean;
  workspace?: {
    id: string;
    name: string;
    slug: string;
  };
  error?: string;
}

/** Server → Device: This device was removed from the workspace */
export interface DeviceRemovedMessage {
  type: 'device-removed';
  deviceId: string;
  reason: 'removed-from-workspace';
}

/** Server → All devices in workspace: Workspace has been deleted */
export interface WorkspaceDeletedMessage {
  type: 'workspace-deleted';
  reason?: string;
}

/** Server → Kiosk devices: Audio chunk for TTS playback */
export interface AudioChunkMessage {
  type: 'audio-chunk';
  sessionId: string;
  utteranceId: string;
  /** Base64-encoded audio data */
  audio: string;
  /** Audio format (always 'mp3' for ElevenLabs) */
  format: 'mp3';
}

/** Server → Kiosk devices: Audio synthesis completed */
export interface AudioEndMessage {
  type: 'audio-end';
  sessionId: string;
  utteranceId: string;
  /** Error message if synthesis failed */
  error?: string;
}

/** Server → All devices in session: TTS settings changed */
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

export type ServerMessage = 
  | RegisteredMessage 
  | DeviceListMessage 
  | RelayedTextMessage 
  | HistoryMessage 
  | DisplayMessage 
  | AIStatusMessage
  | AIThinkingMessage
  | SessionAIStatusMessage
  | AgentActionMessage
  | JoinRequestMessage
  | JoinResolvedMessage
  | DeviceRemovedMessage
  | WorkspaceDeletedMessage
  | AudioChunkMessage
  | AudioEndMessage
  | SessionTtsSettingsChangedMessage
  | TranscriptionResultMessage
  | TranscriptionErrorMessage;

export interface Utterance {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
  receivedAt: Date;
}

/**
 * Unified timeline entry for displaying utterances and agent events inline.
 * Used to chronologically interleave messages with agent actions in the conversation view.
 */
export type TimelineEntry =
  | { type: 'utterance'; data: Utterance }
  | { type: 'agent-event'; data: AgentAction };

/**
 * Determine success/timeout/error status from agent event.
 * Based on OpenHands' get-observation-result.ts logic.
 */
export type ObservationStatus = 'success' | 'timeout' | 'error' | 'pending';

/**
 * Extended agent action with optional exit_code for observations.
 * This allows determining success/failure status for command outputs.
 */
export interface ExtendedAgentAction extends AgentAction {
  /** Exit code from terminal/command observations (0=success, -1=timeout) */
  exitCode?: number;
  /** Whether this is an observation event (has result) vs action event (initiated) */
  isObservation?: boolean;
  /** Whether the observation indicates an error */
  isError?: boolean;
  /** Agent's reasoning/thinking content to show as a chat bubble */
  reasoning?: string;
}
