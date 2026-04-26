import type { RelayedTextMessage } from '../types.js';

export interface MessageStore {
  /** Append a final message to history */
  append(message: RelayedTextMessage): Promise<void>;

  /** Get recent messages, newest last */
  getRecent(limit?: number): Promise<RelayedTextMessage[]>;

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
