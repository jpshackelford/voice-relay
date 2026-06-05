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
  /**
   * Speaker's local IANA timezone, captured at device registration
   * (issue #375). Used by the OpenHands driver to announce the speaker's
   * timezone on the first user turn from this device, and made available
   * to kiosks so peer messages can render local times. May be `undefined`
   * for legacy clients that don't send it.
   */
  timezone?: string;
  /**
   * Local UTC offset in minutes at registration time (positive for east,
   * negative for west — matches POSIX sign conventions, i.e. opposite of
   * `Date.prototype.getTimezoneOffset`). Captured alongside `timezone`
   * for non-IANA-aware clients.
   */
  tzOffsetMinutes?: number;
  /**
   * Workspace member who claimed this device (issue #383). Cached here
   * from `devices.primary_user_id` at registration time, refreshed when
   * a user (re)claims the device via the PATCH endpoint. `null` means
   * the device is anonymous / not yet claimed. Caching avoids a per-utterance
   * DB lookup when resolving the workspace-scoped speaker for relayed text.
   */
  primaryUserId?: string | null;
  /**
   * Per-device mic listening state (issue #388). `true` when the device
   * currently has its mic open and is producing audio/STT events,
   * `false` when muted, `undefined` for legacy clients that have not
   * yet sent a `device-listening-state` message. Runtime-only — never
   * persisted to SQLite.
   */
  listening?: boolean;
  /**
   * Whether this device is capable of producing mic input (issue #388):
   * has Web Speech recognition support OR an accessible `getUserMedia`
   * mic. `false` means the device should be excluded from kiosk
   * "any listening / all muted" aggregation. `undefined` is the
   * conservative default for legacy clients and is treated the same
   * as `false` by the kiosk aggregator. Runtime-only.
   */
  sttSupported?: boolean;
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
  | DeviceListeningStateMessage
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
  /**
   * Speaker's local IANA timezone (e.g. "America/Los_Angeles"), captured
   * by the client at registration time. Sent as
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` (issue #375).
   * Optional for backward compatibility with older clients.
   */
  timezone?: string;
  /**
   * Local UTC offset in minutes (positive east of UTC). Optional for
   * backward compatibility (issue #375).
   */
  tzOffsetMinutes?: number;
  /**
   * Mobile-only (issue #393): the kiosk this mobile is targeting.
   * When set, the server resolves the session via
   * `getOrCreateActiveSessionForKiosk(workspaceId, targetKioskDeviceId)`
   * instead of the legacy workspace-wide single-active rule. The picked
   * kiosk also receives a `kiosk-attention` banner so the user can
   * physically confirm which kiosk picked up the connection.
   *
   * Ignored when the registering device is a kiosk (a kiosk always
   * anchors to its own session) or when the workspace is anonymous.
   */
  targetKioskDeviceId?: string;
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

/**
 * Client → Server: report current per-device mic listening state
 * (issue #388). Sent on mount (with the initial value) and on every
 * change to the derived listening boolean. The server uses these
 * fields to drive the kiosk's three-state mic indicator
 * (listening / muted / no-mic).
 *
 * `deviceId` is implicit — the server identifies the device by the
 * WebSocket connection, matching how `update-device` works today.
 * Runtime-only: nothing in this message is persisted to SQLite.
 */
export interface DeviceListeningStateMessage {
  type: 'device-listening-state';
  /** True when the mic is open and producing audio/STT events. */
  listening: boolean;
  /**
   * False when the device has neither Web Speech recognition nor any
   * accessible `getUserMedia` mic. Devices with `sttSupported: false`
   * are excluded from the kiosk's "any listening / all muted"
   * aggregation.
   */
  sttSupported: boolean;
}

export interface TextMessage {
  type: 'text';
  utteranceId: string;
  text: string;
  partial: boolean;
  /**
   * Optional ISO-8601 Zulu wall-clock time when the utterance was
   * produced on the client. The server falls back to receipt time when
   * absent (issue #375). All timestamps on the wire are UTC.
   */
  clientTimestamp?: string;
  /**
   * Optional engine-emitted speaker label for hosted-STT pipelines
   * (#386). For Deepgram this is rendered as `S1`, `S2`, ... — an
   * opaque per-session identifier with no global meaning. Web Speech
   * never sets this; the server passes it through to other devices
   * and resolves it to a `speakers.id` via `session_engine_speakers`
   * when a mapping exists.
   */
  engineSpeakerLabel?: string;
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

/**
 * Server → All devices in session: full session-settings snapshot.
 *
 * Broadcast whenever any field of the session settings DTO changes
 * (via REST `PATCH /api/sessions/:id/settings` or the existing WS
 * `'session-tts-settings'` handler). The payload mirrors the
 * `SessionSettingsDTO` returned by `GET /api/sessions/:id/settings`,
 * so clients can hydrate their local UI state directly from the
 * broadcast without a follow-up REST call.
 *
 * `session-tts-settings-changed` is still emitted alongside this for
 * backwards compatibility with kiosks/mobiles that only know about
 * the TTS-specific message. See issue #378.
 */
export interface SessionSettingsChangedMessage {
  type: 'session-settings-changed';
  sessionId: string;
  /**
   * Loosely typed here to avoid a cross-module cycle with
   * `sessions/types.ts`. The runtime payload is a
   * `SessionSettingsDTO` (see `server/src/sessions/types.ts`).
   */
  settings: {
    sessionId: string;
    workspaceId: string;
    tts: { enabled: boolean; outputDeviceId: string | null };
    inputMode: 'voice' | 'unified' | 'visualizer';
    autoSubmit: boolean;
    agentPrompt: {
      effective: string;
      source: 'session' | 'workspace-default' | 'builtin';
    };
  };
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
 * with their eyes that they targeted the right physical screen — this
 * matters in rooms where two kiosks are visible at once.
 *
 * The banner is purely transient: no persistence, no echo, no ack.
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
  | SessionStateMessage
  | AgentActionMessage
  | AudioChunkMessage
  | AudioEndMessage
  | SessionTtsSettingsChangedMessage
  | SessionSettingsChangedMessage
  | TranscriptionResultMessage
  | TranscriptionErrorMessage
  | KioskAttentionMessage;

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
  /**
   * The id of the active session this device is anchored to (kiosk only;
   * issue #393). Populated from `sessions.target_kiosk_device_id`. Lets
   * the mobile kiosk picker show a `🔴 In session` pill and a
   * `Join in progress` button without an extra round-trip.
   *
   * `null` for mobile devices and for kiosks that have not been bound to
   * a session yet.
   */
  activeSessionId?: string | null;
  /**
   * ISO-8601 timestamp of the kiosk's most recent `session_devices.joined_at`
   * row (issue #393). The picker renders this as a "last used N hours ago"
   * line. `null` for kiosks that have never participated in a session.
   *
   * Omitted (not `null`) for mobile devices to keep payloads small.
   */
  lastUsedAt?: string | null;
  /**
   * Per-device mic listening state (issue #388). `true` when the device
   * is actively producing mic input, `false` when muted. `undefined` for
   * clients that have not yet sent a `device-listening-state` message
   * (legacy clients, or a brand-new connection before the first flip).
   * Treated as "not listening" by the kiosk aggregator.
   */
  listening?: boolean;
  /**
   * Whether the device is mic-capable (issue #388). Used by the kiosk
   * aggregator to exclude STT-less kiosks from the "all muted" decision.
   * `undefined` is the conservative legacy default: device is excluded
   * from aggregation entirely.
   */
  sttSupported?: boolean;
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
  /**
   * For user utterances: client-captured ISO-8601 Zulu wall-clock time
   * when the utterance was produced (issue #375). Server falls back to
   * receipt time when the client doesn't supply one. Lets kiosks render
   * peer messages with the sender's local time.
   */
  clientTimestamp?: string;
  /**
   * For user utterances: the sender's local IANA timezone, propagated
   * from device registration (issue #375). Used by kiosks to render peer
   * messages in their local time. Undefined for AI utterances and for
   * senders whose timezone is unknown.
   */
  senderTimezone?: string;
  /**
   * Stable id of the workspace-scoped `speakers` row resolved for this
   * utterance (#383). Lets later analytics and the message-history view
   * attribute past statements to the human (not just the device) even
   * after the speaker's preferred name changes. `undefined` for AI
   * utterances, anonymous devices, and pre-#383 messages.
   */
  speakerId?: string;
  /**
   * Engine-emitted speaker label for hosted-STT pipelines (#386).
   * Pass-through from the inbound `TextMessage`. Kiosks render this
   * as a `S1:` / `S2:` prefix on the ticker until the agent or the
   * UI links it to a real speaker (at which point `speakerId` is also
   * set and the prefix can be swapped for the human's name).
   */
  engineSpeakerLabel?: string;
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
 *
 * `thinkingSince` is an optional ISO timestamp indicating when the current
 * thinking phase began. Populated by the register-time resync path
 * (issue #290) so a client rejoining mid-turn knows how long the agent has
 * been working. Live thinking-transition broadcasts may omit it.
 */
export interface AIThinkingMessage {
  type: 'ai-thinking';
  sessionId: string;
  thinking: boolean;
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
 * Server → All devices in session: unified `session-state` message
 * (issue #295). Carries the full `AgentSessionStatus` so the client can
 * reduce a single, internally-consistent state object instead of
 * reconstructing it from the parallel `session-ai-status` + `ai-thinking`
 * pair.
 *
 * Emitted alongside the legacy messages for one release of back-compat;
 * the next release removes the legacy emit path on the server and the
 * legacy receive path on the client.
 *
 * The `ai` payload is intentionally a 1:1 transport of the driver's
 * `AgentSessionStatus` — no translation, no re-shaping. Future fields
 * added to that type (like `startupPhase` for #301) are automatically
 * available on the wire.
 */
export interface SessionStateMessage {
  type: 'session-state';
  sessionId: string;
  ai: AgentSessionStatusWire;
}

/**
 * Wire representation of `AgentSessionStatus` from the driver. Kept in
 * sync with `server/src/agent-driver/types.ts#AgentSessionStatus`.
 *
 * Declared here (not imported from the driver) because `types.ts` is the
 * public wire-shape boundary that other modules — including the client's
 * mirror in `client/src/types.ts` — compare against.
 */
export interface AgentSessionStatusWire {
  sessionId: string;
  state: 'absent' | 'starting' | 'ready' | 'thinking' | 'reconnecting' | 'degraded';
  conversationId: string | null;
  error: string | null;
  thinkingSince: string | null;
  startingSince: string | null;
  startupPhase?: string;
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
