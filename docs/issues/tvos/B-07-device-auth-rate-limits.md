# B-07 — Rate-limit hardening on `/auth/device/*`

## Problem statement

`/auth/device/code` and `/auth/device/token` are unauthenticated by
design — the device code *is* the authenticator-to-be. Public,
unauthenticated endpoints attract probing, and these will become
more obviously public once the tvOS app ships. Today's limits are
generic per-IP defaults; we tighten before visibility increases.

## Proposed solution

- `/auth/device/code`: bounded per-IP requests per minute and per
  hour, returning `429` with a `Retry-After` header above the
  cap.
- `/auth/device/token`: bounded per-`device_code` polling rate (a
  bit looser than the RFC-recommended 5s cadence to allow for
  jitter); and a separate per-IP overall cap.
- The limits do not break a legitimate tvOS client polling on
  the server's published `interval`.

## Demonstration

1. From a single test IP, hit `/auth/device/code` in a tight
   loop. Observe 429 responses kick in after the documented cap
   and include a `Retry-After` header.
2. Start a polling loop on `/auth/device/token` at the server's
   published interval (e.g. once every 5 s). Show no 429 over
   a multi-minute observation window — a legitimate client is
   never rate-limited.
3. Hammer `/auth/device/token` for a single `device_code` at a
   much higher rate. Observe 429.
4. Confirm the dev-server logs include enough detail to spot the
   throttling decisions (so on-call can diagnose).
