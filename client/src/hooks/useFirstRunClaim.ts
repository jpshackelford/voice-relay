/**
 * First-run "claim this device" hook (#433).
 *
 * Decides whether the local device should surface a prompt asking the
 * user-at-the-kiosk to claim the device for themselves, or to give the
 * agent a name to use for this session. Also encapsulates the two POSTs
 * the prompt makes:
 *
 *   1. `claimForUser(deviceId)` — promotes the device into the
 *      authenticated user via PATCH `/api/devices/:deviceId` (the same
 *      route the QR-claim flow uses, so behavior matches exactly).
 *   2. `claimForName(deviceId, sessionId, payload)` — POSTs to
 *      `/api/devices/:deviceId/sessions/:sessionId/active-speaker` with
 *      the stored device token so anyone holding the kiosk can name
 *      themselves without OAuth.
 *
 * The hook does NOT render UI — `FirstRunClaimCard` does. Splitting
 * decision/transport from presentation keeps the hook testable without
 * jsdom-flaky DOM exercises.
 */
import { useCallback, useState } from 'react';
import type { SpeakerState } from '../types';
import type { User } from '../contexts/AuthContext';
import { getStoredDeviceToken } from '../utils/deviceToken';

/** Inputs to `useFirstRunClaim`. */
export interface FirstRunClaimInputs {
  /**
   * Latest `speakerState` from the `registered` WS payload (#433).
   * `null` until the first message arrives, or for anonymous-mode
   * servers that omit the field. Either case suppresses the card.
   */
  speakerState: SpeakerState | null;
  /** Workspace id — used to look up the device token in localStorage. */
  workspaceId: string | null;
  /** Authenticated user (if any) — required to enable "Claim for me". */
  user: User | null;
  /**
   * The session this device joined. Required for the anonymous "Just
   * remember a name" path, which is per-session.
   */
  sessionId: string | null;
  /** This device's id (from `registered`). */
  deviceId: string | null;
  /**
   * `fetch` indirection so tests can supply a stub without polluting
   * `window.fetch`. Defaults to the browser `fetch`.
   */
  fetchFn?: typeof fetch;
}

/** Public surface returned by `useFirstRunClaim`. */
export interface FirstRunClaimApi {
  /**
   * `true` iff the card should render right now. Becomes `false` after
   * a successful claim (server resends `registered` on next connect,
   * but in-memory state also flips immediately) or after explicit
   * dismissal via `dismiss`.
   */
  shouldShow: boolean;
  /** In-flight network state for either claim path. */
  busy: boolean;
  /** User-facing error message from the last failed attempt, or `null`. */
  error: string | null;
  /**
   * PATCH /api/devices/:deviceId with `{ primaryUserId: user.id }`.
   * Resolves on success; sets `error` and throws on failure.
   */
  claimForUser: () => Promise<void>;
  /**
   * POST /api/devices/:deviceId/sessions/:sessionId/active-speaker.
   * `preferredName` is required; `pronouns` optional. Resolves on
   * success; sets `error` and throws on failure.
   */
  claimForName: (preferredName: string, pronouns?: string) => Promise<void>;
  /** Local dismissal — flips `shouldShow` to false until next register. */
  dismiss: () => void;
}

/**
 * Decide whether the card should render given the current state.
 *
 * Conditions (all must hold):
 *
 *  - `speakerState` is present (server told us anything at all).
 *  - The device has no primary user (`deviceClaimed === false`) AND no
 *    active-speaker override for the session
 *    (`activeSpeakerId === null`). Either being set means a name has
 *    already been chosen and the card is unnecessary.
 *  - We know the local `deviceId` and `sessionId` (otherwise we can't
 *    POST either claim, so the card has nothing to do).
 *
 * Note: `user` is NOT required — anonymous-mode users can still take
 * the "Just remember a name" path. The card hides the "Claim for me"
 * button when `user === null`.
 */
function computeShouldShow(
  inputs: Pick<FirstRunClaimInputs, 'speakerState' | 'deviceId' | 'sessionId'>
): boolean {
  const { speakerState, deviceId, sessionId } = inputs;
  if (!speakerState) return false;
  if (!deviceId || !sessionId) return false;
  if (speakerState.deviceClaimed) return false;
  if (speakerState.activeSpeakerId) return false;
  return true;
}

export function useFirstRunClaim(inputs: FirstRunClaimInputs): FirstRunClaimApi {
  const {
    speakerState,
    workspaceId,
    user,
    sessionId,
    deviceId,
    fetchFn = fetch,
  } = inputs;
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedLocally, setResolvedLocally] = useState(false);

  const shouldShow =
    !dismissed &&
    !resolvedLocally &&
    computeShouldShow({ speakerState, deviceId, sessionId });

  const claimForUser = useCallback(async () => {
    if (!deviceId || !user) {
      setError('Sign in is required to claim this device.');
      throw new Error('Missing deviceId or user for claimForUser');
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetchFn(`/api/devices/${deviceId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryUserId: user.id }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const msg = `Claim failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`;
        setError(msg);
        throw new Error(msg);
      }
      setResolvedLocally(true);
    } finally {
      setBusy(false);
    }
  }, [deviceId, user, fetchFn]);

  const claimForName = useCallback(
    async (preferredName: string, pronouns?: string) => {
      if (!deviceId || !sessionId || !workspaceId) {
        setError('Missing device/session — cannot save a name right now.');
        throw new Error('Missing deviceId/sessionId/workspaceId for claimForName');
      }
      const stored = getStoredDeviceToken(workspaceId);
      if (!stored?.deviceToken) {
        // Without a device token we can't authenticate to the
        // device-token-only endpoint. This shouldn't normally happen
        // because we only render once the device has registered, but
        // guard anyway so the error path is user-visible.
        const msg = 'No device token available — try reloading the page.';
        setError(msg);
        throw new Error(msg);
      }
      const trimmedName = preferredName.trim();
      if (trimmedName.length === 0) {
        const msg = 'Please enter a name.';
        setError(msg);
        throw new Error(msg);
      }
      setError(null);
      setBusy(true);
      try {
        const body: Record<string, unknown> = { preferredName: trimmedName };
        const trimmedPronouns = pronouns?.trim();
        if (trimmedPronouns) {
          body.pronouns = trimmedPronouns;
        }
        const res = await fetchFn(
          `/api/devices/${deviceId}/sessions/${sessionId}/active-speaker`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${stored.deviceToken}`,
            },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const msg = `Save failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`;
          setError(msg);
          throw new Error(msg);
        }
        setResolvedLocally(true);
      } finally {
        setBusy(false);
      }
    },
    [deviceId, sessionId, workspaceId, fetchFn]
  );

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    shouldShow,
    busy,
    error,
    claimForUser,
    claimForName,
    dismiss,
  };
}

// Exported for unit tests so we can exercise the decision matrix
// without spinning up the whole hook.
export const _internals = { computeShouldShow };
