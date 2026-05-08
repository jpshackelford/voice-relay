import { test, expect, Page } from '@playwright/test';
import {
  getAuthState,
  waitForStableConnection,
  findMessageInput,
} from './utils/auth-helper';

/**
 * E2E Test: Session Management (Create, View, Switch)
 *
 * This test verifies the complete session management lifecycle:
 * - Auto-creation of first session
 * - Viewing sessions in workspace home
 * - Creating new sessions
 * - Switching between sessions
 * - Session data isolation
 * - Persistence across page reloads
 *
 * Requirements:
 * - Server must have TEST_AUTH_SECRET configured
 * - TEST_AUTH_SECRET environment variable must be set
 *
 * GitHub Issue: #45
 */

// Timeout constants (in milliseconds)
const WORKSPACE_REDIRECT_TIMEOUT = 15000;
const ELEMENT_VISIBLE_TIMEOUT = 10000;
const SESSION_AUTO_CREATE_TIMEOUT = 3000;
const MESSAGE_APPEAR_TIMEOUT = 5000;
const CONNECTION_STABLE_TIMEOUT = 20000;

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

/**
 * Helper: Authenticate and navigate to workspace home
 */
async function authenticateAndNavigateToWorkspace(
  page: Page,
  baseURL: string,
  secret: string
): Promise<string> {
  const storageState = await getAuthState(baseURL, secret);
  await page.context().addCookies(storageState.cookies);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+$/, { timeout: WORKSPACE_REDIRECT_TIMEOUT });
  
  // Extract workspace ID from URL
  const url = page.url();
  const match = url.match(/\/workspace\/([a-f0-9-]+)/);
  if (!match) throw new Error('Could not extract workspace ID from URL');
  return match[1];
}

/**
 * Helper: Wait for workspace home to fully load
 */
async function waitForWorkspaceHomeLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
  await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
}

/**
 * Helper: Wait for a session to appear in the list (auto-creation or explicit)
 */
async function waitForSessionInList(page: Page, timeout = SESSION_AUTO_CREATE_TIMEOUT): Promise<void> {
  // Wait for at least one "View →" button to appear (indicates at least one session exists)
  await expect(page.getByRole('button', { name: /view/i }).first()).toBeVisible({ timeout });
}

/**
 * Helper: Get session count from UI
 */
async function getSessionCount(page: Page): Promise<number> {
  return await page.locator('.session-row').count();
}

/**
 * Helper: Enter a session by clicking View button at index
 */
async function enterSession(page: Page, index: number = 0): Promise<string> {
  const viewButtons = page.getByRole('button', { name: /view/i });
  await viewButtons.nth(index).click();
  await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: ELEMENT_VISIBLE_TIMEOUT });
  
  // Extract session ID from URL
  const url = page.url();
  const match = url.match(/\/session\/([a-f0-9-]+)/);
  if (!match) throw new Error('Could not extract session ID from URL');
  return match[1];
}

/**
 * Helper: Navigate back to workspace home
 * 
 * Uses direct URL navigation for reliability in E2E tests.
 * The exit button test verifies the button works separately.
 */
async function exitToWorkspaceHome(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/workspace/${workspaceId}`);
  await waitForWorkspaceHomeLoaded(page);
}

/**
 * Helper: Send a text message in session view
 * 
 * Uses Enter key submission which is more reliable than clicking send button
 * in kiosk mode where the drawer may be closed.
 */
async function sendMessage(page: Page, text: string): Promise<void> {
  await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
  const { input } = await findMessageInput(page);
  await input.fill(text);
  await input.press('Enter');
  
  // Wait for message to appear
  const messageWithContent = page.locator('.kiosk-message.final, .message.final')
    .filter({ hasText: text });
  await expect(messageWithContent.first()).toBeVisible({ timeout: MESSAGE_APPEAR_TIMEOUT });
}

/**
 * Helper: Check if a message is visible in session
 */
async function isMessageVisible(page: Page, text: string): Promise<boolean> {
  const messageWithContent = page.locator('.kiosk-message.final, .message.final')
    .filter({ hasText: text });
  return await messageWithContent.isVisible({ timeout: 1000 }).catch(() => false);
}

test.describe('Session Management', () => {
  // Skip all tests if no auth secret
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  let baseURL: string;

  test.beforeEach(async ({ page }) => {
    baseURL = page.context().baseURL || 'http://localhost:5174';
  });

  // =====================
  // Scenario 1: Auto-Created First Session
  // =====================
  test('auto-creates first session when workspace has no sessions', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    
    // Wait for workspace home to load
    await waitForWorkspaceHomeLoaded(page);
    
    // Verify auto-created session appears within timeout
    await waitForSessionInList(page, SESSION_AUTO_CREATE_TIMEOUT);
    
    // Verify session metadata is displayed
    const sessionRow = page.locator('.session-row').first();
    await expect(sessionRow).toBeVisible();
    
    // Check for session name (or truncated ID)
    const sessionName = sessionRow.locator('.session-name');
    await expect(sessionName).toBeVisible();
    
    // Check for creation time
    const sessionMeta = sessionRow.locator('.session-meta');
    await expect(sessionMeta).toContainText(/Created/);
    
    // Check for last active time
    const lastActive = sessionRow.locator('.session-last-active');
    await expect(lastActive).toContainText(/just now|ago/);
  });

  // =====================
  // Scenario 2: View Session from Workspace Home
  // =====================
  test('view session from workspace home navigates to session page', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Click View button
    await enterSession(page, 0);
    
    // Verify URL pattern
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+$/);
    
    // Verify session view loaded (kiosk or mobile mode)
    const sessionView = page.locator('.kiosk-mode, .mobile-mode');
    await expect(sessionView).toBeVisible({ timeout: ELEMENT_VISIBLE_TIMEOUT });
    
    // Verify WebSocket connects
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    await expect(page.locator('.connection-indicator.connected, .connection-status.connected')).toBeVisible();
  });

  // =====================
  // Scenario 3: Create Additional Session
  // =====================
  test('create additional session with new session button', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Get initial session count
    const initialCount = await getSessionCount(page);
    expect(initialCount).toBeGreaterThanOrEqual(1);
    
    // Click New Session button
    const newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    
    // Should navigate to new session view
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+$/, { timeout: ELEMENT_VISIBLE_TIMEOUT });
    
    // Navigate back to workspace home
    await exitToWorkspaceHome(page, workspaceId);
    
    // Verify session count increased
    const newCount = await getSessionCount(page);
    expect(newCount).toBe(initialCount + 1);
  });

  // =====================
  // Scenario 4: Switch Between Sessions
  // =====================
  test('switch between sessions shows correct content', async ({ page }) => {
    test.slow(); // Allow extra time for multi-session test
    
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate to workspace
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Create a second session if needed
    const initialCount = await getSessionCount(page);
    if (initialCount < 2) {
      const newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
      await newSessionBtn.click();
      await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/);
      await exitToWorkspaceHome(page, workspaceId);
    }
    
    // Verify we have at least 2 sessions
    const sessionCount = await getSessionCount(page);
    expect(sessionCount).toBeGreaterThanOrEqual(2);
    
    // Enter first session and get its ID
    const session1Id = await enterSession(page, 0);
    expect(session1Id).toBeTruthy();
    
    // Exit to workspace home
    await exitToWorkspaceHome(page, workspaceId);
    
    // Enter second session and get its ID
    const session2Id = await enterSession(page, 1);
    expect(session2Id).toBeTruthy();
    
    // Verify different sessions
    expect(session1Id).not.toBe(session2Id);
    
    // Verify URL shows correct session ID
    expect(page.url()).toContain(session2Id);
  });

  // =====================
  // Scenario 5: Session Messages Isolation
  // =====================
  test('session messages are isolated between sessions', async ({ page }) => {
    test.slow(); // Allow extra time for messaging tests
    
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Set viewport for kiosk mode (wider viewport)
    await page.setViewportSize({ width: 1200, height: 800 });

    // Authenticate and navigate to workspace
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Create two fresh sessions for isolation test
    // First create Session A
    let newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
    await newSessionBtn.click();
    await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/);
    const sessionAId = page.url().match(/\/session\/([a-f0-9-]+)/)?.[1];
    expect(sessionAId).toBeTruthy();
    
    // Generate unique message identifiers
    const timestamp = Date.now();
    const msgA = `Message in Session A - ${timestamp}`;
    const msgB = `Message in Session B - ${timestamp}`;
    
    // Send message in Session A
    await sendMessage(page, msgA);
    
    // Verify message A is visible in Session A
    expect(await isMessageVisible(page, msgA)).toBe(true);
    
    // Exit to workspace home
    await exitToWorkspaceHome(page, workspaceId);
    
    // Create Session B
    newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
    await newSessionBtn.click();
    await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/);
    const sessionBId = page.url().match(/\/session\/([a-f0-9-]+)/)?.[1];
    expect(sessionBId).toBeTruthy();
    expect(sessionBId).not.toBe(sessionAId);
    
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    
    // Verify message A is NOT visible in Session B
    expect(await isMessageVisible(page, msgA)).toBe(false);
    
    // Send message B
    await sendMessage(page, msgB);
    
    // Verify message B is visible in Session B
    expect(await isMessageVisible(page, msgB)).toBe(true);
    
    // Return to Session A by navigating directly to its URL
    await page.goto(`/workspace/${workspaceId}/session/${sessionAId}`);
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    
    // Wait for messages to load from server (history messages)
    await page.waitForTimeout(1000);
    
    // Verify message A is still in Session A
    const msgALocator = page.locator('.kiosk-message.final, .message.final')
      .filter({ hasText: msgA });
    await expect(msgALocator.first()).toBeVisible({ timeout: MESSAGE_APPEAR_TIMEOUT });
    
    // Verify message B is NOT in Session A
    expect(await isMessageVisible(page, msgB)).toBe(false);
  });

  // =====================
  // Scenario 6: Session Persistence Across Page Reloads
  // =====================
  test('session persists across page reloads', async ({ page }) => {
    test.slow();
    
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Set viewport for kiosk mode
    await page.setViewportSize({ width: 1200, height: 800 });

    // Authenticate and navigate to workspace
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Enter session and send a message
    const sessionId = await enterSession(page, 0);
    const timestamp = Date.now();
    const testMessage = `Persistence test - ${timestamp}`;
    await sendMessage(page, testMessage);
    
    // Verify message is visible
    expect(await isMessageVisible(page, testMessage)).toBe(true);
    
    // Reload the page
    await page.reload();
    
    // Wait for session view to reload
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    
    // Verify message is still visible after reload
    expect(await isMessageVisible(page, testMessage)).toBe(true);
    
    // Verify URL still shows correct session
    expect(page.url()).toContain(sessionId);
  });

  // =====================
  // Focused Unit Tests
  // =====================
  
  test('sessions list displays session metadata', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Verify session row structure
    const sessionRow = page.locator('.session-row').first();
    await expect(sessionRow).toBeVisible();
    
    // Session name
    await expect(sessionRow.locator('.session-name')).toBeVisible();
    
    // Creation time
    await expect(sessionRow.locator('.session-meta')).toContainText(/Created/);
    
    // Last active time
    await expect(sessionRow.locator('.session-last-active')).toBeVisible();
    
    // View button
    await expect(sessionRow.getByRole('button', { name: /view/i })).toBeVisible();
  });

  test('session with no messages displays correctly', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    
    // Create a new session (will have no messages)
    const newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
    await newSessionBtn.click();
    
    // Wait for session view to load
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+\/session\/[a-f0-9-]+$/);
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    
    // Session view should be visible even with no messages
    const sessionView = page.locator('.kiosk-mode, .mobile-mode');
    await expect(sessionView).toBeVisible();
    
    // Connection should be established
    await expect(page.locator('.connection-indicator.connected, .connection-status.connected')).toBeVisible();
    
    // Message area should be empty (no .message or .kiosk-message elements with .final)
    const messages = await page.locator('.kiosk-message.final, .message.final').count();
    expect(messages).toBe(0);
  });

  // =====================
  // Edge Case Tests
  // =====================

  test('rapid session switching works correctly', async ({ page }) => {
    test.slow();
    
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Authenticate and navigate
    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Ensure we have at least 2 sessions
    const initialCount = await getSessionCount(page);
    if (initialCount < 2) {
      const newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
      await newSessionBtn.click();
      await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/);
      await exitToWorkspaceHome(page, workspaceId);
    }
    
    // Rapidly switch between sessions multiple times
    for (let i = 0; i < 3; i++) {
      await enterSession(page, 0);
      await exitToWorkspaceHome(page, workspaceId);
      await enterSession(page, 1);
      await exitToWorkspaceHome(page, workspaceId);
    }
    
    // Final verification - enter session 0 and verify stable state
    const finalSessionId = await enterSession(page, 0);
    expect(finalSessionId).toBeTruthy();
    expect(page.url()).toContain(finalSessionId);
  });

  test('exit button navigates back to workspace home', async ({ page }) => {
    test.slow();
    
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    // Set viewport for kiosk mode (where exit button is visible)
    await page.setViewportSize({ width: 1200, height: 800 });

    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Enter session
    await enterSession(page, 0);
    await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
    
    // In desktop kiosk mode, drawer starts closed - open it first
    const drawerOpenBtn = page.locator('.drawer-open-btn');
    if (await drawerOpenBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await drawerOpenBtn.click();
      // Wait for drawer to animate open
      await page.waitForTimeout(300);
    }
    
    // Find exit button - in kiosk mode it's in the sidebar header
    const exitBtn = page.locator('.exit-kiosk').first();
    
    // Verify exit button is visible
    await expect(exitBtn).toBeVisible({ timeout: 5000 });
    
    // Click the exit button
    await exitBtn.click();
    
    // Should return to workspace home
    await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+$/, { timeout: ELEMENT_VISIBLE_TIMEOUT });
    await waitForWorkspaceHomeLoaded(page);
  });

  test('workspace home shows correct session count after operations', async ({ page }) => {
    if (!TEST_AUTH_SECRET) {
      test.skip();
      return;
    }

    const workspaceId = await authenticateAndNavigateToWorkspace(page, baseURL, TEST_AUTH_SECRET);
    await waitForWorkspaceHomeLoaded(page);
    await waitForSessionInList(page);
    
    // Get initial count
    const initialCount = await getSessionCount(page);
    expect(initialCount).toBeGreaterThanOrEqual(1);
    
    // Create a new session
    const newSessionBtn = page.getByRole('button', { name: /\+ New Session/i });
    await newSessionBtn.click();
    await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/);
    
    // Return to workspace home
    await exitToWorkspaceHome(page, workspaceId);
    
    // Verify count increased by 1
    const afterCreateCount = await getSessionCount(page);
    expect(afterCreateCount).toBe(initialCount + 1);
    
    // Sessions section heading should reflect count (if it shows count)
    // Note: Current UI shows "Sessions" without count in heading
    await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible();
  });
});
