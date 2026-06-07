/**
 * Issue #439 — Post-OAuth-return device-claim wiring.
 *
 * Closes the loop on PR #438's "I'm a workspace member" flow: after the
 * OAuth roundtrip returns the user to the same kiosk URL with a fresh
 * session cookie, this hook detects the anonymous→authenticated transition
 * and fires the device PATCH that binds `devices.primary_user_id` to the
 * newly-signed-in user and seeds a speaker row for them.
 *
 * The trigger is a `sessionStorage` flag written by `ClaimSpeakerCard`
 * (see {@link import('../components/ClaimSpeakerCard').setPendingClaim})
 * BEFORE the redirect to GitHub. `sessionStorage` is intentional: the
 * intent dies with the tab, so an abandoned OAuth roundtrip never replays.
 *
 * The PATCH has no body — the empty PATCH is the established "claim this
 * device for me" semantic on the auth-required `/api/devices/:deviceId`
 * endpoint (see `server/src/devices/router.ts`). Don't "clean up" the
 * empty body; it's the API contract.
 */
import { useEffect, useRef } from 'react';
import {
  consumePendingClaim,
  hasPendingClaim,
} from '../components/ClaimSpeakerCard';

export interface UseFirstRunClaimOptions {
  /** Auth status from `useAuth()`. The hook bails until this is `true`. */
  isAuthenticated: boolean;
  /** Device id of the kiosk. The hook bails until this is non-empty. */
  deviceId: string | null | undefined;
  /** Workspace id the device belongs to. Hook bails until non-empty. */
  workspaceId: string | null | undefined;
  /**
   * Refreshes the auth cookie before the PATCH so a near-expired token
   * doesn't cause a spurious 401 right after OAuth return. Same contract
   * as `useAuth().ensureValidToken` — returns `true` on success.
   */
  ensureValidToken: () => Promise<boolean>;
  /**
   * Optional override for the API base. Empty string = same-origin
   * (production). Used in tests so a vitest-jsdom run doesn't try to
   * actually hit `/api/...`.
   */
  apiBase?: string;
  /**
   * Fires when the PATCH succeeds with a 2xx. Parent uses this to nudge
   * the local `speakerState` so the claim card hides immediately without
   * waiting for the next WS `registered` payload. Optional — omitting it
   * just means the card stays visible until the next reconnect.
   */
  onClaimed?: () => void;
}

/**
 * Wires the post-OAuth pending-claim flag to a single `PATCH
 * /api/devices/:deviceId` call. Idempotent across StrictMode double-
 * invokes, render races, and remounts (the `sessionStorage` flag is
 * consumed BEFORE the network call, and an in-memory `firedRef` guards
 * against double-fire within the same effect run).
 */
export function useFirstRunClaim({
  isAuthenticated,
  deviceId,
  workspaceId,
  ensureValidToken,
  apiBase = '',
  onClaimed,
}: UseFirstRunClaimOptions): void {
  /**
   * Guards against the React 18 StrictMode double-effect-invoke and any
   * render races between the auth-context fetch and the device-restore
   * hook resolving. Without this, both effect runs would race to consume
   * the sessionStorage flag.
   */
  const firedRef = useRef(false);

  useEffect(() => {
    // Hard guards — bail without touching storage.
    if (!isAuthenticated) return;
    if (!deviceId || !workspaceId) return;
    if (firedRef.current) return;
    if (!hasPendingClaim(workspaceId, deviceId)) return;

    // Mark in-memory first so a synchronous re-render can't re-enter.
    firedRef.current = true;
    // Consume the persistent flag BEFORE the await so a remount during
    // the network call doesn't see the flag and re-fire.
    consumePendingClaim(workspaceId, deviceId);

    let cancelled = false;

    void (async () => {
      try {
        await ensureValidToken();
        if (cancelled) return;

        const url = `${apiBase}/api/devices/${encodeURIComponent(deviceId)}`;
        // Empty-body PATCH is the established device-claim semantic on
        // this endpoint (#383, #433). The auth cookie is what binds the
        // device to the newly-signed-in user; the body is unused.
        const resp = await fetch(url, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (cancelled) return;

        if (!resp.ok) {
          console.warn(
            `[FirstRunClaim] PATCH /api/devices/${deviceId} failed with ${resp.status}; ` +
              'leaving the claim card visible so the user can retry.'
          );
          return;
        }

        onClaimed?.();
      } catch (err) {
        if (cancelled) return;
        // Network error / abort / etc. — log and exit silently. The card
        // may re-render; the user can fall back to the name-only path or
        // try again. Do not loop or retry.
        console.warn(
          '[FirstRunClaim] PATCH failed (non-fatal):',
          err instanceof Error ? err.message : err
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // `onClaimed` and `ensureValidToken` are intentionally excluded from
    // the deps — they're typically new function refs on every render and
    // we don't want to retry the PATCH just because the parent re-rendered.
    // `firedRef` plus the consumed sessionStorage flag enforce single-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, deviceId, workspaceId, apiBase]);
}
