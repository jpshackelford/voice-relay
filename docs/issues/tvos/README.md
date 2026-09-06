# Issue drafts — tvOS backend gaps

This directory holds drafts of GitHub issues against
**voice-relay** that arise from the tvOS kiosk client work taking
shape in
[`jpshackelford/no-hands-tvos`](https://github.com/jpshackelford/no-hands-tvos).

Each draft is one file. Drafts are written to be filed as-is to the
issue tracker once the maintainer signs off.

The companion design document is at
[`no-hands-tvos/docs/TVOS_APP_DESIGN.md`](https://github.com/jpshackelford/no-hands-tvos/blob/main/docs/TVOS_APP_DESIGN.md).

---

## Conventions

These mirror the conventions in
[`no-hands-tvos/docs/issues/README.md`](https://github.com/jpshackelford/no-hands-tvos/blob/main/docs/issues/README.md).
Summary:

- **Feature / fix drafts** (`B-NN-*.md`) have exactly three
  sections: **Problem statement**, **Proposed solution**,
  **Demonstration**. Implementation detail (file paths, schema
  changes, test strategy) goes in a companion `.followup.md`
  file that is posted as the first comment after filing.
- **Research / spike drafts** (`R-NN-*.md`) have five sections:
  **Research question**, **Why we need to know this**,
  **Approach**, **Scope guardrails**, **Deliverable**. Spikes
  end in a written finding, not shipped behavior, so they have
  no `.followup.md`.
- Avoid effort estimates (hours, days, LOC) in any of these
  files. They age badly and have a habit of becoming commitments
  by accident. Sequencing (dependency graph) is fine and useful.

Existing voice-relay convention in `docs/ISSUE_DRAFTS.md` predates
this directory and uses an older single-file shape. New tvOS-related
issues use this per-file convention; older drafts in
`docs/ISSUE_DRAFTS.md` are not migrated retroactively.

### After filing

Add a YAML front-matter block to the top of the file once filed:

```yaml
---
github_issue: 512
filed: 2026-06-15
---
```

So `grep -L 'github_issue:' docs/issues/tvos/*.md` quickly finds
unfiled drafts.

---

## Index

Items marked **v1-blocker** must land before the tvOS app can
complete the basic user flow described in the design doc § 2.

### Feature / fix drafts

- [`B-01-device-auth-refresh.md`](./B-01-device-auth-refresh.md) — cookie-free refresh endpoint **(v1-blocker)**
- [`B-02-device-auth-revoke.md`](./B-02-device-auth-revoke.md) — server-side token revoke
- [`B-03-workspace-owner-identity.md`](./B-03-workspace-owner-identity.md) — owner identity + slug in workspace summary **(v1-blocker)**
- [`B-04-split-ticker-settings.md`](./B-04-split-ticker-settings.md) — split `kioskFooterTickersEnabled` into two switches **(v1-blocker; also web improvement)**
- [`B-05-per-device-tts-voice.md`](./B-05-per-device-tts-voice.md) — per-device TTS voice override
- [`B-06-register-app-os-version.md`](./B-06-register-app-os-version.md) — accept `appVersion`/`osVersion` on register
- [`B-07-device-auth-rate-limits.md`](./B-07-device-auth-rate-limits.md) — rate-limit hardening on `/auth/device/*`
- [`B-08-ws-auth-for-native.md`](./B-08-ws-auth-for-native.md) — WebSocket auth carrier for native clients **(v1-blocker if R-01 says headers don't work)**
- [`B-09-display-result-docs.md`](./B-09-display-result-docs.md) — document `display-result` semantics for tvOS

### Research / spike drafts

- [`R-20-audit-workspace-payload.md`](./R-20-audit-workspace-payload.md) — audit current workspace summary fields (could collapse B-03 to doc-only)
- [`R-21-audit-devices-payload.md`](./R-21-audit-devices-payload.md) — audit current devices list payload (informs B-06)
- [`R-22-devices-config-keys.md`](./R-22-devices-config-keys.md) — inventory known `devices.config` keys (informs B-05)
- [`R-23-extend-auth-refresh.md`](./R-23-extend-auth-refresh.md) — could we extend existing `/auth/refresh` instead of new `/auth/device/refresh`? (informs B-01)
- [`R-24-revoked-tokens-threat-model.md`](./R-24-revoked-tokens-threat-model.md) — threat model for the revoked-tokens store (informs B-02)
