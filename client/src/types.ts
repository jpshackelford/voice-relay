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

export type ClientMessage = RegisterMessage | UpdateDeviceMessage | TextMessage;

// Messages from server to client
export interface RegisteredMessage {
  type: 'registered';
  deviceId: string;
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

export type ServerMessage = RegisteredMessage | DeviceListMessage | RelayedTextMessage | HistoryMessage | DisplayMessage | AIStatusMessage;

export interface Utterance {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
  receivedAt: Date;
}
