/**
 * Issue #455: fire-and-forget reporter for client-side error events.
 *
 * Posts a small diagnostic payload to `POST /api/client-errors` so the
 * server can emit a `[ClientError] …` log line. Authentication uses
 * the existing device-token (the same bearer we already use for
 * device-scoped endpoints) — we deliberately do NOT thread the
 * server-only display secret through the browser.
 *
 * INVARIANTS (must hold under every failure mode):
 *  - Pure `void` return. No promise leaks to callers.
 *  - Never throws. Synchronous setup is wrapped in `try/catch`; the
 *    fetch is `.catch()`-swallowed.
 *  - Silently no-ops when any required ID is missing or when the
 *    stored device token doesn't match the caller's `deviceId`. The
 *    page that's already failing must not be made worse by a
 *    misconfigured diagnostic call.
 *  - 2s timeout via `AbortController` so a slow VR backend never
 *    backs up the calling component.
 *  - `keepalive: true` so the request can outlive a page unload after
 *    an unhandled exception.
 */
import { getStoredDeviceToken } from './deviceToken';

export interface ReportClientErrorArgs {
  sessionId?: string;
  workspaceId?: string;
  deviceId?: string;
  /** Stable string identifying the call site (e.g. `useSpeechRecognition`). */
  source: string;
  /** Raw error code from the underlying API (e.g. `event.error`). */
  errorCode?: string;
  /** Human-readable message; will be capped server-side at 500 chars. */
  message: string;
  /** Arbitrary additional context. Capped server-side. */
  context?: Record<string, unknown>;
}

const ENDPOINT = '/api/client-errors';
const TIMEOUT_MS = 2_000;

export function reportClientError(args: ReportClientErrorArgs): void {
  try {
    if (!args.sessionId || !args.workspaceId || !args.deviceId) return;

    const stored = getStoredDeviceToken(args.workspaceId);
    if (!stored?.deviceToken) return;
    // Defense in depth: if the stored token is for a different
    // device id, don't report — the server would 401 us anyway.
    if (stored.deviceId !== args.deviceId) return;

    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch {
            // ignore — aborting a finished request is a no-op in
            // healthy browsers; non-conformant ones must not crash
            // the calling component.
          }
        }, TIMEOUT_MS)
      : null;

    const userAgent =
      typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
        ? navigator.userAgent
        : '';

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stored.deviceToken}`,
      },
      body: JSON.stringify({
        sessionId: args.sessionId,
        workspaceId: args.workspaceId,
        deviceId: args.deviceId,
        source: args.source,
        errorCode: args.errorCode,
        message: args.message,
        userAgent,
        context: args.context,
      }),
      ...(controller ? { signal: controller.signal } : {}),
      // Allow this request to survive a page unload triggered by the
      // failure we're reporting on.
      keepalive: true,
    })
      .catch(() => {
        // Never surface a network / 4xx / 5xx to the caller.
      })
      .finally(() => {
        if (timer !== null) clearTimeout(timer);
      });
  } catch {
    // Catch any synchronous throw (e.g. JSON.stringify on a cyclic
    // context, missing globals in a non-browser test env). Reporting
    // must NEVER make the page worse.
  }
}
