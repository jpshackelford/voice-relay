/**
 * Unit tests for `resolveRelayedSenderName` — the substitution helper
 * called from the inbound-text WS handler in `index.ts` to populate
 * `RelayedTextMessage.senderName`.
 *
 * These tests pin the AC table from issue #446 (closes the #433 third-
 * bullet AC gap):
 *
 *   1. Substituted-broadcast happy path: an active-speaker override
 *      with a non-null `preferredName` overrides the device alias.
 *   2. Persisted-row contract: same path — proved structurally by the
 *      fact that `index.ts` assigns the helper's result once into the
 *      `RelayedTextMessage` literal, which is then consumed by BOTH
 *      `registry.broadcastToSession` and `store.append`. We pin that
 *      single-value contract here.
 *   3. Unclaimed-device path: no per-session override and no primary
 *      user → `utteranceSpeaker` is null → falls back to the alias.
 *   4. Engine-label-only path: `resolvedFromEngineMapping` wins but
 *      `utteranceSpeaker` is null → falls back to the alias (engine
 *      labels like `S1` are not human names).
 *   5. Speaker row with a null `preferredName`: graceful fallback so
 *      newly-created speaker rows without a recorded name don't
 *      broadcast `null` or `"null"`.
 *
 * The agent-driver `sender.senderName` path is intentionally NOT
 * routed through this helper (the agent header builder uses
 * `sender.speaker.preferredName` for the `[speaker name=…]` line and
 * keeps `sender.senderName` as the device alias for `[vr alias=…]`).
 * That contract is unchanged by this fix; a regression test pinning
 * the literal `device.displayName` assignment on that path is
 * documented at the call site in `index.ts`.
 */

import { describe, it, expect } from 'vitest';
import { resolveRelayedSenderName } from './resolve-relayed-sender-name.js';

describe('resolveRelayedSenderName (issue #446)', () => {
  // AC #1 + #2 — substituted broadcast & persisted row share the same value.
  it('substitutes the speaker preferredName when one is resolved', () => {
    const result = resolveRelayedSenderName(
      { preferredName: 'JP' },
      'Linux-bda2',
    );

    expect(result).toBe('JP');
  });

  it('returns the same value used by both broadcast and persistence', () => {
    // The single call site in `index.ts` assigns this return value to
    // `RelayedTextMessage.senderName`, then passes the SAME object to
    // both `registry.broadcastToSession(...)` and `store.append(...)`.
    // Calling the helper twice with the same inputs MUST produce the
    // same value — i.e. the helper is referentially transparent so
    // there is no risk of broadcast/persistence drift.
    const inputSpeaker = { preferredName: 'Casey' };
    const wireValue = resolveRelayedSenderName(inputSpeaker, 'Mobile-7f3a');
    const persistedValue = resolveRelayedSenderName(
      inputSpeaker,
      'Mobile-7f3a',
    );

    expect(wireValue).toBe('Casey');
    expect(persistedValue).toBe(wireValue);
  });

  // AC #3 — unclaimed device path: no override, no primary user.
  it('falls back to the device alias when no speaker is resolved (null)', () => {
    const result = resolveRelayedSenderName(null, 'Linux-bda2');

    expect(result).toBe('Linux-bda2');
  });

  it('falls back to the device alias when speaker is undefined', () => {
    // Defensive: callers should pass `null`, but TS allows `undefined`
    // and we want to be safe for the engine-label-only path where the
    // `utteranceSpeaker` variable is also `null`.
    const result = resolveRelayedSenderName(undefined, 'Mobile-7f3a');

    expect(result).toBe('Mobile-7f3a');
  });

  // AC #4 — engine-label-only path. The WS handler resolves
  // `finalSpeakerId` from `resolvedFromEngineMapping` (a `S1` → real
  // speakers.id mapping), but `utteranceSpeaker` stays null because
  // no per-session override and no primary user are set. The helper
  // never sees the engine mapping; it correctly returns the alias.
  it('returns the device alias on the engine-label-only path (utteranceSpeaker stays null)', () => {
    // Simulates: `finalSpeakerId = resolvedFromEngineMapping` wins,
    // but `utteranceSpeaker` is null. Helper input is the same as the
    // unclaimed case — engine labels never become human names here.
    const result = resolveRelayedSenderName(null, 'Kiosk-Foyer-01');

    expect(result).toBe('Kiosk-Foyer-01');
  });

  // AC #5 — speaker row with `preferredName === null` (e.g. just
  // upserted from a workspace claim but the human hasn't picked a name
  // yet). The helper MUST gracefully fall back so we don't broadcast
  // `null` or the string `"null"`.
  it('falls back to the device alias when the resolved speaker has a null preferredName', () => {
    const result = resolveRelayedSenderName(
      { preferredName: null },
      'Linux-bda2',
    );

    expect(result).toBe('Linux-bda2');
  });

  // Defensive — empty-string preferredName is treated as "name was
  // provided, just empty". We DO substitute (`??` only catches
  // null/undefined). Pinning this so a future refactor to `||` doesn't
  // silently change semantics. The speaker repository validates
  // non-empty names on write so empty strings should not reach the
  // relay path in practice, but the contract should still be explicit.
  it('substitutes an empty-string preferredName (??, not ||, semantics)', () => {
    const result = resolveRelayedSenderName(
      { preferredName: '' },
      'Linux-bda2',
    );

    expect(result).toBe('');
  });
});
