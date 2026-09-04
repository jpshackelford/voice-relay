# Voice Relay Worklog

## Log

### 2026-06-10 20:51 UTC - Orchestrator

🚀 **Spawned: Review Worker for PR #472**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0653d94` | implementation | Issue #470 — toggleable verbose STT lifecycle logging | running (spawned 20:37Z) |
| `dd18157` | review | PR #472 — useSttEngine callback identity refactor | **NEW** running |

**Spawned: Review Worker**
- PR: [#472 — refactor(client): stabilize useSttEngine callback identities](https://github.com/jpshackelford/voice-relay/pull/472)
- Conversation: [`dd18157`](https://app.all-hands.dev/conversations/dd18157b70034b898c51be6a61f8134d)
- Trigger: pr-review bot left 1 unresolved 🟡 (suggestion / "Acceptable") thread asking whether an inline comment narrating the change history from #469 ("Bug we fixed…", "Net effect: every render…") belongs in source vs. git history. CI is green; PR is non-draft and mergeable.
- Worker instructed to exercise judgement on the 🟡 nit (trim if redundant with commit/PR description, otherwise reject with rationale), re-run the AC gate against #471 (currently `Fixes #471`), and return PR to ready.

**Current State (PR-side):**
- **PR #472** — non-draft, CI green, mergeable, `oR green ready 💬1` per `lxa`. Picked up for review this tick.
- **PR #465** — draft + `on-hold` (tvOS per-file drafts). Skipped per decision table (stuck-PR rule + on-hold label).

**Current State (issue-side):**
- **Ready issues**: #470 (impl in flight via `0653d94`), #471 (covered by PR #472, now being reviewed), #386 (`on-hold` overlay — skipped).
- **Issues needing expansion**: none.
- **On-hold (kept on hold this tick)**:
  - #299, #301 — mechanical blockers (#298, #295) are closed, but lift remains **vetoed by the AGENTS.md S3 design freeze § Active design freeze (codified policy gate)**. The three freeze-lift conditions (production `VR_WORKSPACE_BUCKET` + four AWS creds in `/var/www/vr.chorecraft.net/app/.env`, plus `docs/runbooks/s3-bucket-provisioning.md` smoke test) are not verifiable from the orchestrator sandbox. No `## INSTRUCTION:` override block in WORKLOG.md.
  - #300, #302 — mechanical blockers still open (#299, #300). Stays on hold both mechanically and by S3 freeze overlay.
  - #210, #239, #386 — policy-tracked holds with no machine-form `Blocked by #N` rationale. Untouched.
  - #372 — `needs-human`. Skipped.

**Unblock Pass:** 0 issues lifted. Two candidates with all machine-form blockers closed (#299, #301) intentionally held per AGENTS.md S3 freeze § "Active design freeze: workspace persistence (S3 / #298)". Same verdict and reasoning as the previous tick — no state change.

**Reconciliation:**
- Implementation worker `0653d94` (issue #470) → still `running` per API; left in place.
- Review slot: 0/2 → 1/2 (`dd18157` for PR #472).
- Implementation slot: 1/1 (unchanged).
- Expansion slot: 0/4 (no work).

**Action Taken:**
🚀 Spawned review worker `dd18157` for PR #472 (1 unresolved pr-review-bot thread, CI green).
🔍 Unblock pass run; 0 lifted (AGENTS.md S3 freeze overrides mechanical unblock for #299/#301).
🔁 Quiet-tick counter reset to 0 (productive tick).

_This entry was created by an AI agent (OpenHands orchestrator, manual /orchestrate) on behalf of @jpshackelford._

---
### 2026-06-10 20:58 UTC - Review worker (PR #472 / issue #471)

✅ **Address-review round complete on PR #472** (`refactor(client): stabilize useSttEngine callback identities`).

| Item | Result |
|---|---|
| Review threads | 1 unresolved (🟡 pr-review-bot nit) → accepted + resolved |
| Change | `client/src/components/MobileMode.tsx` comment trimmed from 33 lines → 7 lines |
| Rationale | Bot was right: comment narrated diagnosis of #469 and net-effect-of-bug, which belongs in git history. Trimmed to present-state design intent only. |
| Commit | `707ec93` |
| CI | All checks green (Build / Client / Server / E2E / lint-pr-title) |
| AC gate re-run | **unchanged** — all 5 non-exempt ACs from #471 still covered; AC#5 (#469 guard kept with comment) still satisfied by trimmed comment which still notes the guard is redundant after #471 and explains belt-and-suspenders rationale |
| Trailer | `Fixes #471` unchanged |
| Follow-ups | None opened. PR body's deferred-list unchanged. |
| State | Back to ready for review (non-draft) |

PR: https://github.com/jpshackelford/voice-relay/pull/472

_This entry was created by an AI agent (OpenHands review worker) on behalf of @jpshackelford._

---
### 2026-06-10 21:01 UTC - Implementation worker (issue #470)

✅ **PR #473 opened (ready for review): toggleable verbose STT lifecycle logging via session settings.**

| Item | Result |
|---|---|
| PR | https://github.com/jpshackelford/voice-relay/pull/473 |
| Branch | `feat/verbose-stt-logging-toggle` (off `e38a9fa`, before PR #472's WORKLOG-only update) |
| AC gate | ✅ all 13 non-exempt ACs satisfied — `Fixes #470` |
| Tests | Server 1747/1747; Client 1241/1241; TypeScript clean both projects; CI green incl. E2E |
| Follow-ups | None opened |

**Scope of change:**

- Server: `verboseSttLogging?: boolean` in `SessionMetadata`/DTO/Patch with default `false`, strict-boolean validation, added to `VALID_SETTINGS_PATCH_KEYS`. No SQL migration (JSON metadata column).
- System prompt: new bullet + two curl examples (on / off) so the AI agent can flip the firehose on user request. `openhands.test.ts` placeholder count bumped 10 → 12.
- Client `useSpeechRecognition`: ref-gated `reportLifecycle` for the verbose firehose + new `reportLifecycleAlways` companion for the four always-on lifecycle events (`onerror`, `start-call-threw`, `stopListening-threw`, `tryRestart-threw`). `aborted-suppressed` and `no-onstart` were already direct `reportClientError` calls so they bypass the gate by construction.
- Client `useHostedSpeechRecognition`: prop accepted as parity stub (JSDoc'd no-op).
- Client `useSttEngine`: forwards the flag to both child hooks.
- Client `useWebSocket`: **back-fills #378's intent** — added the `case 'session-settings-changed'` the client had never consumed (verified during expansion), exposes a new `sessionSettings: SessionSettingsDTO | null` field. Legacy `sessionTtsSettings` is mirrored from the snapshot so single-PATCH `verboseSttLogging` flips don't break TTS consumers.
- Client UI: Mobile gets a "Diagnostics" subsection with a 🐛 toggle; kiosk gets an inline 🐛/🔇 header icon next to auto-submit (chose expansion-comment option *(i)* "smaller diff" over building a new kiosk modal).

**Rebase awareness:** PR #472 was awaiting review when I branched. I touched `useSttEngine.ts` only to add the new `verboseSttLogging` option; PR #472 also touches the file. Rebase impact should be small once #472 merges.

**AC gate verdict:** `Fixes #470`. All 13 acceptance-criteria checkboxes are satisfied by the diff; no follow-up issues were filed.

_This entry was created by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---
### 2026-06-10 21:11 UTC - Merge worker (PR #472)

✅ **PR #472 squash-merged to main; issue #471 auto-closed.**

| Item | Result |
|---|---|
| PR | https://github.com/jpshackelford/voice-relay/pull/472 |
| Squash commit | `0c1c7df` — `refactor(client): stabilize useSttEngine callback identities (#472)` |
| Linked issue | #471 — auto-closed by `Fixes #471` trailer |
| AC gate | ✅ PASS — 5/5 non-exempt criteria met, AC #6 exempt (issue-marked "Optional, defer") |
| Migrations | None — client-only refactor |
| CI pre-merge | All 7 checks SUCCESS (Build Client, Client Tests, Server Tests, E2E, enable-orchestrator, lint-pr-title, pr-review) |
| Review threads | 0 unresolved (1 thread resolved earlier) |

**AC gate per-item verdict (vs issue #471 § Acceptance Criteria):**

| # | Criterion | Status |
|---|---|---|
| 1 | `useSttEngine.startListening`/`.stopListening` stable across renders | ✅ Met — `useCallback` deps now `[]`, dispatch via `wsRef`/`hostedRef`/`effectiveEngineRef` |
| 2 | ≥5-render identity-stability regression test | ✅ Met — `keeps startListening / stopListening identity stable across ≥5 renders with the same options` |
| 3 | Inner-hook-fresh-literal identity test | ✅ Met — `keeps public callback identity stable even when inner-hook return identities change` (vi.mock factories already return fresh literals) |
| 4 | Existing `useSttEngine.test.ts` suite passes | ✅ Met — 17 existing + 4 new = 21 tests pass; full client suite 1235/1235 |
| 5 | `prevInputModeRef` guard kept in `MobileMode.tsx` with comment | ✅ Met — guard kept; comment now says "technically redundant — kept as defense-in-depth" with pointer to contract test |
| 6 | `useChangeEffect<T>` helper | ⏭️ Exempt — issue text marks "(Optional, defer to follow-up if scope grows)" |

**Production impact:** Auto-deploys to vr.chorecraft.net via main → server pipeline. Client-only refactor; no schema or behavior change to user-facing flows. The downstream effect is that `MobileMode`'s inputMode-change `useEffect` no longer relies on identity-churn for the iOS Safari race fix that PR #469 patched — `prevInputModeRef` remains as belt-and-suspenders.

**Downstream rebase note:** PR #473 (verbose STT logging, in review) touches `useSttEngine.ts` and was authored against pre-#472 `main`. The #473 author flagged a small rebase impact in their worklog entry above; a small conflict in the new options-forwarding wiring is expected and not blocking.

_This entry was created by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---
### 2026-06-10 21:19 UTC - Merge worker (PR #473 → main)

✅ **Merged PR #473 — `feat(client): toggleable verbose STT lifecycle logging via session settings`**

| Field | Value |
|---|---|
| PR | [#473](https://github.com/jpshackelford/voice-relay/pull/473) |
| Squash commit | `928f06b` — `feat(client): toggleable verbose STT lifecycle logging via session settings (#473)` |
| Linked issue | #470 — auto-closed by `Closes #470` trailer (closedAt 2026-06-10T21:19:21Z) |
| AC gate | ✅ PASS — 14/14 acceptance criteria covered, 0 deferred/out-of-scope |
| Migrations | None — additive boolean in opaque `SessionMetadata` JSON column; no DDL, no backfill |
| CI pre-merge (post-rebase) | All 5 required checks SUCCESS (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title) |
| Review threads | 0 unresolved |

**AC gate per-item verdict (vs issue #470 § Acceptance Criteria):**

| # | Criterion | Status |
|---|---|---|
| 1 | `verboseSttLogging: boolean` in `SessionMetadata` / `SessionSettingsDTO` / `SessionSettingsPatch` | ✅ Met — `server/src/sessions/types.ts`, `settings-service.ts` |
| 2 | `VALID_SETTINGS_PATCH_KEYS` includes `'verboseSttLogging'` | ✅ Met — `settings-service.ts` |
| 3 | PATCH strict boolean validation; non-boolean → 400 | ✅ Met — `validateAndCoalesce` throws `SettingsValidationError`; `settings-router.test.ts` 400 case |
| 4 | Default `false` for new sessions | ✅ Met — `DEFAULT_VERBOSE_STT_LOGGING = false` constant |
| 5 | `session-settings-changed` WS broadcast carries the field | ✅ Met — covered by `settings-service.test.ts` broadcast assertion |
| 6 | `useSpeechRecognition` gates verbose-only events; errors/throws/`aborted-suppressed`/`no-onstart` always fire | ✅ Met — new `reportLifecycleAlways` helper + `verboseSttLoggingRef` gate; 4 tests in `useSpeechRecognition.test.ts` |
| 7 | `useHostedSpeechRecognition` accepts the option (no-op parity) | ✅ Met — JSDoc'd as parity stub |
| 8 | `useSttEngine` forwards to both inner hooks | ✅ Met — 2 tests in `useSttEngine.test.ts` `describe('verbose STT lifecycle logging (#470)')` |
| 9 | Mobile settings sheet Diagnostics subsection + PATCH | ✅ Met — `MobileSettings.tsx` + `MobileMode.tsx` `handleVerboseSttLoggingChange` |
| 10 | Kiosk equivalent affordance | ✅ Met — inline 🐛/🔇 header icon in `KioskMode.tsx` (option *i* from expansion) |
| 11 | `system-prompt.md` lists field with curl example | ✅ Met — two new curl examples (on/off); `openhands.test.ts` placeholder-count assertion bumped |
| 12 | `settings-service.test.ts` PATCH/validation/defaults/broadcast | ✅ Met — 6 new cases in `describe('applyPatch — verboseSttLogging (#470)')` |
| 13 | `settings-router.test.ts` Bearer + JWT round-trip | ✅ Met — 3 new REST cases |
| 14 | `useSpeechRecognition.test.ts` verbose-on/off + always-on assertions | ✅ Met — 4 cases in `describe('verbose STT lifecycle logging (#470)')` |
| 15 | `session-settings-api.spec.ts` E2E smoke for round-trip | ✅ Met — extended existing GET/PATCH and validation specs |

**Rebase note:** PR #472 (`refactor(client): stabilize useSttEngine callback identities`) merged seconds before #473's merge window opened, so the merge worker rebased `feat/verbose-stt-logging-toggle` onto post-#472 main (`8ad557c`). Sole conflict was in `client/src/hooks/useSttEngine.test.ts` where both PRs added a new sibling `describe` block at the end of the outer suite — resolved by keeping both (`callback identity stability (issue #471)` from #472 and `verbose STT lifecycle logging (#470)` from #473) side-by-side. Post-rebase `npx vitest run src/hooks/useSttEngine.test.ts` (23/23 pass) and `npx tsc --noEmit` (clean) re-verified locally before push; CI re-ran clean on the rebased head.

**Production impact:** Auto-deploys to vr.chorecraft.net via main → server pipeline. Default is `false` so the firehose stays off in production until an operator explicitly flips it per-session via the mobile Diagnostics toggle, kiosk 🐛 icon, or `PATCH /api/sessions/:id/settings -d '{"verboseSttLogging": true}'`. Always-on diagnostic events (real `onerror`, throws, `aborted-suppressed`, `no-onstart`) continue to fire either way, so we don't lose visibility into actual STT failures with the flag off. No SQL migration; the new boolean lives in the opaque `SessionMetadata` JSON column.

_This entry was created by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

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
