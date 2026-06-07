/**
 * First-run claim prompt for unclaimed kiosk devices (#433).
 * Non-blocking corner card with three actions: sign in, remember name, or skip.
 */
import { useState, type FormEvent } from 'react';

/**
 * Max preferred-name / pronouns length for the active-speaker form (#433).
 *
 * IMPORTANT: These must stay in sync with the server-side limits in
 * `server/src/devices/router.ts` (`MAX_SPEAKER_NAME_LENGTH`,
 * `MAX_SPEAKER_PRONOUNS_LENGTH`). If you change one, change the other.
 */
const PREFERRED_NAME_MAX_LEN = 80;
const PRONOUNS_MAX_LEN = 32;
/** Issue #433 AC: 7-day skip TTL when the user picks "Shared device". */
export const SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** localStorage key prefix used by `getSkipUntil` / `setSkipUntil`. */
export const SKIP_KEY_PREFIX = 'voice_relay_first_run_skip_';
/**
 * Issue #439: sessionStorage key prefix for the post-OAuth-return device
 * claim handoff. Scoped to `(workspaceId, deviceId)` so a browser visiting
 * two unclaimed kiosks back-to-back can't accidentally claim the wrong
 * device. `sessionStorage` (not `localStorage`) so it auto-clears on tab
 * close — we never want to replay an intent the user abandoned by closing
 * the browser before OAuth completed.
 */
export const PENDING_CLAIM_KEY_PREFIX = 'voice_relay_pending_claim_';

/**
 * Build the workspace+device-scoped localStorage key for the 7-day skip.
 * Exported so the kiosk container can read the same value when deciding
 * whether to mount the card at all.
 */
export function skipKey(workspaceId: string, deviceId: string): string {
  return `${SKIP_KEY_PREFIX}${workspaceId}_${deviceId}`;
}

/**
 * Read the skip-until timestamp for a (workspace, device). Returns the
 * Date when the skip expires, or `null` when no skip is active.
 * Tolerates corrupt entries by treating them as "no skip".
 */
export function getSkipUntil(
  workspaceId: string,
  deviceId: string
): Date | null {
  try {
    const raw = window.localStorage.getItem(skipKey(workspaceId, deviceId));
    if (!raw) return null;
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return null;
    if (at <= Date.now()) return null;
    return new Date(at);
  } catch {
    return null;
  }
}

/**
 * Write the 7-day skip-until timestamp for a (workspace, device). The
 * return value is `true` on success, `false` when localStorage rejected
 * the write (e.g. quota or private-browsing).
 */
export function setSkipUntil(workspaceId: string, deviceId: string): boolean {
  try {
    const until = new Date(Date.now() + SKIP_TTL_MS).toISOString();
    window.localStorage.setItem(skipKey(workspaceId, deviceId), until);
    return true;
  } catch {
    return false;
  }
}

/**
 * Issue #439: sessionStorage key for the post-OAuth pending-claim flag.
 * Scoped to `(workspaceId, deviceId)` so the post-return effect can
 * verify it was the same kiosk that initiated the OAuth roundtrip.
 */
export function pendingClaimKey(
  workspaceId: string,
  deviceId: string
): string {
  return `${PENDING_CLAIM_KEY_PREFIX}${workspaceId}_${deviceId}`;
}

/**
 * Write the pending-claim flag before redirecting to GitHub OAuth.
 * Returns `true` on success, `false` if sessionStorage rejected the write
 * (private browsing / quota). A `false` result means the post-return
 * claim chain won't fire — the user can still claim by clicking again.
 */
export function setPendingClaim(
  workspaceId: string,
  deviceId: string
): boolean {
  try {
    window.sessionStorage.setItem(pendingClaimKey(workspaceId, deviceId), '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Issue #439: Returns `true` when a pending-claim flag exists for the
 * (workspace, device) pair. Pure read; does not consume the flag.
 */
export function hasPendingClaim(
  workspaceId: string,
  deviceId: string
): boolean {
  try {
    return (
      window.sessionStorage.getItem(pendingClaimKey(workspaceId, deviceId)) ===
      '1'
    );
  } catch {
    return false;
  }
}

/**
 * Issue #439: Clear the pending-claim flag. Caller MUST do this BEFORE
 * firing the PATCH so a render race / StrictMode double-invoke does not
 * fire the network request twice.
 */
export function consumePendingClaim(
  workspaceId: string,
  deviceId: string
): void {
  try {
    window.sessionStorage.removeItem(pendingClaimKey(workspaceId, deviceId));
  } catch {
    // Storage unavailable; nothing to do.
  }
}

export interface ClaimSpeakerCardProps {
  /** The workspace this device belongs to. Used to scope the skip TTL. */
  workspaceId: string;
  /** The device this kiosk is registered as. Used in the POST URL and to
   *  scope the skip TTL. */
  deviceId: string;
  /** Current session the device is wired into. Used in the POST URL. */
  sessionId: string;
  /** Device-token Bearer credential for the POST. */
  deviceToken: string;
  /** Called after the server confirms the active-speaker write succeeded.
   *  Parent uses this to hide the card and refresh local state. */
  onClaimed: (speakerId: string) => void;
  /** "Not now" / `×` handler — parent decides whether to remember the
   *  session-scoped dismissal. */
  onDismiss: () => void;
  /** "Skip / shared device" handler — fires after the 7-day skip is
   *  written to localStorage so the parent can hide the card. */
  onSkip: () => void;
  /** "I'm a workspace member" handler. Typically wired to
   *  `useAuth().login()`, which already handles the OAuth roundtrip
   *  with `returnTo`. Kept injectable so tests don't need to mock the
   *  AuthContext. */
  onSignIn: () => void;
  /** Override the API base when the kiosk is talking to a non-default
   *  host (e.g. tests or local dev). Empty string = same-origin. */
  apiBase?: string;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

export function ClaimSpeakerCard({
  workspaceId,
  deviceId,
  sessionId,
  deviceToken,
  onClaimed,
  onDismiss,
  onSkip,
  onSignIn,
  apiBase = '',
}: ClaimSpeakerCardProps) {
  const [showNameForm, setShowNameForm] = useState(false);
  const [preferredName, setPreferredName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  const trimmedName = preferredName.trim();
  const trimmedPronouns = pronouns.trim();
  const isValid =
    trimmedName.length > 0 && trimmedName.length <= PREFERRED_NAME_MAX_LEN;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || state.kind === 'submitting') return;

    setState({ kind: 'submitting' });
    try {
      const url = `${apiBase}/api/devices/${encodeURIComponent(
        deviceId
      )}/sessions/${encodeURIComponent(sessionId)}/active-speaker`;
      const body: { preferredName: string; pronouns?: string } = {
        preferredName: trimmedName,
      };
      if (trimmedPronouns) body.pronouns = trimmedPronouns;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        let message = `Failed to save name (HTTP ${resp.status}).`;
        try {
          const data = (await resp.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // non-JSON response — keep the generic message
        }
        setState({ kind: 'error', message });
        return;
      }

      const data = (await resp.json()) as { speakerId: string };
      onClaimed(data.speakerId);
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Network error while saving name.',
      });
    }
  }

  function handleSkip() {
    // Best-effort: even if the persistence fails (private browsing /
    // quota) we still hide the card for the lifetime of this tab.
    setSkipUntil(workspaceId, deviceId);
    onSkip();
  }

  /**
   * Issue #439: write the pending-claim flag before kicking off OAuth.
   * The flag is set inside the card (not the parent) so it persists even
   * if the parent unmounts between click and OAuth return. `onSignIn`
   * typically navigates away via `window.location`, so this assignment
   * must finish synchronously before the redirect — keep it inline.
   */
  function handleSignIn() {
    setPendingClaim(workspaceId, deviceId);
    onSignIn();
  }

  const submitting = state.kind === 'submitting';

  return (
    <div
      className="claim-speaker-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="claim-speaker-title"
      data-testid="claim-speaker-card"
    >
      <button
        type="button"
        className="claim-speaker-close"
        aria-label="Close"
        onClick={onDismiss}
        disabled={submitting}
      >
        ✕
      </button>
      <h2 id="claim-speaker-title" className="claim-speaker-title">
        Who&apos;s using this device?
      </h2>

      {!showNameForm ? (
        <>
          <p className="claim-speaker-hint">
            This kiosk isn&apos;t claimed yet. Pick how the assistant should
            address you.
          </p>
          <div className="claim-speaker-choices">
            <button
              type="button"
              className="claim-speaker-primary"
              onClick={handleSignIn}
            >
              I&apos;m a workspace member
            </button>
            <button
              type="button"
              className="claim-speaker-secondary"
              onClick={() => setShowNameForm(true)}
            >
              Just remember a name for this device
            </button>
            <button
              type="button"
              className="claim-speaker-tertiary"
              onClick={handleSkip}
            >
              Skip — shared device
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="claim-speaker-form">
          <label className="claim-speaker-label">
            <span>Your name</span>
            <input
              type="text"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              placeholder="e.g. JP"
              maxLength={PREFERRED_NAME_MAX_LEN}
              autoFocus
              disabled={submitting}
              aria-required="true"
              aria-invalid={!isValid && preferredName.length > 0}
            />
          </label>

          <label className="claim-speaker-label">
            <span>Pronouns (optional)</span>
            <input
              type="text"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="e.g. she/her"
              maxLength={PRONOUNS_MAX_LEN}
              disabled={submitting}
            />
          </label>

          {state.kind === 'error' && (
            <div role="alert" className="claim-speaker-error">
              {state.message}
            </div>
          )}

          <div className="claim-speaker-actions">
            <button
              type="button"
              className="claim-speaker-dismiss"
              onClick={() => setShowNameForm(false)}
              disabled={submitting}
            >
              Back
            </button>
            <button
              type="submit"
              className="claim-speaker-submit"
              disabled={!isValid || submitting}
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
