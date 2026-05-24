# AGENTS.md — guidance for AI agents working on Voice Relay

Persistent, repo-specific knowledge for OpenHands and similar AI agents. Read this
first. The information here has been learned the hard way in past sessions;
following it avoids re-discovering known footguns.

## Project, in one paragraph

Voice Relay is a multi-user real-time voice / text relay platform that connects
devices (kiosks, mobile phones) and integrates an OpenHands agent for AI
assistance. It is a **SaaS** product (not an internal tool): users sign up via
GitHub OAuth, with no human operator in the onboarding loop. The server is a
TypeScript/Node app with SQLite storage; the client is React. See `README.md`
for product concepts and `docs/architecture.md` for the target architecture
(currently mid-rollout via numbered phase issues).

## Orchestrator-managed files (DO NOT touch via PR)

`WORKLOG.md` and `.workflow-state.json` are owned by the orchestrator automation
and **must only change on `main`**. A CI job (`Reject orchestrator file change`)
rejects any PR that modifies these files, because squash-merging such a PR
silently reverts main's orchestrator state. See
[jpshackelford/.openhands#21](https://github.com/jpshackelford/.openhands/issues/21)
for the governance policy and voice-relay#272 (2026-05-22) for the motivating
incident.

To update the worklog as an agent:

1. `git checkout main && git pull`
2. Append your entry at the **bottom** of `WORKLOG.md`.
3. Commit with `docs(worklog): <message>` (this prefix is the orchestrator's
   own convention — see recent commit history).
4. `git push origin main` directly.

This is a repo-specific exception to the global "never push to main" rule.
Other files (code, configs, docs, runbooks, this AGENTS.md) follow the normal
flow: feature branch → PR → review → squash-merge.

## PR title conventional-commit scopes

`lint-pr-title` enforces conventional commits with a restricted scope vocabulary.
Allowed scopes:

- `client`, `server`, `websocket`, `auth`, `db`, `tests`, `e2e`, `deps`, `ci`

Scopes outside this list (e.g. `worklog`, `runbooks`, `scripts`) will fail the
lint. Use a top-level type without a scope (`docs: ...`, `chore: ...`) when no
listed scope fits.

## On-hold / needs-human labels

Two labels signal "do not pick this up automatically":

- `on-hold` — paused; reason in the most recent comment. Applies to issues and
  PRs alike. Set when work is blocked on an upstream decision or a
  not-yet-merged dependency.
- `needs-human` — requires human intervention. Stronger than `on-hold`; used
  when an agent decision was wrong or when an automated path can't make progress
  without a person.

The orchestrator's merge worker re-checks labels right before merging and
aborts on either. The implementation worker dispatcher skips `on-hold` and
`needs-human` items when selecting work. Labels are honored, but they are a
**soft guard** — they live in GitHub metadata and are not enforced by branch
protection. If you need a hard guard (e.g. against a misbehaving agent),
require status checks on `main` or add a `do-not-merge` workflow.

When marking something on-hold, post an explanatory comment with the reason
and a pointer to where the unblocking conversation lives.

## Active design freeze: workspace persistence (S3 / #298)

**Status as of 2026-05-24:** Path B (VR proxies S3) selected. PR #313 closed
as superseded. Issues #298, #299, #300 re-scoped to Path B. Architecture doc
updated in [`docs/architecture.md` § Persistence layer](docs/architecture.md#persistence-layer).

The freeze remains in effect — **do not start implementation work** on these
issues yet — because @jpshackelford is provisioning the S3 bucket and the
single VR-backend AWS credential before any test code runs. Once the bucket
exists, the credential is in `/var/www/vr.chorecraft.net/app/.env` on the
production server (see [DEPLOYMENT.md](docs/DEPLOYMENT.md)), and the user
removes the `on-hold` label, the issues become workable.

In scope (still `on-hold`):

- Issue #298 — Add VR backend persistence endpoints (`/api/internal/workspaces/:id/restore` + `/snapshot`)
- Issue #299 — Workspace restore in the OH adapter (now curl-based, not `aws s3 sync`)
- Issue #300 — Workspace snapshot in the OH adapter (now curl-based)
- Issue #301 — Dependent on #295 + #299
- Issue #302 — Dependent on #300

PR #313 (operator-mediated Path A) is closed. Do not reopen.

When the freeze lifts and Path B work is complete, **remove this entire
section** of AGENTS.md.

## Agent disclosure on external surfaces

When posting GitHub comments, opening PRs/issues, or sending messages outside
the repo, append a one-line note disclosing AI authorship, e.g.:

> _This [comment/PR/issue] was created by an AI agent (OpenHands) on behalf of @jpshackelford._

This is required by the OpenHands operator guidelines and avoids confusion when
humans browse the issue tracker.

## Worklog format

Each entry starts with `### YYYY-MM-DD HH:MM UTC - <Worker type> (<context>)`
and ends with a `---` separator on its own line. The body uses a leading emoji
(✅ done, 🛑 stop, 🚧 in progress, 🚀 dispatched) and either bullet points or
tables. Match the style of the most recent few entries when adding a new one.

Worklog archives roll over daily into `WORKLOG_ARCHIVE_YYYY-MM-DD.md` files at
the repo root (the orchestrator handles this; you typically should not).
