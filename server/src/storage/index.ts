import type { MessageStore, StoreConfig } from './types.js';
import { SQLiteStore } from './sqlite.js';

export type { MessageStore, StoreConfig } from './types.js';
export { Migrator, type Migration, type AppliedMigration } from './migrator.js';
export { getMigrations } from './migrations/index.js';
export { SQLiteStore } from './sqlite.js';

const SUPPORTED_DRIVERS: readonly StoreConfig['driver'][] = ['sqlite'] as const;

function isSupportedDriver(value: string): value is StoreConfig['driver'] {
  return (SUPPORTED_DRIVERS as readonly string[]).includes(value);
}

/**
 * Create a {@link MessageStore} for the given driver configuration.
 *
 * Only the `sqlite` driver is supported today. A Postgres driver is tracked in
 * #263 and will plug in here by adding a new case alongside `sqlite`.
 */
export function createStore(config: StoreConfig): MessageStore {
  switch (config.driver) {
    case 'sqlite':
      if (!config.sqlite?.path) {
        throw new Error('SQLite store requires "sqlite.path" config');
      }
      return new SQLiteStore(config.sqlite);

    default: {
      const driver = (config as { driver: string }).driver;
      throw new Error(
        `Unknown STORE_DRIVER "${driver}". Supported values: ${SUPPORTED_DRIVERS.join(', ')}`,
      );
    }
  }
}

/**
 * Create a store from environment variables:
 *
 *   STORE_DRIVER=sqlite (default: sqlite; currently the only supported value)
 *   SQLITE_PATH=./data/messages.db
 *
 * Unsupported STORE_DRIVER values fail fast with a clear error so stale .env
 * files referencing the removed `memory`, `redis`, or `firestore` drivers are
 * surfaced at startup rather than silently misbehaving.
 */
export function createStoreFromEnv(): MessageStore {
  const rawDriver = process.env.STORE_DRIVER || 'sqlite';

  if (!isSupportedDriver(rawDriver)) {
    throw new Error(
      `Unknown STORE_DRIVER "${rawDriver}". Supported values: ${SUPPORTED_DRIVERS.join(', ')}`,
    );
  }

  const config: StoreConfig = {
    driver: rawDriver,
    sqlite: { path: process.env.SQLITE_PATH || './data/messages.db' },
  };

  console.log(`[Storage] Using ${rawDriver} driver`);

  return createStore(config);
}
