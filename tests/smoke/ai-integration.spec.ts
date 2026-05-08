import { test, expect } from '@playwright/test';
import * as path from 'path';

/**
 * E2E Smoke tests for AI Assistant Integration.
 * 
 * Tests validate the human-to-agent communication flow:
 * 1. AI availability check based on workspace API key configuration
 * 2. Sparkle button visibility and state management
 * 3. Connecting to and disconnecting from AI assistant
 * 4. Sending messages and receiving AI responses
 * 5. AI displaying images on kiosk canvas
 * 6. AI displaying markdown content on kiosk canvas
 * 
 * Prerequisites:
 * - TEST_AUTH_SECRET env var set for automated auth
 * - Test workspace with OPENHANDS_API_KEY configured
 * 
 * Usage:
 *   TEST_AUTH_SECRET=xxx SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';
const AUTH_FILE = path.join(__dirname, '.auth-state.json');

test.describe('AI Assistant Integration', () => {
  
  test.describe('AI Status API', () => {
    test.use({ storageState: AUTH_FILE });

    test('AI status endpoint returns availability info', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/ai/status`);
      expect(response.ok()).toBeTruthy();
      
      const data = await response.json();
      expect(data).toHaveProperty('available');
      expect(data).toHaveProperty('message');
      expect(typeof data.available).toBe('boolean');
      expect(typeof data.message).toBe('string');
    });
  });

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

    // Helper to wait for AI availability check to complete
    // Button appears if AI is available, remains hidden if not
    async function waitForAIAvailabilityCheck(page: import('@playwright/test').Page) {
      const sparkleButton = page.locator('.ai-toggle');
      // Wait for either button to appear (AI available) or timeout (AI unavailable)
      await expect(sparkleButton).toBeVisible({ timeout: 10000 })
        .catch(() => {
          // Expected when AI not available - button won't render
        });
    }

    // Cleanup: disconnect from AI if connected to avoid leaving sessions open
    test.afterEach(async ({ page }) => {
      const sparkleButton = page.locator('.ai-toggle');
      if (await sparkleButton.isVisible().catch(() => false)) {
        const isActive = await sparkleButton.evaluate(el => el.classList.contains('active')).catch(() => false);
        if (isActive) {
          await sparkleButton.click();
        }
      }
    });

    test('sparkle button visible when AI is available', async ({ page }) => {
      // Check if AI is available
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available - no OPENHANDS_API_KEY configured');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available for testing');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      // Sparkle button should be visible
      const sparkleButton = page.locator('.ai-toggle');
      await expect(sparkleButton).toBeVisible({ timeout: 10000 });
      
      // Should show ✨ emoji when not connecting
      await expect(sparkleButton).toContainText('✨');
    });

    test('connect to AI assistant', async ({ page }) => {
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      const sparkleButton = page.locator('.ai-toggle');
      await expect(sparkleButton).toBeVisible({ timeout: 10000 });

      // Click to connect
      await sparkleButton.click();

      // Should show connecting state (⏳) then connected state (active class)
      // The connecting class may appear briefly
      await expect(sparkleButton).toHaveClass(/active/, { timeout: 30000 });
      
      // AI status indicator should be visible
      await expect(page.locator('.kiosk-ai-status')).toBeVisible({ timeout: 5000 });
    });

    test('send message to AI and receive response', async ({ page }) => {
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      // Connect to AI
      const sparkleButton = page.locator('.ai-toggle');
      await sparkleButton.click();
      await expect(sparkleButton).toHaveClass(/active/, { timeout: 30000 });

      // Send a simple message
      const input = page.locator('input[type="text"]');
      await input.fill('Hello, what can you help me with?');
      await input.press('Enter');

      // Wait for AI response to appear in chat
      // AI messages have sender "✨ AI"
      const aiMessage = page.locator('.kiosk-message').filter({ hasText: '✨ AI' });
      await expect(aiMessage.first()).toBeVisible({ timeout: 60000 });
    });

    test('AI displays image on kiosk canvas', async ({ page }) => {
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      // Connect to AI
      const sparkleButton = page.locator('.ai-toggle');
      await sparkleButton.click();
      await expect(sparkleButton).toHaveClass(/active/, { timeout: 30000 });

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
      await expect(displayImage).toBeVisible({ timeout: 30000 });

      // Verify image loaded successfully (not broken)
      const imageLoaded = await displayImage.evaluate((img: HTMLImageElement) => {
        return img.complete && img.naturalWidth > 0;
      });
      expect(imageLoaded).toBe(true);
    });

    test('AI displays markdown content on canvas', async ({ page }) => {
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      // Connect to AI
      const sparkleButton = page.locator('.ai-toggle');
      await sparkleButton.click();
      await expect(sparkleButton).toHaveClass(/active/, { timeout: 30000 });

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
        await expect(markdownDisplay).toBeVisible({ timeout: 30000 });
      }
    });

    test('disconnect from AI clears state', async ({ page }) => {
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      // Connect to AI
      const sparkleButton = page.locator('.ai-toggle');
      await sparkleButton.click();
      await expect(sparkleButton).toHaveClass(/active/, { timeout: 30000 });

      // Click again to disconnect
      await sparkleButton.click();

      // Should return to inactive state
      await expect(sparkleButton).not.toHaveClass(/active/, { timeout: 10000 });
      
      // AI status indicator should be hidden
      await expect(page.locator('.kiosk-ai-status')).toBeHidden({ timeout: 5000 });
    });

    test('rapid connect/disconnect does not corrupt state', async ({ page }) => {
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (!status.available) {
        test.skip(true, 'AI not available');
        return;
      }

      const workspace = await getAIEnabledWorkspace(page);
      if (!workspace) {
        test.skip(true, 'No workspace available');
        return;
      }

      await navigateToKiosk(page, workspace.id);
      await waitForAIAvailabilityCheck(page);

      const sparkleButton = page.locator('.ai-toggle');
      await expect(sparkleButton).toBeVisible({ timeout: 10000 });

      // Rapid toggle sequence - use minimal waits to simulate rapid clicks
      await sparkleButton.click();
      await sparkleButton.click();
      await sparkleButton.click();

      // Wait for state to stabilize by checking button has settled into a valid state
      // (not in transient 'connecting' state)
      await expect(async () => {
        const isConnecting = await sparkleButton.evaluate((el) => el.classList.contains('connecting'));
        expect(isConnecting).toBe(false);
      }).toPass({ timeout: 10000 });

      // Button should be in exactly one valid state (active OR inactive, not both/neither)
      const classes = await sparkleButton.evaluate((el) => Array.from(el.classList));
      const isActive = classes.includes('active');
      const hasAiToggle = classes.includes('ai-toggle');
      
      expect(hasAiToggle).toBe(true);
      // Verify it's in a definite state (connected or disconnected)
      expect(isActive).toBeDefined();
      
      // Verify UI consistency - active state should match visible status indicator
      const statusVisible = await page.locator('.kiosk-ai-status').isVisible();
      expect(statusVisible).toBe(isActive);
      
      // Should still be functional - can click without error
      await expect(sparkleButton).toBeEnabled();
    });
  });

  test.describe('AI Unavailable Scenarios', () => {
    test.use({ storageState: AUTH_FILE });

    test('sparkle button not visible when AI unavailable', async ({ page }) => {
      // First check if AI is actually unavailable - if available, skip
      const statusResponse = await page.request.get(`${BASE_URL}/api/ai/status`);
      const status = await statusResponse.json();
      
      if (status.available) {
        test.skip(true, 'AI is available - cannot test unavailable scenario');
        return;
      }

      // Get any workspace
      const wsResponse = await page.request.get(`${BASE_URL}/api/workspaces`);
      const workspaces = await wsResponse.json();
      const workspace = workspaces[0];
      
      if (!workspace) {
        test.skip(true, 'No workspace available');
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

      // Wait for AI availability check to complete - button should remain hidden
      // Use expect.poll to wait for the UI to settle
      const sparkleButton = page.locator('.ai-toggle');
      await expect(sparkleButton).toBeHidden({ timeout: 10000 });
    });
  });

  test.describe('AI API Error Handling', () => {
    test.use({ storageState: AUTH_FILE });

    test('connect with invalid device ID returns error', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/ai/connect`, {
        data: {
          deviceId: 'non-existent-device-id-12345',
          mode: 'kiosk'
        }
      });
      
      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('send message without active session returns error', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/ai/message`, {
        data: {
          deviceId: 'non-existent-device-id-12345',
          message: 'Hello'
        }
      });
      
      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('connect without deviceId returns 400', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/ai/connect`, {
        data: { mode: 'kiosk' }
      });
      
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('deviceId');
    });

    test('send message without deviceId returns 400', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/ai/message`, {
        data: { message: 'Hello' }
      });
      
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('deviceId');
    });
  });

});

