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


---
### 2026-09-04 21:05 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0937db6` | implementation | Issue #474 - Returning-user GitHub App install loop (auth outage) | **NEW** |

🚀 **Spawned: Implementation Worker**
- Issue: [#474 - Returning (already-installed) users stuck in GitHub App install loop](https://github.com/jpshackelford/voice-relay/issues/474) — `bug`, `critical`, `priority:critical`, `server`, now `ready`
- Conversation: [`0937db6`](https://app.all-hands.dev/conversations/0937db6bb853498a96fdb7d4ca4f9abc) (execution_status=running)
- Rationale: highest-priority (`priority:critical`) `ready` issue with no `on-hold`/`needs-human`/`blocked` label; implementation slot was empty (0/1). Expansion worker `9f56ee6` finished and labeled it `ready` with a confirmed code-level RCA, so it's the clear next implementation target — a critical full-auth outage for returning users.

**Stale worker cleanup:** expansion worker `9f56ee6` (#474) finished (`execution_status=finished`); moved to `completed[]`.

**Unblock pass:** 0 issues lifted.
- #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) have their machine references closed, BUT the **AGENTS.md "Active design freeze: workspace persistence (S3 / #298)"** codified policy gate (Anti-Stall rule, point 3) keeps #298–#302 `on-hold` until production S3 provisioning is verified (env vars + creds + runbook smoke test) — unverifiable from this sandbox, and no `## INSTRUCTION:` block signals the lift. Left on-hold, consistent with prior precedent.
- #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) still have open blockers.
- #210, #239, #386: prose-only policy holds, no machine-parseable `Blocked by #N` → left alone.

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` → skipped (held draft, not auto-promoted).
- Ready issues: #474 (now being implemented); #386 is `ready` but `on-hold`.
- Needs-human: #372.
- Slots after this tick: expansion 0/4, implementation 1/1, review 0/2.

_This entry was created by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

### 2026-09-04 21:20 UTC - Implementation Worker (#474)

✅ **Implemented identify-first sign-in to end the returning-user install loop.**

- PR: [#475 — fix(auth): route sign-in through identify endpoint to end install loop](https://github.com/jpshackelford/voice-relay/pull/475) (ready for review; `Fixes #474`)
- Conversation: `0937db6`
- Change (server-only, no schema change — `github_installation_id` already exists via migration 014):
  - `github-oauth.ts`: added `getIdentifyUrl()` (→ `login/oauth/authorize?client_id&state`), renamed the install URL builder to `getInstallUrl()`, and added `getUserInstallations()` (`GET /user/installations` → `total_count`).
  - `router.ts`: `GET /auth/github` now redirects to the identify endpoint; the callback redirects to `installations/new` (fresh CSRF state, no cookie yet) only when `total_count === 0`, then completes on the install round-trip. Already-installed users go straight to sign-in; stored `github_installation_id` is preserved.
- Tests: `npm run build -w server` clean; full suite **1754 pass**; new code at **100%** stmt/branch/func/line (scoped). Added a regression test for the returning already-installed identify-only path and the first-time not-installed → install → complete path; updated `getIdentifyUrl`/`getInstallUrl`/`getUserInstallations` unit tests.
- CI: all checks green (Server/Client/Build/E2E, lint-pr-title).

**AC-gate verdict:** all issue #474 acceptance criteria (and the refined criteria in the RCA comment) satisfied by the diff → trailer `Fixes #474`. No non-exempt gaps → **no follow-up issues filed**.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 21:36 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4cee8bf` | merge | PR #475 - fix(auth) identify-first sign-in (#474) | **NEW** |

**Spawned: Merge Worker**
- PR: [#475 - fix(auth): route sign-in through identify endpoint to end install loop (#474)](https://github.com/jpshackelford/voice-relay/pull/475)
- Conversation: [`4cee8bf`](https://app.all-hands.dev/conversations/4cee8bf2855b4a43ac323515a66b40d1)
- Reason: green CI, `mergeable: CLEAN`, 0 unresolved review threads, pr-review bot verdict "Worth merging". Merge worker will run the pre-merge AC gate against #474 before merging.

**Current State:**
- Open PRs: #475 (ready, merging), #465 (draft + `on-hold`, stuck, skipped; not promoted)
- Ready issues: #474 (covered by PR #475), #386 (`on-hold`, skipped)
- Issues needing expansion: none
- Prior impl worker `0937db6` (#474) finished, moved to `completed` (opened PR #475)

**Unblock pass:** #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) are mechanically unblockable, BUT both fall under the AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" codified policy gate (#298-#302 held until production S3 provisioning is verified - unverifiable from sandbox, no `## INSTRUCTION:` override). Left `on-hold`, consistent with prior precedent. 0 issues lifted.

_This entry was created by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-09-04 21:38 UTC - Merge Worker (PR #475 / #474)

✅ **Merged PR #475** — `fix(auth): route sign-in through identify endpoint to end install loop (#474)`

- Squash commit: `53e90ae` on `main` (auto-deploys to vr.chorecraft.net).
- PR: [#475](https://github.com/jpshackelford/voice-relay/pull/475) — state `MERGED`.
- Issue: [#474](https://github.com/jpshackelford/voice-relay/issues/474) — auto-closed `COMPLETED` via `Fixes #474`.

**Merge criteria (verified):** 7/7 CI checks green, `mergeable: CLEAN`, 0 unresolved review threads, pr-review bot verdict 🟢 Good taste / ✅ Worth merging (risk 🟡 MEDIUM, auth-subsystem criticality only).

**Migration check:** no schema change. Only `server/src/auth/github-oauth.ts` + `router.ts` (and tests) touched; `github_installation_id` already exists (migration 014). No post-deploy step — safe for the SQLite production auto-deploy.

**AC Gate (pre-merge): PASS.** Trailer `Fixes #474` (auto-close). All four #474 acceptance criteria covered by the final diff, none exempt:
1. Returning already-installed user signs in with no install/configure detour + cookie set — identify-first routing in `router.ts`; regression test asserts cookie + `/home` + not `installations/new`.
2. Brand-new user still gets install → identify → callback with `users.github_installation_id` populated — callback redirects to `getInstallUrl` when `getUserInstallations` returns 0; test asserts id persisted.
3. No longer strands users on `settings/installations/<id>` — terminal install path removed; tests assert redirect never `installations/new`.
4. Automated test covers returning-user identify-only path — added and passing.

No non-exempt AC gaps → no follow-up issues filed. Gate verdict recorded in the squash commit body. No `## INSTRUCTION:` override needed or present.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 21:48 UTC - Orchestrator

🚀 **Spawned: Expansion Worker** (production incident RCA)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `55a40a3` | expansion | Issue #476 - Smoke test failure after PR #475 deploy | **NEW** |

**Spawned worker:**
- Issue: [#476 - Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/476)
- Conversation: [`55a40a3`](https://app.all-hands.dev/conversations/55a40a3d3521445ea8d98d91fbe56568)

**Why:** Issue #476 was auto-created by CI at 21:42 UTC. The failed commit `53e90ae` is the squash-merge of **PR #475** ("fix(auth): route sign-in through identify endpoint …", closes #474). Its production deploy to vr.chorecraft.net failed the post-deploy smoke test and CI **auto-rolled back** to `7d9ea78`. So the #474 auth fix passed CI + the AC gate but broke the production smoke test — production is currently on the pre-#475 commit. #476 had no `ready`/`on-hold`/`needs-human` label → routed to an expansion slot for root-cause analysis.

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` (skipped, stuck; also `lint-pr-title` FAILURE). No other open PRs; #475 merged.
- Issue #476 → now being investigated (expansion).
- `needs-human`: #372 (skipped).
- On-hold (unchanged): #210, #239 (prose/policy holds, no machine `Blocked by #N`); #299–#302 held by AGENTS.md "Active design freeze: workspace persistence (S3)" codified policy gate; #386 (`ready` but `on-hold`).

**Unblock pass:** 0 issues lifted. #210/#239/#386 have no machine-parseable `Blocked by #N` refs (policy/prose holds). #299–#302 remain under the AGENTS.md S3 design-freeze codified policy gate (production provisioning unverifiable from sandbox; no `## INSTRUCTION:` override) — consistent with prior precedent.

**Worker completed since last tick:** `4cee8bf` (merge) → merged PR #475.

**Slots after this tick:** expansion 1/4, implementation 0/1, review 0/2.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 21:53 UTC - Expansion Worker (`55a40a3`)

✅ **Expanded Issue #476** — Smoke test failure after PR #475 deploy (production incident)

- Issue: [#476 - Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/476)
- Type: Bug (stale test / deploy-gate), production incident
- Status: **Ready for implementation** (`ready` label added)
- **Root cause:** PR #475 (fix #474) correctly switched `GET /auth/github` to the identify-first endpoint (`login/oauth/authorize`) and updated the server unit/integration tests — but **not** the production smoke test `tests/smoke/smoke.spec.ts:56`, which still asserts the old `installations/new` redirect. The stale assertion failed against the correct new behavior → smoke job exit 1 → CI auto-rolled production back to `7d9ea78`.
- **Production impact:** rollback reverted `53e90ae`, so the #474 install-loop fix is no longer live — returning already-installed users are stuck in the sign-in loop again.
- **Approach:** Forward-fix, **not** a revert of #475 (reverting would re-introduce the #474 outage). Update `tests/smoke/smoke.spec.ts` to assert the identify-first contract (`302` → `login/oauth/authorize?client_id=...&state=<hex>`, never `installations/new`); merging rolls #475's code back onto production.
- Files to modify: `tests/smoke/smoke.spec.ts` (auth/github assertion + comment, lines ~56–72).

---
### 2026-09-04 22:06 UTC - Orchestrator

🚀 **Spawned: Implementation Worker** for Issue #476 (production incident)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `6f04823` | implementation | Issue #476 - stale smoke test / #475 rollback | **NEW** |

**Spawned: Implementation Worker**
- Issue: [#476 - Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/476) (`priority:high`, added inline)
- Conversation: [`6f04823`](https://app.all-hands.dev/conversations/6f048234302b466dbabe04059fe1dfa8)
- Forward-fix: update `tests/smoke/smoke.spec.ts` to the identify-first contract; merging re-lands #475's #474 fix that CI auto-rolled back.

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` (stuck, skipped; also `lint-pr-title` FAILURE). No other open PRs.
- Ready issues: #476 (now being implemented). #386 `ready` but `on-hold` (skipped).
- `needs-human`: #372 (skipped).
- On-hold (unchanged): #210, #239 (prose/policy holds); #299–#302 held by AGENTS.md S3 design-freeze codified policy gate; #386.

**Unblock pass:** 0 issues lifted. #299 (blocker #298 closed) and #301 (blocker #295 closed) are mechanically eligible but remain under the AGENTS.md S3 design-freeze codified policy gate (production provisioning unverifiable from sandbox; no `## INSTRUCTION:` override). #300/#302 still have open blockers. #210/#239/#386 have no machine-parseable `Blocked by #N` refs.

**Worker completed since last tick:** `55a40a3` (expansion) → expanded & readied #476.

**Slots after this tick:** expansion 0/4, implementation 1/1, review 0/2.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 22:20 UTC - Implementation Worker (#476)

✅ **Forward-fixed stale smoke test → PR [#477](https://github.com/jpshackelford/voice-relay/pull/477)** (ready for review)

- **Change:** test-only. `tests/smoke/smoke.spec.ts` now asserts the identify-first contract from #475/#474: `GET /auth/github` `302`s to `github.com/login/oauth/authorize?client_id=…&state=<hex>` and guards `not.toContain('installations/new')`. Renamed the test and rewrote the stale PR #283 / `test-mode-placeholder` comment block.
- **Re-land of #475:** #475's server code already lives in `main` history (the failure triggered a *deploy-level* rollback, not a git revert). Merging #477 produces a new commit that auto-re-deploys the #474 install-loop fix with a smoke suite that now passes the deploy gate.
- **CI:** all green — Server/Client/E2E/Build + `lint-pr-title` pass. (Fixed initial `lint-pr-title` failure: `smoke` is not an allowed scope → retitled to `test(tests): …`.)
- **AC-Gate verdict:** all non-exempt items satisfied → trailer `Fixes #476`. No coverage gate (no new production code). **No follow-up issues filed.**

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 22:21 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `d17aa6c` | review | PR #477 - smoke test OAuth redirect assertion (#474) | **NEW** |

**Spawned: Review Worker**
- PR: [#477 - test(tests): assert identify-first /auth/github redirect in smoke suite (#474)](https://github.com/jpshackelford/voice-relay/pull/477)
- Conversation: [`d17aa6c`](https://app.all-hands.dev/conversations/d17aa6cd32c141eca972f403ace64134)
- Reason: 1 unresolved review thread from the pr-review bot (suggestion: comment block overly verbose for a 6-line test). PR is non-draft, CLEAN/MERGEABLE, no stuck labels.

**Worker Completed (this tick):**
- `6f04823` (implementation, #476) -> finished. Opened PR #477 (green CI, mergeable). Impl slot freed.

**Unblock pass:** 0 issues lifted. #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) are mechanically eligible but remain under the AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" codified policy gate (production S3 provisioning unverifiable from sandbox; no `## INSTRUCTION:` override) - consistent with prior precedent. #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) have open blockers. #210/#239/#386 have no machine-parseable `Blocked by #N` refs (prose/policy holds).

**Current State:**
- Open PRs: [#477](https://github.com/jpshackelford/voice-relay/pull/477) (review worker dispatched), [#465](https://github.com/jpshackelford/voice-relay/pull/465) (draft, `on-hold` - skipped).
- Ready issues: #476 (priority:high) - implemented, awaiting PR #477 merge.
- Slots: expansion 0/4, implementation 0/1, review 1/2.