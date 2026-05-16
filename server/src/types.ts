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

// Messages from client to server
export type ClientMessage =
  | RegisterMessage
  | UpdateDeviceMessage
  | TextMessage
  | JoinResponseMessage;

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
  workspaceId?: string;  // Optional for backward compatibility; defaults to 'default'
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
  | AudioChunkMessage
  | AudioEndMessage;

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
