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

/**
 * Storage driver configuration.
 *
 * The driver union is intentionally kept as a string literal type so additional
 * drivers (e.g. Postgres, tracked in #263) can be added by extending the union
 * and adding a corresponding case in {@link createStore}.
 */
export interface StoreConfig {
  driver: 'sqlite';

  sqlite?: {
    path: string;
  };
}
