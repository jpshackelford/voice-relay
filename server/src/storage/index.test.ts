import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createStore, createStoreFromEnv, SQLiteStore } from './index.js';
import type { StoreConfig } from './types.js';

describe('createStore', () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `voice-relay-storage-index-test-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, 'test.db');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates a SQLiteStore for the sqlite driver', () => {
    const store = createStore({ driver: 'sqlite', sqlite: { path: testDbPath } });
    expect(store).toBeInstanceOf(SQLiteStore);
  });

  it('throws when the sqlite driver is missing its path config', () => {
    expect(() => createStore({ driver: 'sqlite' } as StoreConfig)).toThrow(
      /sqlite\.path/,
    );
  });

  // Cast through unknown so we can simulate stale callers that still pass a
  // removed driver name at runtime.
  it.each(['memory', 'redis', 'firestore', 'postgres', 'invalid'])(
    'rejects the removed/unsupported driver %s with a clear error',
    (driver) => {
      const badConfig = { driver } as unknown as StoreConfig;
      expect(() => createStore(badConfig)).toThrow(
        new RegExp(`Unknown STORE_DRIVER "${driver}".*Supported values: sqlite`),
      );
    },
  );
});

describe('createStoreFromEnv', () => {
  const ORIGINAL_ENV = { ...process.env };
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `voice-relay-storage-env-test-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('defaults to the sqlite driver when STORE_DRIVER is unset', () => {
    delete process.env.STORE_DRIVER;
    process.env.SQLITE_PATH = join(testDir, 'default.db');

    const store = createStoreFromEnv();
    expect(store).toBeInstanceOf(SQLiteStore);
  });

  it('uses the sqlite driver when STORE_DRIVER=sqlite', () => {
    process.env.STORE_DRIVER = 'sqlite';
    process.env.SQLITE_PATH = join(testDir, 'explicit.db');

    const store = createStoreFromEnv();
    expect(store).toBeInstanceOf(SQLiteStore);
  });

  it.each(['memory', 'redis', 'firestore', 'postgres', 'bogus'])(
    'throws a clear error when STORE_DRIVER is the unsupported value %s',
    (driver) => {
      process.env.STORE_DRIVER = driver;
      process.env.SQLITE_PATH = join(testDir, 'unused.db');

      expect(() => createStoreFromEnv()).toThrow(
        new RegExp(`Unknown STORE_DRIVER "${driver}".*Supported values: sqlite`),
      );
    },
  );
});
