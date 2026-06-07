/**
 * Tests for the post-OAuth-return device-claim chain (#439).
 *
 * Covers the four AC paths laid out on the issue:
 *   1. success path — flag present + auth transition → single PATCH, onClaimed fires.
 *   2. PATCH-failed path — non-2xx response logged via console.warn, no throw,
 *      flag still consumed (no infinite retry loop).
 *   3. no-flag path — no PATCH fires even with isAuthenticated=true.
 *   4. double-render idempotency — multiple re-renders/StrictMode → 1 PATCH.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFirstRunClaim } from './useFirstRunClaim';
import {
  setPendingClaim,
  hasPendingClaim,
  pendingClaimKey,
} from '../components/ClaimSpeakerCard';

const WS = 'ws-1';
const DEV = 'dev-abc';

function ok(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: DEV, workspaceId: WS }),
  } as unknown as Response;
}

function notOk(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'nope' }),
  } as unknown as Response;
}

describe('useFirstRunClaim (#439)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let ensureValidTokenMock: ReturnType<typeof vi.fn>;
  let ensureValidToken: () => Promise<boolean>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ensureValidTokenMock = vi.fn().mockResolvedValue(true);
    ensureValidToken = ensureValidTokenMock as unknown as () => Promise<boolean>;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
    window.sessionStorage.clear();
  });

  it('does NOT PATCH when not authenticated even if flag is set', async () => {
    setPendingClaim(WS, DEV);

    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: false,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
      })
    );

    // Wait a tick to make sure no async effect sneaks in.
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    // Flag is preserved for the eventual auth completion.
    expect(hasPendingClaim(WS, DEV)).toBe(true);
  });

  it('does NOT PATCH when authenticated but no flag is set', async () => {
    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
      })
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureValidTokenMock).not.toHaveBeenCalled();
  });

  it('does NOT PATCH while deviceId or workspaceId is still missing', async () => {
    setPendingClaim(WS, DEV);

    const { rerender } = renderHook(
      ({ deviceId, workspaceId }: { deviceId: string | null; workspaceId: string | null }) =>
        useFirstRunClaim({
          isAuthenticated: true,
          deviceId,
          workspaceId,
          ensureValidToken,
        }),
      {
        initialProps: { deviceId: null, workspaceId: null } as {
          deviceId: string | null;
          workspaceId: string | null;
        },
      }
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();

    // Once both resolve, the chain fires.
    rerender({ deviceId: DEV, workspaceId: WS });
    fetchMock.mockResolvedValueOnce(ok());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('success path: clears flag, awaits ensureValidToken, fires one PATCH, runs onClaimed', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    setPendingClaim(WS, DEV);
    const onClaimed = vi.fn();

    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
        onClaimed,
      })
    );

    await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));

    expect(ensureValidTokenMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/devices/${DEV}`);
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).body).toBe('{}');
    // Flag is gone immediately after the call started.
    expect(hasPendingClaim(WS, DEV)).toBe(false);
  });

  it('non-2xx PATCH: logs warn, does NOT call onClaimed, does NOT throw, flag stays consumed', async () => {
    fetchMock.mockResolvedValueOnce(notOk(403));
    setPendingClaim(WS, DEV);
    const onClaimed = vi.fn();

    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
        onClaimed,
      })
    );

    await waitFor(() => expect(warnSpy).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onClaimed).not.toHaveBeenCalled();
    expect(hasPendingClaim(WS, DEV)).toBe(false);
  });

  it('network error: logs warn, does NOT throw, flag stays consumed (no retry loop)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network is down'));
    setPendingClaim(WS, DEV);
    const onClaimed = vi.fn();

    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
        onClaimed,
      })
    );

    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onClaimed).not.toHaveBeenCalled();
    expect(hasPendingClaim(WS, DEV)).toBe(false);
  });

  it('idempotency: re-render with the same triggers fires exactly one PATCH', async () => {
    fetchMock.mockResolvedValue(ok());
    setPendingClaim(WS, DEV);

    const { rerender } = renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
      })
    );
    rerender();
    rerender();
    rerender();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Sanity check: still 1 PATCH after a longer settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('idempotency: a refresh-equivalent remount with no flag does not re-fire', async () => {
    // First run consumes the flag.
    fetchMock.mockResolvedValueOnce(ok());
    setPendingClaim(WS, DEV);
    const first = renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
      })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();

    // Simulate a page refresh: new hook instance, no flag, still authenticated.
    expect(hasPendingClaim(WS, DEV)).toBe(false);
    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
      })
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1
  });

  it('honors apiBase override (tests / non-default host)', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    setPendingClaim(WS, DEV);

    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
        apiBase: 'https://example.test',
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://example.test/api/devices/${DEV}`);
  });

  it('uses the (workspaceId, deviceId)-scoped flag key', async () => {
    // Set a flag for a DIFFERENT device — must not trigger ours.
    setPendingClaim(WS, 'other-dev');

    renderHook(() =>
      useFirstRunClaim({
        isAuthenticated: true,
        deviceId: DEV,
        workspaceId: WS,
        ensureValidToken,
      })
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).not.toHaveBeenCalled();
    // Other-device flag is left alone.
    expect(
      window.sessionStorage.getItem(pendingClaimKey(WS, 'other-dev'))
    ).toBe('1');
  });
});
