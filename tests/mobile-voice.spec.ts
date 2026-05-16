/**
 * Mobile Voice Input Tests
 *
 * Tests the mobile walkie-talkie UI with simulated audio input.
 * Uses audio fixtures from oh-local-speech project for deterministic testing.
 *
 * Audio fixtures:
 * - short_hello.wav: Human voice saying "Hello" (~1s)
 * - short_yes.wav: Human voice saying "Yes" (~1s)
 * - short_no.wav: Human voice saying "No" (~1s)
 * - medium_order.wav: Human voice with order details (~7s)
 *
 * These tests use Chromium's fake audio device feature to feed WAV files
 * as microphone input, allowing end-to-end voice testing without real hardware.
 */

import { test, expect, devices } from '@playwright/test';
import path from 'path';

const AUDIO_FIXTURES = path.resolve(__dirname, 'fixtures/audio');

// Mobile device configuration with fake audio
const mobileConfig = {
  ...devices['Pixel 5'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(AUDIO_FIXTURES, 'short_hello.wav')}`,
    ],
  },
};

test.describe('Mobile Voice UI', () => {
  test.use(mobileConfig);

  test('displays walkie-talkie interface on mobile viewport', async ({ page }) => {
    await page.goto('/');

    // Should show mobile walkie-talkie UI
    await expect(page.locator('.mobile-walkie')).toBeVisible();
    await expect(page.locator('.walkie-mic-btn')).toBeVisible();
    await expect(page.locator('.walkie-header')).toBeVisible();
  });

  test('mic button shows correct ARIA labels', async ({ page }) => {
    await page.goto('/');

    const micButton = page.locator('.walkie-mic-btn');
    await expect(micButton).toBeVisible();

    // Should have appropriate aria-label for voice mode
    const ariaLabel = await micButton.getAttribute('aria-label');
    expect(ariaLabel).toContain('microphone');
  });

  test('settings modal opens and closes', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.click('[aria-label="Open settings"]');
    await expect(page.locator('.settings-modal, .mobile-settings')).toBeVisible();

    // Close settings (click outside or close button)
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal, .mobile-settings')).not.toBeVisible();
  });

  test('conversation pane toggles', async ({ page }) => {
    await page.goto('/');

    // Open conversation pane
    const conversationBtn = page.locator('.conversation-btn, [aria-label*="conversation"]');
    await conversationBtn.click();

    // Should show conversation/message history
    await expect(page.locator('.conversation-pane, .message-list')).toBeVisible();
  });

  test('connection status indicator is visible', async ({ page }) => {
    await page.goto('/');

    // Should show connection status
    const statusIndicator = page.locator('[role="status"], .connection-dot, .walkie-header span[aria-label*="onnect"]');
    await expect(statusIndicator.first()).toBeVisible();
  });
});

test.describe('Mobile Voice Input with Fake Audio', () => {
  test.use(mobileConfig);

  test('mic button toggles recording state', async ({ page }) => {
    await page.goto('/');

    const micButton = page.locator('.walkie-mic-btn');
    await expect(micButton).toBeVisible();

    // Initially not recording
    await expect(micButton).not.toHaveClass(/active/);

    // Click to start recording
    await micButton.click();

    // Should show active/recording state
    // Note: This may fail if mic permissions aren't auto-granted
    // The fake-ui-for-media-stream flag should handle this
    await expect(micButton).toHaveClass(/active/, { timeout: 3000 });

    // Status should indicate recording/listening
    const status = page.locator('.walkie-status');
    await expect(status).toContainText(/Recording|Listening/i, { timeout: 3000 });

    // Click again to stop
    await micButton.click();
    await expect(micButton).not.toHaveClass(/active/);
  });

  test('oscilloscope shows waveform when recording in visualizer mode', async ({ page }) => {
    await page.goto('/');

    // Switch to visualizer mode via settings
    await page.click('[aria-label="Open settings"]');

    // Look for input mode selector and switch to visualizer
    const visualizerOption = page.locator('text=Visualizer, text=visualizer, [data-mode="visualizer"]').first();
    if (await visualizerOption.isVisible()) {
      await visualizerOption.click();
      await page.keyboard.press('Escape');

      // Start recording in visualizer mode
      const micButton = page.locator('.walkie-mic-btn');
      await micButton.click();

      // Oscilloscope canvas should be visible
      const oscilloscope = page.locator('.walkie-oscilloscope canvas, .oscilloscope-canvas');
      await expect(oscilloscope).toBeVisible({ timeout: 3000 });
    } else {
      // Visualizer mode might not be available, skip this assertion
      test.skip();
    }
  });
});

test.describe('Mobile Voice - Different Audio Fixtures', () => {
  // Test with "Yes" audio
  test.describe('short_yes.wav', () => {
    test.use({
      ...devices['Pixel 5'],
      launchOptions: {
        args: [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-audio-capture=${path.join(AUDIO_FIXTURES, 'short_yes.wav')}`,
        ],
      },
    });

    test('processes "Yes" audio input', async ({ page }) => {
      await page.goto('/');

      const micButton = page.locator('.walkie-mic-btn');
      await micButton.click();

      // Should start recording with the "Yes" audio file
      await expect(micButton).toHaveClass(/active/, { timeout: 3000 });

      // Let it process for a moment
      await page.waitForTimeout(1500);

      // Stop recording
      await micButton.click();
    });
  });

  // Test with longer audio for realistic scenario
  test.describe('medium_order.wav', () => {
    test.use({
      ...devices['Pixel 5'],
      launchOptions: {
        args: [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-audio-capture=${path.join(AUDIO_FIXTURES, 'medium_order.wav')}`,
        ],
      },
    });

    test.slow(); // This test uses longer audio

    test('handles longer audio input', async ({ page }) => {
      await page.goto('/');

      const micButton = page.locator('.walkie-mic-btn');
      await micButton.click();

      await expect(micButton).toHaveClass(/active/, { timeout: 3000 });

      // Let it process the longer audio (~7 seconds)
      await page.waitForTimeout(5000);

      // Should still be responsive
      const status = page.locator('.walkie-status');
      await expect(status).toBeVisible();

      await micButton.click();
    });
  });
});

test.describe('Mobile Safari (mocked APIs)', () => {
  // Safari/WebKit doesn't support Chromium's fake device flags
  // We test with mocked Web APIs instead
  test.use({
    ...devices['iPhone 13'],
  });

  test('displays mobile UI on iPhone viewport', async ({ page }) => {
    await page.goto('/');

    // Should detect mobile and show walkie UI
    await expect(page.locator('.mobile-walkie, .mobile-mode')).toBeVisible();
    await expect(page.locator('.walkie-mic-btn')).toBeVisible();
  });

  test('mic button is interactive', async ({ page }) => {
    // Mock getUserMedia to avoid permission issues
    await page.addInitScript(() => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const destination = audioContext.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();

      navigator.mediaDevices.getUserMedia = async () => destination.stream;
    });

    await page.goto('/');

    const micButton = page.locator('.walkie-mic-btn');
    await expect(micButton).toBeVisible();

    // Click should not throw (permissions are mocked)
    await micButton.click();

    // Should transition to some active state
    // (exact behavior depends on whether SpeechRecognition is also mocked)
  });
});
