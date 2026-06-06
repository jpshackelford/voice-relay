# Smoke Tests

Production smoke tests for Voice Relay. These verify core functionality after deployment.

## Quick Start (CI/Automated)

For fully unattended smoke tests, use the test auth endpoint:

```bash
# Requires TEST_AUTH_SECRET set on both server and in your env
TEST_AUTH_SECRET=your-secret SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke
```

## Setup

### Option 1: Automated Authentication (Recommended for CI)

1. Generate a secret:
   ```bash
   openssl rand -hex 32
   ```

2. Add to server's `.env`:
   ```
   TEST_AUTH_SECRET=your-generated-secret
   ```

3. Restart the server (or redeploy)

4. Add `TEST_AUTH_SECRET` as a GitHub Actions secret

5. Run tests:
   ```bash
   TEST_AUTH_SECRET=xxx SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke
   ```

### Option 2: Interactive Authentication (Local Development)

```bash
# Opens browser for GitHub OAuth - complete login manually
SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke:auth

# Then run tests using saved session
SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke
```

## Running Smoke Tests

```bash
# Run all smoke tests against production
SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke

# Run specific test
SMOKE_TEST_URL=https://app.no-hands.dev npx playwright test tests/smoke/smoke.spec.ts -g "health"

# Run only unauthenticated tests
SMOKE_TEST_URL=https://app.no-hands.dev npx playwright test tests/smoke/smoke.spec.ts -g "Health|Authentication Flow"
```

## What's Tested

### Core Smoke Tests (`smoke.spec.ts`)

| Test | Auth Required | Description |
|------|---------------|-------------|
| Health endpoint | ❌ | `/health` returns `{"status":"ok"}` |
| Server info | ❌ | `/api/server-info` returns URLs |
| Login page | ❌ | Renders correctly with GitHub button |
| OAuth redirect | ❌ | `/auth/github` redirects to GitHub |
| Dashboard access | ✅ | Authenticated users can access dashboard |
| Auth API | ✅ | `/auth/me` returns user info |
| Workspaces API | ✅ | `/api/workspaces` returns data |
| WebSocket | ✅ | WSS connection can be established |

### Invite Link Flow Tests (`invite-link.spec.ts`)

| Test | Auth Required | Description |
|------|---------------|-------------|
| Owner sees Settings | ✅ | Owner-only Settings section visibility |
| Copy Invite Link | ✅ | Clipboard copies valid `/join/{code}` URL |
| Invite URL format | ✅ | URL matches `/join/{code}` pattern |
| Unauthenticated redirect | ❌ | Redirects to `/login?returnTo=/join/{code}` |
| Already-member redirect | ✅ | Redirects to workspace (skip join) |
| Invalid code error | ✅ | Shows "invalid or expired" message |
| Non-owner access | ✅ | Settings section hidden for non-owners |

> **Note**: The "new user joins workspace" scenario is not tested in smoke tests because they run against production with a single test user who is already a member of existing workspaces. The already-member redirect behavior is tested instead.

### AI Integration Tests (`ai-integration.spec.ts`)

| Test | Auth Required | Description |
|------|---------------|-------------|
| AI status endpoint | ✅ | Returns availability info |
| Sparkle button visibility | ✅ | Visible when AI is available |
| Connect to AI | ✅ | Shows connecting then connected state |
| Send message to AI | ✅ | AI responds within timeout |
| AI displays image | ✅ | Image appears on kiosk canvas |
| AI displays markdown | ✅ | Markdown content renders on canvas |
| Disconnect from AI | ✅ | Returns to inactive state |
| Rapid toggle | ✅ | State not corrupted by rapid clicks |
| AI unavailable | ✅ | Sparkle button hidden when no API key |
| API error handling | ✅ | Proper errors for invalid requests |
| Display API validation | ✅ | Validates required parameters |

> **Note**: AI integration tests require a workspace with a per-workspace OpenHands API key configured (in workspace settings) and sufficient API quota. Tests gracefully skip when AI is unavailable. AI tests use longer timeouts (up to 120s) due to API response times.

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
smoke-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npx playwright install chromium
    - name: Run smoke tests
      env:
        SMOKE_TEST_URL: https://app.no-hands.dev
        TEST_AUTH_SECRET: ${{ secrets.TEST_AUTH_SECRET }}
      run: npm run smoke
```

## Security Notes

- `TEST_AUTH_SECRET` enables a special endpoint (`POST /auth/test-session`)
- The endpoint is **only** registered when `TEST_AUTH_SECRET` env var is set
- Requires the secret in `X-Test-Auth-Secret` header to authenticate
- Creates a dedicated test user, separate from real GitHub users
- Safe for production as long as the secret is kept secure

## Auth State

- Saved to `tests/smoke/.auth-state.json` (gitignored)
- Automatically created by test-session endpoint or interactive login
- Re-authenticate if tests fail with 401 errors
