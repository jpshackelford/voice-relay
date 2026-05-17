import { test, expect } from './fixtures';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { 
  createAuthenticatedContext, 
  waitForStableConnection,
  navigateKioskToSession,
  extractQrUrl,
} from './utils/auth-helper';

/**
 * E2E Tests: QR Code Join Flow (Device Pairing)
 *
 * These tests verify the QR code device pairing functionality:
 * - Kiosk displays large QR code when no mobile devices are connected
 * - QR URL can be extracted programmatically for testing
 * - Mobile device can navigate to QR URL and auto-join session
 * - Device counts update on both devices after joining
 * - Mini QR appears after first device joins
 *
 * Requirements:
 * - Server must have TEST_AUTH_SECRET configured
 * - TEST_AUTH_SECRET environment variable must be set
 *
 * GitHub Issue: #44
 */

// Timeout constants (in milliseconds)
const ELEMENT_VISIBLE_TIMEOUT = 10000;
const DEVICE_COUNT_UPDATE_TIMEOUT = 10000;
const CONNECTION_STABLE_TIMEOUT = 20000;
const QR_URL_EXTRACT_TIMEOUT = 10000;

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

// Skip tests if TEST_AUTH_SECRET is not set
test.beforeAll(() => {
  if (!TEST_AUTH_SECRET) {
    console.warn('⚠️ TEST_AUTH_SECRET not set - QR join flow tests will be skipped');
    console.warn('Set TEST_AUTH_SECRET in environment and ensure server has it configured');
  }
});

test.describe('QR Code Join Flow', () => {
  // Skip all tests if no auth secret
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  let baseURL: string;

  test.beforeEach(async ({ workerBaseURL }) => {
    // Get base URL from worker fixture (set by global setup)
    baseURL = workerBaseURL;
  });

  test('mobile device joins session via QR code URL', async ({ browser }) => {
    test.slow(); // Allow 3x the default timeout

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Create kiosk context (desktop viewport, triggers kiosk mode)
    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1280, height: 720 } }
    );
    const kioskPage = await kioskContext.newPage();

    try {
      // Navigate kiosk to session
      await navigateKioskToSession(kioskPage, CONNECTION_STABLE_TIMEOUT);

      // Verify large QR code is displayed (no mobile devices yet)
      await expect(kioskPage.locator('.display-idle-qr')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
      await expect(kioskPage.getByText('Scan to join on your phone')).toBeVisible();
      await expect(kioskPage.getByText('Join this session')).toBeVisible();

      // Extract QR URL from data attribute
      const qrUrl = await extractQrUrl(kioskPage, '[data-qr-url]', QR_URL_EXTRACT_TIMEOUT);
      console.log('Extracted QR URL:', qrUrl);

      // Create mobile context with mobile viewport
      const mobileContext = await createAuthenticatedContext(
        browser,
        baseURL,
        TEST_AUTH_SECRET,
        { viewport: { width: 375, height: 667 } } // Mobile viewport triggers mobile mode
      );
      const mobilePage = await mobileContext.newPage();

      try {
        // Navigate mobile to extracted QR URL (simulates QR code scan)
        await mobilePage.goto(qrUrl);

        // Verify mobile is in session and mobile mode
        await expect(mobilePage.locator('.mobile-mode')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
        await waitForStableConnection(mobilePage, CONNECTION_STABLE_TIMEOUT);

        // Verify kiosk sees device count update
        await expect(kioskPage.locator('.display-greeting')).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });
        await expect(kioskPage.getByText(/📱.*1.*device.*connected/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });

        // Verify kiosk shows mini QR code (not large QR)
        await expect(kioskPage.locator('.mini-qr-overlay')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
        await expect(kioskPage.locator('.display-idle-qr')).not.toBeVisible();

        // Verify mobile sees device counts
        await expect(mobilePage.locator('.mobile-participants')).toBeVisible();
        await expect(mobilePage.getByText(/🖥️.*1.*kiosk/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });
        await expect(mobilePage.getByText(/📱.*1.*mobile/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });

        console.log('QR code join flow test passed');

      } finally {
        await mobileContext.close();
      }

    } finally {
      await kioskContext.close();
    }
  });

  test('QR code contains proper session URL format', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1280, height: 720 } }
    );
    const kioskPage = await kioskContext.newPage();

    try {
      await navigateKioskToSession(kioskPage, CONNECTION_STABLE_TIMEOUT);

      // Extract and validate QR URL
      const qrUrl = await extractQrUrl(kioskPage, '[data-qr-url]', QR_URL_EXTRACT_TIMEOUT);

      // Parse the URL and validate structure
      const parsedUrl = new URL(qrUrl);
      
      // Should be a valid URL with the expected path format
      expect(parsedUrl.pathname).toMatch(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+/);
      
      // QR token parameter may be present if signed tokens are enabled
      // This is optional - the test should work with or without it
      const hasQrToken = parsedUrl.searchParams.has('qr');
      
      console.log('QR URL structure validated:', {
        pathname: parsedUrl.pathname,
        hasQrToken,
      });

    } finally {
      await kioskContext.close();
    }
  });


  test('large QR code disappears and mini QR appears after mobile joins', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1280, height: 720 } }
    );
    const kioskPage = await kioskContext.newPage();

    try {
      await navigateKioskToSession(kioskPage, CONNECTION_STABLE_TIMEOUT);

      // Verify initial state: large QR visible, mini QR not visible
      await expect(kioskPage.locator('.display-idle-qr')).toBeVisible();
      await expect(kioskPage.locator('.mini-qr-overlay')).not.toBeVisible();
      await expect(kioskPage.locator('.display-greeting')).not.toBeVisible();

      // Extract QR URL
      const qrUrl = await extractQrUrl(kioskPage, '[data-qr-url]', QR_URL_EXTRACT_TIMEOUT);

      // Create mobile context and join
      const mobileContext = await createAuthenticatedContext(
        browser,
        baseURL,
        TEST_AUTH_SECRET,
        { viewport: { width: 375, height: 667 } }
      );
      const mobilePage = await mobileContext.newPage();

      try {
        await mobilePage.goto(qrUrl);
        await expect(mobilePage.locator('.mobile-mode')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
        await waitForStableConnection(mobilePage, CONNECTION_STABLE_TIMEOUT);

        // Verify state change on kiosk: large QR hidden, mini QR visible
        await expect(kioskPage.locator('.display-idle-qr')).not.toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });
        await expect(kioskPage.locator('.display-greeting')).toBeVisible();
        await expect(kioskPage.locator('.mini-qr-overlay')).toBeVisible();

        // Verify mini QR also has the data-qr-url attribute
        const miniQrContainer = kioskPage.locator('.mini-qr-overlay [data-qr-url]');
        await expect(miniQrContainer).toBeVisible();
        const miniQrUrl = await miniQrContainer.getAttribute('data-qr-url');
        expect(miniQrUrl).toContain('/workspace/');
        expect(miniQrUrl).toContain('/session/');

        console.log('QR visibility transition test passed');

      } finally {
        await mobileContext.close();
      }

    } finally {
      await kioskContext.close();
    }
  });

  test('multiple mobile devices can join via QR code', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1280, height: 720 } }
    );
    const kioskPage = await kioskContext.newPage();

    try {
      await navigateKioskToSession(kioskPage, CONNECTION_STABLE_TIMEOUT);

      // Extract QR URL
      const qrUrl = await extractQrUrl(kioskPage, '[data-qr-url]', QR_URL_EXTRACT_TIMEOUT);

      // Create first mobile context
      const mobile1Context = await createAuthenticatedContext(
        browser,
        baseURL,
        TEST_AUTH_SECRET,
        { viewport: { width: 375, height: 667 } }
      );
      const mobile1Page = await mobile1Context.newPage();

      // Create second mobile context
      const mobile2Context = await createAuthenticatedContext(
        browser,
        baseURL,
        TEST_AUTH_SECRET,
        { viewport: { width: 375, height: 667 } }
      );
      const mobile2Page = await mobile2Context.newPage();

      try {
        // First mobile joins
        await mobile1Page.goto(qrUrl);
        await expect(mobile1Page.locator('.mobile-mode')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
        await waitForStableConnection(mobile1Page, CONNECTION_STABLE_TIMEOUT);

        // Wait for kiosk to see first device
        await expect(kioskPage.getByText(/📱.*1.*device.*connected/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });

        // Second mobile joins (using mini QR URL from kiosk)
        const miniQrUrl = await extractQrUrl(kioskPage, '.mini-qr-overlay [data-qr-url]', QR_URL_EXTRACT_TIMEOUT);
        await mobile2Page.goto(miniQrUrl);
        await expect(mobile2Page.locator('.mobile-mode')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
        await waitForStableConnection(mobile2Page, CONNECTION_STABLE_TIMEOUT);

        // Verify kiosk sees 2 devices connected
        await expect(kioskPage.getByText(/📱.*2.*device.*connected/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });

        // Verify mobile 1 sees updated counts
        await expect(mobile1Page.getByText(/📱.*2.*mobile/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });

        // Verify mobile 2 sees counts
        await expect(mobile2Page.getByText(/📱.*2.*mobile/)).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });
        await expect(mobile2Page.getByText(/🖥️.*1.*kiosk/)).toBeVisible();

        console.log('Multiple mobile device join test passed');

      } finally {
        await mobile1Context.close();
        await mobile2Context.close();
      }

    } finally {
      await kioskContext.close();
    }
  });

  test('kiosk device count shows correct emoji and text format', async ({ browser }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const kioskContext = await createAuthenticatedContext(
      browser,
      baseURL,
      TEST_AUTH_SECRET,
      { viewport: { width: 1280, height: 720 } }
    );
    const kioskPage = await kioskContext.newPage();

    try {
      await navigateKioskToSession(kioskPage, CONNECTION_STABLE_TIMEOUT);

      // Extract QR URL
      const qrUrl = await extractQrUrl(kioskPage, '[data-qr-url]', QR_URL_EXTRACT_TIMEOUT);

      // Create mobile context and join
      const mobileContext = await createAuthenticatedContext(
        browser,
        baseURL,
        TEST_AUTH_SECRET,
        { viewport: { width: 375, height: 667 } }
      );
      const mobilePage = await mobileContext.newPage();

      try {
        await mobilePage.goto(qrUrl);
        await expect(mobilePage.locator('.mobile-mode')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
        await waitForStableConnection(mobilePage, CONNECTION_STABLE_TIMEOUT);

        // Verify greeting subtitle text format
        const greetingSubtitle = kioskPage.locator('.greeting-subtitle');
        await expect(greetingSubtitle).toBeVisible({ timeout: DEVICE_COUNT_UPDATE_TIMEOUT });
        
        const subtitleText = await greetingSubtitle.textContent();
        expect(subtitleText).toContain('📱');
        expect(subtitleText).toContain('1');
        expect(subtitleText).toContain('device');
        expect(subtitleText).toContain('connected');

        console.log('Device count format test passed:', subtitleText);

      } finally {
        await mobileContext.close();
      }

    } finally {
      await kioskContext.close();
    }
  });
});
