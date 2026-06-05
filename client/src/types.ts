export type DeviceMode = 'mobile' | 'kiosk';

export interface DeviceInfo {
  id: string;
  displayName: string;
  mode: DeviceMode;
  /**
   * Issue #393: id of the active session anchored to this kiosk,
   * derived from `sessions.target_kiosk_device_id` on the server.
   * Mobile uses this to render a `🔴 In session` pill and a
   * `Join in progress` button in the kiosk picker. Mobile devices
   * carry no value here.
   */
  activeSessionId?: string | null;
  /**
   * Issue #393: ISO-8601 timestamp of the kiosk's most recent
   * `session_devices.joined_at`. Renders as "last used 2h ago" on
   * picker cards. `null` for kiosks that have never been used yet;
   * undefined for mobile devices.
   */
  lastUsedAt?: string | null;
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
  /**
   * Client's local IANA timezone (e.g. "America/Los_Angeles"). Captured
   * from `Intl.DateTimeFormat().resolvedOptions().timeZone` at registration
   * time so the agent can use it for wall-clock and relative-time answers
   * (issue #375). Optional for older clients.
   */
  timezone?: string;
  /**
   * Local UTC offset in minutes (positive east of UTC). Mirrors the
   * POSIX sign convention — i.e. the negation of
   * `Date.prototype.getTimezoneOffset()` (issue #375).
   */
  tzOffsetMinutes?: number;
  /**
   * Issue #393: mobile-only. The kiosk this mobile is targeting. When
   * present, the server anchors the session to that kiosk instead of
   * the workspace-wide single-active session, and emits a
   * `kiosk-attention` banner to the chosen kiosk. Ignored when the
   * registering device is a kiosk.
   */
  targetKioskDeviceId?: string;
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
  /**
   * Client-captured ISO-8601 Zulu wall-clock time when the utterance was
   * produced (issue #375). Server falls back to receipt time when this
   * is missing. All timestamps on the wire are UTC.
   */
  clientTimestamp?: string;
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
  /**
   * For AI utterances: the OpenHands-server-emitted event timestamp
   * (ISO Zulu after server-side normalization). Use this in preference to
   * `new Date()` so the message lies on the same clock as agent events on
   * the kiosk timeline (issue #264).
   */
  serverTimestamp?: string;
  /**
   * For history payloads: when the row was persisted (ISO Zulu after
   * server-side normalization). Use this in preference to `new Date()` on
   * reconnect so historical messages keep their original ordering.
   */
  createdAt?: string;
  /**
   * For user utterances: client-captured ISO Zulu wall-clock time when
   * the utterance was produced (issue #375). Server falls back to its
   * receipt time when the client doesn't supply one. Use to render
   * sender-local times for peer messages on the kiosk timeline.
   */
  clientTimestamp?: string;
  /**
   * For user utterances: the sender's local IANA timezone, propagated
   * from device registration (issue #375). Lets kiosks render peer
   * messages in their local time. Undefined for AI utterances and for
   * senders whose timezone is unknown.
   */
  senderTimezone?: string;
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
  /**
   * Optional ISO timestamp marking when the current thinking phase began.
   * Set on the resync emitted at WebSocket register time (issue #290) so a
   * refreshed client knows how long the agent has been working.
   *
   * Currently informational only — no UI surfaces this duration yet. It is
   * reserved for future client work (e.g. an "Agent thinking for 5s…"
   * indicator on refresh) and will likely be superseded by the consolidated
   * `session-state` message landing with issue #295. Live thinking-transition
   * broadcasts (i.e. not the register-time resync) may omit this field.
   */
  thinkingSince?: string;
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
 * Lifecycle states for an agent session, mirrored from
 * `server/src/agent-driver/types.ts#AgentSessionState`.
 *
 * Duplicated here (not imported across the workspace boundary) so the
 * client TS project has no dependency on server internals.
 */
export type AgentSessionState =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'thinking'
  | 'reconnecting'
  | 'degraded';

/**
 * Wire shape of the driver's `AgentSessionStatus`. The reducer in
 * `useAI` stores this exact shape — see the issue #295 design notes.
 */
export interface AgentSessionStatusWire {
  sessionId: string;
  state: AgentSessionState;
  conversationId: string | null;
  error: string | null;
  thinkingSince: string | null;
  startingSince: string | null;
  startupPhase?: string;
}

/**
 * Server → All devices in session: unified session-state message
 * (issue #295). Carries the full `AgentSessionStatus` from the driver.
 *
 * The client prefers this message when it arrives; if it does, the
 * legacy `session-ai-status` + `ai-thinking` pair is ignored for the
 * remainder of the connection. On socket open we reset the flag so a
 * reconnect re-establishes whichever shape the server chooses to emit.
 */
export interface SessionStateMessage {
  type: 'session-state';
  sessionId: string;
  ai: AgentSessionStatusWire;
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

  // === Invoke skill actions/observations ===
  skill_name?: string;     // snake_case per OpenHands convention

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

/**
 * Server → specific kiosk: a mobile is connecting to this kiosk
 * (issue #393). The kiosk renders a brief
 * `📱 <mobileDisplayName> connecting…` banner so the user can confirm
 * they targeted the right physical screen in rooms with multiple
 * visible kiosks. Transient: no persistence, no echo.
 */
export interface KioskAttentionMessage {
  type: 'kiosk-attention';
  /** Id of the mobile device that triggered the attention. */
  mobileDeviceId: string;
  /** Human-readable name to render in the banner. */
  mobileDisplayName: string;
  /** How long the kiosk should show the banner. */
  ttlMs: number;
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
  | SessionStateMessage
  | AgentActionMessage
  | JoinRequestMessage
  | JoinResolvedMessage
  | DeviceRemovedMessage
  | WorkspaceDeletedMessage
  | AudioChunkMessage
  | AudioEndMessage
  | SessionTtsSettingsChangedMessage
  | TranscriptionResultMessage
  | TranscriptionErrorMessage
  | KioskAttentionMessage;

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
 *
 * For agent events, the `data` field holds the action and `observation` (optional)
 * holds the paired observation if one has been received. See `pairAgentEvents()` in
 * `utils/pairAgentEvents.ts` for the pairing rules.
 */
export type TimelineEntry =
  | { type: 'utterance'; data: Utterance }
  | { type: 'agent-event'; data: AgentAction; observation?: AgentAction };

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
