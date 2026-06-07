/**
 * First-run "claim this device" prompt for unknown speakers (#433).
 *
 * Renders when a kiosk-mode device connects and the server's `registered`
 * payload reports it as unclaimed (`deviceClaimed === false`) and with no
 * per-session active-speaker override. The card is non-blocking: it pins
 * to a corner of the kiosk overlay grid so voice and chat input behind
 * it stay usable per AC #3.
 *
 * Three actions, per the issue's AC:
 *   1. "I'm a workspace member" → hands off to `useAuth().login()`
 *      (GitHub OAuth). On return the existing PATCH-as-authenticated-user
 *      side-effect inside `SessionView` claims the device for the
 *      now-logged-in user (server-side: see `devices/router.ts:200`).
 *   2. "Remember a name for this device" → POSTs the device-token
 *      authenticated endpoint
 *      `/api/devices/:deviceId/sessions/:sessionId/active-speaker`
 *      with `{ preferredName, pronouns? }`. The server creates an
 *      anonymous speakers row in the workspace (user_id = NULL) and
 *      writes `session_devices.active_speaker_id` for the current
 *      (session, device). Returns the new speakerId.
 *   3. "Skip / shared device" → writes a 7-day localStorage TTL keyed
 *      by `workspaceId+deviceId` so the same browser stops prompting
 *      on that device for a week.
 *
 * Visual treatment is the kiosk corner-card style (mirrors
 * `JoinRequestNotification`), with a top-right `×` that maps to the
 * same "dismiss until this session ends" semantic as the per-form
 * "Not now" button — kept in keeping with the existing `× ` close
 * affordance on `JoinRequestNotification`.
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
              onClick={onSignIn}
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
