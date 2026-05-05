import { defineConfig } from '@playwright/test';

// Use different ports for tests to avoid conflicts with dev server
const TEST_CLIENT_PORT = 5174;
const TEST_SERVER_PORT = 3002;

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${TEST_CLIENT_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Enable E2E test mode on both server and client
    // - Server uses 'default' workspace without auth validation
    // - Client bypasses auth with mock user and workspace
    command: `PORT=${TEST_SERVER_PORT} npm run dev -w server & VITE_WS_PORT=${TEST_SERVER_PORT} VITE_E2E_MODE=true npm run dev -w client -- --port ${TEST_CLIENT_PORT}`,
    url: `http://localhost:${TEST_CLIENT_PORT}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
