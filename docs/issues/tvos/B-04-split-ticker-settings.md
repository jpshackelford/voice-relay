# B-04 — Split `kioskFooterTickersEnabled` into two switches

## Problem statement

The single `kioskFooterTickersEnabled` workspace setting
(introduced in issue #340) lights up *both* the speaker
transcription ticker and the agent-action ticker on the kiosk.
This is a common request from both web users and the in-progress
tvOS design: some users want the speaker ticker for room
awareness but find the agent ticker noisy, or vice versa.

## Proposed solution

Replace the single switch with two independent ones, applied to
both web and tvOS so behavior stays consistent across platforms:

- `kioskTickerSpeakerEnabled` — controls the speaker
  transcription strip.
- `kioskTickerAgentEnabled` — controls the AI action strip.

Both default to the existing
`kioskFooterTickersEnabled` value for current workspaces at
migration time (preserves current behavior). New workspaces
default both to off. The old field stays as a deprecated read-
only accessor (returning the AND of the two new fields) for one
release, then is dropped.

The new fields are exposed on:

- `GET /api/workspaces/:id/kiosk-config` (consumed by both web
  and tvOS clients).
- `PATCH /api/workspaces/:id/settings` (owner-only).

Web Workspace settings UI replaces the one switch with two
clearly-labelled ones. Web `KioskMode` consumes the two new
props in place of the one old prop. tvOS `T-10` (the
no-hands-tvos issue) consumes the same fields.

## Demonstration

1. With an existing workspace that has the legacy setting on,
   open Workspace settings on the web. Show both new switches
   are on.
2. With an existing workspace that has the legacy setting off,
   open Workspace settings. Show both new switches are off.
3. Open the kiosk view (web). Show both tickers visible.
4. Turn off "Speaker transcription ticker". Show the bottom-
   left strip disappears; the bottom-right strip remains.
5. Turn off "Agent action ticker". Show both strips are gone.
6. Run the same check against the tvOS app on the same
   workspace — confirm parity.
7. Read the database directly: show the deprecated
   `kiosk_footer_tickers_enabled` column still returns the
   AND of the two new fields.
