/**
 * Detects post-OAuth auth transitions and fires the device-claim PATCH.
 * Uses a sessionStorage flag set before OAuth redirect to avoid replaying
 * abandoned flows. Empty PATCH body is the established claim semantic.
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
  // Prevents StrictMode double-invoke and render races.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!deviceId || !workspaceId) return;
    if (firedRef.current) return;
    if (!hasPendingClaim(workspaceId, deviceId)) return;

    firedRef.current = true;
    consumePendingClaim(workspaceId, deviceId);

    let cancelled = false;

    void (async () => {
      try {
        await ensureValidToken();
        if (cancelled) return;

        const url = `${apiBase}/api/devices/${encodeURIComponent(deviceId)}`;
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
        // Network error - log and exit without retrying.
        console.warn(
          '[FirstRunClaim] PATCH failed (non-fatal):',
          err instanceof Error ? err.message : err
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // Exclude function refs (onClaimed, ensureValidToken) to prevent re-firing on parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, deviceId, workspaceId, apiBase]);
}
