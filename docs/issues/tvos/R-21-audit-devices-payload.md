# R-21 — Audit current devices list payload

## Research question

What fields does `GET /api/workspaces/:id/devices` return today
for each device, and what would change if we extended it to
include `appVersion` and `osVersion` per **B-06**?

## Why we need to know this

**B-06** specifies new persisted fields and surfaces them in this
endpoint. The exact diff to the response shape — and any web
client consumers that might break on a new field — depends on
what the payload looks like right now.

## Approach

- Inspect the device list handler in
  `server/src/workspaces/router.ts`.
- Identify all web client call sites that consume the response.
- Capture an example payload from the dev server.

## Scope guardrails

- Read-only investigation.
- No server code changes.

## Deliverable

A comment on this issue with:

- The current response shape as JSON.
- A list of web consumers and what they read.
- A go/no-go for adding the two new fields without breaking any
  consumer, feeding into the **B-06** followup.
