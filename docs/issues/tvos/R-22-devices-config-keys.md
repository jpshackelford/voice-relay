# R-22 — Inventory known `devices.config` keys

## Research question

What per-device configuration keys are already in use under
`devices.config`, where are they read and written, and is there
an existing convention we should follow when adding new keys
(like the `tts_voice_id` proposed in **B-05**)?

## Why we need to know this

**B-05** adds a new key without a schema change because
`devices.config` is JSON. Before we add it we want to confirm
existing usage so the new key follows the same naming + access
conventions, and so we can publish a complete catalog rather
than a one-off addition that future readers won't connect to
the broader pattern.

## Approach

- `grep -rn "devices.config" server/src` and trace each read
  and write.
- Catalog each key: name, type, who writes it, who reads it,
  default behavior when absent.
- Note any conventions: snake_case vs camelCase, validation
  patterns, where defaults live.

## Scope guardrails

- Read-only investigation.
- No changes to server source.

## Deliverable

A comment on this issue with:

- The catalog as a table.
- A recommended naming + access convention for `tts_voice_id`
  (feeds **B-05** followup).
- A proposal for a one-page "`devices.config` known keys" doc
  to live somewhere under `docs/` (decide where in the
  comment) — captured as a tiny follow-on issue or rolled into
  **B-05**.
