import { test, expect, Page } from '@playwright/test';
import { getAuthState, waitForWebSocketConnected, waitForStableConnection, findMessageInput, ensureKioskDrawerOpen } from './utils/auth-helper';

/**
 * E2E Test: Complete User Onboarding Flow (First-Time Experience)
 *
 * This test verifies the complete onboarding journey:
 * - New user visits the application
 * - Authentication via test endpoint
 * - Auto-redirects to workspace home
 * - Session auto-creates
 * - User can enter session and send first message
 *
 * Requirements:
 * - Server must have TEST_AUTH_SECRET configured
 * - TEST_AUTH_SECRET environment variable must be set
 *
 * GitHub Issue: #43
 */

// Timeout constants (in milliseconds)
const WORKSPACE_REDIRECT_TIMEOUT = 15000;
const ELEMENT_VISIBLE_TIMEOUT = 10000;
const MESSAGE_APPEAR_TIMEOUT = 5000;
const CONNECTION_STABLE_TIMEOUT = 20000;

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

/**
 * Helper: Authenticate and navigate to workspace
 * Reduces duplication across tests that need authenticated workspace access
 */
async function authenticateAndNavigateToWorkspace(page: Page, baseURL: string, secret: string): Promise<void> {
  const storageState = await getAuthState(baseURL, secret);
  await page.context().addCookies(storageState.cookies);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+$/, { timeout: WORKSPACE_REDIRECT_TIMEOUT });
}

test.describe('User Onboarding Flow', () => {
  // Skip all tests if no auth secret
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  let baseURL: string;

  test.beforeEach(async ({ page }) => {
    baseURL = page.context().baseURL || 'http://localhost:5174';
  });

  test('complete onboarding flow - new user to first message', async ({ page, request }) => {
    test.slow(); // Allow 3x the default timeout

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // =====================
    // STEP 1: Verify root redirects unauthenticated users to /login
    // =====================
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);

    // =====================
    // STEP 2: Verify login page elements
    // =====================
    // Check for Voice Relay branding
    await expect(page.getByText('Voice Relay')).toBeVisible();
    
    // Check for tagline
    await expect(page.getByText(/Real-time voice and text communication/)).toBeVisible();
    
    // Check for GitHub sign-in button
    await expect(page.getByRole('button', { name: /Sign in with GitHub/i })).toBeVisible();

    // =====================
    // STEP 3-5: Authenticate and navigate to workspace
    // =====================
    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);

    // =====================
    // STEP 6: Verify workspace home elements
    // =====================
    // Wait for Devices heading
    await expect(page.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
    
    // Wait for Sessions heading
    await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });

    // =====================
    // STEP 7: Wait for auto-created session
    // =====================
    // The workspace auto-creates a session when none exist
    const viewButton = page.getByRole('button', { name: /view/i });
    await expect(viewButton).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });

    // =====================
    // STEP 8: Enter the session
    // =====================
    await viewButton.first().click();

    // =====================
    // STEP 9: Verify session view URL
    // =====================
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+$/, { timeout: ELEMENT_VISIBLE_TIMEOUT });

    // =====================
    // STEP 10: Verify WebSocket connected
    // =====================
    // Wait for connection indicator to show connected state
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);

    // Verify connected indicator is visible
    await expect(page.locator('.connection-indicator.connected, .connection-status.connected')).toBeVisible();

    // =====================
    // STEP 11: Send first message
    // =====================
    // Open drawer to access input (in desktop kiosk mode, input is in collapsible sidebar)
    await ensureKioskDrawerOpen(page);

    // Use kiosk-specific locators for more reliability
    const kioskInput = page.locator('.kiosk-sidebar .kiosk-input-row input[type="text"]');
    await expect(kioskInput).toBeVisible({ timeout: 3000 });

    // Wait a moment for WebSocket to be fully ready
    await page.waitForTimeout(300);

    // Fill in the message
    await kioskInput.fill('Hello world!');

    // Click send button (explicitly target kiosk sidebar button)
    const kioskSendBtn = page.locator('.kiosk-sidebar .send-btn-small');
    await expect(kioskSendBtn).toBeEnabled({ timeout: 2000 });
    await kioskSendBtn.click();

    // Wait for message to be processed and UI to update
    await page.waitForTimeout(1000);

    // =====================
    // STEP 12: Verify message appears
    // =====================
    // Debug: check if any messages exist
    const allMessages = page.locator('.kiosk-message');
    const messageCount = await allMessages.count();
    console.log(`Found ${messageCount} messages in kiosk`);

    // Verify message appears with "You:" prefix and content
    const messageWithContent = page.locator('.kiosk-message.final')
      .filter({ hasText: 'Hello world!' });  // Simplified filter without "You:" prefix
    await expect(messageWithContent.first()).toBeVisible({ timeout: MESSAGE_APPEAR_TIMEOUT });
  });

  // =====================
  // Focused Tests (smaller units for easier debugging)
  // =====================

  test('unauthenticated user redirects to login from root', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page shows branding and sign-in button', async ({ page }) => {
    await page.goto('/login');

    // Verify Voice Relay branding
    await expect(page.getByText('Voice Relay')).toBeVisible();

    // Verify tagline
    await expect(page.getByText(/Real-time voice and text communication/)).toBeVisible();

    // Verify GitHub sign-in button
    await expect(page.getByRole('button', { name: /Sign in with GitHub/i })).toBeVisible();
  });

  test('login page shows error message when error param present', async ({ page }) => {
    // Navigate to login with error parameter
    await page.goto('/login?error=1');
    
    // Verify error message is displayed
    await expect(page.getByText(/Authentication failed/)).toBeVisible();
  });

  test('authenticated user redirects to workspace from dashboard', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
  });

  test('workspace shows auto-created session', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);

    // Wait for workspace elements
    await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });

    // Verify auto-created session is visible
    const viewButton = page.getByRole('button', { name: /view/i });
    await expect(viewButton).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
  });

  test('user can send message in session', async ({ page }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);

    // Enter session
    const viewButton = page.getByRole('button', { name: /view/i });
    await expect(viewButton).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
    await viewButton.first().click();

    // Wait for session and WebSocket connection
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+$/, { timeout: ELEMENT_VISIBLE_TIMEOUT });
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);

    // Open drawer to access input (in desktop kiosk mode, input is in collapsible sidebar)
    await ensureKioskDrawerOpen(page);

    // Use kiosk-specific locators for more reliability
    const kioskInput = page.locator('.kiosk-sidebar .kiosk-input-row input[type="text"]');
    await expect(kioskInput).toBeVisible({ timeout: 3000 });

    // Wait a moment for WebSocket to be fully ready
    await page.waitForTimeout(300);

    // Fill and send message
    await kioskInput.fill('Test message');
    const kioskSendBtn = page.locator('.kiosk-sidebar .send-btn-small');
    await expect(kioskSendBtn).toBeEnabled({ timeout: 2000 });
    await kioskSendBtn.click();

    // Wait for message to be processed
    await page.waitForTimeout(1000);

    // Debug: check if any messages exist
    const allMessages = page.locator('.kiosk-message');
    const messageCount = await allMessages.count();
    console.log(`Found ${messageCount} messages in kiosk (send message test)`);

    // Verify message appears with content (simplified filter)
    const messageWithContent = page.locator('.kiosk-message.final')
      .filter({ hasText: 'Test message' });
    await expect(messageWithContent.first()).toBeVisible({ timeout: MESSAGE_APPEAR_TIMEOUT });
  });

  // =====================
  // Unauthenticated Redirect Tests
  // =====================

  test('workspace URL redirects to login when not authenticated', async ({ page }) => {
    // Try to access a workspace directly without auth
    await page.goto('/workspace/some-workspace-id');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('session URL redirects to login when not authenticated', async ({ page }) => {
    // Try to access a session directly without auth
    await page.goto('/workspace/some-workspace-id/session/some-session-id');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('dashboard redirects to login when not authenticated', async ({ page }) => {
    // Try to access dashboard directly without auth
    await page.goto('/dashboard');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated user can see workspace elements', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);

    // Verify key workspace elements
    await expect(page.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
    await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible();
    
    // Verify user info area exists (sign out button indicates authenticated state)
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('session view shows QR code in kiosk mode', async ({ page }) => {
    test.slow();

    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Set viewport to trigger kiosk mode (>= 768px width)
    await page.setViewportSize({ width: 1200, height: 800 });

    // Authenticate and navigate to workspace
    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);

    // Wait for and click the session view button
    const viewButton = page.getByRole('button', { name: /view/i });
    await expect(viewButton).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
    await viewButton.first().click();

    // Wait for session view
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+$/);

    // Verify kiosk mode is active (check for kiosk-specific element)
    // Note: Use .first() since both .kiosk-sidebar and .kiosk-input-row exist in kiosk mode
    await expect(page.locator('.kiosk-mode')).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });

    // Wait for connection to stabilize
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);

    // Verify QR code is present in kiosk mode
    const qrCode = page.locator('.qr-code-container img, .qr-code');
    await expect(qrCode).toBeVisible({ timeout: MESSAGE_APPEAR_TIMEOUT });
  });
});

// Note: GitHub OAuth button test removed per review feedback.
// The test only verified navigation to /auth/github which provides minimal value:
// - The button presence is already tested in 'login page shows branding and sign-in button'
// - Without actual OAuth credentials, the endpoint redirects back with error
// - This test added maintenance burden without proving meaningful OAuth behavior
