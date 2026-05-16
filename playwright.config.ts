import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for parallel E2E tests.
 *
 * ## Architecture (GitHub Issue #155)
 *
 * Each Playwright worker gets isolated infrastructure:
 * - Unique client port: 5174 + (workerIndex * 10)
 * - Unique server port: 3002 + (workerIndex * 10)
 * - Unique SQLite database: ./data/test-worker-{workerIndex}.db
 *
 * Port Allocation:
 * | Worker | Client Port | Server Port | Database                  |
 * |--------|-------------|-------------|---------------------------|
 * | 0      | 5174        | 3002        | ./data/test-worker-0.db   |
 * | 1      | 5184        | 3012        | ./data/test-worker-1.db   |
 * | 2      | 5194        | 3022        | ./data/test-worker-2.db   |
 * | 3      | 5204        | 3032        | ./data/test-worker-3.db   |
 *
 * ## Server Lifecycle
 *
 * - globalSetup spawns all worker servers before tests run
 * - globalTeardown kills all processes and cleans up after tests
 * - Each test file imports fixtures.ts which provides worker-specific baseURL
 *
 * ## Environment Variables
 *
 * - PLAYWRIGHT_WORKERS: Number of parallel workers (default: 4)
 * - TEST_AUTH_SECRET: Required for authenticated tests
 * - JWT_SECRET: JWT signing secret (defaults to test value locally)
 * - DEBUG_GLOBAL_SETUP: Enable verbose logging from server processes
 * - CLEANUP_TEST_DBS: Remove test databases after teardown (default: false)
 */

// Determine worker count from environment or default to 4
// Must match the default in global-setup.ts to ensure worker count consistency
const WORKER_COUNT = parseInt(process.env.PLAYWRIGHT_WORKERS || '4', 10);

// Audio fixtures for mobile voice tests (from oh-local-speech)
const AUDIO_FIXTURES_DIR = path.resolve(__dirname, 'tests/fixtures/audio');

export default defineConfig({
  testDir: './tests',
  // Smoke tests are excluded from regular test runs - they require production
  // auth state and target the deployed server. Run them separately with:
  // `SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke`
  // See tests/smoke/README.md for setup instructions.
  testIgnore: ['**/smoke/**'],

  // Default timeout of 30s, but multi-device tests use test.slow() for 90s
  timeout: 30000,
  retries: 0,

  // Parallel execution with per-worker isolation (GitHub Issue #155)
  // Each worker gets its own server instance and database
  workers: WORKER_COUNT,

  // Allow tests within a file to run in parallel
  // Tests that need sequential execution can use test.describe.configure({ mode: 'serial' })
  fullyParallel: true,

  // Global setup/teardown handles server lifecycle for all workers
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',

  use: {
    // baseURL is dynamically set per-worker via fixtures.ts
    // The default here is just a fallback
    baseURL: 'http://localhost:5174',
    headless: true,
    screenshot: 'only-on-failure',
    // Enable tracing for debugging failed tests
    trace: 'on-first-retry',
  },

  // NOTE: webServer block removed - servers are now managed by globalSetup/globalTeardown
  // This allows each worker to have its own isolated server instance

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        launchOptions: {
          args: [
            // Use fake audio/video devices for testing
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // Use short_hello.wav as default fake audio input
            `--use-file-for-fake-audio-capture=${path.join(AUDIO_FIXTURES_DIR, 'short_hello.wav')}`,
          ],
        },
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 13'],
        // Note: Safari/WebKit doesn't support --use-fake-device-for-media-stream
        // These tests will use mocked APIs instead
      },
    },
  ],
});
