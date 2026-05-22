import type { RelayedTextMessage } from '../types.js';
import type { MessageStore } from './types.js';

export interface MemoryStoreOptions {
  maxMessages?: number;
}

export class MemoryStore implements MessageStore {
  private messages: RelayedTextMessage[] = [];
  private readonly maxMessages: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.maxMessages = options.maxMessages ?? 100;
  }

  async connect(): Promise<void> {
    // No-op for memory store
  }

  async disconnect(): Promise<void> {
    // No-op for memory store
  }

  async append(message: RelayedTextMessage): Promise<void> {
    // Stamp createdAt at append time if the caller didn't provide one, so
    // that on reconnect the client can render historical messages with their
    // original time instead of page-load time (issue #264). ISO Zulu only.
    const stamped: RelayedTextMessage = message.createdAt
      ? message
      : { ...message, createdAt: new Date().toISOString() };
    this.messages.push(stamped);

    // Trim to max size
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  async getRecent(limit?: number, workspaceId?: string): Promise<RelayedTextMessage[]> {
    const count = limit ?? this.maxMessages;
    const filtered = workspaceId 
      ? this.messages.filter(m => m.workspaceId === workspaceId)
      : this.messages;
    return filtered.slice(-count);
  }

  async getRecentBySession(limit: number, sessionId: string): Promise<RelayedTextMessage[]> {
    const filtered = this.messages.filter(m => m.sessionId === sessionId);
    return filtered.slice(-limit);
  }

  async clear(): Promise<void> {
    this.messages = [];
  }
}
