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
  | TextMessage;

export interface RegisterMessage {
  type: 'register';
  deviceId: string;
  workspaceId?: string;  // Optional for backward compatibility; defaults to 'default'
  sessionId?: string;    // Optional; auto-assigns to active session if omitted
  displayName: string;
  mode: DeviceMode;
  screenWidth?: number;
  screenHeight?: number;
}

/**
 * Request payload for POST /api/display endpoint.
 * Extends DisplayContent with optional workspace targeting.
 */
export interface DisplayRequest extends DisplayContent {
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

// Messages from server to client
export type ServerMessage =
  | RegisteredMessage
  | DeviceListMessage
  | RelayedTextMessage
  | HistoryMessage
  | DisplayMessage;

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
