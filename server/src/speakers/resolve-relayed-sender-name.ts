/**
 * Resolve the `senderName` field that ships on a `RelayedTextMessage`
 * to peer devices (and lands in `messages.sender_name`).
 *
 * Background — issue #446 (closes the #433 third-bullet AC gap):
 *
 *   PR #438 wired `resolveSpeakerForSession` so the per-session
 *   `session_devices.active_speaker_id` override yields an
 *   `utteranceSpeaker = { id, preferredName, pronouns }` shape on the
 *   relay path. The speaker `id` was already being forwarded as the
 *   wire-frame's `speakerId`, but `preferredName` was being dropped —
 *   so a kiosk that just claimed itself for "JP" via the first-run card
 *   would still broadcast `senderName: 'Linux-bda2'` (the auto-generated
 *   device alias). This function performs the substitution at the
 *   single literal site in `index.ts` and gives every other call path
 *   safe fallback behavior.
 *
 * Behavior table (matches the issue's AC):
 *
 *   utteranceSpeaker                                  │ result
 *   ──────────────────────────────────────────────────┼──────────────────────
 *   { preferredName: "JP", ... }                      │ "JP"  ← substitution
 *   { preferredName: null, ... }   (speaker row has   │ deviceDisplayName
 *     no preferredName recorded yet — graceful fallb.)│
 *   null  (unclaimed device, no primary user,         │ deviceDisplayName
 *     no per-session override)                        │
 *   null  (engine-label-only path: a Deepgram         │ deviceDisplayName
 *     `S1` mapping resolved `speakerId` but no        │   ← engine labels are
 *     human speaker is present)                       │     not human names
 *
 * Why the persisted row is fixed for free: both `store.append` and
 * `registry.broadcastToSession` consume the same `RelayedTextMessage`
 * literal, so the single assignment in `index.ts` covers wire AND DB.
 *
 * Why the agent-driver `sender.senderName` path is unchanged: the
 * voice-relay header builder uses `sender.speaker.preferredName` for
 * the `[speaker name=…]` line and treats `sender.senderName` only as
 * the device alias for `[vr alias=…]`. The agent path forwards
 * `utteranceSpeaker` as `sender.speaker` already, so it should keep
 * `device.displayName` as the alias — this helper deliberately does
 * not get called there.
 */
export interface SpeakerNameSource {
  preferredName: string | null;
}

export function resolveRelayedSenderName(
  utteranceSpeaker: SpeakerNameSource | null | undefined,
  deviceDisplayName: string,
): string {
  return utteranceSpeaker?.preferredName ?? deviceDisplayName;
}
