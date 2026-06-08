> Proposed first comment for B-01. Post after filing the issue.

## Proposed technical implementation

- Add `POST /auth/device/refresh` to
  `server/src/auth/device-auth-router.ts`.
- Re-use `jwtService.verifyRefresh()` and the existing
  refresh-rotation helpers from `server/src/auth/router.ts` — no
  duplicate verification logic.
- Apply the same `express-rate-limit` policy used by
  `/auth/device/token`; lift it into a shared limiter if useful.
- Update `docs/TVOS_CLIENT.md` "Token Refresh" section.
- Vitest in `server/src/auth/device-auth-router.test.ts` covering
  happy path, tampered, reused, and expired tokens.

## Out of scope

- Migrating the existing cookie-based `/auth/refresh` away from
  cookies. The web client depends on the cookie path; we keep it
  unchanged.
- Refresh-token introspection or revocation lookup — that's B-02.

## Open questions

- Whether to extend `/auth/refresh` to read the refresh token
  from the body when no cookie is present, instead of adding a
  new endpoint. **R-23** decides this. If yes, the diff is
  ~1/3 the size of a new-endpoint approach.
- Whether the rotated refresh token should be returned in the
  body, in a cookie (where applicable), or both. The device-auth
  flow already returns it in the body, so consistency favors
  body-only for the device-auth refresh path.
