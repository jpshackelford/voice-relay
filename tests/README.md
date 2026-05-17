# Voice Relay E2E Tests

End-to-end tests for Voice Relay using Playwright.

## Quick Start

```bash
# Install dependencies
npm ci
npx playwright install --with-deps chromium webkit

# Run all E2E tests
npm test

# Run mobile voice tests only
npm run test:mobile
```

## Test Categories

### Standard E2E Tests

| Script | Description |
|--------|-------------|
| `npm test` | All E2E tests (chromium project) |
| `npm run test:headed` | Same tests with visible browser |
| `npm run test:ui` | Interactive Playwright UI mode |

### Mobile Voice Tests

Tests for the mobile walkie-talkie UI with simulated audio input.

| Script | Description |
|--------|-------------|
| `npm run test:mobile` | Mobile tests with mocked speech (CI-compatible) |
| `npm run test:mobile:headed` | Same tests with visible browser |
| `npm run test:mobile:real` | Include real SpeechRecognition tests (local only) |

### Smoke Tests

Production validation tests that run against the deployed server.

| Script | Description |
|--------|-------------|
| `npm run smoke` | Run smoke tests (requires `SMOKE_TEST_URL`) |
| `npm run smoke:auth` | Same with visible browser for debugging |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TEST_AUTH_SECRET` | Yes* | Secret for test authentication endpoint |
| `SMOKE_TEST_URL` | For smoke | Production URL to test against |
| `RUN_REAL_SPEECH_TESTS` | No | Set to `1` to run real speech API tests |

*Required for authenticated E2E tests. CI has this configured as a secret.

## Mobile Voice Testing

### How It Works

Mobile tests use Chromium's fake device flags to simulate microphone input:

```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream  
--use-file-for-fake-audio-capture=/path/to/audio.wav
```

This feeds a WAV file as microphone input, allowing deterministic testing without real hardware.

### Audio Fixtures

Located in `tests/fixtures/audio/`:

| File | Content | Duration | Use Case |
|------|---------|----------|----------|
| `short_hello.wav` | Human saying "Hello" | ~1s | Default test input |
| `short_yes.wav` | Human saying "Yes" | ~1s | Affirmative response |
| `short_no.wav` | Human saying "No" | ~1s | Negative response |
| `medium_order.wav` | Order details phrase | ~7s | Longer utterance |

Fixtures sourced from [jpshackelford/oh-local-speech](https://github.com/jpshackelford/oh-local-speech) PR #11.

### Test Structure

**CI-compatible tests (8 tests):**
- Use mocked SpeechRecognition API
- Work in headless Chromium
- Run automatically in CI

**Local-only tests (3 tests):**
- Use real browser SpeechRecognition
- Require headed browser with network access
- Must opt-in with `RUN_REAL_SPEECH_TESTS=1`

### Artifacts

Every mobile test captures:
- `video.webm` - Full test recording
- `test-finished-1.png` - Screenshot at completion

Artifacts are saved to `test-results/` and can be used as PR evidence.

## CI Integration

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. **Server Tests** - Unit tests with coverage
2. **Build Client** - Verify client builds
3. **E2E Tests** - Playwright tests including mobile

Mobile tests run with `TEST_AUTH_SECRET` from GitHub Secrets.

### Viewing CI Artifacts

After CI completes, artifacts are available:
1. Go to the workflow run
2. Scroll to "Artifacts" section
3. Download `playwright-report`

## Writing New Tests

### Authentication

Use the auth helper for authenticated tests:

```typescript
import { getAuthState } from './utils/auth-helper';

test.beforeEach(async ({ page }) => {
  const storageState = await getAuthState(baseURL, TEST_AUTH_SECRET);
  await page.context().addCookies(storageState.cookies);
  await page.goto('/dashboard');
});
```

### Mobile Device Emulation

Use the `mobile-chrome` project for mobile viewport:

```typescript
// In playwright.config.ts projects, or:
test.use({ ...devices['Pixel 5'] });
```

### Mocking Browser APIs

For CI compatibility, mock APIs that don't work in headless:

```typescript
await page.addInitScript(() => {
  // Mock SpeechRecognition, etc.
});
```

## Troubleshooting

### Tests timeout waiting for connection

The WebSocket connection requires:
1. Server running with `STORE_DRIVER=sqlite`
2. Valid `TEST_AUTH_SECRET`
3. Database accessible

### Mobile tests skip with "not configured"

Set `TEST_AUTH_SECRET`:
```bash
TEST_AUTH_SECRET=your-secret npm run test:mobile
```

### Real speech tests fail in headless

Real SpeechRecognition requires a headed browser:
```bash
npm run test:mobile:real  # Runs headed with RUN_REAL_SPEECH_TESTS=1
```

### Videos not capturing

Check `playwright.config.ts` has `video: 'on'` for the project.
