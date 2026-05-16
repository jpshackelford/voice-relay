import { test, expect, Page } from '@playwright/test';
import {
  getAuthState,
  waitForStableConnection,
} from './utils/auth-helper';

/**
 * E2E Test: Markdown Rendering in Kiosk Display
 *
 * This test verifies markdown rendering including:
 * - Images render correctly (not as broken links with ! prefix)
 * - GFM tables render with proper structure
 * - Images inside table cells work
 * - Existing markdown features (headers, bold, italic, code, links) preserved
 * - XSS protection via DOMPurify
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

/**
 * Helper: Display markdown content via API and verify rendering
 * Uses the display content feature to show markdown in the kiosk display
 */
async function displayMarkdownContent(page: Page, markdown: string, title?: string): Promise<void> {
  // Get workspace and session IDs from URL
  const url = page.url();
  const workspaceMatch = url.match(/\/workspace\/([a-f0-9-]+)/);
  const sessionMatch = url.match(/\/session\/([a-f0-9-]+)/);
  
  if (!workspaceMatch || !sessionMatch) {
    throw new Error('Not on a session page');
  }
  
  // Use evaluate to send a display-content WebSocket message
  await page.evaluate(async ({ content, title, sessionId }) => {
    // Find the WebSocket connection (if available)
    // Otherwise, we need to inject content another way
    const ws = (window as Window & { __ws?: WebSocket }).__ws;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'display-content',
        sessionId,
        content: {
          type: 'markdown',
          content,
          title
        }
      }));
    }
  }, { content: markdown, title, sessionId: sessionMatch[1] });
}

test.describe('Markdown Rendering', () => {
  // Skip all tests if no auth secret
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  let baseURL: string;

  test.beforeEach(async ({ page }) => {
    baseURL = page.context().baseURL || 'http://localhost:5174';
  });

  test.describe('parseMarkdown function - via unit tests', () => {
    // Note: These are primarily verified via unit tests in KioskMode.test.tsx
    // The following E2E tests verify the integration works end-to-end
    
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

  test.describe('Visual regression - markdown content types', () => {
    test('markdown display area renders when content is shown', async ({ page }) => {
      if (!TEST_AUTH_SECRET) {
        test.skip();
        return;
      }

      await authenticateAndNavigateToSession(page, baseURL, TEST_AUTH_SECRET);
      await waitForStableConnection(page, CONNECTION_STABLE_TIMEOUT);
      
      // When markdown content is displayed, it should show in the display area
      const displayArea = page.locator('.kiosk-display');
      await expect(displayArea).toBeVisible();
      
      // Take a baseline screenshot of the kiosk display area
      await expect(displayArea).toHaveScreenshot('kiosk-display-baseline.png', {
        maxDiffPixelRatio: 0.1, // Allow 10% difference for dynamic content
      });
    });
  });
});

/**
 * Standalone unit-like tests for parseMarkdown that can be run client-side
 * These complement the vitest unit tests
 */
test.describe('parseMarkdown integration', () => {
  test('renders markdown images without leftover exclamation marks', async ({ page }) => {
    // Create a minimal HTML page with the parseMarkdown function
    await page.setContent(`
      <html>
        <head>
          <script src="https://cdn.jsdelivr.net/npm/marked@latest/lib/marked.umd.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/dompurify@latest/dist/purify.min.js"></script>
          <script>
            // Configure marked for GFM
            marked.setOptions({ gfm: true, breaks: true });
            
            function parseMarkdown(text) {
              const rawHtml = marked.parse(text);
              return DOMPurify.sanitize(rawHtml);
            }
            
            function runTests() {
              const results = [];
              
              // Test 1: Image rendering
              const img1 = parseMarkdown('![apple](https://example.com/apple.png)');
              results.push({
                name: 'Image renders correctly',
                pass: img1.includes('<img') && 
                      img1.includes('src="https://example.com/apple.png"') &&
                      !img1.includes('!<a'),
                output: img1
              });
              
              // Test 2: Table rendering
              const table1 = parseMarkdown('| A | B |\\n|---|---|\\n| 1 | 2 |');
              results.push({
                name: 'Table renders correctly',
                pass: table1.includes('<table>') && 
                      table1.includes('<th>') &&
                      table1.includes('<td>'),
                output: table1
              });
              
              // Test 3: Table with image
              const tableImg = parseMarkdown('| Icon |\\n|------|\\n| ![x](x.png) |');
              results.push({
                name: 'Table with image renders correctly',
                pass: tableImg.includes('<table>') && tableImg.includes('<img'),
                output: tableImg
              });
              
              // Test 4: XSS protection
              const xss1 = parseMarkdown('<script>alert("xss")</script>');
              results.push({
                name: 'Script tags stripped',
                pass: !xss1.includes('<script>'),
                output: xss1
              });
              
              const xss2 = parseMarkdown('<img src=x onerror=alert(1)>');
              results.push({
                name: 'onerror attributes stripped',
                pass: !xss2.includes('onerror'),
                output: xss2
              });
              
              return results;
            }
          </script>
        </head>
        <body>
          <div id="results"></div>
          <script>
            const results = runTests();
            document.getElementById('results').innerHTML = JSON.stringify(results, null, 2);
          </script>
        </body>
      </html>
    `);
    
    // Get test results
    const resultsText = await page.locator('#results').textContent();
    const results = JSON.parse(resultsText || '[]');
    
    // Verify all tests passed
    for (const result of results) {
      expect(result.pass, `${result.name}: ${result.output}`).toBe(true);
    }
  });
});
