/**
 * Tests for the per-turn metadata header injected onto user utterances
 * before they reach the OpenHands agent (issue #375).
 */

import { describe, test, expect } from 'vitest';
import {
  USER_HEADER_QUIET_MS,
  buildVoiceRelayHeader,
  makeVoiceRelayHeaderState,
  nextAlias,
  type VoiceRelayHeaderState,
} from './voice-relay-header.js';
import type { AgentSenderMeta } from './types.js';

function sender(
  overrides: Partial<AgentSenderMeta> & Pick<AgentSenderMeta, 'deviceId' | 'senderName' | 'saidAtUtc'>,
): AgentSenderMeta {
  return {
    timezone: 'America/Los_Angeles',
    ...overrides,
  };
}

describe('nextAlias', () => {
  test('single letters A..Z', () => {
    expect(nextAlias(0)).toBe('A');
    expect(nextAlias(1)).toBe('B');
    expect(nextAlias(25)).toBe('Z');
  });

  test('two-letter overflow AA..AZ, BA..', () => {
    expect(nextAlias(26)).toBe('AA');
    expect(nextAlias(27)).toBe('AB');
    expect(nextAlias(51)).toBe('AZ');
    expect(nextAlias(52)).toBe('BA');
  });

  test('three-letter overflow past ZZ', () => {
    // 26 + 26*26 = 702 → 'AAA'
    expect(nextAlias(702)).toBe('AAA');
  });

  test('rejects negative / non-integer inputs', () => {
    expect(() => nextAlias(-1)).toThrow(RangeError);
    expect(() => nextAlias(1.5)).toThrow(RangeError);
  });
});

describe('buildVoiceRelayHeader', () => {
  const T0 = '2026-06-01T17:23:45Z';
  const T0_MS = Date.UTC(2026, 5, 1, 17, 23, 45);

  test("first turn from a device → announcement + fully-qualified anchor (no alias, single device)", () => {
    const state = makeVoiceRelayHeaderState();
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: T0 }),
      T0_MS,
    );
    expect(header).toBe(
      '[vr A=Kitchen iPad tz=America/Los_Angeles]\n[t=2026-06-01T17:23Z]',
    );
    expect(state.deviceAliases.get('d1')).toBe('A');
    expect(state.lastUserAlias).toBe('A');
    expect(state.lastUserAtMs).toBe(T0_MS);
  });

  test('first turn without timezone → announcement without `tz=`', () => {
    const state = makeVoiceRelayHeaderState();
    const header = buildVoiceRelayHeader(
      state,
      { deviceId: 'd1', senderName: 'Plain Phone', saidAtUtc: T0 },
      T0_MS,
    );
    expect(header).toBe('[vr A=Plain Phone]\n[t=2026-06-01T17:23Z]');
  });

  test('same device, < quiet period → no header', () => {
    const state = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: T0 }),
      T0_MS,
    );
    // 10 s later, well under the quiet period
    const t1 = T0_MS + 10_000;
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: '2026-06-01T17:23:55Z' }),
      t1,
    );
    expect(header).toBe('');
    expect(state.lastUserAtMs).toBe(t1);
  });

  test('same device, ≥ quiet period → short HH:MMZ anchor only', () => {
    const state = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: T0 }),
      T0_MS,
    );
    const t1 = T0_MS + USER_HEADER_QUIET_MS; // exactly at the boundary
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: '2026-06-01T17:30:00Z' }),
      t1,
    );
    expect(header).toBe('[t=17:30Z]');
  });

  test('quiet-period boundary: gap = QUIET-1 → no header, gap = QUIET → anchor', () => {
    const stateA = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      stateA,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: T0 }),
      T0_MS,
    );
    expect(
      buildVoiceRelayHeader(
        stateA,
        sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: '2026-06-01T17:26:14Z' }),
        T0_MS + USER_HEADER_QUIET_MS - 1,
      ),
    ).toBe('');

    const stateB = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      stateB,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: T0 }),
      T0_MS,
    );
    expect(
      buildVoiceRelayHeader(
        stateB,
        sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: '2026-06-01T17:26:15Z' }),
        T0_MS + USER_HEADER_QUIET_MS,
      ),
    ).toBe('[t=17:26Z]');
  });

  test('second device joins → announcement, alias allocation, combined alias+anchor', () => {
    const state = makeVoiceRelayHeaderState();
    // First device speaks twice.
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: T0 }),
      T0_MS,
    );
    // Second device joins 30 s later, still within the quiet period.
    const t1 = T0_MS + 30_000;
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd2', senderName: 'Living Room TV', saidAtUtc: '2026-06-01T17:24:15Z' }),
      t1,
    );
    expect(header).toBe(
      '[vr B=Living Room TV tz=America/Los_Angeles]\n[B t=2026-06-01T17:24Z]',
    );
    expect(state.deviceAliases.get('d2')).toBe('B');
  });

  test('switch back to a prior device within quiet period → alias only', () => {
    const state = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: T0 }),
      T0_MS,
    );
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd2', senderName: 'B', saidAtUtc: '2026-06-01T17:24:00Z' }),
      T0_MS + 15_000,
    );
    // Back to A, 30s later, well under the quiet period.
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: '2026-06-01T17:24:30Z' }),
      T0_MS + 45_000,
    );
    expect(header).toBe('[A]');
  });

  test('switch back to a prior device after quiet period → alias + HH:MMZ', () => {
    const state = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: T0 }),
      T0_MS,
    );
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd2', senderName: 'B', saidAtUtc: '2026-06-01T17:24:00Z' }),
      T0_MS + 30_000,
    );
    const t2 = T0_MS + 30_000 + USER_HEADER_QUIET_MS + 5_000;
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: '2026-06-01T17:27:00Z' }),
      t2,
    );
    expect(header).toBe('[A t=17:27Z]');
  });

  test('alias overflow past Z → AA, AB, …', () => {
    const state = makeVoiceRelayHeaderState();
    // Pre-seed 26 devices so the 27th allocation hits the overflow.
    for (let i = 0; i < 26; i++) {
      state.deviceAliases.set(`d${i}`, nextAlias(i));
    }
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd26', senderName: 'Extra', saidAtUtc: T0 }),
      T0_MS,
    );
    expect(state.deviceAliases.get('d26')).toBe('AA');
    expect(header.startsWith('[vr AA=Extra ')).toBe(true);
  });

  test('sanitizes device names containing `]` and newlines', () => {
    const state = makeVoiceRelayHeaderState();
    const header = buildVoiceRelayHeader(
      state,
      sender({
        deviceId: 'd1',
        senderName: 'Bad]name\nwith\rstuff',
        saidAtUtc: T0,
      }),
      T0_MS,
    );
    expect(header).toMatch(/^\[vr A=Bad name with stuff tz=America\/Los_Angeles\]/);
    expect(header.split('\n')).toHaveLength(2);
  });

  test('substitutes (unnamed) when the device name is empty after sanitization', () => {
    const state = makeVoiceRelayHeaderState();
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: '   ]]]   ', saidAtUtc: T0 }),
      T0_MS,
    );
    expect(header.startsWith('[vr A=(unnamed) tz=')).toBe(true);
  });

  test('alias is allocated per deviceId, not per name (rename does not reset)', () => {
    const state = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'OldName', saidAtUtc: T0 }),
      T0_MS,
    );
    // Same device id, new display name — should not re-announce.
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'NewName', saidAtUtc: '2026-06-01T17:23:55Z' }),
      T0_MS + 10_000,
    );
    expect(header).toBe('');
  });

  test('two-device announcement always combines alias with anchor on first turn', () => {
    const state = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: T0 }),
      T0_MS,
    );
    // d2 first turn, well within quiet period — but it's first-from-device,
    // so anchor is required regardless of gap.
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd2', senderName: 'B', saidAtUtc: '2026-06-01T17:23:50Z' }),
      T0_MS + 5_000,
    );
    expect(header).toBe(
      '[vr B=B tz=America/Los_Angeles]\n[B t=2026-06-01T17:23Z]',
    );
  });

  test('single-device first turn omits the alias from the anchor line', () => {
    // Sanity: even though `isFirstFromDevice` is true, the alias is only
    // added when the conversation is *multi-device* (size > 1 after this
    // device is bound). With one device, we don't bother with `[A t=…]`.
    const state = makeVoiceRelayHeaderState();
    const header = buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'only', senderName: 'Solo', saidAtUtc: T0 }),
      T0_MS,
    );
    expect(header).toBe('[vr A=Solo tz=America/Los_Angeles]\n[t=2026-06-01T17:23Z]');
  });

  test('state advances `lastUserAtMs` even when no header is emitted', () => {
    const state: VoiceRelayHeaderState = makeVoiceRelayHeaderState();
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: T0 }),
      T0_MS,
    );
    const t1 = T0_MS + 5_000;
    buildVoiceRelayHeader(
      state,
      sender({ deviceId: 'd1', senderName: 'A', saidAtUtc: '2026-06-01T17:23:50Z' }),
      t1,
    );
    expect(state.lastUserAtMs).toBe(t1);
  });

  // ========================================================================
  // Engine-speaker label fallback (#386 / #411)
  //
  // When a hosted-STT engine attaches a per-session label (e.g. `S1`) to
  // an utterance and no real `speakers.id` is bound yet, the header
  // builder must surface that label so the agent can attribute the turn
  // to a stable bucket. Once a `speaker` becomes available, it wins and
  // the engine label is silently dropped.
  // ========================================================================
  describe('engine-speaker label fallback (#386 / #411)', () => {
    test('emits `[speaker engine=...]` when only the engine label is present', () => {
      const state = makeVoiceRelayHeaderState();
      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'Kitchen iPad',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S1',
        }),
        T0_MS,
      );
      expect(header).toContain('[speaker engine=S1]');
      // Sanity: the announcement + anchor still surround it.
      expect(header.split('\n')).toEqual([
        '[vr A=Kitchen iPad tz=America/Los_Angeles]',
        '[speaker engine=S1]',
        '[t=2026-06-01T17:23Z]',
      ]);
      expect(state.deviceEngineSpeakerLabel.get('d1')).toBe('S1');
    });

    test('suppresses repeat `[speaker engine=...]` on consecutive same-label turns from same device', () => {
      const state = makeVoiceRelayHeaderState();
      buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'A',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S1',
        }),
        T0_MS,
      );
      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'A',
          saidAtUtc: '2026-06-01T17:23:55Z',
          engineSpeakerLabel: 'S1',
        }),
        T0_MS + 10_000,
      );
      // Same speaker, same engine label, within quiet period → nothing.
      expect(header).toBe('');
      expect(header).not.toContain('[speaker');
    });

    test('emits a new `[speaker engine=...]` when the engine label changes on the same device', () => {
      const state = makeVoiceRelayHeaderState();
      buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'A',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S1',
        }),
        T0_MS,
      );
      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'A',
          saidAtUtc: '2026-06-01T17:23:55Z',
          engineSpeakerLabel: 'S2',
        }),
        T0_MS + 10_000,
      );
      expect(header).toBe('[speaker engine=S2]');
      expect(state.deviceEngineSpeakerLabel.get('d1')).toBe('S2');
    });

    test('resolved `speaker` wins over `engineSpeakerLabel` when both are present', () => {
      const state = makeVoiceRelayHeaderState();
      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'Kitchen iPad',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S1',
          speaker: { id: 'sp-1', preferredName: 'Sam', pronouns: 'they/them' },
        }),
        T0_MS,
      );
      // Only the resolved-speaker line should be in the output; the
      // engine label is fully ignored.
      expect(header).toContain('[speaker id=sp-1 name=Sam pronouns=they/them]');
      expect(header).not.toContain('engine=S1');
      // State: resolved-speaker map is populated; engine map is *not*
      // populated because the resolved path takes over completely.
      expect(state.deviceSpeakerId.get('d1')).toBe('sp-1');
      expect(state.deviceEngineSpeakerLabel.get('d1')).toBeUndefined();
    });

    test('switching from engine-only to a resolved speaker emits the speaker line and clears engine state', () => {
      const state = makeVoiceRelayHeaderState();
      buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'Kitchen iPad',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S1',
        }),
        T0_MS,
      );
      expect(state.deviceEngineSpeakerLabel.get('d1')).toBe('S1');

      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'Kitchen iPad',
          saidAtUtc: '2026-06-01T17:23:55Z',
          engineSpeakerLabel: 'S1',
          speaker: { id: 'sp-1', preferredName: 'Sam', pronouns: null },
        }),
        T0_MS + 10_000,
      );
      expect(header).toBe('[speaker id=sp-1 name=Sam]');
      expect(state.deviceSpeakerId.get('d1')).toBe('sp-1');
      // Engine cache for this device cleared so a later unclaim that
      // loses `speaker` can re-emit the engine fallback cleanly.
      expect(state.deviceEngineSpeakerLabel.get('d1')).toBeUndefined();
    });

    test('losing the resolved speaker but still carrying the engine label re-emits the engine line', () => {
      const state = makeVoiceRelayHeaderState();
      buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'Kitchen iPad',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S1',
          speaker: { id: 'sp-1', preferredName: 'Sam', pronouns: null },
        }),
        T0_MS,
      );
      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'Kitchen iPad',
          saidAtUtc: '2026-06-01T17:23:55Z',
          engineSpeakerLabel: 'S1',
        }),
        T0_MS + 10_000,
      );
      // First: the speaker disappears → `id=unknown`. Second: engine
      // label re-asserts because the engine cache was cleared.
      expect(header.split('\n')).toEqual([
        '[speaker id=unknown]',
        '[speaker engine=S1]',
      ]);
      expect(state.deviceSpeakerId.get('d1')).toBeUndefined();
      expect(state.deviceEngineSpeakerLabel.get('d1')).toBe('S1');
    });

    test('engine label is sanitized (control chars / `]` stripped)', () => {
      const state = makeVoiceRelayHeaderState();
      const header = buildVoiceRelayHeader(
        state,
        sender({
          deviceId: 'd1',
          senderName: 'A',
          saidAtUtc: T0,
          engineSpeakerLabel: 'S]1\n!',
        }),
        T0_MS,
      );
      expect(header).toContain('[speaker engine=S 1 !]');
    });

    test('no `engineSpeakerLabel` → no `[speaker ...]` line (Web Speech path unchanged)', () => {
      const state = makeVoiceRelayHeaderState();
      const header = buildVoiceRelayHeader(
        state,
        sender({ deviceId: 'd1', senderName: 'Kitchen iPad', saidAtUtc: T0 }),
        T0_MS,
      );
      // Regression guard: utterances without an engine label or
      // resolved speaker must produce only the announcement +
      // time anchor.
      expect(header).toBe(
        '[vr A=Kitchen iPad tz=America/Los_Angeles]\n[t=2026-06-01T17:23Z]',
      );
      expect(header).not.toContain('[speaker');
    });
  });
});
