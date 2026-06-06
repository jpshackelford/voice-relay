/**
 * Token-efficient per-turn metadata header injected onto user utterances
 * forwarded to the OpenHands agent (issue #375).
 *
 * The header tells the agent two things on each user turn:
 *
 *   1. *Who* is speaking — a stable short alias (`A`, `B`, …) bound the
 *      first time a device speaks in a conversation, along with the
 *      speaker's display name and IANA timezone for that announcement
 *      only.
 *   2. *When* they spoke — a UTC timestamp, fully-qualified on a device's
 *      first turn and re-anchored after a quiet period; otherwise omitted
 *      so the per-turn cost is `0` tokens for typical chatty
 *      single-device runs.
 *
 * The wire format and rationale are documented in the issue body — see
 * the "Header grammar" and "Behavior rules" sections. The agent-side
 * interpretation lives in `server/prompts/system-prompt.md` § Message
 * format.
 *
 * The state used by this module is owned by the `AISession`. Resetting
 * happens naturally — a new `AISession` (fresh `getOrCreateForSession` or
 * `attachExistingForSession` on a *different* `conversationId`) starts
 * with empty aliases and `null` last-speaker / last-time. Rebind onto
 * the same conversation preserves the state.
 */

import type { AgentSenderMeta } from './types.js';

/**
 * How long a user turn can be silent before the next turn re-anchors the
 * agent's notion of "now" with a fresh `[t=…]` header.
 *
 * Below this gap, successive turns are part of the same conversational
 * beat and emit no time anchor; above it the agent benefits from an
 * explicit timestamp.
 *
 * Override at process start via the `OH_USER_HEADER_QUIET_MS`
 * environment variable. Invalid values fall back to the default.
 */
export const USER_HEADER_QUIET_MS = (() => {
  const raw = process.env.OH_USER_HEADER_QUIET_MS;
  if (!raw) return 150_000; // 2 min 30 s
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 150_000;
})();

/**
 * Per-conversation header state carried on the `AISession`. Reset
 * implicitly whenever a new `AISession` is constructed (which is what
 * happens on `endSessionAI` + re-bind, `restartSession`, or attach onto
 * a different `conversationId`).
 */
export interface VoiceRelayHeaderState {
  /** deviceId → conversation-scoped alias (`A`, `B`, …, `AA`, `AB`, …). */
  deviceAliases: Map<string, string>;
  /** Alias of the most recent user-turn speaker, or `null` before the first turn. */
  lastUserAlias: string | null;
  /** `Date.now()` of the most recent user turn, or `null` before the first turn. */
  lastUserAtMs: number | null;
  /**
   * deviceId → last announced speaker id (#383). Used to suppress
   * repeated `[speaker ...]` headers when the same human keeps
   * talking, and to surface changes promptly when speakers swap on
   * a borrowed device.
   */
  deviceSpeakerId: Map<string, string>;
  /**
   * deviceId → last announced hosted-STT engine label (#386 / #411),
   * e.g. `'S1'`. Used in the same suppress-when-unchanged spirit as
   * `deviceSpeakerId`, but for the engine-label fallback path that
   * fires when no real `speakers.id` has been linked yet. Cleared on
   * the device entry when a real `speaker` is resolved.
   */
  deviceEngineSpeakerLabel: Map<string, string>;
}

/** Construct a fresh header state. Call this when constructing an `AISession`. */
export function makeVoiceRelayHeaderState(): VoiceRelayHeaderState {
  return {
    deviceAliases: new Map(),
    lastUserAlias: null,
    lastUserAtMs: null,
    deviceSpeakerId: new Map(),
    deviceEngineSpeakerLabel: new Map(),
  };
}

/**
 * Allocate the next spreadsheet-style alphabetic alias.
 *
 *   0 → A, 1 → B, …, 25 → Z, 26 → AA, 27 → AB, …
 *
 * Mirrors the column-naming scheme used by spreadsheets, which the agent
 * is already familiar with from its training.
 */
export function nextAlias(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`alias index must be a non-negative integer, got ${n}`);
  }
  let out = '';
  let i = n;
  while (true) {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
    if (i < 0) break;
  }
  return out;
}

/**
 * Build the metadata header for a single user turn, and (side-effect)
 * advance the header state on `state` so the next call decides correctly.
 *
 * Returns an empty string when no header is required — the caller MUST
 * NOT prepend a stray newline in that case.
 *
 * The header consists of zero, one, or two lines, joined by `\n`:
 *
 * - First turn from a new device emits a `[vr <alias>=<name> tz=<IANA>]`
 *   announcement followed by a fully-qualified `[t=YYYY-MM-DDTHH:MMZ]`
 *   anchor (combined with the alias if the session is multi-device).
 * - Subsequent turns within `USER_HEADER_QUIET_MS` from the same speaker
 *   emit nothing.
 * - Subsequent turns within the quiet period from a different speaker
 *   emit just `[<alias>]`.
 * - Turns after the quiet period emit `[t=HH:MMZ]`, combined with the
 *   alias when the speaker also changed.
 *
 * @param state - Per-conversation header state, mutated in place.
 * @param sender - Identity + UTC timestamp of the current speaker.
 * @param nowMs - Wall-clock used for the quiet-period gap calculation.
 *                Defaults to `Date.now()` but is overridable for tests.
 */
export function buildVoiceRelayHeader(
  state: VoiceRelayHeaderState,
  sender: AgentSenderMeta,
  nowMs: number = Date.now(),
): string {
  let alias = state.deviceAliases.get(sender.deviceId);
  const isFirstFromDevice = !alias;
  if (!alias) {
    alias = nextAlias(state.deviceAliases.size);
    state.deviceAliases.set(sender.deviceId, alias);
  }

  const isMultiDevice = state.deviceAliases.size > 1;
  const sameSpeaker = state.lastUserAlias === alias;
  const gap =
    state.lastUserAtMs == null ? Infinity : nowMs - state.lastUserAtMs;
  const needTime = isFirstFromDevice || gap >= USER_HEADER_QUIET_MS;
  // After the first device's first turn, isMultiDevice is still false
  // (size == 1), so the alias is correctly omitted. When the second
  // device first speaks, size becomes 2 and the announcement carries
  // both the speaker name and the alias.
  const needAlias = isMultiDevice && !sameSpeaker;

  const lines: string[] = [];

  if (isFirstFromDevice) {
    // Sanitize the device name: strip control chars and `]` so it can't
    // close the bracket early. Newlines are stripped too — the header
    // must remain a small, parseable block separable from message text.
    const safeName = sanitizeDeviceName(sender.senderName);
    const tz = sender.timezone ? ` tz=${sender.timezone}` : '';
    lines.push(`[vr ${alias}=${safeName}${tz}]`);
  }

  // Speaker identity (#383, #386, #411). Emit when resolved speaker
  // changes (independent of device changes for borrowed-device flows).
  // When unresolved, fall back to engine label if available.
  const lastSpeakerForDevice = state.deviceSpeakerId.get(sender.deviceId);
  const lastEngineLabelForDevice = state.deviceEngineSpeakerLabel.get(
    sender.deviceId,
  );
  if (
    sender.speaker &&
    sender.speaker.id !== lastSpeakerForDevice
  ) {
    const speakerBits: string[] = [`id=${sender.speaker.id}`];
    if (sender.speaker.preferredName) {
      speakerBits.push(`name=${sanitizeDeviceName(sender.speaker.preferredName)}`);
    }
    if (sender.speaker.pronouns) {
      speakerBits.push(`pronouns=${sanitizeDeviceName(sender.speaker.pronouns)}`);
    }
    lines.push(`[speaker ${speakerBits.join(' ')}]`);
    state.deviceSpeakerId.set(sender.deviceId, sender.speaker.id);
    // Real speaker just won — drop any cached engine-label state for
    // this device so a later unclaim that loses `speaker` can re-emit
    // the engine fallback cleanly.
    state.deviceEngineSpeakerLabel.delete(sender.deviceId);
  } else if (!sender.speaker && lastSpeakerForDevice !== undefined) {
    // Speaker just became unknown again (device unclaimed, override
    // cleared, etc). Announce so the agent stops attributing to the
    // last speaker. If an engine label is also present we still
    // announce `id=unknown` first; the engine line below picks up the
    // new bucket on the next divergence.
    lines.push(`[speaker id=unknown]`);
    state.deviceSpeakerId.delete(sender.deviceId);
    state.deviceEngineSpeakerLabel.delete(sender.deviceId);
  }

  // Sanitize engine label (user-controlled input, like display names).
  if (
    !sender.speaker &&
    sender.engineSpeakerLabel &&
    sender.engineSpeakerLabel !== lastEngineLabelForDevice
  ) {
    const safeLabel = sanitizeDeviceName(sender.engineSpeakerLabel);
    lines.push(`[speaker engine=${safeLabel}]`);
    state.deviceEngineSpeakerLabel.set(
      sender.deviceId,
      sender.engineSpeakerLabel,
    );
  }

  if (needTime || needAlias) {
    const bits: string[] = [];
    if (needAlias) bits.push(alias);
    if (needTime) {
      const t = sender.saidAtUtc;
      // First turn from a device → fully-qualified date+time anchor.
      // Otherwise just HH:MMZ; the agent resolves it under monotonic
      // forward time relative to the most recent fully-qualified anchor
      // for that speaker (see system prompt).
      bits.push(
        isFirstFromDevice
          ? `t=${t.slice(0, 16)}Z` // YYYY-MM-DDTHH:MMZ
          : `t=${t.slice(11, 16)}Z`, // HH:MMZ
      );
    }
    lines.push(`[${bits.join(' ')}]`);
  }

  state.lastUserAlias = alias;
  state.lastUserAtMs = nowMs;

  return lines.join('\n');
}

/**
 * Strip characters that would break header parsing.
 *
 * The header grammar is line-oriented with `[`...`]` delimiters; a
 * stray `]` would close the bracket early, and embedded newlines would
 * confuse the agent. Control chars are stripped for hygiene. The
 * resulting string is trimmed; if empty, we substitute the literal
 * `(unnamed)` so the announcement is still well-formed.
 */
function sanitizeDeviceName(raw: string): string {
  // eslint-disable-next-line no-control-regex -- intentional control-char strip
  const cleaned = raw.replace(/[\r\n\t\u0000-\u001f\]]+/g, ' ').trim();
  return cleaned || '(unnamed)';
}
