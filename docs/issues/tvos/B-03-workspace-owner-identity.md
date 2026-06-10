# B-03 — Owner identity and slug in workspace summary payload

## Problem statement

The tvOS app needs to render an always-visible identity badge
("you are looking at *X*'s workspace *Y*") using a single
round-trip's data. Today (until **R-20** audits the current
payload) it is unclear whether `GET /api/workspaces` and
`GET /api/workspaces/:id` return everything the badge needs:
owner display name, owner handle, owner avatar URL, and the
workspace slug. If any of those fields are missing, the badge
becomes a two-request operation, which costs latency and adds a
coupling we don't want for a security-relevant UI element.

## Proposed solution

For every workspace the requester can see, the workspace summary
returns at least:

- `id`, `name`, `slug`.
- An `owner` object with `id`, `username`, `displayName`,
  `avatarUrl`.
- The requester's `role` in that workspace (`owner` or
  `member`).

If **R-20** finds the payload already contains all of this, this
issue collapses to "document the contract and add a regression
test." If anything is missing — most likely `avatarUrl` or
`slug` — add it.

## Demonstration

1. Sign in as a user that belongs to two workspaces: one they
   own, one they're a member of.
2. Call `GET /api/workspaces`. Show the response includes both
   workspaces; for each, the response includes the workspace
   slug and the full owner identity block.
3. Open the existing web `WorkspaceHome` page for each workspace
   — show no console warnings or visual regressions.
4. Open the tvOS app's identity badge (T-06 on the tvOS side,
   when merged) — show it renders the owner avatar and handle
   from the single payload, without a second round-trip.
5. Show the updated `docs/TVOS_CLIENT.md` example payload
   matches what the server actually returns.
