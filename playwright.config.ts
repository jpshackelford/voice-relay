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
    command: `PORT=${TEST_SERVER_PORT} npm run dev -w server & VITE_WS_PORT=${TEST_SERVER_PORT} npm run dev -w client -- --port ${TEST_CLIENT_PORT}`,
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
