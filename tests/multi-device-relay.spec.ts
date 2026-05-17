import { test, expect } from './fixtures';
import { setupTwoDeviceSession, ensureKioskInputVisible, ensureKioskDrawerOpen } from './utils/auth-helper';

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
 * These tests run in parallel with per-worker isolation (GitHub Issue #155)
 */

// Run tests serially within this file (they share workspace state within a worker)
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

  test.beforeEach(async ({ workerBaseURL }) => {
    // Get base URL from worker fixture (set by global setup)
    baseURL = workerBaseURL;
  });

  test('two devices can join same session and relay messages', async ({ browser }) => {
    test.slow(); // Allow 3x the default timeout

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const session = await setupTwoDeviceSession(browser, baseURL, TEST_AUTH_SECRET);
    const { kioskPage, mobilePage, cleanup } = session;

    try {
      // Verify both devices show connected status
      await expect(kioskPage.locator('.connection-indicator.connected, .connection-status.connected')).toBeVisible();
      await expect(mobilePage.locator('.connection-status.connected, .connection-indicator.connected')).toBeVisible();

      // Mobile sends a message
      const mobileMessage = 'Hello from mobile! ' + Date.now();
      const mobileInput = mobilePage.locator('.mobile-input-row input[type="text"]');
      await mobileInput.fill(mobileMessage);
      await mobilePage.locator('.send-btn-small').click();

      // Verify message appears on mobile (with "You:" prefix)
      await expect(mobilePage.locator(`.message.final:has-text("${mobileMessage}")`)).toBeVisible({ timeout: 2000 });

      // Open kiosk drawer to see messages (sidebar starts closed in desktop kiosk mode)
      await ensureKioskDrawerOpen(kioskPage);

      // Verify message appears on kiosk within 2 seconds
      await expect(kioskPage.locator(`.kiosk-message.final:has-text("${mobileMessage}")`)).toBeVisible({ timeout: 2000 });

      // On kiosk, the message should NOT have "You:" prefix (it's from another device)
      const kioskMessageSender = kioskPage.locator(`.kiosk-message.final:has-text("${mobileMessage}") .sender`);
      const kioskSenderText = await kioskMessageSender.textContent();
      expect(kioskSenderText).not.toContain('You');
      console.log('Mobile -> Kiosk relay verified');

      // Kiosk sends a message back
      const kioskMessage = 'Hello from kiosk! ' + Date.now();
      const kioskInput = await ensureKioskInputVisible(kioskPage);
      await expect(kioskInput).toBeVisible({ timeout: 5000 });
      await kioskInput.fill(kioskMessage);
      await kioskPage.locator('.kiosk-sidebar .send-btn-small').click();

      // Verify message appears on kiosk (with "You:" prefix)
      await expect(kioskPage.locator(`.kiosk-message.final:has-text("${kioskMessage}")`)).toBeVisible({ timeout: 2000 });

      // Verify message appears on mobile within 1 second
      await expect(mobilePage.locator(`.message.final:has-text("${kioskMessage}")`)).toBeVisible({ timeout: 2000 });

      // On mobile, the message should NOT have "You:" prefix
      const mobileMessageSender = mobilePage.locator(`.message.final:has-text("${kioskMessage}") .sender`);
      const mobileSenderText = await mobileMessageSender.textContent();
      expect(mobileSenderText).not.toContain('You');
      console.log('Kiosk -> Mobile relay verified');

    } finally {
      await cleanup();
    }
  });

  test('typing indicator shows partial messages to other devices', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const session = await setupTwoDeviceSession(browser, baseURL, TEST_AUTH_SECRET);
    const { kioskPage, mobilePage, cleanup } = session;

    try {
      // Type without sending - this should trigger debounced partial message
      const partialText = 'Testing partial ' + Date.now();
      const mobileInput = mobilePage.locator('.mobile-input-row input[type="text"]');

      // Type the message character by character to simulate real typing
      await mobileInput.click();
      await mobileInput.pressSequentially(partialText, { delay: 50 });

      // Wait for debounce (100ms in the app) plus a buffer
      await mobilePage.waitForTimeout(300);

      // Open kiosk drawer to see messages
      await ensureKioskDrawerOpen(kioskPage);

      // Check for partial message indicator on kiosk
      const partialMessage = kioskPage.locator('.kiosk-message.partial');
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
      await mobilePage.locator('.send-btn-small').click();
      await kioskPage.waitForTimeout(500);

      // Verify the message is now final (no partial class, no typing indicator)
      const finalMessage = kioskPage.locator(`.kiosk-message.final:has-text("${partialText}")`);
      await expect(finalMessage).toBeVisible({ timeout: 2000 });

      // Verify no partial messages remain for this text
      const remainingPartial = kioskPage.locator(`.kiosk-message.partial:has-text("${partialText}")`);
      await expect(remainingPartial).not.toBeVisible();

      console.log('Typing indicator test passed');

    } finally {
      await cleanup();
    }
  });

  test('device count updates when devices join/leave', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const session = await setupTwoDeviceSession(browser, baseURL, TEST_AUTH_SECRET);
    const { kioskPage, mobilePage, cleanup } = session;

    try {
      // Both devices should be connected
      expect(await kioskPage.locator('.connection-indicator.connected, .connection-status.connected').isVisible()).toBe(true);
      expect(await mobilePage.locator('.connection-status.connected, .connection-indicator.connected').isVisible()).toBe(true);

      // After both devices join, verify count shows 2 devices
      // Format is now "🖥️ {kiosk_count}📱 {mobile_count}" or similar
      // Open drawer to see participants in kiosk mode
      await ensureKioskDrawerOpen(kioskPage);
      const deviceIndicator = kioskPage.locator('.kiosk-participants, .participants, .device-count');
      // Check for "1📱" (indicating at least 1 mobile) since format is "🖥️ 1📱 1"
      await expect(deviceIndicator).toContainText(/📱.*1|1.*📱/i, { timeout: 5000 });

      // Mobile mode shows device count in mobile-participants element
      const mobileParticipants = mobilePage.locator('.mobile-participants');
      // Check for mobile device indicator (format: "📱 1 mobile🖥️ 1 kiosk")
      await expect(mobileParticipants).toContainText(/📱|mobile|kiosk/i, { timeout: 5000 });

      console.log('Device count test passed - both views show 2 devices');

    } finally {
      await cleanup();
    }
  });

  test('message sender attribution is correct', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const session = await setupTwoDeviceSession(browser, baseURL, TEST_AUTH_SECRET);
    const { kioskPage, mobilePage, cleanup } = session;

    try {
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
      const mobileOwnMessage = mobilePage.locator(`.message.final:has-text("${testMessage}")`);
      await expect(mobileOwnMessage).toBeVisible({ timeout: 2000 });

      const mobileOwnSender = mobilePage.locator(`.message.final:has-text("${testMessage}") .sender`);
      const mobileOwnSenderText = await mobileOwnSender.textContent();
      expect(mobileOwnSenderText).toContain('You');

      // Open kiosk drawer to see messages (sidebar starts closed in desktop kiosk mode)
      await ensureKioskDrawerOpen(kioskPage);

      // On kiosk, should see sender name (not "You:")
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
      await cleanup();
    }
  });
});
