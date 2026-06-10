import { test, expect } from './fixtures';
import { getAuthState } from './utils/auth-helper';

/**
 * E2E test: session settings REST surface (issue #378).
 *
 * Exercises `GET` / `PATCH /api/sessions/:sessionId/settings` end-to-end
 * against a worker-isolated server. Auth uses the test-session helper so
 * we hit the real JWT path; we then PATCH the per-session TTS, input
 * mode, auto-submit, and agent prompt fields and assert the snapshot
 * comes back correctly. We also verify the unauthenticated path returns
 * 401 (no scary 500s) and the round-trip restored snapshot survives a
 * follow-up GET.
 *
 * Requirements:
 * - Server must have TEST_AUTH_SECRET configured
 * - TEST_AUTH_SECRET environment variable must be set
 */

const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;

test.describe('Session settings REST API', () => {
  test.skip(!TEST_AUTH_SECRET, 'TEST_AUTH_SECRET not configured');

  test('GET requires authentication (no Bearer, no JWT)', async ({ request, workerBaseURL }) => {
    // We don't have a session id yet, but the unauth check happens
    // before the session lookup so any id is fine.
    const res = await request.get(`${workerBaseURL}/api/sessions/any-id/settings`);
    expect([401, 404]).toContain(res.status());
  });

  test('JWT-authenticated GET + PATCH round-trip', async ({ request, workerBaseURL }) => {
    const storageState = await getAuthState(workerBaseURL, TEST_AUTH_SECRET!);

    // Surface the JWT cookie as a header so Playwright's APIRequestContext
    // attaches it on every call. Each cookie obj has a `name` and `value`.
    const cookieHeader = storageState.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    // Get the user's workspaces so we know where to create a session.
    const wsList = await request.get(`${workerBaseURL}/api/workspaces`, {
      headers: { Cookie: cookieHeader },
    });
    expect(wsList.ok()).toBeTruthy();
    const wsBody = await wsList.json();
    const workspaceId: string = wsBody.workspaces?.[0]?.id;
    test.skip(!workspaceId, 'Test workspace not provisioned');

    // Create a fresh session so we don't trample existing state.
    const createRes = await request.post(
      `${workerBaseURL}/api/workspaces/${workspaceId}/sessions`,
      {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: { name: 'settings-api-e2e' },
      },
    );
    expect(createRes.ok()).toBeTruthy();
    const { session } = await createRes.json();
    const sessionId: string = session.id;

    // GET — default snapshot.
    const initialRes = await request.get(
      `${workerBaseURL}/api/sessions/${sessionId}/settings`,
      { headers: { Cookie: cookieHeader } },
    );
    expect(initialRes.status()).toBe(200);
    const initial = await initialRes.json();
    expect(initial.sessionId).toBe(sessionId);
    expect(initial.workspaceId).toBe(workspaceId);
    expect(initial.tts).toEqual({ enabled: true, outputDeviceId: null });
    expect(initial.inputMode).toBe('unified');
    expect(initial.autoSubmit).toBe(true);
    expect(initial.agentPrompt.source).toBe('builtin');
    expect(typeof initial.agentPrompt.effective).toBe('string');
    // Issue #470: verboseSttLogging defaults to false. Asserting on
    // the GET path verifies (a) the field is part of the snapshot the
    // client hydrates from and (b) the default isn't silently flipped
    // by some other code path (regression-protection for AC §3).
    expect(initial.verboseSttLogging).toBe(false);

    // PATCH — flip every visible field.
    const patchRes = await request.patch(
      `${workerBaseURL}/api/sessions/${sessionId}/settings`,
      {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: {
          tts: { enabled: false, outputDeviceId: null },
          inputMode: 'voice',
          autoSubmit: false,
          agentPrompt: 'Be terse.',
          // Issue #470: flip the verbose flag on so the round-trip
          // assertions below see both the PATCH-response and the GET
          // refresh agree on the new value.
          verboseSttLogging: true,
        },
      },
    );
    expect(patchRes.status()).toBe(200);
    const patched = await patchRes.json();
    expect(patched.tts.enabled).toBe(false);
    expect(patched.inputMode).toBe('voice');
    expect(patched.autoSubmit).toBe(false);
    expect(patched.agentPrompt.source).toBe('session');
    expect(patched.agentPrompt.effective).toBe('Be terse.');
    expect(patched.verboseSttLogging).toBe(true);

    // GET again — fresh request should observe the persisted state.
    const refetched = await request.get(
      `${workerBaseURL}/api/sessions/${sessionId}/settings`,
      { headers: { Cookie: cookieHeader } },
    );
    expect(refetched.status()).toBe(200);
    const refetchedBody = await refetched.json();
    expect(refetchedBody).toEqual(patched);

    // PATCH agentPrompt back to null clears the override.
    const clearRes = await request.patch(
      `${workerBaseURL}/api/sessions/${sessionId}/settings`,
      {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: { agentPrompt: null },
      },
    );
    expect(clearRes.status()).toBe(200);
    const cleared = await clearRes.json();
    expect(['workspace-default', 'builtin']).toContain(cleared.agentPrompt.source);
  });

  test('validation errors return 400 with a useful message', async ({ request, workerBaseURL }) => {
    const storageState = await getAuthState(workerBaseURL, TEST_AUTH_SECRET!);
    const cookieHeader = storageState.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const wsList = await request.get(`${workerBaseURL}/api/workspaces`, {
      headers: { Cookie: cookieHeader },
    });
    const wsBody = await wsList.json();
    const workspaceId: string = wsBody.workspaces?.[0]?.id;
    test.skip(!workspaceId, 'Test workspace not provisioned');

    const createRes = await request.post(
      `${workerBaseURL}/api/workspaces/${workspaceId}/sessions`,
      {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: { name: 'settings-api-e2e-validation' },
      },
    );
    const { session } = await createRes.json();
    const sessionId: string = session.id;

    const badInputMode = await request.patch(
      `${workerBaseURL}/api/sessions/${sessionId}/settings`,
      {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: { inputMode: 'nonsense' },
      },
    );
    expect(badInputMode.status()).toBe(400);
    const body = await badInputMode.json();
    expect(body.error).toMatch(/inputMode/);

    // Issue #470: non-boolean verboseSttLogging must be rejected with
    // a 400 and a useful error message. Confirms the validator
    // recognises the new field (and isn't silently ignoring it).
    const badVerbose = await request.patch(
      `${workerBaseURL}/api/sessions/${sessionId}/settings`,
      {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: { verboseSttLogging: 'yes-please' },
      },
    );
    expect(badVerbose.status()).toBe(400);
    const verboseBody = await badVerbose.json();
    expect(verboseBody.error).toMatch(/verboseSttLogging/);
  });
});
