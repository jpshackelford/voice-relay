import { request, type BrowserContext } from '@playwright/test';

/**
 * Authentication helper for E2E tests.
 *
 * Provides utilities to authenticate browser contexts using TEST_AUTH_SECRET.
 * This is extracted from the smoke test auth setup for reuse in other E2E tests.
 */

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
    (cookie) => cookie.name !== 'voice_relay_device'
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
  // Mobile mode: .connection-status.connected or text "Connected"
  // Kiosk mode: .connection-indicator.connected (plug icon)
  await page.waitForFunction(
    () => {
      // Check mobile connection status
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
 * @param timeout - Maximum time to wait in ms (default: 20000)
 * @param stabilityMs - How long connection must be stable (default: 1000ms)
 */
export async function waitForStableConnection(
  page: import('@playwright/test').Page,
  timeout = 20000,
  stabilityMs = 1000
): Promise<void> {
  const startTime = Date.now();
  let lastConnectedTime = 0;
  let stableMs = 0;
  
  while (Date.now() - startTime < timeout) {
    const isConnected = await page.evaluate(() => {
      // Check both mobile and kiosk connection indicators
      const mobileStatus = document.querySelector('.connection-status.connected');
      const kioskIndicator = document.querySelector('.connection-indicator.connected');
      return !!(mobileStatus || kioskIndicator);
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
 * @param timeout - Maximum time to wait in ms (default: 20000)
 */
export async function waitForSessionReady(
  page: import('@playwright/test').Page,
  timeout = 20000
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
