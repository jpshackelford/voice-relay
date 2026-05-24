import { test, expect } from './fixtures';
import {
  createAuthenticatedContext,
  navigateKioskToFirstSession,
} from './utils/auth-helper';

/**
 * E2E: WebSocket keepalive (issue #310)
 *
 * Real-time, browser-level proof that the kiosk WebSocket stays up across
 * a multi-minute idle window — no intermediary (Vite proxy, Apache, ngrok,
 * Cloudflare) silently drops the connection — and that the server's
 * keepalive-driven tear-down of a frozen client is followed by a clean
 * client-side reconnect.
 *
 * Both tests are tagged `@slow-keepalive` so they're excluded from the
 * default `--project=chromium` PR run (see playwright.config.ts). They
 * run on the nightly workflow `.github/workflows/nightly-slow-e2e.yml`
 * via `npx playwright test --project=slow-keepalive`.
 *
 * Follow-up to:
 *  - #286 (production server-driven keepalive)
 *  - #309 (server keepalive helper + unit coverage on both sides)
 */

// Both tests in this file share a workspace within a worker.
test.describe.configure({ mode: 'serial' });

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;
const SLOW_TAG = '@slow-keepalive';

/**
 * Install a `window.__wsInstances` array that captures every WebSocket
 * constructed by the page. Used to prove identity-of-connection across the
 * idle window (case 1) and prove that a fresh socket replaces the
 * terminated one (case 2). Must be called via context.addInitScript()
 * BEFORE navigation so the proxy is installed before any client code runs.
 *
 * Defined at module scope so both tests share the exact same shim.
 */
function installWsInstrumentation(): string {
  return `(() => {
    const w = window;
    if (w.__wsInstances) return;
    w.__wsInstances = [];
    const Native = w.WebSocket;
    w.WebSocket = new Proxy(Native, {
      construct(target, args) {
        const inst = new target(...args);
        w.__wsInstances.push(inst);
        return inst;
      },
    });
  })();`;
}

interface WsSnapshot {
  count: number;
  lastState: number | null;
}

async function readWsSnapshot(page: import('@playwright/test').Page): Promise<WsSnapshot> {
  return page.evaluate(() => {
    const list = (window as unknown as { __wsInstances?: WebSocket[] }).__wsInstances ?? [];
    return {
      count: list.length,
      lastState: list.length > 0 ? list[list.length - 1].readyState : null,
    };
  });
}

test.describe(`WS keepalive ${SLOW_TAG}`, () => {
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  test(`5-minute background-idle keeps the kiosk WS green ${SLOW_TAG}`, async ({
    browser,
    workerBaseURL,
  }) => {
    // 5 min idle + auth + assertions; leave generous headroom for CI.
    test.setTimeout(6.5 * 60 * 1000);

    const context = await createAuthenticatedContext(
      browser,
      workerBaseURL,
      TEST_AUTH_SECRET!,
      { viewport: { width: 1200, height: 800 } },
    );

    // Instrument WebSocket BEFORE any page navigation.
    await context.addInitScript(installWsInstrumentation());

    const page = await context.newPage();

    try {
      await navigateKioskToFirstSession(page, workerBaseURL);
      await expect(page.locator('.connection-indicator.connected')).toBeVisible();

      const before = await readWsSnapshot(page);
      // Reaching the green dot must have produced at least one socket.
      expect(before.count).toBeGreaterThanOrEqual(1);

      // 5-minute idle. The server's protocol-level ping/pong (default
      // 25 s interval, #309) is the only traffic on the wire during this
      // window. If any intermediary tears the connection down, the
      // client's #285 reconnect path will create a NEW WebSocket
      // instance, which our shim will record and the assertion below
      // will catch.
      await page.waitForTimeout(5 * 60 * 1000);

      // Same dot, same instance, still OPEN.
      await expect(page.locator('.connection-indicator.connected')).toBeVisible();
      await expect(page.locator('.connection-indicator.disconnected')).toHaveCount(0);

      const after = await readWsSnapshot(page);
      expect(after.count).toBe(before.count);
      expect(after.lastState).toBe(1 /* WebSocket.OPEN */);
    } finally {
      await context.close();
    }
  });

  test(`server tears down a stale kiosk and the kiosk reconnects ${SLOW_TAG}`, async ({
    browser,
    workerBaseURL,
  }) => {
    test.setTimeout(90_000);

    const context = await createAuthenticatedContext(
      browser,
      workerBaseURL,
      TEST_AUTH_SECRET!,
      { viewport: { width: 1200, height: 800 } },
    );
    await context.addInitScript(installWsInstrumentation());

    const page = await context.newPage();

    try {
      await navigateKioskToFirstSession(page, workerBaseURL);
      await expect(page.locator('.connection-indicator.connected')).toBeVisible();

      const before = await readWsSnapshot(page);
      expect(before.count).toBeGreaterThanOrEqual(1);

      // Read the active deviceId. The client persists it under a
      // workspace-scoped key (`voice_relay_device_id_<workspaceId>`) and
      // under the legacy unscoped key on first migration; we search both
      // shapes so the test isn't fragile to which one is populated.
      const deviceId = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (key === 'voice_relay_device_id' || key.startsWith('voice_relay_device_id_')) {
            const v = localStorage.getItem(key);
            if (v) return v;
          }
          if (key === 'voice_relay_device_token' || key.startsWith('voice_relay_device_token_')) {
            const raw = localStorage.getItem(key);
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.deviceId === 'string') return parsed.deviceId;
              } catch {
                // ignore
              }
            }
          }
        }
        return null;
      });
      expect(deviceId, 'kiosk client did not persist a deviceId').toBeTruthy();

      // Force the server to terminate this kiosk's WS — same code path
      // production keepalive uses when no pong arrives within the deadline.
      const res = await page.request.post(`${workerBaseURL}/auth/test-terminate-ws`, {
        headers: { 'X-Test-Auth-Secret': TEST_AUTH_SECRET! },
        data: { deviceId },
      });
      expect(res.ok(), `terminate endpoint returned ${res.status()}: ${await res.text()}`).toBe(true);

      // Brief red, then green again via the #285 reconnect path.
      await expect(page.locator('.connection-indicator.disconnected')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('.connection-indicator.connected')).toBeVisible({ timeout: 30_000 });

      const after = await readWsSnapshot(page);
      // Proof of reconnect: a brand-new WS instance was constructed.
      expect(after.count).toBeGreaterThan(before.count);
      expect(after.lastState).toBe(1 /* WebSocket.OPEN */);
    } finally {
      await context.close();
    }
  });
});
