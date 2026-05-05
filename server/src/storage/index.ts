import type { MessageStore, StoreConfig } from './types.js';
import { MemoryStore } from './memory.js';
import { SQLiteStore } from './sqlite.js';
import { RedisStore } from './redis.js';
import { FirestoreStore } from './firestore.js';

export type { MessageStore, StoreConfig } from './types.js';
export { Migrator, type Migration, type AppliedMigration } from './migrator.js';
export { getMigrations } from './migrations/index.js';
export { SQLiteStore } from './sqlite.js';
export { MemoryStore } from './memory.js';

export function createStore(config: StoreConfig): MessageStore {
  switch (config.driver) {
    case 'memory':
      return new MemoryStore(config.memory);

    case 'sqlite':
      if (!config.sqlite?.path) {
        throw new Error('SQLite store requires "sqlite.path" config');
      }
      return new SQLiteStore(config.sqlite);

    case 'redis':
      if (!config.redis?.url) {
        throw new Error('Redis store requires "redis.url" config');
      }
      return new RedisStore(config.redis);

    case 'firestore':
      return new FirestoreStore(config.firestore ?? {});

    default:
      throw new Error(`Unknown store driver: ${config.driver}`);
  }
}

/**
 * Create a store from environment variables:
 * 
 * STORE_DRIVER=memory|sqlite|redis|firestore (default: memory)
 * STORE_MAX_MESSAGES=100 (default: 100)
 * 
 * For SQLite:
 *   SQLITE_PATH=./data/messages.db
 * 
 * For Redis:
 *   REDIS_URL=redis://localhost:6379
 * 
 * For Firestore:
 *   FIRESTORE_PROJECT_ID=your-project
 *   FIRESTORE_COLLECTION=voice-relay-messages
 */
export function createStoreFromEnv(): MessageStore {
  const driver = (process.env.STORE_DRIVER || 'memory') as StoreConfig['driver'];
  const maxMessages = parseInt(process.env.STORE_MAX_MESSAGES || '100', 10);

  const config: StoreConfig = {
    driver,
    memory: { maxMessages },
    sqlite: { path: process.env.SQLITE_PATH || './data/messages.db' },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      maxMessages,
    },
    firestore: {
      projectId: process.env.FIRESTORE_PROJECT_ID,
      collection: process.env.FIRESTORE_COLLECTION || 'voice-relay-messages',
      maxMessages,
    },
  };

  console.log(`[Storage] Using ${driver} driver`);
  return createStore(config);
}
