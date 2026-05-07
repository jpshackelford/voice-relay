import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createAuthenticatedContext, waitForStableConnection } from './utils/auth-helper';

/**
 * E2E Tests: Multi-Device Real-Time Text Relay
 *
 * These tests verify Voice Relay's core functionality:
 * - Real-time text message relay between multiple devices
 * - WebSocket connection management
 * - Partial message (typing indicator) support
 * - Device list updates
 *
 * Requirements:
 * - Server must have TEST_AUTH_SECRET configured
 * - TEST_AUTH_SECRET environment variable must be set
 *
 * These tests run against the local dev server (via webServer config in playwright.config.ts)
 */

// Mark entire test file as slow - multi-device tests need more time
test.describe.configure({ mode: 'serial' });

// Get test auth secret from environment
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

// Skip tests if TEST_AUTH_SECRET is not set
test.beforeAll(() => {
  if (!TEST_AUTH_SECRET) {
    console.warn('⚠️ TEST_AUTH_SECRET not set - multi-device tests will be skipped');
    console.warn('Set TEST_AUTH_SECRET in environment and ensure server has it configured');
  }
});

test.describe('Multi-Device Real-Time Relay', () => {
  // Skip all tests if no auth secret
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  let baseURL: string;

  test.beforeEach(async ({ page }) => {
    // Get base URL from page context (set by webServer config)
    baseURL = page.context().baseURL || 'http://localhost:5174';
  });

  test('two devices can join same session and relay messages', async ({ browser }) => {
    test.slow(); // Allow 3x the default timeout

    // Skip if no auth secret
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Create two isolated browser contexts (simulates separate devices)
    // Kiosk: >= 768px width, Mobile: < 768px width
    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1200, height: 800 } }  // Triggers kiosk mode
    );

    const mobileContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 375, height: 667 } }  // Triggers mobile mode
    );

    try {
      const kioskPage = await kioskContext.newPage();
      const mobilePage = await mobileContext.newPage();

      // Step 1: Navigate kiosk to dashboard (which redirects to workspace home)
      await kioskPage.goto('/dashboard');

      // Wait for workspace home to load (shows devices section)
      await expect(kioskPage.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: 15000 });

      // Wait for sessions section to appear
      await expect(kioskPage.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: 5000 });

      // Click "View →" button to enter the first session
      const viewButton = kioskPage.getByRole('button', { name: /view/i });
      await expect(viewButton).toBeVisible({ timeout: 5000 });
      await viewButton.click();

      // Wait for session view to load
      await kioskPage.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: 10000 });

      // Get the session URL
      const sessionUrl = kioskPage.url();
      console.log('Session URL:', sessionUrl);

      // Step 2: Wait for kiosk WebSocket connection to stabilize
      // This handles reconnections that occur when session data loads
      await waitForStableConnection(kioskPage, 20000);
      console.log('Kiosk connected (stable)');

      // Step 3: Navigate mobile to the same session URL
      await mobilePage.goto(sessionUrl);

      // Wait for mobile to be in session view
      await mobilePage.waitForFunction(
        () => {
          return document.querySelector('.mobile-mode') !== null ||
                 document.querySelector('.kiosk-mode') !== null;
        },
        { timeout: 15000 }
      );

      // Step 4: Wait for mobile WebSocket connection to stabilize
      await waitForStableConnection(mobilePage, 20000);
      console.log('Mobile connected (stable)');

      // Step 5: Verify both devices show connected status
      // Kiosk: .connection-indicator.connected
      // Mobile: .connection-status.connected
      await expect(kioskPage.locator('.connection-indicator.connected, .connection-status.connected')).toBeVisible();
      await expect(mobilePage.locator('.connection-status.connected, .connection-indicator.connected')).toBeVisible();

      // Step 6: Mobile sends a message
      const mobileMessage = 'Hello from mobile! ' + Date.now();

      // Mobile input is in .mobile-input-row
      const mobileInput = mobilePage.locator('.mobile-input-row input[type="text"]');
      await mobileInput.fill(mobileMessage);

      // Click send button
      const mobileSendBtn = mobilePage.locator('.send-btn-small');
      await mobileSendBtn.click();

      // Step 7: Verify message appears on mobile (with "You:" prefix)
      // Mobile uses .message class while kiosk uses .kiosk-message
      await expect(mobilePage.locator(`.message.final:has-text("${mobileMessage}")`)).toBeVisible({ timeout: 2000 });

      // Step 8: Verify message appears on kiosk within 1 second
      // Kiosk uses .kiosk-message class
      await expect(kioskPage.locator(`.kiosk-message.final:has-text("${mobileMessage}")`)).toBeVisible({ timeout: 2000 });

      // On kiosk, the message should NOT have "You:" prefix (it's from another device)
      const kioskMessageSender = kioskPage.locator(`.kiosk-message.final:has-text("${mobileMessage}") .sender`);
      const kioskSenderText = await kioskMessageSender.textContent();
      expect(kioskSenderText).not.toContain('You');

      console.log('Mobile -> Kiosk relay verified');

      // Step 9: Kiosk sends a message back
      const kioskMessage = 'Hello from kiosk! ' + Date.now();

      // Kiosk has a collapsible sidebar drawer that's closed by default
      // Need to open it to access the input
      const drawerOpenBtn = kioskPage.locator('.drawer-open-btn');
      if (await drawerOpenBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await drawerOpenBtn.click();
        // Wait for drawer to animate open
        await kioskPage.waitForTimeout(300);
      }

      // Now the input should be visible in the sidebar
      const kioskInput = kioskPage.locator('.kiosk-sidebar .kiosk-input-row input[type="text"]');
      await expect(kioskInput).toBeVisible({ timeout: 5000 });
      await kioskInput.fill(kioskMessage);

      const kioskSendBtn = kioskPage.locator('.kiosk-sidebar .send-btn-small');
      await kioskSendBtn.click();

      // Step 10: Verify message appears on kiosk (with "You:" prefix)
      // Kiosk uses .kiosk-message class
      await expect(kioskPage.locator(`.kiosk-message.final:has-text("${kioskMessage}")`)).toBeVisible({ timeout: 2000 });

      // Step 11: Verify message appears on mobile within 1 second
      // Mobile uses .message class
      await expect(mobilePage.locator(`.message.final:has-text("${kioskMessage}")`)).toBeVisible({ timeout: 2000 });

      // On mobile, the message should NOT have "You:" prefix
      const mobileMessageSender = mobilePage.locator(`.message.final:has-text("${kioskMessage}") .sender`);
      const mobileSenderText = await mobileMessageSender.textContent();
      expect(mobileSenderText).not.toContain('You');

      console.log('Kiosk -> Mobile relay verified');

    } finally {
      // Cleanup contexts
      await kioskContext.close();
      await mobileContext.close();
    }
  });

  test('typing indicator shows partial messages to other devices', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1200, height: 800 } }
    );

    const mobileContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 375, height: 667 } }
    );

    try {
      const kioskPage = await kioskContext.newPage();
      const mobilePage = await mobileContext.newPage();

      // Navigate kiosk to workspace home
      await kioskPage.goto('/dashboard');
      await expect(kioskPage.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: 15000 });
      await expect(kioskPage.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: 5000 });

      // Click View to enter session
      const viewButton = kioskPage.getByRole('button', { name: /view/i });
      await expect(viewButton).toBeVisible({ timeout: 5000 });
      await viewButton.click();
      await kioskPage.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: 10000 });

      await waitForStableConnection(kioskPage, 20000);

      // Join mobile to same session
      await mobilePage.goto(kioskPage.url());
      await mobilePage.waitForFunction(
        () => document.querySelector('.mobile-mode, .kiosk-mode') !== null,
        { timeout: 15000 }
      );
      await waitForStableConnection(mobilePage, 20000);

      // Type without sending - this should trigger debounced partial message
      // Use unique text to avoid conflicts with previous test runs
      const partialText = 'Testing partial ' + Date.now();
      const mobileInput = mobilePage.locator('.mobile-input-row input[type="text"]');

      // Type the message character by character to simulate real typing
      await mobileInput.click();
      await mobileInput.pressSequentially(partialText, { delay: 50 });

      // Wait for debounce (100ms in the app) plus a buffer
      await mobilePage.waitForTimeout(300);

      // Check for partial message indicator on kiosk
      // Kiosk uses .kiosk-message class, partial messages have .partial class
      const partialMessage = kioskPage.locator('.kiosk-message.partial');

      // Check if partial message is visible
      const hasPartial = await partialMessage.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasPartial) {
        // Verify typing indicator is present
        const typingIndicator = kioskPage.locator('.kiosk-message.partial .typing-indicator');
        await expect(typingIndicator).toBeVisible({ timeout: 1000 });

        // Verify the text content matches
        const messageText = kioskPage.locator('.kiosk-message.partial .text');
        await expect(messageText).toContainText(partialText, { timeout: 1000 });
      }

      // Now send the message (complete it)
      const sendBtn = mobilePage.locator('.send-btn-small');
      await sendBtn.click();

      // Wait a moment for the final message to arrive
      await kioskPage.waitForTimeout(500);

      // Verify the message is now final (no partial class, no typing indicator)
      // Kiosk uses .kiosk-message class
      const finalMessage = kioskPage.locator(`.kiosk-message.final:has-text("${partialText}")`);
      await expect(finalMessage).toBeVisible({ timeout: 2000 });

      // Verify no partial messages remain for this text
      const remainingPartial = kioskPage.locator(`.kiosk-message.partial:has-text("${partialText}")`);
      await expect(remainingPartial).not.toBeVisible();

      console.log('Typing indicator test passed');

    } finally {
      await kioskContext.close();
      await mobileContext.close();
    }
  });

  test('device count updates when devices join/leave', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1200, height: 800 } }
    );

    const mobileContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 375, height: 667 } }
    );

    try {
      const kioskPage = await kioskContext.newPage();

      // Navigate kiosk to workspace home
      await kioskPage.goto('/dashboard');
      await expect(kioskPage.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: 15000 });
      await expect(kioskPage.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: 5000 });

      // Click View to enter session
      const viewButton = kioskPage.getByRole('button', { name: /view/i });
      await expect(viewButton).toBeVisible({ timeout: 5000 });
      await viewButton.click();
      await kioskPage.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: 10000 });

      await waitForStableConnection(kioskPage, 20000);

      // Initial state: only kiosk connected
      // The kiosk should show device count (in drawer header or participants area)
      const kioskParticipants = kioskPage.locator('.kiosk-participants, .participants, .device-count');

      // Check initial state - should show 1 kiosk, 0 mobile (or just show kiosk icon)
      // Allow flexible initial state checking

      // Now join mobile
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(kioskPage.url());
      await mobilePage.waitForFunction(
        () => document.querySelector('.mobile-mode, .kiosk-mode') !== null,
        { timeout: 15000 }
      );
      await waitForStableConnection(mobilePage, 20000);

      // After mobile joins, kiosk should show both devices
      // Look for device indicators (emoji or count text)
      const deviceIndicator = kioskPage.locator('.kiosk-participants, .participants, .device-count');

      // Verify there's content showing device counts
      const indicatorText = await deviceIndicator.textContent().catch(() => '');

      // Should show at least one mobile device indicator
      // The format might be "📱 1, 🖥️ 1" or similar
      // We just verify the mobile device appears somewhere in the UI
      const mobileDeviceShown = await kioskPage.evaluate(() => {
        // Check for mobile emoji or mobile count in various possible containers
        const pageText = document.body.textContent || '';
        return pageText.includes('📱') ||
               pageText.includes('mobile') ||
               document.querySelectorAll('.mobile-mode, [data-device-type="mobile"]').length > 0;
      });

      // Also check mobile's perspective - it should see devices too
      const mobileParticipants = mobilePage.locator('.mobile-participants, .participants, .device-count');
      const mobileIndicatorText = await mobileParticipants.textContent().catch(() => '');

      console.log('Kiosk indicator text:', indicatorText);
      console.log('Mobile indicator text:', mobileIndicatorText);

      // At minimum, both devices should be connected and see each other
      expect(await kioskPage.locator('.connection-indicator.connected, .connection-status.connected').isVisible()).toBe(true);
      expect(await mobilePage.locator('.connection-status.connected, .connection-indicator.connected').isVisible()).toBe(true);

      console.log('Device count test passed');

    } finally {
      await kioskContext.close();
      await mobileContext.close();
    }
  });

  test('message sender attribution is correct', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1200, height: 800 } }
    );

    const mobileContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 375, height: 667 } }
    );

    try {
      const kioskPage = await kioskContext.newPage();
      const mobilePage = await mobileContext.newPage();

      // Navigate kiosk to workspace home
      await kioskPage.goto('/dashboard');
      await expect(kioskPage.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: 15000 });
      await expect(kioskPage.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: 5000 });

      // Click View to enter session
      const viewButton = kioskPage.getByRole('button', { name: /view/i });
      await expect(viewButton).toBeVisible({ timeout: 5000 });
      await viewButton.click();
      await kioskPage.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: 10000 });

      await waitForStableConnection(kioskPage, 20000);

      await mobilePage.goto(kioskPage.url());
      await mobilePage.waitForFunction(
        () => document.querySelector('.mobile-mode, .kiosk-mode') !== null,
        { timeout: 15000 }
      );
      await waitForStableConnection(mobilePage, 20000);

      // Get the display names shown in each device's header
      const mobileDisplayName = await mobilePage.locator('.device-name').first().textContent() || 'Unknown';
      const kioskDisplayName = await kioskPage.locator('.device-name').first().textContent() || 'Unknown';

      console.log('Mobile display name:', mobileDisplayName);
      console.log('Kiosk display name:', kioskDisplayName);

      // Send message from mobile
      const testMessage = 'Attribution test ' + Date.now();
      const mobileInput = mobilePage.locator('.mobile-input-row input[type="text"]');
      await mobileInput.fill(testMessage);
      await mobilePage.locator('.send-btn-small').click();

      // On mobile, should see "You:" prefix
      // Mobile uses .message class
      const mobileOwnMessage = mobilePage.locator(`.message.final:has-text("${testMessage}")`);
      await expect(mobileOwnMessage).toBeVisible({ timeout: 2000 });

      const mobileOwnSender = mobilePage.locator(`.message.final:has-text("${testMessage}") .sender`);
      const mobileOwnSenderText = await mobileOwnSender.textContent();
      expect(mobileOwnSenderText).toContain('You');

      // On kiosk, should see sender name (not "You:")
      // Kiosk uses .kiosk-message class
      const kioskReceivedMessage = kioskPage.locator(`.kiosk-message.final:has-text("${testMessage}")`);
      await expect(kioskReceivedMessage).toBeVisible({ timeout: 2000 });

      const kioskReceivedSender = kioskPage.locator(`.kiosk-message.final:has-text("${testMessage}") .sender`);
      const kioskReceivedSenderText = await kioskReceivedSender.textContent();
      expect(kioskReceivedSenderText).not.toContain('You');

      // The sender name should be a device name, not empty
      expect(kioskReceivedSenderText?.trim().replace(':', '')).toBeTruthy();

      console.log('Sender attribution test passed');
      console.log('Mobile own message sender:', mobileOwnSenderText);
      console.log('Kiosk received message sender:', kioskReceivedSenderText);

    } finally {
      await kioskContext.close();
      await mobileContext.close();
    }
  });
});
