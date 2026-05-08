import { defineConfig } from '@playwright/test';
import * as path from 'path';

/**
 * Playwright config for smoke tests.
 * 
 * Uses global setup to handle authentication before tests run.
 * This ensures auth state is available when tests load.
 * 
 * Test files:
 * - smoke.spec.ts: Core health/auth/connectivity tests
 * - invite-link.spec.ts: Workspace invite link flow tests
 * - ai-integration.spec.ts: AI assistant E2E tests (requires OPENHANDS_API_KEY)
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['smoke.spec.ts', 'invite-link.spec.ts', 'ai-integration.spec.ts'],
  timeout: 30000,
  globalSetup: path.join(__dirname, 'auth.setup.ts'),
  use: {
    baseURL: process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
