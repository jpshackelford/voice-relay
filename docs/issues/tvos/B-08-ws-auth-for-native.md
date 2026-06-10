# B-08 — WebSocket authorization carrier for native clients

## Problem statement

The web kiosk authenticates its `/ws` connection via the cookie the
browser attaches to the `Upgrade` request. Native tvOS clients have
neither cookies nor — depending on **R-01** — a clean way to set
custom headers on a WebSocket upgrade. They need a different way to
prove identity at connect time.

## Proposed solution

Add a short-lived **WebSocket ticket** flow:

- A new bearer-authenticated endpoint mints a single-use ticket
  bound to the requesting device or user with a short expiry.
- The `/ws` endpoint accepts the ticket as a query-string
  parameter in addition to its existing cookie path; on a
  successful match the ticket is consumed and the connection
  inherits the same identity the cookie path would have given.
- The existing cookie path stays unchanged so the web kiosk
  doesn't need to migrate.
- Documented in `docs/TVOS_CLIENT.md`.

This is the path **R-01** falls back to if native WebSocket
headers turn out not to work. If R-01 finds headers work, this
issue may not be strictly necessary for tvOS v1 — but the
ticket flow is also useful for any future non-browser client
(e.g. a CLI integration) so it's still worth shipping.

## Demonstration

1. From the dev server, request a ticket using a valid bearer
   token. Show the response is a short-lived opaque string
   with an expiry.
2. Open a WebSocket to `wss://.../ws?ticket=...` (no cookies,
   no headers). Show the `register` round-trip succeeds.
3. Re-use the same ticket. Show the second connection is
   rejected.
4. Wait until the ticket expires; try to use it. Show
   rejection.
5. Open the web kiosk in a browser (cookie path). Show its
   WebSocket still connects normally — no regression.
