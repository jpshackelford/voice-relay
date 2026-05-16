import { defineConfig } from '@playwright/test';

// Use different ports for tests to avoid conflicts with dev server
const TEST_CLIENT_PORT = 5174;
const TEST_SERVER_PORT = 3002;

// Get auth secret from environment for multi-device tests
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET || '';
// JWT_SECRET is required for auth to work. In local development, a fallback is
// convenient. In CI, JWT_SECRET MUST be set explicitly via environment/secrets
// to avoid using a well-known value that could be exploited if tests somehow
// run against non-test infrastructure.
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-local-dev-only';

// Use a separate test database to avoid conflicts with dev/prod
const SQLITE_PATH = process.env.SQLITE_PATH || './data/test-messages.db';

export default defineConfig({
  testDir: './tests',
  // Smoke tests are excluded from regular test runs - they require production
  // auth state and target the deployed server. Run them separately with:
  // `SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke`
  // See tests/smoke/README.md for setup instructions.
  testIgnore: ['**/smoke/**'],
  // Default timeout of 30s, but multi-device tests use test.slow() for 90s
  timeout: 30000,
  retries: 0,
  // Run tests serially to avoid race conditions with shared SQLite database
  // All tests share the same test user/workspace created by /auth/test-session
  workers: 1,
  use: {
    baseURL: `http://localhost:${TEST_CLIENT_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    // Enable tracing for debugging failed tests
    trace: 'on-first-retry',
  },
  webServer: {
    // Pass env vars inline in the command (more reliable than env option)
    // Use SQLite storage to enable auth routes (required for multi-device tests)
    command: `PORT=${TEST_SERVER_PORT} STORE_DRIVER=sqlite SQLITE_PATH="${SQLITE_PATH}" TEST_AUTH_SECRET="${TEST_AUTH_SECRET}" JWT_SECRET="${JWT_SECRET}" npm run dev -w server & VITE_WS_PORT=${TEST_SERVER_PORT} npm run dev -w client -- --port ${TEST_CLIENT_PORT}`,
    url: `http://localhost:${TEST_CLIENT_PORT}`,
    reuseExistingServer: false,
    // Increase timeout for server startup
    timeout: 60000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
