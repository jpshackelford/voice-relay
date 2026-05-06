import type { RelayedTextMessage } from '../types.js';

export interface MessageStore {
  /** Append a final message to history */
  append(message: RelayedTextMessage): Promise<void>;

  /** Get recent messages, newest last. Optionally filter by workspaceId. */
  getRecent(limit?: number, workspaceId?: string): Promise<RelayedTextMessage[]>;

  /** Get recent messages by session, newest last. */
  getRecentBySession(limit: number, sessionId: string): Promise<RelayedTextMessage[]>;

  /** Clear all messages */
  clear(): Promise<void>;

  /** Connect to the store (if needed) */
  connect(): Promise<void>;

  /** Disconnect from the store (if needed) */
  disconnect(): Promise<void>;
}

export interface StoreConfig {
  driver: 'memory' | 'sqlite' | 'redis' | 'firestore';
  
  memory?: {
    maxMessages?: number;
  };

  sqlite?: {
    path: string;
  };

  redis?: {
    url: string;
    maxMessages?: number;
    keyPrefix?: string;
  };

  firestore?: {
    projectId?: string;
    collection?: string;
    maxMessages?: number;
  };
}
