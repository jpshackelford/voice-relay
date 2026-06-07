/**
 * Tests for `useFirstRunClaim` (#433).
 *
 * Covers:
 *  - the decision matrix (`computeShouldShow` via `_internals`)
 *  - the two POST paths (`claimForUser`, `claimForName`) on the
 *    happy and error sides, including the device-token Bearer header
 *  - local dismissal flipping `shouldShow` off
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useFirstRunClaim,
  _internals,
  firstRunSkipKey,
  FIRST_RUN_SKIP_MS,
  type FirstRunClaimInputs,
} from './useFirstRunClaim';
import type { SpeakerState } from '../types';
import type { User } from '../contexts/AuthContext';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    email: null,
    ...overrides,
  } as User;
}

function makeSpeakerState(overrides: Partial<SpeakerState> = {}): SpeakerState {
  return {
    deviceClaimed: false,
    primaryUserId: null,
    activeSpeakerId: null,
    ...overrides,
  };
}

function makeInputs(
  overrides: Partial<FirstRunClaimInputs> = {}
): FirstRunClaimInputs {
  return {
    speakerState: makeSpeakerState(),
    workspaceId: 'ws-1',
    user: makeUser(),
    sessionId: 'sess-1',
    deviceId: 'dev-1',
    ...overrides,
  };
}

describe('useFirstRunClaim._internals.computeShouldShow', () => {
  it('returns false when speakerState is null', () => {
    expect(
      _internals.computeShouldShow({
        speakerState: null,
        deviceId: 'd',
        sessionId: 's',
      })
    ).toBe(false);
  });

  it('returns false when deviceId is missing', () => {
    expect(
      _internals.computeShouldShow({
        speakerState: makeSpeakerState(),
        deviceId: null,
        sessionId: 's',
      })
    ).toBe(false);
  });

  it('returns false when sessionId is missing', () => {
    expect(
      _internals.computeShouldShow({
        speakerState: makeSpeakerState(),
        deviceId: 'd',
        sessionId: null,
      })
    ).toBe(false);
  });

  it('returns false when deviceClaimed is true', () => {
    expect(
      _internals.computeShouldShow({
        speakerState: makeSpeakerState({
          deviceClaimed: true,
          primaryUserId: 'user-1',
        }),
        deviceId: 'd',
        sessionId: 's',
      })
    ).toBe(false);
  });

  it('returns false when activeSpeakerId is set', () => {
    expect(
      _internals.computeShouldShow({
        speakerState: makeSpeakerState({ activeSpeakerId: 'speaker-x' }),
        deviceId: 'd',
        sessionId: 's',
      })
    ).toBe(false);
  });

  it('returns true when everything is unclaimed and IDs are present', () => {
    expect(
      _internals.computeShouldShow({
        speakerState: makeSpeakerState(),
        deviceId: 'd',
        sessionId: 's',
      })
    ).toBe(true);
  });
});

describe('useFirstRunClaim hook behavior', () => {
  beforeEach(() => {
    // Ensure no localStorage device-token leaks from earlier tests.
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shouldShow reflects the decision matrix', () => {
    const { result, rerender } = renderHook(
      (props: FirstRunClaimInputs) => useFirstRunClaim(props),
      { initialProps: makeInputs() }
    );
    expect(result.current.shouldShow).toBe(true);

    rerender(
      makeInputs({
        speakerState: makeSpeakerState({
          deviceClaimed: true,
          primaryUserId: 'user-1',
        }),
      })
    );
    expect(result.current.shouldShow).toBe(false);
  });

  it('dismiss flips shouldShow to false locally', () => {
    const { result } = renderHook(() => useFirstRunClaim(makeInputs()));
    expect(result.current.shouldShow).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.shouldShow).toBe(false);
  });

  it('claimForUser PATCHes /api/devices/:id with primaryUserId on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );

    await act(async () => {
      await result.current.claimForUser();
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/devices/dev-1');
    expect(init?.method).toBe('PATCH');
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(init?.body as string)).toEqual({ primaryUserId: 'user-1' });
    // Resolves locally so the card hides.
    expect(result.current.shouldShow).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('claimForUser surfaces non-2xx as an error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('forbidden', { status: 403 })
    );
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );

    await act(async () => {
      await expect(result.current.claimForUser()).rejects.toThrow();
    });
    expect(result.current.error).toMatch(/Claim failed.*403/);
    // Card stays visible.
    expect(result.current.shouldShow).toBe(true);
  });

  it('claimForUser refuses when there is no signed-in user', async () => {
    const fetchFn = vi.fn();
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ user: null, fetchFn }))
    );
    await act(async () => {
      await expect(result.current.claimForUser()).rejects.toThrow();
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/Sign in is required/);
  });

  it('claimForName POSTs preferredName + Bearer token on success', async () => {
    // Seed a stored device token (the helper stores under workspace
    // key `voice_relay_device_token_<workspaceId>`).
    localStorage.setItem(
      'voice_relay_device_token_ws-1',
      JSON.stringify({
        deviceId: 'dev-1',
        deviceToken: 'token-abc',
        workspaceId: 'ws-1',
        name: 'Kiosk',
        mode: 'kiosk',
      })
    );

    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ speakerId: 'spk-7' }), { status: 201 })
    );

    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );

    await act(async () => {
      await result.current.claimForName('Jane', 'she/her');
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/devices/dev-1/sessions/sess-1/active-speaker');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-abc'
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      preferredName: 'Jane',
      pronouns: 'she/her',
    });
    expect(result.current.shouldShow).toBe(false);
  });

  it('claimForName omits pronouns when blank', async () => {
    localStorage.setItem(
      'voice_relay_device_token_ws-1',
      JSON.stringify({
        deviceId: 'dev-1',
        deviceToken: 'token-abc',
        workspaceId: 'ws-1',
        name: 'Kiosk',
        mode: 'kiosk',
      })
    );
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ speakerId: 'spk-7' }), { status: 201 })
    );
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );
    await act(async () => {
      await result.current.claimForName('Pat', '   ');
    });
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({ preferredName: 'Pat' });
  });

  it('claimForName rejects when no device token is stored', async () => {
    const fetchFn = vi.fn();
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );
    await act(async () => {
      await expect(result.current.claimForName('Jane')).rejects.toThrow();
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/device token/i);
  });

  it('claimForName rejects on blank name', async () => {
    localStorage.setItem(
      'voice_relay_device_token_ws-1',
      JSON.stringify({
        deviceId: 'dev-1',
        deviceToken: 'token-abc',
        workspaceId: 'ws-1',
        name: 'Kiosk',
        mode: 'kiosk',
      })
    );
    const fetchFn = vi.fn();
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );
    await act(async () => {
      await expect(result.current.claimForName('   ')).rejects.toThrow();
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/name/i);
  });

  it('claimForName surfaces non-2xx as an error', async () => {
    localStorage.setItem(
      'voice_relay_device_token_ws-1',
      JSON.stringify({
        deviceId: 'dev-1',
        deviceToken: 'token-abc',
        workspaceId: 'ws-1',
        name: 'Kiosk',
        mode: 'kiosk',
      })
    );
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('bad request', { status: 400 })
    );
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ fetchFn }))
    );
    await act(async () => {
      await expect(result.current.claimForName('Jane')).rejects.toThrow();
    });
    expect(result.current.error).toMatch(/Save failed.*400/);
    expect(result.current.shouldShow).toBe(true);
  });

  it('skip() writes a 7-day timestamp to localStorage and hides the card', () => {
    const before = Date.now();
    const { result } = renderHook(() => useFirstRunClaim(makeInputs()));
    expect(result.current.shouldShow).toBe(true);

    act(() => result.current.skip());

    expect(result.current.shouldShow).toBe(false);
    const raw = localStorage.getItem(firstRunSkipKey('ws-1', 'dev-1'));
    expect(raw).not.toBeNull();
    const until = Date.parse(raw!);
    // Allow a small fudge for test execution time but verify it's
    // ~7 days out (and exactly FIRST_RUN_SKIP_MS away in spec terms).
    expect(until - before).toBeGreaterThanOrEqual(FIRST_RUN_SKIP_MS - 1000);
    expect(until - before).toBeLessThanOrEqual(FIRST_RUN_SKIP_MS + 5000);
  });

  it('shouldShow is false when a future skip timestamp exists on mount', () => {
    const future = new Date(Date.now() + FIRST_RUN_SKIP_MS).toISOString();
    localStorage.setItem(firstRunSkipKey('ws-1', 'dev-1'), future);
    const { result } = renderHook(() => useFirstRunClaim(makeInputs()));
    expect(result.current.shouldShow).toBe(false);
  });

  it('shouldShow stays true when an EXPIRED skip timestamp exists', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    localStorage.setItem(firstRunSkipKey('ws-1', 'dev-1'), past);
    const { result } = renderHook(() => useFirstRunClaim(makeInputs()));
    expect(result.current.shouldShow).toBe(true);
  });

  it('skip() with no workspace/device falls back to session-only dismiss', () => {
    const { result } = renderHook(() =>
      useFirstRunClaim(makeInputs({ workspaceId: null }))
    );
    // Card is hidden anyway because workspaceId is null (no token), but
    // make sure skip() doesn't throw and still flips the in-memory flag.
    act(() => result.current.skip());
    expect(result.current.shouldShow).toBe(false);
    expect(localStorage.getItem(firstRunSkipKey('ws-1', 'dev-1'))).toBeNull();
  });
});
