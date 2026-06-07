import { test, expect } from './fixtures';
import { setupTwoDeviceSession, ensureKioskInputVisible } from './utils/auth-helper';

/**
 * E2E test: first-run claim card → next-utterance speaker resolution (#442).
 *
 * Verifies that the session-scoped speaker override
 * (`session_devices.active_speaker_id`) written by the name-only claim flow
 * wins over the device-level default on the very next outbound utterance,
 * with no reconnect. Two contexts (kiosk + mobile peer) so we can read the
 * server-emitted `RelayedTextMessage` on the wire.
 *
 * Scope: name-only path only. OAuth-handoff path deferred (needs test IdP + #439).
 * senderName assertion deferred to #446 (server still uses device.displayName).
 */

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

test.describe('First-run claim card → next-utterance speaker resolution (#442)', () => {
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  test('name-only claim stamps server-resolved speakerId on the next text', async ({
    browser,
    workerBaseURL,
  }) => {
    test.slow(); // multi-context + WS handshakes

    const { kioskPage, mobilePage, cleanup } = await setupTwoDeviceSession(
      browser,
      workerBaseURL,
      TEST_AUTH_SECRET!,
    );

    try {
      // ── 1. Claim card visible (unclaimed device + no session override) ──
      // The auto-created device from /auth/test-session has
      // primary_user_id = NULL → speakerState.deviceClaimed === false and
      // activeSpeakerId === null, which is exactly the
      // shouldShowClaimCard condition in KioskMode.
      //
      // Wait for the device token to be persisted to localStorage first —
      // the claim card's shouldShowClaimCard derivation reads
      // `getStoredDeviceToken(workspaceId)?.deviceToken` synchronously,
      // and we'd otherwise race the WS `registered` handler that writes
      // it after the WS visually reports `connected`.
      await kioskPage.waitForFunction(
        () => {
          const keys = Object.keys(window.localStorage);
          return keys.some((k) => k.startsWith('voice_relay_device_token_'));
        },
        { timeout: 10_000 },
      );
      const claimCard = kioskPage.getByTestId('claim-speaker-card');
      await expect(claimCard).toBeVisible({ timeout: 10_000 });

      // ── 2. Arm a response observer on the active-speaker POST. ──
      // The endpoint returns `{ speakerId }`; we use it below to
      // verify the WS frame carries the same id.
      const activeSpeakerPostPromise = kioskPage.waitForResponse((resp) =>
        /\/api\/devices\/[^/]+\/sessions\/[^/]+\/active-speaker$/.test(resp.url()) &&
        resp.request().method() === 'POST',
      );

      // ── 3. Drive the name-only flow through the real DOM. ──
      await kioskPage.getByRole('button', { name: /remember a name/i }).click();
      const speakerName = `e2e-speaker-${Date.now()}`;
      await kioskPage.getByLabel(/your name/i).fill(speakerName);
      await kioskPage.getByRole('button', { name: /^save$/i }).click();

      const postResponse = await activeSpeakerPostPromise;
      expect(postResponse.ok()).toBe(true);
      const { speakerId } = (await postResponse.json()) as { speakerId: string };
      expect(speakerId).toMatch(/^[0-9a-f-]{36}$/);

      // ── 4. Card optimistically disappears (#433 AC). ──
      await expect(claimCard).toBeHidden({ timeout: 2_000 });

      // ── 5. Arm a wire-level observer on the mobile peer BEFORE
      //       sending. We use a CDP session with Network.enable so
      //       Network.webSocketFrameReceived fires for frames received
      //       on the already-open WS (page.on('websocket') only fires
      //       for *new* sockets — the mobile peer's WS was opened
      //       during setupTwoDeviceSession and is already up here). ──
      const utterance = `e2e-msg-${Date.now()}`;
      const cdp = await mobilePage.context().newCDPSession(mobilePage);
      await cdp.send('Network.enable');

      type RelayedTextFrame = {
        type: 'text';
        senderName: string;
        text: string;
        partial: boolean;
        utteranceId: string;
        speakerId?: string;
      };

      const wsFramePromise = new Promise<RelayedTextFrame>((resolve, reject) => {
        const timeoutId = setTimeout(
          () => reject(new Error(`No matching ws text frame within 5s for "${utterance}"`)),
          5_000,
        );
        cdp.on('Network.webSocketFrameReceived', (event) => {
          try {
            const data = JSON.parse(event.response.payloadData) as Record<string, unknown>;
            if (
              data.type === 'text' &&
              data.partial === false &&
              data.text === utterance
            ) {
              clearTimeout(timeoutId);
              resolve(data as unknown as RelayedTextFrame);
            }
          } catch {
            // not JSON or binary frame — ignore
          }
        });
      });

      // ── 6. Kiosk sends a text via the existing input affordance. ──
      const kioskInput = await ensureKioskInputVisible(kioskPage);
      await expect(kioskInput).toBeVisible({ timeout: 5_000 });
      await kioskInput.fill(utterance);
      await kioskPage.locator('.kiosk-sidebar .send-btn-small').click();

      // ── 7. UI assertion — mobile peer receives the relayed text. ──
      const peerMessage = mobilePage.locator(`.message.final:has-text("${utterance}")`);
      await expect(peerMessage).toBeVisible({ timeout: 2_000 });

      // ── 8. Wire assertion — session override wins on next utterance. ──
      const wsFrame = await wsFramePromise;
      expect(wsFrame.type).toBe('text');
      expect(wsFrame.text).toBe(utterance);
      expect(wsFrame.partial).toBe(false);
      expect(wsFrame.speakerId).toBe(speakerId);

      // TODO(#446): assert `wsFrame.senderName === speakerName` and rendered
      // peer sender once server substitutes RelayedTextMessage.senderName.
    } finally {
      await cleanup();
    }
  });
});
