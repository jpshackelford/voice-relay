# Smoke Tests

Production smoke tests for Voice Relay. These verify core functionality after deployment.

## Setup (First Time)

Smoke tests require an authenticated session. The auth state is saved locally and reused.

```bash
# Authenticate interactively (opens browser for GitHub OAuth)
SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke:auth
```

This opens a browser window. Complete the GitHub login, and the session will be saved to `.auth-state.json`.

## Running Smoke Tests

```bash
# Run all smoke tests against production
SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke

# Or run specific test
SMOKE_TEST_URL=https://vr.chorecraft.net npx playwright test tests/smoke/smoke.spec.ts -g "health"
```

## What's Tested

| Test | Description |
|------|-------------|
| Health endpoint | `/health` returns `{"status":"ok"}` |
| Server info | `/api/server-info` returns URLs |
| Login page | Renders correctly with GitHub button |
| OAuth redirect | `/auth/github` redirects to GitHub |
| Dashboard access | Authenticated users can access dashboard |
| Auth API | `/auth/me` returns user info |
| Workspaces API | `/api/workspaces` returns data |
| WebSocket | WSS connection can be established |

## Auth State

- Saved to `tests/smoke/.auth-state.json` (gitignored)
- Valid for ~6 hours (based on JWT expiry)
- Re-run `smoke:auth` if tests fail with 401 errors

## Running Against Other Environments

```bash
# Staging
SMOKE_TEST_URL=https://staging.vr.example.com npm run smoke

# Local
SMOKE_TEST_URL=http://localhost:3001 npm run smoke
```

## CI/CD Integration

For automated smoke tests in CI, you'll need one of:

1. **Stored auth state** - Commit encrypted `.auth-state.json` or store as CI secret
2. **Test OAuth app** - Create a dedicated test GitHub account with saved credentials
3. **Skip auth tests** - Run only unauthenticated tests in CI:
   ```bash
   npx playwright test tests/smoke/smoke.spec.ts -g "Health|Authentication Flow"
   ```
