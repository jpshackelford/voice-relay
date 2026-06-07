/**
 * Tests for the first-run "claim this device" prompt (#433).
 *
 * Coverage of the three AC action paths plus the form / error / skip
 * behaviour. We mock `fetch` directly rather than spinning up a real
 * server — the server-side endpoint is exercised end-to-end by the
 * device-router vitest suite.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ClaimSpeakerCard,
  consumePendingClaim,
  getSkipUntil,
  hasPendingClaim,
  pendingClaimKey,
  setPendingClaim,
  setSkipUntil,
  skipKey,
  SKIP_TTL_MS,
} from './ClaimSpeakerCard';

const WORKSPACE_ID = 'ws-1';
const DEVICE_ID = 'dev-1';
const SESSION_ID = 'sess-1';
const TOKEN = 'tok-abc';

function renderCard(
  overrides: Partial<React.ComponentProps<typeof ClaimSpeakerCard>> = {}
) {
  const onClaimed = vi.fn();
  const onDismiss = vi.fn();
  const onSkip = vi.fn();
  const onSignIn = vi.fn();
  const utils = render(
    <ClaimSpeakerCard
      workspaceId={WORKSPACE_ID}
      deviceId={DEVICE_ID}
      sessionId={SESSION_ID}
      deviceToken={TOKEN}
      onClaimed={onClaimed}
      onDismiss={onDismiss}
      onSkip={onSkip}
      onSignIn={onSignIn}
      {...overrides}
    />
  );
  return { ...utils, onClaimed, onDismiss, onSkip, onSignIn };
}

describe('ClaimSpeakerCard (#433)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('renders title, hint, and the three action buttons by default', () => {
    renderCard();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/who.?s using this device/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /workspace member/i })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /remember a name/i })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /shared device/i })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
  });

  it('renders aria-modal=false so chat/voice behind it stays usable', () => {
    renderCard();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
  });

  // AC: GitHub-auth action.
  it('"workspace member" button fires onSignIn without calling fetch', () => {
    const fetchMock = vi.mocked(fetch);
    const { onSignIn } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /workspace member/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Issue #439 AC: pending-claim flag must be written BEFORE onSignIn fires
  // so the post-OAuth-return chain can find it after the redirect.
  it('"workspace member" button sets the pending-claim flag before onSignIn', () => {
    let flagAtSignIn: string | null = null;
    const onSignIn = vi.fn(() => {
      // Capture sessionStorage state at the moment onSignIn fires.
      flagAtSignIn = window.sessionStorage.getItem(
        pendingClaimKey(WORKSPACE_ID, DEVICE_ID)
      );
    });
    renderCard({ onSignIn });
    fireEvent.click(screen.getByRole('button', { name: /workspace member/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(flagAtSignIn).toBe('1');
    expect(hasPendingClaim(WORKSPACE_ID, DEVICE_ID)).toBe(true);
  });

  // AC: Skip action — 7-day localStorage TTL keyed by workspace+device.
  it('"shared device" button writes a 7-day TTL skip entry and fires onSkip', () => {
    const { onSkip } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /shared device/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    const raw = window.localStorage.getItem(skipKey(WORKSPACE_ID, DEVICE_ID));
    expect(raw).not.toBeNull();
    const at = Date.parse(raw!);
    // The recorded TTL should be ~7d (allow 5s scheduler slop).
    const delta = at - Date.now();
    expect(delta).toBeGreaterThan(SKIP_TTL_MS - 5_000);
    expect(delta).toBeLessThanOrEqual(SKIP_TTL_MS);
  });

  it('× close button fires onDismiss without writing the skip TTL', () => {
    const { onDismiss } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(
      window.localStorage.getItem(skipKey(WORKSPACE_ID, DEVICE_ID))
    ).toBeNull();
  });

  // AC: Name-only action.
  it('"remember a name" reveals a form whose Save is disabled until a name is entered', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /remember a name/i }));

    const saveBtn = screen.getByRole('button', {
      name: /save/i,
    }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText(/e\.g\. JP/i);
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(saveBtn.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: 'JP' } });
    expect(saveBtn.disabled).toBe(false);
  });

  it('POSTs preferredName + pronouns to the correct URL with Bearer token', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ speakerId: 'sp-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { onClaimed } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /remember a name/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'JP' },
    });
    fireEvent.change(screen.getByPlaceholderText(/she\/her/i), {
      target: { value: 'he/him' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith('sp-1'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `/api/devices/${DEVICE_ID}/sessions/${SESSION_ID}/active-speaker`
    );
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init!.body as string)).toEqual({
      preferredName: 'JP',
      pronouns: 'he/him',
    });
  });

  it('omits pronouns from the payload when not entered', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ speakerId: 'sp-2' }), { status: 201 })
    );

    const { onClaimed } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /remember a name/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'Anna' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith('sp-2'));

    const body = JSON.parse(
      fetchMock.mock.calls[0]![1]!.body as string
    ) as Record<string, unknown>;
    expect(body).toEqual({ preferredName: 'Anna' });
  });

  it('surfaces the server error message and does NOT call onClaimed on 400', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'preferredName cannot be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { onClaimed } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /remember a name/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'JP' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('preferredName cannot be empty');
    });
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('shows a generic error and does NOT call onClaimed when fetch rejects', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('boom'));

    const { onClaimed } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /remember a name/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'JP' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('boom');
    });
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('honours the apiBase prop when building the POST URL', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ speakerId: 'sp-3' }), { status: 201 })
    );

    renderCard({ apiBase: 'https://vr.example.com' });
    fireEvent.click(screen.getByRole('button', { name: /remember a name/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'JP' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://vr.example.com/api/devices/${DEVICE_ID}/sessions/${SESSION_ID}/active-speaker`
    );
  });
});

describe('getSkipUntil / setSkipUntil (#433)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when no skip exists', () => {
    expect(getSkipUntil(WORKSPACE_ID, DEVICE_ID)).toBeNull();
  });

  it('round-trips a TTL through localStorage', () => {
    const ok = setSkipUntil(WORKSPACE_ID, DEVICE_ID);
    expect(ok).toBe(true);
    const until = getSkipUntil(WORKSPACE_ID, DEVICE_ID);
    expect(until).not.toBeNull();
    expect(until!.getTime()).toBeGreaterThan(Date.now());
  });

  it('treats expired entries as "no skip"', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    window.localStorage.setItem(skipKey(WORKSPACE_ID, DEVICE_ID), past);
    expect(getSkipUntil(WORKSPACE_ID, DEVICE_ID)).toBeNull();
  });

  it('treats corrupt entries as "no skip"', () => {
    window.localStorage.setItem(
      skipKey(WORKSPACE_ID, DEVICE_ID),
      'not-a-date'
    );
    expect(getSkipUntil(WORKSPACE_ID, DEVICE_ID)).toBeNull();
  });

  it('scopes the key by workspaceId AND deviceId', () => {
    setSkipUntil(WORKSPACE_ID, DEVICE_ID);
    expect(getSkipUntil(WORKSPACE_ID, DEVICE_ID)).not.toBeNull();
    expect(getSkipUntil('other-ws', DEVICE_ID)).toBeNull();
    expect(getSkipUntil(WORKSPACE_ID, 'other-dev')).toBeNull();
  });
});

// Issue #439: pending-claim helpers — sessionStorage-backed, scoped to
// (workspaceId, deviceId), survive the OAuth roundtrip in the same tab,
// die on tab close.
describe('pending-claim helpers (#439)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('round-trips through sessionStorage', () => {
    expect(hasPendingClaim(WORKSPACE_ID, DEVICE_ID)).toBe(false);
    expect(setPendingClaim(WORKSPACE_ID, DEVICE_ID)).toBe(true);
    expect(hasPendingClaim(WORKSPACE_ID, DEVICE_ID)).toBe(true);
    consumePendingClaim(WORKSPACE_ID, DEVICE_ID);
    expect(hasPendingClaim(WORKSPACE_ID, DEVICE_ID)).toBe(false);
  });

  it('scopes the key by workspaceId AND deviceId', () => {
    setPendingClaim(WORKSPACE_ID, DEVICE_ID);
    expect(hasPendingClaim(WORKSPACE_ID, DEVICE_ID)).toBe(true);
    expect(hasPendingClaim('other-ws', DEVICE_ID)).toBe(false);
    expect(hasPendingClaim(WORKSPACE_ID, 'other-dev')).toBe(false);
  });

  it('uses sessionStorage (not localStorage) so it dies on tab close', () => {
    setPendingClaim(WORKSPACE_ID, DEVICE_ID);
    expect(
      window.sessionStorage.getItem(pendingClaimKey(WORKSPACE_ID, DEVICE_ID))
    ).toBe('1');
    expect(
      window.localStorage.getItem(pendingClaimKey(WORKSPACE_ID, DEVICE_ID))
    ).toBeNull();
  });

  it('consume is idempotent (safe to call when no flag set)', () => {
    expect(() =>
      consumePendingClaim(WORKSPACE_ID, DEVICE_ID)
    ).not.toThrow();
  });
});
