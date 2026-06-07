import { request, type BrowserContext, type Browser, type Page, expect } from '@playwright/test';

/**
 * Authentication helper for E2E tests.
 *
 * Provides utilities to authenticate browser contexts using TEST_AUTH_SECRET.
 * This is extracted from the smoke test auth setup for reuse in other E2E tests.
 */

// CI environment detection for adjusted timeouts
const isCI = !!process.env.CI;
// WebSocket stability timeout - longer in CI due to resource constraints
export const WS_STABLE_TIMEOUT = isCI ? 30000 : 20000;

/**
 * IMPORTANT: Must match DEVICE_TOKEN_COOKIE_NAME in server/src/auth/router.ts
 * This cookie is filtered out when creating authenticated contexts so each
 * browser context registers as a separate device for message relay testing.
 */
const DEVICE_COOKIE_NAME = 'voice_relay_device';

interface AuthCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  expires: number;
}

interface StorageState {
  cookies: AuthCookie[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

/**
 * Authenticate a browser context using the test auth endpoint.
 *
 * Requires:
 * - Server to have TEST_AUTH_SECRET configured
 * - TEST_AUTH_SECRET environment variable to be set
 *
 * @param baseURL - The base URL of the server (e.g., 'http://localhost:5174')
 * @param testAuthSecret - The TEST_AUTH_SECRET value
 * @returns StorageState that can be used to set cookies on a context
 */
export async function getAuthState(baseURL: string, testAuthSecret: string): Promise<StorageState> {
  const context = await request.newContext();

  try {
    const response = await context.post(`${baseURL}/auth/test-session`, {
      headers: {
        'X-Test-Auth-Secret': testAuthSecret,
      },
    });

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Test auth failed: ${response.status()} ${body}\nIs TEST_AUTH_SECRET set correctly on the server?`);
    }

    // Parse cookies from response
    const cookies = await response.headersArray();
    const setCookies = cookies.filter(h => h.name.toLowerCase() === 'set-cookie');

    const cookieObjects: AuthCookie[] = setCookies.map(h => {
      const cookiePart = h.value.split(';')[0];
      const eqIndex = cookiePart.indexOf('=');
      // Parse Max-Age from cookie header if present
      const maxAgeMatch = h.value.match(/Max-Age=(\d+)/i);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 86400; // Default 1 day

      const domain = new URL(baseURL).hostname;

      return {
        name: cookiePart.substring(0, eqIndex),
        value: cookiePart.substring(eqIndex + 1),
        domain,
        path: '/',
        httpOnly: true,
        secure: baseURL.startsWith('https'),
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + maxAge,
      };
    });

    return {
      cookies: cookieObjects,
      origins: [],
    };
  } finally {
    await context.dispose();
  }
}

/**
 * Apply authentication state to a browser context.
 *
 * @param context - The browser context to authenticate
 * @param storageState - The storage state from getAuthState()
 */
export async function applyAuthState(context: BrowserContext, storageState: StorageState): Promise<void> {
  await context.addCookies(storageState.cookies);
}

/**
 * Create an authenticated browser context.
 *
 * Convenience function that combines context creation and authentication.
 * IMPORTANT: This removes the device cookie from auth state so each context
 * registers as a separate device. Without this, all contexts using the same
 * auth state would share the same device ID and messages wouldn't relay.
 *
 * @param browser - The browser instance
 * @param baseURL - The base URL of the server
 * @param testAuthSecret - The TEST_AUTH_SECRET value
 * @param options - Additional context options (e.g., viewport)
 */
export async function createAuthenticatedContext(
  browser: import('@playwright/test').Browser,
  baseURL: string,
  testAuthSecret: string,
  options?: {
    viewport?: { width: number; height: number };
  }
): Promise<BrowserContext> {
  const storageState = await getAuthState(baseURL, testAuthSecret);

  // Remove device cookie so each context creates its own device
  // The test auth endpoint creates a device and sets a cookie, but we need
  // separate devices for each browser context to test message relay
  const filteredCookies = storageState.cookies.filter(
    (cookie) => cookie.name !== DEVICE_COOKIE_NAME
  );

  const context = await browser.newContext({
    viewport: options?.viewport,
    storageState: {
      ...storageState,
      cookies: filteredCookies,
    },
  });

  return context;
}

/**
 * Wait for WebSocket connection to be established.
 *
 * Polls the connection status indicator for "Connected" state.
 * Note: This waits for the UI to show connected, but the device may
 * reconnect as session data loads. Use waitForStableConnection for more
 * reliable session-aware waiting.
 *
 * @param page - The Playwright page
 * @param timeout - Maximum time to wait in ms (default: 10000)
 */
export async function waitForWebSocketConnected(
  page: import('@playwright/test').Page,
  timeout = 10000
): Promise<void> {
  // Wait for any of the connection status indicators to show "Connected"
  // Mobile walkie mode: .connection-dot.connected (dot indicator)
  // Mobile legacy mode: .connection-status.connected or text "Connected"
  // Kiosk mode: .connection-indicator.connected (plug icon)
  await page.waitForFunction(
    () => {
      // Check mobile walkie connection dot (current mobile UI)
      const mobileDot = document.querySelector('.connection-dot.connected');
      if (mobileDot) return true;

      // Check mobile connection status (legacy)
      const mobileStatus = document.querySelector('.connection-status.connected');
      if (mobileStatus) return true;

      // Check kiosk connection indicator
      const kioskIndicator = document.querySelector('.connection-indicator.connected');
      if (kioskIndicator) return true;

      // Also check for text content as fallback
      const statusText = document.querySelector('.connection-status');
      if (statusText && statusText.textContent?.includes('Connected')) return true;

      return false;
    },
    { timeout }
  );
}

/**
 * Wait for WebSocket connection to stabilize.
 * 
 * This is more robust than waitForWebSocketConnected because it waits for the
 * connection to remain stable for a period of time. When session data loads
 * (workspaceId, sessionId), React re-renders cause WebSocket reconnections.
 * This helper ensures all reconnections are complete before proceeding.
 *
 * @param page - The Playwright page
 * @param timeout - Maximum time to wait in ms (default: WS_STABLE_TIMEOUT)
 * @param stabilityMs - How long connection must be stable (default: 1000ms)
 */
export async function waitForStableConnection(
  page: import('@playwright/test').Page,
  timeout = WS_STABLE_TIMEOUT,
  stabilityMs = 1000
): Promise<void> {
  const startTime = Date.now();
  let lastConnectedTime = 0;
  let stableMs = 0;
  
  while (Date.now() - startTime < timeout) {
    const isConnected = await page.evaluate(() => {
      // Check all connection indicators: mobile walkie dot, mobile legacy status, kiosk indicator
      const mobileDot = document.querySelector('.connection-dot.connected');
      const mobileStatus = document.querySelector('.connection-status.connected');
      const kioskIndicator = document.querySelector('.connection-indicator.connected');
      return !!(mobileDot || mobileStatus || kioskIndicator);
    });
    
    if (isConnected) {
      if (lastConnectedTime === 0) {
        lastConnectedTime = Date.now();
      }
      stableMs = Date.now() - lastConnectedTime;
      if (stableMs >= stabilityMs) {
        return;
      }
    } else {
      lastConnectedTime = 0;
      stableMs = 0;
    }
    
    await page.waitForTimeout(100);
  }
  
  throw new Error(`WebSocket connection did not stabilize within ${timeout}ms`);
}

/**
 * Wait for the session view to be fully ready.
 *
 * This waits for:
 * 1. Loading spinner to disappear
 * 2. Session view (kiosk-mode or mobile-mode) to be visible
 * 3. WebSocket to show connected
 *
 * This is more reliable than waitForWebSocketConnected because it ensures
 * the session data is loaded and the WebSocket has reconnected with the
 * correct sessionId.
 *
 * @param page - The Playwright page
 * @param timeout - Maximum time to wait in ms (default: WS_STABLE_TIMEOUT)
 */
export async function waitForSessionReady(
  page: import('@playwright/test').Page,
  timeout = WS_STABLE_TIMEOUT
): Promise<void> {
  // Wait for loading overlay to disappear
  await page.waitForFunction(
    () => !document.querySelector('.loading-overlay'),
    { timeout }
  );

  // Wait for session view to be visible
  await page.waitForFunction(
    () => {
      return document.querySelector('.kiosk-mode') !== null ||
             document.querySelector('.mobile-mode') !== null ||
             document.querySelector('.kiosk-container') !== null;
    },
    { timeout }
  );

  // Wait for WebSocket connected status
  await waitForWebSocketConnected(page, timeout);

  // Small additional delay for WebSocket to fully stabilize
  await page.waitForTimeout(500);
}

/**
 * Return type for setupTwoDeviceSession helper.
 */
export interface TwoDeviceSession {
  kioskContext: BrowserContext;
  mobileContext: BrowserContext;
  kioskPage: Page;
  mobilePage: Page;
  sessionUrl: string;
  /** Cleanup function that closes both contexts */
  cleanup: () => Promise<void>;
}

/**
 * Set up a two-device session for multi-device E2E tests.
 *
 * This helper encapsulates the common setup pattern:
 * 1. Create kiosk and mobile authenticated contexts
 * 2. Navigate kiosk to dashboard → enter first session
 * 3. Wait for kiosk WebSocket connection to stabilize
 * 4. Navigate mobile to the same session
 * 5. Wait for mobile WebSocket connection to stabilize
 *
 * @param browser - The browser instance
 * @param baseURL - The base URL of the server
 * @param testAuthSecret - The TEST_AUTH_SECRET value
 * @returns Object with kiosk/mobile contexts, pages, session URL, and cleanup function
 */
export async function setupTwoDeviceSession(
  browser: Browser,
  baseURL: string,
  testAuthSecret: string
): Promise<TwoDeviceSession> {
  // Create two isolated browser contexts (simulates separate devices)
  // Kiosk: >= 768px width, Mobile: < 768px width
  const kioskContext = await createAuthenticatedContext(
    browser,
    baseURL,
    testAuthSecret,
    { viewport: { width: 1200, height: 800 } }  // Triggers kiosk mode
  );

  const mobileContext = await createAuthenticatedContext(
    browser,
    baseURL,
    testAuthSecret,
    { viewport: { width: 375, height: 667 } }  // Triggers mobile mode
  );

  const kioskPage = await kioskContext.newPage();
  const mobilePage = await mobileContext.newPage();

  // Navigate kiosk to dashboard → first session and wait for green dot.
  const sessionUrl = await navigateKioskToFirstSession(kioskPage, baseURL);

  // Navigate mobile to the same session URL
  await mobilePage.goto(sessionUrl);

  // Wait for mobile to be in session view
  await mobilePage.waitForFunction(
    () => document.querySelector('.mobile-mode') !== null ||
         document.querySelector('.kiosk-mode') !== null,
    { timeout: 15000 }
  );

  // Wait for mobile WebSocket connection to stabilize (uses CI-aware timeout)
  await waitForStableConnection(mobilePage, WS_STABLE_TIMEOUT);

  return {
    kioskContext,
    mobileContext,
    kioskPage,
    mobilePage,
    sessionUrl,
    cleanup: async () => {
      await kioskContext.close();
      await mobileContext.close();
    },
  };
}

/**
 * Navigate an already-authenticated kiosk page to the first session.
 *
 * Extracted from setupTwoDeviceSession so single-device specs (e.g. the
 * keepalive spec, issue #310) can reuse the same dashboard → "View →"
 * flow without spinning up a second mobile context.
 *
 * Assumes:
 *  - `page` belongs to a context created via createAuthenticatedContext()
 *    with a kiosk viewport (>= 768px wide).
 *  - The test workspace has at least one session for the test user
 *    (the test-session endpoint auto-creates one).
 *
 * After this returns:
 *  - URL matches /workspace/.+/session/.+
 *  - The kiosk green dot (`.connection-indicator.connected`) has been
 *    waited on via waitForStableConnection.
 *
 * @param page    The kiosk Playwright page
 * @param baseURL Worker-specific base URL (from fixtures)
 * @returns       The session URL the page settled on
 */
export async function navigateKioskToFirstSession(
  page: Page,
  baseURL: string,
): Promise<string> {
  await page.goto(`${baseURL}/dashboard`);

  await expect(page.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: 5000 });

  // Scope to the session-row button class to avoid Playwright strict-mode
  // violations when the worker DB has >1 session. Sessions render newest-first,
  // so `.first()` deterministically picks the most recently created one. See #452.
  const viewButton = page.locator('button.view-session-btn').first();
  await expect(viewButton).toBeVisible({ timeout: 5000 });
  await viewButton.click();

  await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: 10000 });
  const sessionUrl = page.url();

  await waitForStableConnection(page, WS_STABLE_TIMEOUT);

  return sessionUrl;
}

/**
 * Ensure kiosk sidebar drawer is open.
 *
 * In desktop kiosk mode (width >= 768px), messages and input are in a
 * collapsible sidebar drawer that starts closed. This helper opens it
 * so that messages can be seen and assertions can pass.
 *
 * @param page - The kiosk Playwright page
 */
export async function ensureKioskDrawerOpen(page: Page): Promise<void> {
  const drawerOpenBtn = page.locator('.drawer-open-btn');
  if (await drawerOpenBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await drawerOpenBtn.click();
    // Wait for drawer to animate open and visibility:visible to apply
    await page.waitForTimeout(350);
  }
}

/**
 * Ensure kiosk input is visible (opens drawer if needed).
 *
 * In desktop kiosk mode, the input is in a collapsible sidebar drawer
 * that starts closed. This helper opens it and returns the input locator.
 *
 * @param page - The kiosk Playwright page
 * @returns Locator for the kiosk text input
 */
export async function ensureKioskInputVisible(page: Page): Promise<import('@playwright/test').Locator> {
  await ensureKioskDrawerOpen(page);
  return page.locator('.kiosk-sidebar .kiosk-input-row input[type="text"]');
}

/**
 * Return type for findMessageInput helper.
 */
export interface MessageInputResult {
  input: import('@playwright/test').Locator;
  sendBtn: import('@playwright/test').Locator;
}

/**
 * Navigate a kiosk page to a session via dashboard.
 *
 * This helper encapsulates the common navigation pattern for E2E tests:
 * 1. Navigate to /dashboard
 * 2. Wait for workspace home to load (devices/sessions headings)
 * 3. Click the "View" button to enter the first session
 * 4. Wait for session URL to load
 * 5. Wait for WebSocket connection to stabilize
 *
 * @param page - The kiosk Playwright page
 * @param connectionTimeout - Timeout for connection stabilization (default: WS_STABLE_TIMEOUT)
 * @param baseURL - Optional base URL for navigation (for parallel test isolation)
 */
export async function navigateKioskToSession(
  page: Page,
  connectionTimeout: number = WS_STABLE_TIMEOUT,
  baseURL?: string
): Promise<void> {
  const dashboardUrl = baseURL ? `${baseURL}/dashboard` : '/dashboard';
  await page.goto(dashboardUrl);
  await expect(page.getByRole('heading', { name: /devices/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible({ timeout: 5000 });

  // Scope to the session-row button class to avoid Playwright strict-mode
  // violations when the worker DB has >1 session. Sessions render newest-first,
  // so `.first()` deterministically picks the most recently created one. See #452.
  const viewButton = page.locator('button.view-session-btn').first();
  await expect(viewButton).toBeVisible({ timeout: 5000 });
  await viewButton.click();

  await page.waitForURL(/\/workspace\/[^/]+\/session\/[^/]+/, { timeout: 10000 });
  await waitForStableConnection(page, connectionTimeout);
}

/**
 * Extract QR URL from a page element with data-qr-url attribute.
 *
 * This helper encapsulates the common pattern for extracting and validating
 * QR code URLs in E2E tests.
 *
 * @param page - The Playwright page
 * @param selector - CSS selector for element with data-qr-url attribute (default: '[data-qr-url]')
 * @param timeout - Maximum time to wait for element (default: 10000)
 * @returns The extracted and validated QR URL
 */
export async function extractQrUrl(
  page: Page,
  selector: string = '[data-qr-url]',
  timeout: number = 10000
): Promise<string> {
  const qrContainer = page.locator(selector).first();
  await expect(qrContainer).toBeVisible({ timeout });

  const qrUrl = await qrContainer.getAttribute('data-qr-url');
  expect(qrUrl).toBeTruthy();
  expect(qrUrl).toContain('/workspace/');
  expect(qrUrl).toContain('/session/');

  return qrUrl!;
}

/**
 * Find the message input and send button, handling kiosk/mobile modes.
 *
 * This helper abstracts the complexity of finding the input element across
 * different viewport modes (kiosk vs mobile) and drawer states. It:
 * 1. Checks for kiosk mode input first
 * 2. Falls back to mobile mode input
 * 3. Opens the drawer if in kiosk mode with closed drawer
 *
 * @param page - The Playwright page
 * @returns Object with input locator and send button locator
 */
export async function findMessageInput(page: Page): Promise<MessageInputResult> {
  const kioskInput = page.locator('.kiosk-input-row input[type="text"]');
  const mobileInput = page.locator('.mobile-input-row input[type="text"]');

  // Try kiosk input first
  if (await kioskInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    return {
      input: kioskInput,
      sendBtn: page.locator('.kiosk-input-row .send-btn-small, .kiosk-sidebar .send-btn-small'),
    };
  }

  // Check for mobile input
  if (await mobileInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    return {
      input: mobileInput,
      sendBtn: page.locator('.mobile-input-row .send-btn-small'),
    };
  }

  // Kiosk mode with closed drawer - open it
  const drawerOpenBtn = page.locator('.drawer-open-btn');
  if (await drawerOpenBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await drawerOpenBtn.click();
    // Wait for drawer animation and verify input becomes visible
    try {
      await kioskInput.waitFor({ state: 'visible', timeout: 2000 });
    } catch (error) {
      throw new Error(
        'Drawer button was clicked but input did not appear. The drawer animation may have failed or taken longer than expected. ' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return {
      input: kioskInput,
      sendBtn: page.locator('.kiosk-input-row .send-btn-small, .kiosk-sidebar .send-btn-small'),
    };
  }

  // If we get here, no input was found - throw descriptive error
  throw new Error(
    'Could not find message input. Tried kiosk input, mobile input, and drawer button. ' +
    'Verify the UI mode and that the session view is fully loaded.'
  );
}
