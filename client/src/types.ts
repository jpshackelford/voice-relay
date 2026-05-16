export type DeviceMode = 'mobile' | 'kiosk';

export interface DeviceInfo {
  id: string;
  displayName: string;
  mode: DeviceMode;
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

export type ClientMessage = RegisterMessage | UpdateDeviceMessage | TextMessage | JoinResponseMessage | DisplayResultMessage;

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

export type ServerMessage = 
  | RegisteredMessage 
  | DeviceListMessage 
  | RelayedTextMessage 
  | HistoryMessage 
  | DisplayMessage 
  | AIStatusMessage
  | AIThinkingMessage
  | SessionAIStatusMessage
  | JoinRequestMessage
  | JoinResolvedMessage
  | DeviceRemovedMessage
  | WorkspaceDeletedMessage
  | AudioChunkMessage
  | AudioEndMessage;

export interface Utterance {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
  receivedAt: Date;
}
