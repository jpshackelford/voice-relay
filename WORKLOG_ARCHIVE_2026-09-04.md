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

---
### 2026-09-04 22:22 UTC - Review Worker (PR #477, round 1)

✅ **Addressed review round 1 on PR [#477](https://github.com/jpshackelford/voice-relay/pull/477)** (back to ready for review)

- **Thread (1, pr-review bot 🟡):** verbose comment block on the 6-line smoke test. **Accepted** → condensed the 13-line comment to the 3-line essential invariant, preserving the `#474` reference and the `installations/new` regression guard. Committed `d4a2e38`, thread resolved with a reply referencing the SHA.
- **CI:** all green on `d4a2e38` (Server/Client/E2E/Build + `lint-pr-title`).
- **AC-Gate re-verdict:** **UNCHANGED** → trailer stays `Fixes #476`. The change was comment-only; the identify-first assertion logic is unchanged, so all non-exempt #476 items remain satisfied. No trailer edit, no follow-up issues, no `## Deferred to follow-ups` change.
- **Reflection:** commented on #476 — behavior-changing PRs must grep the changed HTTP contract across **all** test layers (the separate smoke suite was missed by #475, causing the post-deploy rollback). Worth a checklist/CI guard.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 22:48 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `6ead722` | merge | PR #477 - smoke test OAuth redirect assertion (#474/#476) | **NEW** |

**Spawned: Merge Worker**
- PR: [#477 - test(tests): assert identify-first /auth/github redirect in smoke suite (#474)](https://github.com/jpshackelford/voice-relay/pull/477)
- Conversation: [`6ead722`](https://app.all-hands.dev/conversations/6ead722125f74d6b8e1b48c3ead73b1d)
- Reason: PR is non-draft, MERGEABLE/CLEAN, all CI checks green (Server/Client/E2E/Build + lint-pr-title + pr-review), and the sole review thread is resolved. Merge criteria met → dispatched merge worker to run the pre-merge AC gate and squash-merge.

**Worker Completed (this tick):**
- `d17aa6c` (review, PR #477) → finished. Addressed review round 1 (condensed comment block, thread resolved), returned PR to ready; AC-gate re-verdict unchanged (`Fixes #476`). Review slot recycled into the merge worker.

**Unblock pass:** 0 issues lifted. #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) are mechanically eligible but remain under the AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" codified policy gate (production S3 provisioning unverifiable from sandbox; no `## INSTRUCTION:` override) — consistent with prior precedent. #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) have open blockers. #210/#239/#386 have no machine-parseable `Blocked by #N` refs (prose/policy holds).

**Current State:**
- Open PRs: [#477](https://github.com/jpshackelford/voice-relay/pull/477) (merge worker dispatched), [#465](https://github.com/jpshackelford/voice-relay/pull/465) (draft, `on-hold` — skipped).
- Ready issues: #476 (priority:high) — implemented in PR #477, awaiting merge. #386 (priority:low, `on-hold` — skipped).
- Issues needing expansion: none.
- Slots after this tick: expansion 0/4, implementation 0/1, review 1/2.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 22:53 UTC - Merge Worker (PR #477)

✅ **Squash-merged PR [#477](https://github.com/jpshackelford/voice-relay/pull/477)** → `main` (merge commit `774db3e`)

- **What:** `test(tests): assert identify-first /auth/github redirect in smoke suite (#474)`. Forward-fix that re-lands #475's identify-first `/auth/github` contract into the production smoke suite (`tests/smoke/smoke.spec.ts`, +8/-9). Corrects the stale assertion that tripped the post-deploy auto-rollback and re-opened the #474 install loop.
- **AC-Gate verdict: PASS.** Walked issue #476's `## Expected Behavior` item-by-item vs the final diff (no exempt/deferred items): (1) `302` → `login/oauth/authorize?client_id=…&state=<hex>` ✅, (2) base sign-in never routed through `installations/new` ✅, (3) comment block rewritten to identify-first flow ✅, (4) re-land #475 onto production ✅ (new commit re-deploys #475, already in main history). All non-exempt items satisfied → trailer `Fixes #476` honored. Verdict also recorded in the squash commit body. No coverage gate (test-only, no new production code); **no follow-up issues filed**.
- **Migration check:** test-only change — no schema, no migrations, no production code touched. Safe for the SQLite production auto-deploy to vr.chorecraft.net; no post-deploy steps.
- **Linked issue:** [#476](https://github.com/jpshackelford/voice-relay/issues/476) **auto-closed** by GitHub via `Fixes #476` (closed 22:53 UTC). Verified.
- **Production effect:** merge triggers a new auto-deploy that re-lands the #475 auth fix with a smoke suite that now passes the deploy gate — restoring identify-first sign-in for returning users.

**Worker Completed (this tick):**
- `6ead722` (merge, PR #477) → finished. AC gate PASS, squash-merged (`774db3e`), #476 auto-closed. Merge slot freed.

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) (draft, `on-hold` — skipped).
- Ready issues: #386 (priority:low, `on-hold` — skipped).
- Slots after this tick: expansion 0/4, implementation 0/1, review 0/2.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 23:05 UTC - Orchestrator

🚀 **Spawned: Expansion Worker**

- Issue: [#478 - 🚨 Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/478) (auto-created by CI; `ci-failure`, no `ready`/`on-hold`/`needs-human` → needs expansion)
- Conversation: [`7d14590`](https://app.all-hands.dev/conversations/7d14590f70ff493b9eedcec29207b8c6) — verified `running`
- Task: analyze failed smoke-test run 33927250344 (failed commit `f08edef`, auto-rolled back to `7d9ea78`), find root cause, rewrite issue + post RCA, then add `ready`.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `7d14590` | expansion | Issue #478 - Smoke test failure | **NEW** running |

**Worker Completed (this tick):**
- `6ead722` (review/merge, PR #477) → finished. Squash-merged PR #477 to main; #476 auto-closed. Review slot recycled.

**Unblock pass:** 0 issues lifted. #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) are mechanically eligible but remain under the AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" codified policy gate (production S3 provisioning unverifiable from sandbox; no `## INSTRUCTION:` override) — consistent with prior precedent. #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) have open blockers. #210/#239/#386 have no machine-parseable `Blocked by #N` refs (prose/policy holds).

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) (draft, `on-hold` — skipped, no promotion).
- Ready issues: #386 (priority:low, `on-hold` — skipped).
- Issues needing expansion: #478 (now being expanded).
- Slots after this tick: expansion 1/4, implementation 0/1, review 0/2. quiet_ticks=0.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 23:12 UTC - Expansion Worker (`7d14590`)

✅ **Expanded Issue #478**

- Issue: [#478 - 🚨 Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/478)
- Type: Bug (CI / deploy pipeline)
- Status: **Ready for implementation** (labels: `ready`, `scope:ci-only`)
- Failing run: [33927250344](https://github.com/jpshackelford/voice-relay/actions/runs/33927250344), commit `f08edef`, rolled back to `7d9ea78`.
- Root cause (two layers):
  - **Layer 1 (already fixed):** surface failure is the same stale `tests/smoke/smoke.spec.ts:56` auth assertion as #476 (expected `installations/new`, server correctly returned `login/oauth/authorize` per #474/#475). PR #477 (`774db3e`) fixed the assertion ~83 s *after* `f08edef` deployed; main now correct and prod self-healed (`deploy-success` tag on `774db3e`).
  - **Layer 2 (actionable):** `f08edef` is a bookkeeping-only commit (`WORKLOG.md` + `.workflow-state.json`) that still triggered `Server Operations` because `.github/workflows/deploy.yml` `paths-ignore` omits `.workflow-state.json`. This redeployed prod and re-ran smoke, tripping a spurious rollback.
- Proposed fix: add `.workflow-state.json` to `deploy.yml` `paths-ignore` so orchestrator state churn no longer redeploys production. Low complexity, low risk.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 23:20 UTC - Orchestrator

🚀 **Spawned: Implementation Worker**

- Issue: [#478 - Smoke test failure after deployment (Layer-2 CI trigger-scoping bug)](https://github.com/jpshackelford/voice-relay/issues/478) (priority:high, ready, scope:ci-only)
- Conversation: [`920b30e3`](https://app.all-hands.dev/conversations/920b30e30969414081ec4ff0d49d2f4c) — verified `running`
- Task: extend `paths-ignore` in `.github/workflows/deploy.yml` to include `.workflow-state.json` so orchestrator-bookkeeping-only commits stop triggering full production deploy/smoke/rollback. Layer-1 (stale auth smoke assertion) already fixed by PR #477 — out of scope.

**Priority assessment (inline):** #478 was `ready` but unprioritized after expansion. Assigned `priority:high` — the Layer-2 bug recurs on every `.workflow-state.json`-touching commit (frequent) and each occurrence risks a spurious production rollback; fix is a low-risk one-line workflow change. Not `critical` (production self-healed, no active outage).

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `920b30e3` | implementation | Issue #478 - deploy.yml trigger-scoping | **NEW** running |

**Worker Completed (this tick):**
- `7d14590` (expansion, #478) → finished. Added `ready` label + Layer-1/Layer-2 RCA comment. Expansion slot recycled.

**Unblock pass:** 0 issues lifted. #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) are mechanically eligible but remain under the AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" codified policy gate (production S3 provisioning unverifiable from sandbox; no `## INSTRUCTION:` override) — consistent with prior precedent. #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) have open blockers. #210/#239/#386 have no machine-parseable `Blocked by #N` refs (prose/policy holds).

**Current State:**
- Open PRs: [#465](https://github.com/jpshackelford/voice-relay/pull/465) (draft, `on-hold` — skipped, no promotion).
- Ready issues: #478 (priority:high — now being implemented). #386 (priority:low, `on-hold` — skipped).
- Issues needing expansion: none.
- Slots after this tick: expansion 0/4, implementation 1/1, review 0/2. quiet_ticks=0.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 23:30 UTC - Implementation Worker (`920b30e3`, #478)

✅ Implemented Layer-2 fix for #478 (CI trigger-scoping bug).

- **PR:** [#479](https://github.com/jpshackelford/voice-relay/pull/479) (ready for review).
- **Change:** Added `.workflow-state.json` to `paths-ignore` under `on.push` in `.github/workflows/deploy.yml`. Bookkeeping-only commits (state-counter bumps) no longer trigger the production deploy/smoke/rollback pipeline. `WORKLOG.md` / `WORKLOG_ARCHIVE_*.md` already covered by `*.md`.
- **Scope:** Layer-1 (stale auth smoke assertion) untouched — already fixed by PR #477; production self-healed.
- **CI:** All PR checks green (Build Client, Client/Server Tests, E2E, lint-pr-title). `Server Operations` correctly does not run on PRs.
- **AC-gate verdict:** `Fixes #478`. All non-exempt Proposed-Fix/Validation items satisfied. Optional AGENTS.md note omitted (kept PR minimal); push-based "does not deploy" validation is observable only post-merge (verified by YAML parse + `paths-ignore` semantics). No follow-up issues filed.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-09-04 23:33 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `ca0395a6` | merge | PR #479 - deploy.yml trigger-scoping | **NEW** running |

**Spawned: Merge Worker**
- PR: [#479](https://github.com/jpshackelford/voice-relay/pull/479) (fix(ci): exclude `.workflow-state.json` from deploy trigger; `Fixes #478`)
- Conversation: [`ca0395a6`](https://app.all-hands.dev/conversations/ca0395a61ee541649c22fefff4e9821a)
- Rationale: PR is ready (not draft), `MERGEABLE`, all CI green (Build Client, Client/Server Tests, E2E, lint-pr-title), pr-review bot review positive ("🟢 Good taste"), no unresolved review threads. Merge criteria met → merge worker.

**Worker Completed (this tick):**
- `920b30e3` (implementation, #478) → finished. Opened PR #479 (green CI, mergeable). Impl slot recycled.

**Unblock pass:** 0 issues lifted. #299 (`Blocked by #298`=CLOSED) and #301 (`Blocked by #295`=CLOSED) are mechanically eligible but remain under the AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" codified policy gate (production S3 provisioning unverifiable from sandbox; no `## INSTRUCTION:` override) — consistent with prior precedent. #300 (`Blocked by #299`=OPEN) and #302 (`Blocked by #300`=OPEN) have open blockers. #210/#239/#386 have no machine-parseable `Blocked by #N` refs (prose/policy holds).

**Current State:**
- Open PRs: [#479](https://github.com/jpshackelford/voice-relay/pull/479) (merge worker dispatched); [#465](https://github.com/jpshackelford/voice-relay/pull/465) (draft, `on-hold` — skipped, no promotion).
- Ready issues: #386 (priority:low, `on-hold` — skipped). No implementable ready+prioritized issues.
- Issues needing expansion: none.
- Slots after this tick: expansion 0/4, implementation 0/1, review 1/2. quiet_ticks=0.

_This entry was created by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-09-04 23:38 UTC - Merge Worker (`ca0395a6`, PR #479)

✅ Squash-merged **PR #479** — `fix(ci): exclude .workflow-state.json from deploy trigger` (`Fixes #478`, Layer-2).

- **Merge commit:** `7506cf5` (merged 2026-09-04T23:38:23Z into `main`).
- **AC-gate verdict:** ✅ **PASS**. Auto-close trailer `Fixes #478`. Issue #478 has no literal `## Acceptance Criteria` heading; its `## Expected Behavior` bullets are the acceptance surface and both non-exempt items are covered by the final diff — (a) commits touching only orchestrator bookkeeping files (`WORKLOG.md`, `.workflow-state.json`, archive worklogs) no longer trigger the deploy/smoke/rollback pipeline (`.workflow-state.json` now in `paths-ignore`; `*.md` already covers the worklogs); (b) production deploys fire only for real app/config changes. Layer-1 (stale smoke assertion) exempt — out of scope, already fixed by #477. No uncovered non-exempt items; no `## INSTRUCTION:` override needed or present. Verdict recorded in the squash commit body.
- **Migration check:** N/A — diff touches only `.github/workflows/deploy.yml` (CI config); no schema/DB/migration files. Safe for production SQLite.
- **Pre-merge state:** not draft, `MERGEABLE`, all 7 CI checks green, pr-review bot 🟢 "Good taste", no unresolved review threads, no `on-hold`/`needs-human` labels (re-checked immediately before merge).
- **Linked issue:** #478 auto-closed by GitHub via `Fixes #478` (state `CLOSED`/`COMPLETED`). Verified — no manual close needed.
- **Production note:** merge to `main` auto-deploys to vr.chorecraft.net; this is a deploy-trigger-narrowing CI change only, no application/schema impact.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._