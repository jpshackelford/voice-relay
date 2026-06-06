import { test, expect } from '@playwright/test';
import * as path from 'path';

/**
 * E2E Smoke tests for AI Assistant Integration.
 *
 * Tests validate the session-centric AI architecture:
 * 1. AI availability check based on workspace API key configuration
 * 2. AI auto-connects to sessions when first device joins
 * 3. AI status indicator (.ai-status) shows connecting/connected states
 * 4. Sending messages and receiving AI responses via WebSocket
 * 5. AI displaying images on kiosk canvas
 * 6. AI displaying markdown content on kiosk canvas
 * 7. Deprecated device-centric endpoints return 410 Gone
 *
 * Prerequisites:
 * - TEST_AUTH_SECRET env var set for automated auth
 * - Test workspace with a per-workspace OpenHands API key configured (#404)
 *
 * Usage:
 *   TEST_AUTH_SECRET=xxx SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://app.no-hands.dev';
const AUTH_FILE = path.join(__dirname, '.auth-state.json');

test.describe('AI Assistant Integration', () => {

  // Helper to ensure the kiosk drawer is open
  // The drawer starts collapsed (per F3 requirement), so we need to open it
  // before interacting with elements inside (like .ai-status indicator)
  async function ensureDrawerOpen(page: import('@playwright/test').Page) {
    const drawerOpenBtn = page.locator('.drawer-open-btn');
    if (await drawerOpenBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await drawerOpenBtn.click();
      // Wait for drawer to animate open
      await page.waitForTimeout(300);
    }
  }

  // `/api/ai/status` describe block removed in #404. The global probe was
  // retired alongside the env-keyed singleton client; availability is now a
  // per-workspace question answered by the workspace settings UI.

  test.describe('Kiosk AI Features', () => {
    // Only AI interaction tests need extended timeout for API response times
    test.setTimeout(120000);
    test.use({ storageState: AUTH_FILE });

    // Helper to get a workspace with AI enabled
    async function getAIEnabledWorkspace(page: import('@playwright/test').Page): Promise<{ id: string; name: string } | null> {
      const response = await page.request.get(`${BASE_URL}/api/workspaces`);
      if (!response.ok()) return null;

      const workspaces = await response.json();

      // Find workspace where current user is owner (likely to have AI configured)
      const ownedWorkspace = workspaces.find((ws: { isOwner: boolean }) => ws.isOwner);
      return ownedWorkspace || null;
    }

    // Helper to navigate to kiosk mode for a workspace
    async function navigateToKiosk(page: import('@playwright/test').Page, workspaceId: string) {
      // Create a new session and enter kiosk mode
      await page.goto(`${BASE_URL}/workspace/${workspaceId}`);

      // Wait for workspace page to load
      await expect(
        page.getByRole('heading', { name: /devices/i })
      ).toBeVisible({ timeout: 15000 });

      // Click "New Session" button to create a session
      const newSessionBtn = page.getByRole('button', { name: /new session|start session/i });
      if (await newSessionBtn.isVisible()) {
        await newSessionBtn.click();
      }

      // Wait for session to be created and kiosk mode to load
      await expect(page.locator('.kiosk-mode')).toBeVisible({ timeout: 15000 });
    }

    // Helper to wait for AI to auto-connect after session starts
    // AI now automatically connects to sessions when first device joins
    async function waitForAIAutoConnect(page: import('@playwright/test').Page) {
      // First ensure the drawer is open so the AI status indicator is accessible
      await ensureDrawerOpen(page);

      // AI status indicator only appears when connecting or connected
      const aiStatus = page.locator('.ai-status');
      // Wait for AI to auto-connect (status indicator appears)
      await expect(aiStatus).toBeVisible({ timeout: 60000 });
    }

    /**
     * Wait for AI to reach connected state with retry support.
     * Uses Playwright's toPass() to handle transient API failures gracefully.
     * 
     * The AI connection can fail due to:
     * - OpenHands API rate limiting or timeouts
     * - Transient network issues
     * - Server-side connection pool exhaustion
     * 
     * This helper retries the entire connection check for up to 90 seconds,
     * allowing 30-second intervals for each connection attempt.
     */
    async function waitForAIConnected(page: import('@playwright/test').Page) {
      const aiStatus = page.locator('.ai-status');
      // Use toPass() for retry logic on transient API failures
      // This wraps the assertion in a retry loop
      await expect(async () => {
        await expect(aiStatus).toHaveClass(/active/, { timeout: 30000 });
      }).toPass({ timeout: 90000 });
    }

    // TEMPORARILY SKIPPED: These tests are flaky due to OpenHands API reliability issues.
    // The API intermittently returns 401 BearerTokenError on session creation.
    // See GitHub Issue #239 (https://github.com/jpshackelford/voice-relay/issues/239)
    // TODO(#239): Re-enable once OpenHands API stability improves or we implement better retry logic.

    test.skip('AI auto-connects to session and shows status indicator', async ({ page }) => {
      // Post-#404: AI availability is per-workspace. We probe by looking
      // for a workspace that has an OpenHands API key configured; if none
      // exists this test environment can't exercise the AI path.
      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'AI not available - no workspace with a per-workspace OpenHands API key configured');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAutoConnect(page);

      // AI status indicator should be visible (AI auto-connects to sessions)
      const aiStatus = page.locator('.ai-status');

      // Should show ✨ emoji when connected (or 🔗 when connecting)
      await expect(aiStatus).toContainText(/✨|🔗/);
    });

    test.skip('AI status shows connected state after auto-connect', async ({ page }) => {
      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAutoConnect(page);

      // Wait for connected state with retry for transient failures
      await waitForAIConnected(page);

      // Kiosk AI status indicator should also be visible
      await expect(page.locator('.kiosk-ai-status')).toBeVisible({ timeout: 5000 });
    });

    test.skip('send message to AI and receive response', async ({ page }) => {
      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAutoConnect(page);

      // Wait for AI to reach connected state with retry for transient failures
      await waitForAIConnected(page);

      // Send a simple message
      const input = page.locator('input[type="text"]');
      await input.fill('Hello, what can you help me with?');
      await input.press('Enter');

      // Wait for AI response to appear in chat
      // AI messages have sender "✨ AI"
      const aiMessage = page.locator('.kiosk-message').filter({ hasText: '✨ AI' });
      await expect(aiMessage.first()).toBeVisible({ timeout: 60000 });
    });

    // SKIPPED: This test is flaky because it depends on the AI model choosing to
    // call the display API within 90 seconds. The AI's response is non-deterministic
    // and may not always include a display action even when prompted. The core AI
    // connectivity is verified by the auto-connect and 'send message' tests.
    // See GitHub Issue #88 for investigation details.
    test.skip('AI displays image on kiosk canvas', async ({ page }) => {
      // `/api/ai/status` was retired in #404; AI availability is now a
      // per-workspace fact. `getAIEnabledWorkspace` handles the gate.
      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAutoConnect(page);

      // Wait for AI to reach connected state with retry for transient failures
      await waitForAIConnected(page);

      // Intercept display API call to verify AI uses it
      const displayApiPromise = page.waitForRequest(
        request => request.url().includes('/api/display') && request.method() === 'POST',
        { timeout: 90000 }
      );

      // Request image display
      const input = page.locator('input[type="text"]');
      await input.fill('Show me a picture of a golden retriever');
      await input.press('Enter');

      // Verify AI calls display API (may take time for AI to process and respond)
      const displayRequest = await displayApiPromise;
      const requestBody = displayRequest.postDataJSON();
      expect(requestBody).toHaveProperty('type');
      expect(requestBody.type).toBe('image');
      expect(requestBody.content).toBeTruthy();

      // Verify image appears on canvas
      const displayImage = page.locator('.kiosk-display img, .display-image img');
      await expect(displayImage).toBeVisible({ timeout: 60000 });

      // Verify image loaded successfully (not broken)
      const imageLoaded = await displayImage.evaluate((img: HTMLImageElement) => {
        return img.complete && img.naturalWidth > 0;
      });
      expect(imageLoaded).toBe(true);
    });

    // SKIPPED: This test is flaky because it depends on the AI model choosing to
    // call the display API within 90 seconds. The AI's response is non-deterministic
    // and may not always include a display action even when prompted. The core AI
    // connectivity is verified by the auto-connect and 'send message' tests.
    // See GitHub Issue #88 for investigation details.
    test.skip('AI displays markdown content on canvas', async ({ page }) => {
      // `/api/ai/status` was retired in #404; AI availability is now a
      // per-workspace fact. `getAIEnabledWorkspace` handles the gate.
      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAutoConnect(page);

      // Wait for AI to reach connected state with retry for transient failures
      await waitForAIConnected(page);

      // Intercept display API
      const displayApiPromise = page.waitForRequest(
        request => request.url().includes('/api/display') && request.method() === 'POST',
        { timeout: 90000 }
      );

      // Request markdown display
      const input = page.locator('input[type="text"]');
      await input.fill('Create a brief meeting agenda with 3 bullet points and display it');
      await input.press('Enter');

      // Verify AI calls display API
      const displayRequest = await displayApiPromise;
      const requestBody = displayRequest.postDataJSON();
      expect(requestBody).toHaveProperty('type');
      expect(requestBody.content).toBeTruthy();

      // If markdown type, verify it renders
      if (requestBody.type === 'markdown') {
        const markdownDisplay = page.locator('.display-markdown, .markdown-content');
        await expect(markdownDisplay).toBeVisible({ timeout: 60000 });
      }
    });
  });

  test.describe('AI Unavailable Scenarios', () => {
    test.use({ storageState: AUTH_FILE });

    // Helper: find an owned workspace that does NOT have an OpenHands API
    // key configured. Post-#404 the global `/api/ai/status` probe was
    // retired and AI availability became a per-workspace question answered
    // by `workspace_settings.openhands_api_key_encrypted` (surfaced as
    // `hasApiKey` on `GET /api/workspaces/:id/settings`). See issue #421.
    async function getAIDisabledWorkspace(
      page: import('@playwright/test').Page,
    ): Promise<{ id: string; name: string } | null> {
      const wsResponse = await page.request.get(`${BASE_URL}/api/workspaces`);
      if (!wsResponse.ok()) return null;
      const workspaces: Array<{ id: string; name: string; isOwner: boolean }> =
        await wsResponse.json();

      // The settings endpoint requires owner permission, so only owned
      // workspaces can be probed for `hasApiKey`.
      for (const ws of workspaces) {
        if (!ws.isOwner) continue;
        const settingsResp = await page.request.get(
          `${BASE_URL}/api/workspaces/${ws.id}/settings`,
        );
        if (!settingsResp.ok()) continue;
        const settings = (await settingsResp.json()) as { hasApiKey?: boolean };
        if (!settings.hasApiKey) return ws;
      }
      return null;
    }

    test('AI status indicator not visible when AI unavailable', async ({ page }) => {
      // Find a workspace where AI is genuinely unavailable (no per-workspace
      // OpenHands API key). If none exists in the smoke account, skip — the
      // previous global `/api/ai/status` probe was deleted in #404 and a
      // workspace with AI configured will auto-connect, leaving
      // `.ai-status` visible (issue #421).
      const workspace = await getAIDisabledWorkspace(page);
      if (!workspace) {
        test.skip(
          true,
          'No AI-unconfigured owned workspace available - cannot test unavailable scenario',
        );
        return;
      }

      // Navigate to kiosk
      await page.goto(`${BASE_URL}/workspace/${workspace.id}`);
      await expect(
        page.getByRole('heading', { name: /devices/i })
      ).toBeVisible({ timeout: 15000 });

      const newSessionBtn = page.getByRole('button', { name: /new session|start session/i });
      if (await newSessionBtn.isVisible()) {
        await newSessionBtn.click();
      }

      await expect(page.locator('.kiosk-mode')).toBeVisible({ timeout: 15000 });

      // Open the drawer first to ensure .ai-status would be visible if it existed
      await ensureDrawerOpen(page);

      // Wait for any availability check to complete - AI status should remain hidden
      // since AI only renders .ai-status when connecting or connected
      const aiStatus = page.locator('.ai-status');
      await expect(aiStatus).toBeHidden({ timeout: 10000 });
    });
  });

  test.describe('Deprecated AI API Endpoints', () => {
    // Tests for legacy device-centric AI endpoints that now return 410 Gone
    // These endpoints were deprecated in favor of session-centric auto-connect
    test.use({ storageState: AUTH_FILE });

    test('POST /api/ai/connect returns 410 Gone (deprecated)', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/ai/connect`, {
        data: {
          deviceId: 'any-device-id',
          mode: 'kiosk'
        }
      });

      expect(response.status()).toBe(410);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Deprecated');
    });

    test('POST /api/ai/message returns 410 Gone (deprecated)', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/ai/message`, {
        data: {
          deviceId: 'any-device-id',
          message: 'Hello'
        }
      });

      expect(response.status()).toBe(410);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Deprecated');
    });

    test('DELETE /api/ai/disconnect returns 410 Gone (deprecated)', async ({ request }) => {
      const response = await request.delete(`${BASE_URL}/api/ai/disconnect`, {
        data: {
          deviceId: 'any-device-id'
        }
      });

      expect(response.status()).toBe(410);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Deprecated');
    });
  });

});
