import type { WebSocket } from 'ws';

export type DeviceMode = 'input' | 'output';

export interface Device {
  id: string;
  displayName: string;
  mode: DeviceMode;
  ws: WebSocket;
  connectedAt: Date;
  ttsEnabled?: boolean;
}

// Messages from client to server
export type ClientMessage =
  | RegisterMessage
  | UpdateDeviceMessage
  | TextMessage;

export interface RegisterMessage {
  type: 'register';
  deviceId: string;
  displayName: string;
  mode: DeviceMode;
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
  | HistoryMessage;

export interface RegisteredMessage {
  type: 'registered';
  deviceId: string;
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
  displayName: string;
  mode: DeviceMode;
}

export interface RelayedTextMessage {
  type: 'text';
  utteranceId: string;
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
}
