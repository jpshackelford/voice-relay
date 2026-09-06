# B-02 — Server-side token revocation for device-auth

## Problem statement

`POST /auth/logout` clears the browser's refresh-token cookie. A
tvOS client doesn't have a cookie to clear, and our JWTs are
stateless — so a stolen or leaked access token continues to work
for its remaining TTL, and the refresh token works for its TTL.
Today's behavior is acceptable but gives a poor "I signed out"
guarantee, especially relevant once a tvOS device may be sitting
on someone else's wall.

## Proposed solution

- A new endpoint `POST /auth/device/revoke` that accepts a
  refresh token (and/or access token) in the body, marks it
  revoked server-side, and returns a small acknowledgement.
- Authenticated request handlers consult a deny list before
  allowing a token through. The deny list is bounded — entries
  expire at the token's own `exp`, so it cannot grow without
  limit.
- The existing browser-side `/auth/logout` is updated to push
  the refresh token's identifier onto the deny list before
  clearing the cookie, so the same protection applies to the
  web kiosk.
- Documented in `docs/TVOS_CLIENT.md` alongside the device-auth
  flow.

The threat model and persistence choice (database table vs.
short-TTL LRU vs. Redis) is the subject of **R-24**; this issue
describes the wire contract and behavior.

## Demonstration

1. Sign in with a tvOS device (or test fixture) and capture the
   access + refresh tokens.
2. Verify both tokens authorize a protected endpoint.
3. Call `POST /auth/device/revoke` with the refresh token —
   observe success.
4. Repeat the protected-endpoint call with the access token —
   observe 401 with a clear "token revoked" error.
5. Attempt to refresh using the (now revoked) refresh token —
   observe 401.
6. Wait until both original tokens are past their `exp`; show
   the deny-list entries for them have been pruned by the
   reaper job.
7. Sign out of the web kiosk; capture the previously-issued
   refresh token from a copy. Attempt `POST /auth/refresh`
   with it — observe 401 (the web-side wiring also consults
   the deny list).
