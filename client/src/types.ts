export type DeviceMode = 'input' | 'output' | 'chat';

export interface DeviceInfo {
  id: string;
  displayName: string;
  mode: DeviceMode;
}

// Messages from client to server
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

export type ServerMessage = RegisteredMessage | DeviceListMessage | RelayedTextMessage | HistoryMessage;

export interface Utterance {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  partial: boolean;
  receivedAt: Date;
}
