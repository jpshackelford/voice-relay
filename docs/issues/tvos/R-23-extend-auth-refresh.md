# R-23 — Should we extend `/auth/refresh` instead of adding `/auth/device/refresh`?

## Research question

Is it cleaner to extend the existing `POST /auth/refresh` to also
accept a refresh token in the body (when no cookie is present)
than to add a new `POST /auth/device/refresh` endpoint per
**B-01**?

## Why we need to know this

**B-01** as currently drafted adds a new endpoint. If we can
extend the existing one without breaking the cookie-based path or
muddling its contract, the resulting code is smaller, the docs
have one entry point instead of two, and we don't carry a
duplicate of the verify/rotate logic. If extending it complicates
the contract or risks the web kiosk, two endpoints is cleaner.

## Approach

- Read `server/src/auth/router.ts` around `/refresh` and trace
  what it does in the happy and error paths.
- Sketch a unified handler: "read refresh token from cookie if
  present, otherwise from body; everything else unchanged."
- Identify failure modes for the unified shape: priority when
  both are present, error responses for invalid combinations,
  test surface area.
- Compare against the two-endpoint shape on:
  - Lines of code in the server and the client docs.
  - Risk to the web kiosk.
  - Discoverability for tvOS / future native clients.

## Scope guardrails

- Sketch / analysis only. Do not merge a change to
  `/auth/refresh` during the spike.

## Deliverable

A comment on this issue with:

- The two options written out as proposed contracts.
- A short pros/cons table.
- A recommendation that either:
  - Updates **B-01** to extend the existing endpoint, OR
  - Confirms the new-endpoint approach already drafted in
    **B-01**.
