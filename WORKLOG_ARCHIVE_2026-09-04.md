# Voice Relay Worklog Archive - 2026-09-04

Archived entries from WORKLOG.md.

---

### 2026-09-04 20:49 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `9f56ee6` | expansion | Issue #474 - Returning-user GitHub App install loop (auth outage) | **NEW** |

🚀 **Spawned: Expansion Worker**
- Issue: [#474 - Returning (already-installed) users stuck in GitHub App install loop](https://github.com/jpshackelford/voice-relay/issues/474) — `bug`, `critical`, `priority:critical`, `server`
- Conversation: [`9f56ee6`](https://app.all-hands.dev/conversations/9f56ee6832904d5c93e16f030a8748f7) (execution_status=running)
- Rationale: newest issue, no `ready`/`on-hold`/`needs-human` label → needs expansion. Critical full-auth outage for returning users; human already raised severity. Expansion worker will confirm the suspected root cause (`/auth/github` always routes through `installations/new`) and finalize the implementation plan + AC before labeling `ready`.

**Stale worker cleanup:** cleared two finished slots whose targets already merged — impl `0653d94` (#470 → PR #473 merged `928f06b`) and review `dd18157` (PR #472 merged `8ad557c`). Moved to `completed[]`; pruned 6 completed entries older than 24h.

**Unblock pass:** 0 issues lifted.
- #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) have their machine references closed, BUT the **AGENTS.md "Active design freeze: workspace persistence (S3 / #298)"** codified policy gate (Anti-Stall rule, point 3) keeps #298–#302 `on-hold` until production S3 provisioning is verified (env vars + creds + runbook smoke test) — unverifiable from this sandbox, and no `## INSTRUCTION:` block signals the lift. Left on-hold, consistent with prior precedent.
- #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) still have open blockers.
- #210, #239, #386: prose-only policy holds, no machine-parseable `Blocked by #N` → left alone.

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` → skipped (held draft, not auto-promoted).
- Ready issues: none unblocked (#386 is `ready` but `on-hold`).
- Needs-human: #372.
- Slots after this tick: expansion 1/4, implementation 0/1, review 0/2.

_This entry was created by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

### 2026-09-04 20:55 UTC - Expansion Worker (`9f56ee6`)

✅ **Expanded Issue #474** — Returning (already-installed) users stuck in GitHub App install loop

- Issue: [#474](https://github.com/jpshackelford/voice-relay/issues/474) — `bug`, `critical`, `priority:critical`, `server`
- Type: Bug (CRITICAL — full auth outage for returning users)
- Status: **Ready for implementation** (`ready` label added)
- Root cause **confirmed at code level** (`main` @ `dc036b4`): `GET /auth/github` (`server/src/auth/router.ts:187-195`) unconditionally redirects through `github.getAuthorizationUrl()`, which in `server/src/auth/github-oauth.ts:34-60` only ever builds `apps/<slug>/installations/new`. No identify branch exists; the current unit test even asserts `not.toContain('login/oauth/authorize')`. Already-installed users get stranded on GitHub's configure screen (`settings/installations/<id>`), so `/auth/github/callback` never receives a `code` and no cookie is set.
- Key finding: the callback + persistence layers **already** tolerate identify-only sign-in (`installation_id` handled optionally at `router.ts:267`; `upsertFromGitHub`/`setGitHubInstallationId` decoupled in `user-repository.ts`), so the fix is small.
- Recommended fix: **Option 1** — route `/auth/github` through `login/oauth/authorize` (identify), and in the callback redirect to `installations/new` only when `GET /user/installations` shows the App is not installed for that user. Option 2 (App OAuth-during-install setting) noted as a possible temporary mitigation but insufficient alone.
- Posted comment with confirmed RCA, fix, file-by-file implementation plan, required test coverage (returning-already-installed identify-only path + first-time-install path), and refined testable acceptance criteria.
- Verified env: `server` deps installed, existing 17 auth tests pass (`vitest run src/auth/github-oauth.test.ts src/auth/router.test.ts`).

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._
