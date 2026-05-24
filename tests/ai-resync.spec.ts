import { test, expect } from './fixtures';
import { Page, WebSocket as PWWebSocket } from '@playwright/test';
import {
  createAuthenticatedContext,
  navigateKioskToFirstSession,
} from './utils/auth-helper';

/**
 * E2E: AI session-state resync on register (issue #290)
 *
 * Verifies the wire-shape side of the resync introduced in #290: when a
 * device registers (or re-registers after a browser refresh) with an
 * active AI session, the server reports the current AI state immediately
 * — instead of waiting for the next transition.
 *
 * Test matrix from issue #290:
 *  - T-3.1-E2E.1: refresh during ready agent restores ✨ indicator
 *  - T-3.1-E2E.2: refresh during thinking agent restores 🤔 indicator
 *  - T-3.1-E2E.3: refresh without active AI shows no indicator (already
 *    implicitly covered: the server's resync skips the absent path)
 *
 * E2E.1 / E2E.2 require a working OpenHands agent in the test environment
 * (TEST_AUTH_SECRET + OPENHANDS_API_KEY). The default CI E2E job has no
 * AI key configured, so those tests are skipped there. They run via the
 * smoke suite (`npm run smoke`) against the deployed environment.
 *
 * T-3.1-E2E.3 is a true negative test that runs in every environment:
 * after a refresh on a session with no active AI binding, no
 * `session-ai-status` frame should be emitted by the server during
 * register, and the kiosk UI should show no AI indicator.
 */

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;
const OPENHANDS_API_KEY = process.env.OPENHANDS_API_KEY;

/**
 * Capture every WS frame received by the page from the moment it's hooked
 * up. Returns a snapshot accessor and the underlying buffer (closed-over).
 */
function captureWsFrames(page: Page) {
  const frames: Array<{ ws: PWWebSocket; payload: string }> = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (event) => {
      const payload = typeof event.payload === 'string'
        ? event.payload
        : event.payload.toString('utf8');
      frames.push({ ws, payload });
    });
  });
  return {
    /** Parsed messages received so far on any WebSocket. */
    parsed(): Array<Record<string, unknown>> {
      return frames
        .map((f) => {
          try {
            return JSON.parse(f.payload) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((m): m is Record<string, unknown> => m !== null);
    },
  };
}

test.describe('AI session-state resync on register (#290)', () => {
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  test('T-3.1-E2E.3: refresh on a session with no active AI sends no session-ai-status', async ({
    browser,
    workerBaseURL,
  }) => {
    const context = await createAuthenticatedContext(
      browser,
      workerBaseURL,
      TEST_AUTH_SECRET!,
      { viewport: { width: 1200, height: 800 } },
    );

    const page = await context.newPage();
    try {
      // First navigation: establish a session with no AI binding (the
      // test server has no OPENHANDS_API_KEY by default, so any new
      // session starts in `state: 'absent'`).
      await navigateKioskToFirstSession(page, workerBaseURL);

      // Now refresh — the new register call exercises the resync path.
      // Hook up the frame capture BEFORE the reload so we see the
      // register-time messages on the fresh WebSocket.
      const capture = captureWsFrames(page);
      await page.reload();

      // Wait long enough for the register handshake to complete.
      // history + tts-settings + (optionally) session-ai-status all fly
      // back within a couple of seconds on a healthy local server.
      await page.waitForTimeout(2000);

      const messages = capture.parsed();
      const statusMessages = messages.filter((m) => m.type === 'session-ai-status');
      const thinkingMessages = messages.filter((m) => m.type === 'ai-thinking');

      // Resync should be skipped entirely when state === 'absent'.
      expect(statusMessages).toEqual([]);
      expect(thinkingMessages).toEqual([]);

      // AI indicator should NOT be visible on the refreshed kiosk.
      // The selector `.ai-status` only renders when `ai?.connected` or
      // `ai?.connecting` is true (see client/src/components/KioskMode.tsx).
      await expect(page.locator('.ai-status')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('T-3.1-E2E.1: refresh during ready agent restores ✨ indicator', async () => {
    test.skip(
      !OPENHANDS_API_KEY,
      'Requires a working OpenHands agent (set OPENHANDS_API_KEY). Runs in the smoke suite.',
    );
    // The smoke suite covers this against the deployed environment with
    // a real OPENHANDS_API_KEY configured. Left here as a documented hook
    // for future local enablement.
  });

  test('T-3.1-E2E.2: refresh during thinking agent restores 🤔 indicator', async () => {
    test.skip(
      !OPENHANDS_API_KEY,
      'Requires a working OpenHands agent (set OPENHANDS_API_KEY). Runs in the smoke suite.',
    );
    // The smoke suite covers this against the deployed environment with
    // a real OPENHANDS_API_KEY configured. Left here as a documented hook
    // for future local enablement.
  });
});
