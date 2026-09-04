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
