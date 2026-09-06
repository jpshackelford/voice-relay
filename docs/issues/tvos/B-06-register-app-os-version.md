# B-06 — Accept and persist `appVersion` + `osVersion` on register

## Problem statement

The WebSocket `register` message accepts a `platform` hint but no
`appVersion` or `osVersion`. Once the tvOS app is in the field,
"which app version is the Living Room TV on, and what tvOS is it
running" is the first diagnostic question any bug report needs to
answer. We have no audit trail for it today.

## Proposed solution

- Extend the `register` schema to accept optional `appVersion`
  (short string) and `osVersion` (short string). Validate and
  truncate to a sane upper bound.
- Persist the values to the `devices` row.
- Include both fields in the
  `GET /api/workspaces/:id/devices` response.
- Web devices list adds a small "v1.2.3 · tvOS 17.4" subtitle
  for devices that report them; the row is unchanged for
  devices (web kiosk, mobile) that don't.

The companion **R-21** spike audits the current devices payload
so we know the exact field shape to extend.

## Demonstration

1. Have a tvOS device register with an app/version pair.
2. From the web, open the workspace's devices list. Observe
   the per-device subtitle showing the version pair.
3. Update the tvOS app to a new version and re-register.
   Observe the subtitle changes.
4. Open the web kiosk (which doesn't report these fields).
   Observe its row shows no version subtitle — no regression
   for clients that haven't been updated.
