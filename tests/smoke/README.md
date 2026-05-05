# Smoke Tests

Production smoke tests for Voice Relay. These verify core functionality after deployment.

## Quick Start (CI/Automated)

For fully unattended smoke tests, use the test auth endpoint:

```bash
# Requires TEST_AUTH_SECRET set on both server and in your env
TEST_AUTH_SECRET=your-secret SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
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
   TEST_AUTH_SECRET=xxx SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
   ```

### Option 2: Interactive Authentication (Local Development)

```bash
# Opens browser for GitHub OAuth - complete login manually
SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke:auth

# Then run tests using saved session
SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
```

## Running Smoke Tests

```bash
# Run all smoke tests against production
SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke

# Run specific test
SMOKE_TEST_URL=https://vr.chorecraft.net npx playwright test tests/smoke/smoke.spec.ts -g "health"

# Run only unauthenticated tests
SMOKE_TEST_URL=https://vr.chorecraft.net npx playwright test tests/smoke/smoke.spec.ts -g "Health|Authentication Flow"
```

## What's Tested

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
        SMOKE_TEST_URL: https://vr.chorecraft.net
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
