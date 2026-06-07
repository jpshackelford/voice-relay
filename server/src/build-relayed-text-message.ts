/**
 * Pure builder for the `RelayedTextMessage` that the WS text-handler in
 * `index.ts` constructs for every inbound user utterance.
 *
 * Extracted in PR for #446 so the substitution rule for `senderName` is
 * exercisable without booting the full server (index.ts is a side-effect
 * bootstrap module). The WS handler still owns I/O — speaker resolution,
 * engine-mapping lookup, broadcast, persistence — but the construction of
 * the wire-shape object lives here.
 *
 * Substitution rule (issue #446 / #433 third-bullet AC):
 *
 *   `senderName` is the per-session active-speaker `preferredName` when
 *   one resolved with a non-null name. It falls back to the device alias
 *   (`device.displayName`) for:
 *     - unclaimed devices (no `utteranceSpeaker`),
 *     - engine-label-only paths (engine label like `S1` won
 *       `finalSpeakerId`, but no human speaker was resolved),
 *     - speaker rows whose `preferredName` happens to be null.
 *
 * The same returned object is consumed by both `store.append` (persisted
 * `messages.sender_name`) and `registry.broadcastToSession` (wire frame
 * to peers), so the substitution lands once and applies to both.
 */

import type { RelayedTextMessage } from './types.js';

/**
 * Minimal speaker shape both `resolveSpeakerForSession` and
 * `resolveSpeakerForUser` already return.
 */
export interface UtteranceSpeaker {
  id: string;
  preferredName: string | null;
  pronouns: string | null;
}

/**
 * Minimal device fields the builder consumes. Pulled from the in-memory
 * `Device` cached at registration time. We deliberately keep this shape
 * structural (not importing `Device`) so the builder is decoupled from
 * the registry.
 */
export interface BuilderDevice {
  id: string;
  displayName: string;
  workspaceId: string;
  /**
   * Current session id. Optional because anonymous devices and pre-claim
   * registrations may not have one; the corresponding `RelayedTextMessage`
   * field is also optional. The WS handler guards downstream broadcast on
   * presence, but the message itself just carries whatever value is there.
   */
  sessionId?: string;
  timezone?: string | null;
}

/**
 * Inbound-text fields read off the client `TextMessage` frame.
 */
export interface BuilderInboundText {
  utteranceId: string;
  text: string;
  partial: boolean;
}

export interface BuildRelayedTextMessageInput {
  message: BuilderInboundText;
  device: BuilderDevice;
  /** Resolved active-speaker (per-session override or primary-user fallback). */
  utteranceSpeaker: UtteranceSpeaker | null;
  /**
   * Winner of `resolvedFromEngineMapping ?? utteranceSpeaker?.id` — the id
   * that lands as `RelayedTextMessage.speakerId`. May be `undefined`.
   */
  finalSpeakerId: string | undefined;
  /** Raw engine label from the inbound frame, if any (e.g. `S1`). */
  engineSpeakerLabel: string | undefined;
  clientTimestamp: string;
}

/**
 * Build the outbound `RelayedTextMessage` for a user utterance.
 *
 * Returns a frozen-shape object whose `senderName` field is the substituted
 * speaker name when one resolved, and the device alias otherwise. See the
 * module docstring for the full substitution rule.
 */
export function buildRelayedTextMessage(
  input: BuildRelayedTextMessageInput
): RelayedTextMessage {
  const {
    message,
    device,
    utteranceSpeaker,
    finalSpeakerId,
    engineSpeakerLabel,
    clientTimestamp,
  } = input;

  return {
    type: 'text',
    utteranceId: message.utteranceId,
    workspaceId: device.workspaceId,
    sessionId: device.sessionId,
    senderId: device.id,
    // Substitute speaker's preferred name when available; see module
    // docstring above for the full fallback semantics.
    senderName: utteranceSpeaker?.preferredName ?? device.displayName,
    text: message.text,
    partial: message.partial,
    clientTimestamp,
    ...(device.timezone ? { senderTimezone: device.timezone } : {}),
    ...(finalSpeakerId ? { speakerId: finalSpeakerId } : {}),
    ...(engineSpeakerLabel ? { engineSpeakerLabel } : {}),
  };
}
