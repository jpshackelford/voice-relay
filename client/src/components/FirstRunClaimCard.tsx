/**
 * First-run "claim this device" card (#433).
 *
 * Rendered by `SessionView` when `useFirstRunClaim().shouldShow` is
 * true. Offers three primary paths plus a corner dismiss:
 *
 *  - **Claim for me / Sign in & claim** — promotes the device into the
 *     authenticated user's primary device. When the user isn't signed
 *     in yet the same button initiates the GitHub OAuth flow via the
 *     parent's `onSignIn` callback (the parent owns the redirect so
 *     the card stays test-free of `window.location`).
 *  - **Just remember a name** — inline name + pronouns form that POSTs
 *     to the device-token-authenticated active-speaker endpoint.
 *  - **Skip / this is shared** — sets a 7-day localStorage flag so the
 *     card stays hidden on this device.
 *
 * The corner × close button is a session-only dismissal (no
 * persistence), matching the AC's "dismiss × in the corner" spec.
 *
 * The component is purely presentational over the surface returned by
 * `useFirstRunClaim` so it's easy to unit-test in jsdom (the hook is
 * tested separately).
 */
import { useState, type FormEvent } from 'react';
import type { User } from '../contexts/AuthContext';

export interface FirstRunClaimCardProps {
  /** Authenticated user, or `null` for anonymous sessions. */
  user: User | null;
  /** True while either claim path is in flight. */
  busy: boolean;
  /** Most recent error from a failed claim, or null. */
  error: string | null;
  /** Promote device into the current user (only callable when signed in). */
  onClaimForUser: () => Promise<void> | void;
  /** Save just a name (and optional pronouns) for the session. */
  onClaimForName: (preferredName: string, pronouns?: string) => Promise<void> | void;
  /**
   * Initiate the GitHub OAuth flow (called when the "Sign in & claim"
   * button is pressed and `user` is null). The parent should redirect
   * with a `returnTo` that brings the user back to the same session.
   */
  onSignIn: () => void;
  /** Persistent 7-day skip — "this device is shared / skip for now". */
  onSkip: () => void;
  /** Session-only dismiss — corner × close button. */
  onDismiss: () => void;
}

export function FirstRunClaimCard({
  user,
  busy,
  error,
  onClaimForUser,
  onClaimForName,
  onSignIn,
  onSkip,
  onDismiss,
}: FirstRunClaimCardProps) {
  const [showNameForm, setShowNameForm] = useState(false);
  const [name, setName] = useState('');
  const [pronouns, setPronouns] = useState('');

  // Pre-fill the name input with the signed-in user's display name
  // when they open the form — common case is "they're me, but I don't
  // want to claim the kiosk permanently".
  const handleOpenNameForm = () => {
    if (!showNameForm) {
      setName(user?.displayName ?? user?.username ?? '');
    }
    setShowNameForm(true);
  };

  const handleNameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Promise rejections are surfaced via `error` from the hook; we
    // intentionally swallow them here so the form stays mounted.
    try {
      await onClaimForName(name, pronouns || undefined);
    } catch {
      /* hook updates `error` */
    }
  };

  const handleClaim = async () => {
    // Unauthenticated callers fork into the OAuth flow; the parent
    // owns the redirect and the auto-claim-on-return.
    if (!user) {
      onSignIn();
      return;
    }
    try {
      await onClaimForUser();
    } catch {
      /* hook updates `error` */
    }
  };

  return (
    <div
      className="first-run-claim-card"
      role="dialog"
      aria-labelledby="first-run-claim-title"
      data-testid="first-run-claim-card"
    >
      <button
        type="button"
        className="first-run-claim-close"
        onClick={onDismiss}
        aria-label="Close"
        disabled={busy}
        data-testid="first-run-claim-close-btn"
      >
        ×
      </button>
      <div className="first-run-claim-content">
        <h3 id="first-run-claim-title" className="first-run-claim-title">
          Who's using this device?
        </h3>
        <p className="first-run-claim-hint">
          The assistant doesn't recognize the speaker on this device yet.
          {user
            ? ' Claim it as yours, or set a name just for this session.'
            : ' Sign in to claim it, or set a name just for this session.'}
        </p>

        {error && (
          <div
            className="first-run-claim-error"
            role="alert"
            data-testid="first-run-claim-error"
          >
            {error}
          </div>
        )}

        {!showNameForm && (
          <div className="first-run-claim-actions">
            <button
              type="button"
              className="first-run-claim-primary"
              onClick={handleClaim}
              disabled={busy}
              data-testid="first-run-claim-claim-btn"
            >
              {busy
                ? 'Claiming…'
                : user
                  ? 'Claim for me'
                  : 'Sign in & claim'}
            </button>
            <button
              type="button"
              className="first-run-claim-secondary"
              onClick={handleOpenNameForm}
              disabled={busy}
              data-testid="first-run-claim-open-name-form-btn"
            >
              Just remember a name
            </button>
            <button
              type="button"
              className="first-run-claim-dismiss"
              onClick={onSkip}
              disabled={busy}
              data-testid="first-run-claim-skip-btn"
            >
              Skip — this is shared
            </button>
          </div>
        )}

        {showNameForm && (
          <form
            className="first-run-claim-form"
            onSubmit={handleNameSubmit}
            data-testid="first-run-claim-name-form"
          >
            <label className="first-run-claim-label">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane"
                maxLength={200}
                disabled={busy}
                required
                autoFocus
                data-testid="first-run-claim-name-input"
              />
            </label>
            <label className="first-run-claim-label">
              <span>Pronouns (optional)</span>
              <input
                type="text"
                value={pronouns}
                onChange={(e) => setPronouns(e.target.value)}
                placeholder="e.g. she/her"
                maxLength={64}
                disabled={busy}
                data-testid="first-run-claim-pronouns-input"
              />
            </label>
            <div className="first-run-claim-actions">
              <button
                type="submit"
                className="first-run-claim-primary"
                disabled={busy || name.trim().length === 0}
                data-testid="first-run-claim-save-name-btn"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="first-run-claim-secondary"
                onClick={() => setShowNameForm(false)}
                disabled={busy}
                data-testid="first-run-claim-back-btn"
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
