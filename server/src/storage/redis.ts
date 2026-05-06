import { createClient, RedisClientType } from 'redis';
import type { RelayedTextMessage } from '../types.js';
import type { MessageStore } from './types.js';

export interface RedisStoreOptions {
  url: string;
  maxMessages?: number;
  keyPrefix?: string;
}

export class RedisStore implements MessageStore {
  private client: RedisClientType | null = null;
  private readonly url: string;
  private readonly maxMessages: number;
  private readonly listKey: string;

  constructor(options: RedisStoreOptions) {
    this.url = options.url;
    this.maxMessages = options.maxMessages ?? 100;
    this.listKey = `${options.keyPrefix ?? 'voice-relay'}:messages`;
  }

  async connect(): Promise<void> {
    this.client = createClient({ url: this.url });
    
    this.client.on('error', (err) => {
      console.error('[RedisStore] Error:', err);
    });

    await this.client.connect();
    console.log('[RedisStore] Connected to', this.url);
  }

  async disconnect(): Promise<void> {
    await this.client?.quit();
    this.client = null;
    console.log('[RedisStore] Disconnected');
  }

  async append(message: RelayedTextMessage): Promise<void> {
    if (!this.client) throw new Error('RedisStore not connected');

    const serialized = JSON.stringify(message);
    
    // Push to list and trim to max size
    await this.client
      .multi()
      .rPush(this.listKey, serialized)
      .lTrim(this.listKey, -this.maxMessages, -1)
      .exec();
  }

  async getRecent(limit?: number): Promise<RelayedTextMessage[]> {
    if (!this.client) throw new Error('RedisStore not connected');

    const count = limit ?? this.maxMessages;
    
    // Get last N messages (already in oldest-first order)
    const items = await this.client.lRange(this.listKey, -count, -1);
    
    return items.map(item => JSON.parse(item) as RelayedTextMessage);
  }

  async getRecentBySession(limit: number, sessionId: string): Promise<RelayedTextMessage[]> {
    if (!this.client) throw new Error('RedisStore not connected');

    // Redis doesn't support efficient session filtering, so we need to filter client-side
    // Get more messages than requested and filter down
    const items = await this.client.lRange(this.listKey, -this.maxMessages, -1);
    const messages = items.map(item => JSON.parse(item) as RelayedTextMessage);
    
    // Filter by session and take last N
    const sessionMessages = messages.filter(m => m.sessionId === sessionId);
    return sessionMessages.slice(-limit);
  }

  async clear(): Promise<void> {
    if (!this.client) throw new Error('RedisStore not connected');
    await this.client.del(this.listKey);
  }
}
