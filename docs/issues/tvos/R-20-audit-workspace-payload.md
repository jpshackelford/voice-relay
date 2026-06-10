# R-20 — Audit current workspace summary payload

## Research question

Do `GET /api/workspaces` and `GET /api/workspaces/:id` already
return everything the tvOS identity badge needs (owner display
name, owner handle, owner avatar URL, workspace slug, requester
role), or are some fields missing?

## Why we need to know this

**B-03** assumes some of these fields are missing and adds them.
If the audit shows the payload already includes all of them,
**B-03** collapses from a server change + migration to a
documentation-and-regression-test issue. That's a much cheaper
landing for the identity-badge dependency.

## Approach

- Inspect the current handlers in
  `server/src/workspaces/router.ts` and the workspace repository.
- Hit the live dev server with a test user that has more than
  one workspace and capture the actual responses for both
  endpoints.
- Compare against the field list **B-03** requires.

## Scope guardrails

- Read-only investigation; no server code changes.
- Capture findings as JSON snippets in the deliverable
  comment.

## Deliverable

A comment on this issue listing, for each field B-03 needs:
present today (with shape) / missing / present-but-wrong-shape.

- If everything is present → close R-20; reshape **B-03** to be
  doc-and-test only.
- If anything is missing → leave **B-03** as drafted; link this
  finding into B-03's first comment.
