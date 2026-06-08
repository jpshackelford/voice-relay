# B-01 — Cookie-free refresh endpoint for device-auth tokens

## Problem statement

The existing `POST /auth/refresh` reads the refresh token from an
HTTP cookie (`voice_relay_refresh`). That works for the browser
kiosk but not for native clients: React Native's URLSession-backed
`fetch` does not maintain a cookie jar across app launches, and
existing cookie-bridge libraries are fragile on tvOS. The
device-auth grant already returns the refresh token in the JSON
response body, so the missing piece is a refresh path that accepts
it the same way.

A tvOS app whose access token has expired cannot refresh without
re-running the full RFC 8628 flow (QR + phone + GitHub). That is a
poor experience for what is effectively a routine token rotation
and undermines the "frictionless re-launch" goal in the tvOS app
design.

## Proposed solution

A new endpoint that accepts the refresh token in the request body
and returns the same payload shape as the device-auth `/token`
endpoint:

- `POST /auth/device/refresh` with `{ "refresh_token": "<jwt>" }`.
- On success, returns a new access + refresh pair (rotation
  preserved) with the same shape RFC 8628 specifies for the
  device-auth `/token` happy path.
- On any token problem — invalid signature, expired, already-
  rotated — returns `401` with an `invalid_grant` error and a
  human-readable description, matching the RFC convention.
- Rate-limited per source IP to discourage abuse.
- Documented in `docs/TVOS_CLIENT.md` alongside the device-auth
  flow (which currently punts on refresh).

The decision of whether to add this as a separate endpoint or
extend the existing `/auth/refresh` to accept either cookie or
body depends on **R-23**.

## Demonstration

1. Mint a tvOS-style access + refresh token pair through the
   device-auth flow (or via the test helpers).
2. With the access token's expiry shortened (or after waiting it
   out), call a protected endpoint — observe a 401.
3. Call `POST /auth/device/refresh` with the refresh token in the
   body — observe the JSON response with new tokens.
4. Repeat the protected endpoint call with the new access token —
   observe 200.
5. Replay the original (now rotated-out) refresh token — observe
   401 with `invalid_grant`.
6. Show the updated `docs/TVOS_CLIENT.md` section that describes
   the new endpoint and how a tvOS client should use it.
