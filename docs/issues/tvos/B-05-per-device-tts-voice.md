# B-05 — Per-device TTS voice override

## Problem statement

The workspace's ElevenLabs voice is set in workspace settings and
applies to every TTS-emitting device in that workspace. The tvOS
Settings screen exposes a per-device voice picker so two kiosks
in the same workspace (e.g. "Living Room TV" and "Bedroom TV")
can speak with different voices. There is no per-device
override capability today.

`devices.config.stt_engine` already establishes the per-device-
override pattern at the JSON-blob level; we want the symmetric
capability for TTS voice.

## Proposed solution

- Document `devices.config.tts_voice_id: string | null` as a
  known key. The `devices.config` column is already JSON, so
  no schema change is required.
- When the server selects the voice for a TTS request, prefer
  `devices.config.tts_voice_id` (when set on the device that
  will play the audio) over the workspace setting.
- Extend the `update-device` WebSocket message to accept a
  `config` partial, so a device can set its own override:
  `{type: 'update-device', config: {tts_voice_id: 'rachel'}}`.
- Surface the per-device voice (read-only) in the web devices
  list for workspace owners to audit.

The companion **R-22** spike inventories existing
`devices.config` keys so we publish a single, consistent doc.

## Demonstration

1. Configure a workspace with three devices: two tvOS kiosks
   and a phone. Pick a workspace default voice.
2. Use the tvOS Settings screen on "Living Room TV" to choose
   a different voice; preview plays it.
3. Trigger an AI response in the session. Both kiosks speak —
   "Living Room TV" uses its override voice; the other kiosk
   uses the workspace default.
4. From the web devices list, show the per-device voice column
   reflects the override on "Living Room TV" and is empty for
   the others.
5. Clear the override from tvOS settings ("Use workspace
   default"). The next AI response uses the workspace voice on
   "Living Room TV" again.
