import { test, expect } from './fixtures';
import { Page } from '@playwright/test';
import {
  getAuthState,
  waitForStableConnection,
} from './utils/auth-helper';

/**
 * E2E Smoke Test: Kiosk Display Area
 *
 * This test verifies the kiosk display area loads correctly.
 * Markdown parsing is tested comprehensively via unit tests in KioskMode.test.tsx
 * (17 tests covering images, tables, XSS protection, etc.)
 *
 * GitHub Issue: #134
 */

const ELEMENT_VISIBLE_TIMEOUT = 10000;
const WORKSPACE_REDIRECT_TIMEOUT = 15000;
const CONNECTION_STABLE_TIMEOUT = 20000;

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

/**
 * Helper: Authenticate and navigate to session
 */
async function authenticateAndNavigateToSession(
  page: Page,
  baseURL: string,
  secret: string
): Promise<{ workspaceId: string; sessionId: string }> {
  const storageState = await getAuthState(baseURL, secret);
  await page.context().addCookies(storageState.cookies);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+$/, { timeout: WORKSPACE_REDIRECT_TIMEOUT });
  
  // Extract workspace ID
  const url = page.url();
  const match = url.match(/\/workspace\/([a-f0-9-]+)/);
  if (!match) throw new Error('Could not extract workspace ID from URL');
  const workspaceId = match[1];
  
  // Wait for sessions to load and enter first session
  await expect(page.getByRole('button', { name: /view/i }).first()).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
  await page.getByRole('button', { name: /view/i }).first().click();
  await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: ELEMENT_VISIBLE_TIMEOUT });
  
  const sessionUrl = page.url();
  const sessionMatch = sessionUrl.match(/\/session\/([a-f0-9-]+)/);
  if (!sessionMatch) throw new Error('Could not extract session ID from URL');
  
  return { workspaceId, sessionId: sessionMatch[1] };
}

test.describe('Kiosk Display Smoke Test', () => {
  // Skip all tests if no auth secret
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  let baseURL: string;

  test.beforeEach(async ({ workerBaseURL }) => {
    // Get base URL from worker fixture (set by global setup)
    baseURL = workerBaseURL;
  });

  test('kiosk display area loads correctly', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    await authenticateAndNavigateToSession(page, baseURL, TEST_AUTH_SECRET);
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    
    // Verify kiosk mode loads with display area
    const kioskMode = page.locator('.kiosk-mode');
    await expect(kioskMode).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
    
    // Verify display area exists
    const displayArea = page.locator('.kiosk-display');
    await expect(displayArea).toBeVisible();
  });
});
