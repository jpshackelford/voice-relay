# Voice Relay Worklog

## Log

### 2026-06-05 13:51 UTC - Orchestrator

🔒 **Auto-disabled due to inactivity** (2nd consecutive quiet tick)

No actionable work remained after PR #402 merged at 13:21:35Z:

- **Open PRs:** 0
- **Issues needing expansion:** 0
- **Ready+prioritized issues not on-hold/needs-human:** 0
- **All 10 open issues are blocked:**
  - `on-hold` (9): #210, #239, #299, #300, #301, #302, #351, #363, #384
  - `needs-human` (1): #372
- **Active workers:** 0 (merge worker `8919f27` for PR #402 finished cleanly; sandbox PAUSED at 13:21:51Z)

Quiet-tick counter went `1 → 2`, so per the auto-disable rule the v2 orchestrator automation (`5f180989-ed9c-42b4-ac9f-5f30f0623316`) has been disabled to prevent unnecessary cron runs while the backlog is fully blocked. The S3 workspace-persistence design freeze (#298–#302, per `AGENTS.md`) is still in effect, which is why those issues remain `on-hold`.

**To re-enable** (after a human unblocks one or more of the on-hold/needs-human issues, or files new work):

- OpenHands UI: https://app.all-hands.dev/automations → "Voice Relay Workflow Orchestrator v2" → toggle on
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-05 22:18 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `5e8b184` | implementation | Issue #403 — Refresh/rebind workspace API key | **NEW** |

🔓 **Re-enabled automation `5f180989-ed9c-42b4-ac9f-5f30f0623316`** ("Voice Relay Workflow Orchestrator v2") — `PATCH /api/automation/v1/{id} {"enabled": true}` returned 200. Auto-disabled at 13:51Z; new work (#403, #404) has since landed, so resuming.

🚀 **Spawned: Implementation Worker**

- Issue: [#403 — Refresh & rebind use the env-keyed singleton OpenHandsClient instead of the per-workspace API key](https://github.com/jpshackelford/voice-relay/issues/403) (`bug`, `ready`, `priority:high`, `critical`, `scope:server-only`)
- Conversation: [`5e8b184`](https://app.all-hands.dev/conversations/5e8b184eabaa45428fb04226194b3ff4)
- Start-task id: `bb71d91466da4849ac449e07e0e81161` → `app_conversation_id = 5e8b184eabaa45428fb04226194b3ff4` (`status = READY` on first poll; `execution_status = running`, `sandbox_status = RUNNING`)
- Plugin ref: `voice-relay-workflow @ main`

**Current State:**
- **Open PRs:** 0 (PR #402 squash-merged at 13:21:35Z — `feat(server): hosted STT (Deepgram) broker + workspace settings`, closed Issue #386).
- **Ready+prioritized issues (unblocked):**
  - **#403** — `priority:high`, `critical` — **NOW IN IMPL SLOT** ✅
  - **#404** — `priority:medium`, depends on #403 per comment "Cleanup follow-up that depends on this fix: #404" → deliberately deferred until #403 lands so the cleanup PR isn't fighting the bugfix PR.
- **Issues needing expansion:** 0 (both #403 and #404 already have `ready` label and full technical-approach bodies).
- **Ready issues on-hold (excluded):** #351, #363.
- **Issues without `ready` label that are skipped:** all are `on-hold` or `needs-human` (#210, #239, #299, #300, #301, #302, #372, #384).
- **Active slot summary:** expansion 0/4, implementation 1/1, review 0/2.

**Decision rationale:**
- 0 open PRs → no review/merge work this tick.
- Impl slot was empty (1 available) → spawn for highest-priority unblocked ready issue.
- #403 (`priority:high` + `critical`) outranks #404 (`priority:medium`). #404 is also a dependent cleanup of #403, so even ignoring priority it must wait.
- No expansion work — all unexpanded issues are `on-hold`/`needs-human`.
- After this spawn: expansion 0/4 idle (nothing eligible), impl 1/1 full, review 0/2 idle (no open PRs).

**Why the orchestrator was off when this tick fired:** the v2 automation auto-disabled at 13:51Z when the backlog was fully blocked (all 10 open issues at that moment were `on-hold` / `needs-human`). Between 13:51Z and 22:18Z, @jpshackelford filed #403 and #404, which made the backlog actionable again — but auto-disable correctly prevented the cron from spinning idle in the interim. Manual `/orchestrate` invocation is the documented unblock path.

**Quiet-tick counter:** reset `2 → 0` (productive tick).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-05 22:35 UTC - Implementation worker (#403)

✅ PR opened and CI green for the workspace-key recovery-path fix.

- Issue: [#403 — Refresh & rebind use the env-keyed singleton OpenHandsClient instead of the per-workspace API key](https://github.com/jpshackelford/voice-relay/issues/403)
- PR: [#406](https://github.com/jpshackelford/voice-relay/pull/406) — `fix(server): refresh & rebind honor per-workspace OpenHands API key (#403)`
- Branch: `fix/403-workspace-key-in-refresh-rebind`
- Status: marked **ready for review** (review-bot triggered).

**What landed:**
- `AISession` gains `workspaceId` + `apiKey?`; populated at both construction sites (`getOrCreateForSession`, `attachExistingForSession`).
- New `clientForSession(session)` helper used by `doRefreshSessionCredentials` and `doRebindSession`.
- `pollSandboxRunning` and `buildRebindReplaySuffix` now take an explicit client so the resume poll and memory-replay GET use the same bearer as the rest of the path.
- Env fallback (`this.client`) preserved end-to-end — strict superset of today's behaviour. Removing it is tracked in #404 (deliberately not rolled in).

**Tests:** new `AISessionManager workspace-key resolution (#403)` describe block — 8 cases covering refresh, rebind (POST + events-page GET), PAUSED→RUNNING resume, key rotation, env-fallback preservation, and clean degrade when no client is configured. Full server suite passes (1547 tests / 76 files). The two regression guards called out in the issue body (`auto-connect.test.ts:317–329` and `agent-rehydrate.test.ts:238–258`) still pass.

**CI status (PR #406):** Server Tests ✅ • Client Tests ✅ • Build Client ✅ • E2E Tests ✅ • lint-pr-title ✅

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---
### 2026-06-05 22:35 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `ca35fb8` | implementation | Issue #405 — Typed reason for missing WS handshake materials | **NEW** |

**Worker Completed Last Tick:** `5e8b184` (implementation, Issue #403) → **finished**
- Created [PR #406](https://github.com/jpshackelford/voice-relay/pull/406) — `fix(server): refresh & rebind honor per-workspace OpenHands API key (#403)`.
- All required CI checks green; `pr-review` IN_PROGRESS; `mergeable=MERGEABLE` / `mergeStateStatus=UNSTABLE` (gated on pr-review verdict). No unresolved review threads yet — nothing to address this tick.

🚀 **Spawned: Implementation Worker**

- Issue: [#405 — Replace opaque 'missing WS handshake materials' error with a typed, self-describing reason](https://github.com/jpshackelford/voice-relay/issues/405) (`enhancement`, `ready`, `priority:low`, `scope:server-only`)
- Conversation: [`ca35fb8`](https://app.all-hands.dev/conversations/ca35fb869e5d4f45bdcc567cfe01ed71)
- Start-task id: `a2f89df0f4d34f109700c5d3214beaad` → `app_conversation_id = ca35fb869e5d4f45bdcc567cfe01ed71` (`status = READY` on first poll; `execution_status = running`, `sandbox_status = RUNNING`)
- Plugin ref: `voice-relay-workflow @ main`
- Heads-up given to worker: PR #406 also touches `server/src/openhands.ts`; rebase if it lands first; scope is the typed-reason error model in `getOrCreateForSession` only.

**Current State:**
- **Open PRs:** 1 — [PR #406](https://github.com/jpshackelford/voice-relay/pull/406) (Issue #403). Status: `o pending ready` — required CI green, `pr-review` IN_PROGRESS, no unresolved threads.
- **Ready+prioritized issues (unblocked):**
  - **#403** → covered by PR #406 (closes on merge).
  - **#404** — `priority:medium`, depends on #403/PR #406 — **deferred** until #406 merges (avoids fighting the bugfix PR).
  - **#405** — `priority:low` — **NOW IN IMPL SLOT** ✅ (independent of #406's diff modulo same file).
- **Issues needing expansion:** 0.
- **Ready issues on-hold (excluded):** #351, #363.
- **Issues without `ready` label that are skipped:** all are `on-hold` or `needs-human` (#210, #239, #299, #300, #301, #302, #372, #384).
- **Active slot summary:** expansion 0/4, implementation 1/1, review 0/2.

**Decision rationale:**
- Last tick's impl worker (5e8b184) successfully created PR #406 and exited — moved to `completed`.
- PR #406 has no unresolved review threads yet (pr-review still running). No review worker spawn needed; merge worker can't run while `mergeStateStatus=UNSTABLE`. Next tick will reassess once pr-review reports.
- Impl slot freed → spawn for highest-priority unblocked ready issue.
- Priority order of eligible unblocked: #404 (medium, blocked by #403/#406) → **skip**; #405 (low, independent) → **spawn**.
- Risk noted: #406 and #405 both edit `server/src/openhands.ts`. Surface areas are disjoint (#406 = refresh/rebind, #405 = `getOrCreateForSession` typed errors). Worker instructed to rebase if #406 merges first.
- No expansion work — all unexpanded issues are `on-hold`/`needs-human`.

**Quiet-tick counter:** reset `0 → 0` (productive tick: 1 worker spawned, 1 worker reaped to completed).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-05 22:50 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `ca35fb8` | implementation | Issue #405 — Typed reason for missing WS handshake materials | running |
| `e531d1f` | review | PR #406 — workspace-key fix (#403) | **NEW** |

🚀 **Spawned: Review Worker for PR #406**

- PR: [#406 — fix(server): refresh & rebind honor per-workspace OpenHands API key (#403)](https://github.com/jpshackelford/voice-relay/pull/406)
- Conversation: [`e531d1f`](https://app.all-hands.dev/conversations/e531d1f3cb7f4f319c84bf12309f8a3e)
- Start-task id: `ba773d70` → `app_conversation_id = e531d1f3cb7f4f319c84bf12309f8a3e` (`status = READY` on 2nd poll; `execution_status = running`, `sandbox_status = RUNNING`)
- Plugin ref: `voice-relay-workflow @ main`
- Scope: comment-only cleanup. 11 unresolved 🟡 *Suggestion* threads from the `pr-review` bot — all asking to shrink JSDoc/inline comments in `server/src/openhands.ts` that were added with the workspace-key fix. None are 🛑 blocking.

**PR #406 status at dispatch:**
- All required CI ✅ green: Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review (SUCCESS).
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`.
- 11 unresolved review threads (all from `github-actions` pr-review bot, all `isOutdated=false`).
- `reviewDecision=""` (no required human reviewers).

**Worker instructions emphasized:**
- Pragmatic accept/decline — accept the bot's compressed comments whenever the load-bearing info (the `#403` linkage / *why*) survives; decline only when an invariant would be dropped, and keep a one-line trimmed version in that case.
- Single squash-able commit `style(server): tighten comments per pr-review on #403 fix`. Comments-only diff — no behaviour change, no test changes.
- After resolving all 11 threads and re-greening CI, move PR back to ready and exit. **Merge handoff is a separate orchestrator tick.**
- WORKLOG.md only on `main`; `.workflow-state.json` is hands-off (orchestrator owns it). Branch Hygiene CI guard will reject either file in the PR branch.

**Current State:**
- **Open PRs:** 1 — [PR #406](https://github.com/jpshackelford/voice-relay/pull/406) (Issue #403). Now: `oR green ready 💬11` → after this review round will become `oRF green ready 💬0` and eligible for the merge worker.
- **Ready+prioritized issues (unblocked):**
  - **#403** → covered by PR #406 (review round in flight).
  - **#404** — `priority:medium`, depends on PR #406 — **still deferred**.
  - **#405** — `priority:low` — implementation worker `ca35fb8` running (spawned at 22:35Z).
- **Issues needing expansion:** 0 actionable. All unexpanded issues are `on-hold` (#210, #239, #299, #300, #301, #302, #384) or `needs-human` (#372).
- **Ready issues on-hold (excluded):** #351, #363.
- **Active slot summary:** expansion 0/4 (no eligible work), implementation 1/1 full, review 1/2 (1 slot free, but no other PRs need attention).

**Decision rationale:**
- Last tick's reaping caught up to current state — `ca35fb8` (impl on #405) is still `running` per `/api/v1/app-conversations` query; left in place.
- PR #406 transitioned from `oR green ready` with `pr-review IN_PROGRESS` (last tick) to `pr-review SUCCESS` + 11 unresolved threads (this tick). Threads need addressing before the merge worker fires.
- Review slot available (0/2 → 1/2) → spawned exactly 1 review worker for PR #406. No other PRs exist, so the 2nd review slot stays idle.
- No expansion work — same on-hold backlog as last tick.
- No new implementation work — #405 is in flight and #404 is the only other eligible candidate but it's blocked on PR #406 landing.
- No merge worker yet: spawning one with 11 unresolved threads would either (a) merge over unaddressed feedback or (b) immediately bail and waste a slot. Better to let the review worker normalize the PR first.

**Quiet-tick counter:** reset `0 → 0` (productive tick: 1 review worker spawned).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

### 2026-06-05 22:58 UTC - Review worker (PR #406 review round)

✅ Addressed all 11 🟡 *Suggestion* threads from `github-actions` pr-review bot on [PR #406](https://github.com/jpshackelford/voice-relay/pull/406) (#403 fix).

**Commit:** `819fd88` — `style(server): tighten comments per pr-review on #403 fix` (server/src/openhands.ts, +17 / -69, comments-only)

**Disposition:** all 11 suggestions accepted as-suggested or with a 1-line variant that preserved the load-bearing invariant. Notably:
- `clientForSession` docstring kept the `#404` env-fallback-removal reference per the orchestrator's "preserve invariant" guidance.
- `AISession.workspaceId` / `AISession.apiKey` JSDoc collapsed to single-line `/** … (#403). */` comments; the rotation NB is now implicit in "snapshot" + carried by `clientForSession` docstring.
- All 8 inline `// Issue #403:` block comments collapsed to either `// #403: honor workspace key` trailing comments or short `// Capture/Cache workspace context for refresh/rebind (#403)` headers; ones that simply restated the code were removed outright.

**CI:** all 5 required checks green on `819fd88` — Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title. `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, `isDraft=false`.

**Threads:** 11/11 replied with `Fixed in 819fd88…` and resolved via `resolveReviewThread`. The pr-review workflow did not re-fire on this push (comment-only diff likely skipped its trigger paths) — 0 new threads.

PR #406 is ready for the merge worker on the next orchestrator tick.

_This worklog entry was written by an AI agent (OpenHands review worker) on behalf of @jpshackelford._

---

### 2026-06-05 23:00 UTC - Implementation worker (#405)

✅ Opened [PR #407](https://github.com/jpshackelford/voice-relay/pull/407) — `feat(server): typed reason for missing-WS-handshake failure` (#405).

**Branch:** `feat/405-typed-handshake-reason` off `main` @ `c64de6f` (does not collide with PR #406's refresh/rebind paths).

**Scope:** server-only error-reporting refactor. No DB migrations, no env-var changes, no client changes, no new deps.

**Changes:**
- `server/src/openhands.ts`: new `MissingWsHandshakeReason` union (`auth-rejected` / `sandbox-stopped` / `sandbox-missing` / `paused-no-sandbox-id` / `unknown`); `UpstreamConversationEndedError` carries an optional readonly `reason`; pure classifier `explainMissingHandshake(convInfo, lastError?)`; renderer `formatMissingHandshakeMessage(id, reason)`; both throw sites (create-path in `getOrCreateForSession`, attach-path in `attachExistingForSession`) now emit the typed reason + self-describing message. `pollSandboxRunning` grew an optional `onTransientError` callback so the attach-path can capture the last swallowed 401 without leaking through the resolver contract.
- `server/src/agent-driver/openhands.ts`: `BindResult.error.cause: Error` so `openSession` and `restartSession` re-throw the original typed error instead of wrapping in `new Error(msg)`. Prior wrapping silently dropped the `.reason` on `UpstreamConversationEndedError` before it could reach the broadcast layer — caught and fixed during implementation; covered by 3 new driver tests.
- `server/src/auto-connect.ts` + `server/src/agent-rehydrate.ts`: when the caught error is an `UpstreamConversationEndedError` with a typed `reason`, propagate `err.message` into the `degraded` `session-state.error` field (and the matching legacy `session-ai-status.error` in `auto-connect.ts`). Otherwise keep the existing sanitized generic message.

**Tests:** +31 tests total — 23 in `openhands.test.ts`, 3 in `agent-driver/openhands.test.ts`, 3 in `auto-connect.test.ts`, 2 in `agent-rehydrate.test.ts`. **All 1570 server tests pass.** Coverage stays at 93.9% statements / 88.6% branches (≥ 80% threshold).

**CI on `d317d57`:** all required checks green — Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, enable-orchestrator. PR promoted from draft to ready for review; `pr-review` workflow will fire on the next tick.

**Acceptance criteria:** all six AC bullets satisfied (see PR description for the per-bullet mapping). Out-of-scope items (kiosk UI changes, auto-rotation policy, class-hierarchy refactor of `UpstreamConversationEndedError`) deliberately untouched.

**Coordination with PR #406:** different code paths (handshake throw sites + broadcast field vs. refresh/rebind). Will rebase onto `main` once #406 lands if there are textual conflicts in `server/src/openhands.ts` (none expected — different regions of the file).

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---

### 2026-06-05 23:05 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0211d27` | merge | PR #406 — workspace-key fix (#403) | **NEW** |

🚀 **Spawned: Merge Worker for PR #406**

- PR: [#406 — fix(server): refresh & rebind honor per-workspace OpenHands API key (#403)](https://github.com/jpshackelford/voice-relay/pull/406)
- Conversation: [`0211d27`](https://app.all-hands.dev/conversations/0211d27a2d094956b46253cd45e7807d)
- Start-task: `cebf9da4` → `app_conversation_id=0211d27a2d094956b46253cd45e7807d` (READY on 3rd poll; `execution_status=running`, `sandbox_status=RUNNING`)
- Plugin ref: `voice-relay-workflow @ main`

**PR #406 status at dispatch:**
- All 7 CI checks ✅ green: Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review, enable-orchestrator.
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, `isDraft=false`.
- **0 unresolved review threads** (all 11 pr-review bot suggestions were addressed by the last review worker in commit `819fd88`).
- `reviewDecision=""` (no required human reviewers).
- No schema/migration changes (server-only logic change) — production-safe.

**Workers Reaped to `completed`:**
- `ca35fb8` (implementation, issue #405) → finished. Outcome: opened [PR #407 — feat(server): typed reason for missing-WS-handshake failure](https://github.com/jpshackelford/voice-relay/pull/407). Required CI green; `pr-review` IN_PROGRESS at reaping; `mergeable=MERGEABLE/UNSTABLE`.
- `e531d1f` (review, PR #406) → finished. Outcome: addressed all 11 pr-review bot 🟡 *Suggestion* threads in commit `819fd88` (`style(server): tighten comments per pr-review on #403 fix`). CI 5/5 required green; 0 unresolved threads.

**Current State:**
- **Open PRs:**
  - [PR #406](https://github.com/jpshackelford/voice-relay/pull/406) — `oRFC green ready 💬0`, merge worker in flight.
  - [PR #407](https://github.com/jpshackelford/voice-relay/pull/407) — `o pending ready 💬0` (just opened by `ca35fb8`); 5 required checks green, `pr-review` IN_PROGRESS, `mergeStateStatus=UNSTABLE`. Defer to next tick once pr-review settles.
- **Ready+prioritized issues (unblocked):**
  - **#403** (`priority:high`) — covered by PR #406 (merge in flight).
  - **#404** (`priority:medium`) — still depends on PR #406 landing → wait.
  - **#405** (`priority:low`) — covered by PR #407 (just opened, pr-review pending).
- **Issues needing expansion:** 0 actionable. All unexpanded issues are `on-hold` (#210, #239, #299, #300, #301, #302, #384) or `needs-human` (#372).
- **Ready issues on-hold (excluded):** #351, #363.
- **Active slot summary:** expansion 0/4 (no eligible work), implementation 0/1 (idle — all ready+prioritized issues covered by open PRs), review 1/2 (merge worker on #406; 1 slot held for #407 once its pr-review settles).

**Decision rationale:**
- `ca35fb8` and `e531d1f` both transitioned to `finished` (verified via `/api/v1/app-conversations/search`). Reaped to `completed` and slots cleared.
- PR #406 now satisfies the full merge gate: CI green, threads resolved, mergeable=CLEAN, no schema changes. Spawned **merge worker** (review slot, per the slot model) rather than a redundant review round.
- PR #407 has `pr-review` IN_PROGRESS — spawning a review worker now would race with the bot or trigger on stale signals. Defer one tick.
- Implementation slot left idle: #404 is the only other priority issue and remains blocked by PR #406; #405 already has PR #407 open. Spawning a fresh impl worker would either duplicate or create no-op work.
- No expansion work — same on-hold backlog as last tick.

**Quiet-tick counter:** reset `0 → 0` (productive tick: 1 merge worker spawned, 2 workers reaped).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-05 23:08 UTC - Merge worker (PR #406)

✅ **Squash-merged [PR #406](https://github.com/jpshackelford/voice-relay/pull/406)** — `fix(server): refresh & rebind honor per-workspace OpenHands API key (#403)` → main as `6641c71`.

**Pre-merge verification:**
- 7/7 CI checks green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review, enable-orchestrator)
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, `isDraft=false`, no `on-hold`/`needs-human` labels
- 0 unresolved review threads (all 11 pr-review bot suggestions addressed in `819fd88`)
- **Migration check:** `git diff main -- 'server/src/db' migrations '*.sql'` → empty. Server-only logic change, safe for SQLite production auto-deploy.
- Code diff scope: `server/src/openhands.ts` (+71/-16) and `server/src/openhands.test.ts` (+300). No other files.

**What landed:**
- `AISession` snapshots `workspaceId` + optional `apiKey` at attach time (`getOrCreateForSession`, `attachExistingForSession`).
- New `clientForSession(session)` helper returns a workspace-scoped `OpenHandsClient` from `session.apiKey`, falling back to the env-keyed singleton when unset.
- `doRefreshSessionCredentials` and `doRebindSession` use the helper at every upstream call site; `pollSandboxRunning` and `buildRebindReplaySuffix` accept the resolved client so the PAUSED→RUNNING resume poll and the memory-replay GET ride the same bearer as the rest of the recovery path.
- Durable fix for the 2026-06-04 production incident (env-key revocation → infinite refresh/rebind 401 loop surfacing as misleading "missing WS handshake materials").

**Follow-up:** #404 still tracks removal of the env fallback (`OPENHANDS_CLOUD_API_KEY` / `OPENHANDS_API_KEY`), `AISessionManager.isAvailable()`, and `/api/ai/status`. PR #406 deliberately preserves the fallback as a strict superset of today's behaviour.

**Issue closure:** #403 auto-closed via `Fixes #403` link at 23:07:52 UTC (state=CLOSED, reason=COMPLETED).

**Production impact:** auto-deploys to vr.chorecraft.net on push to main. No schema/migration risk. Existing regression guards (`auto-connect.test.ts:317–329`, `agent-rehydrate.test.ts:238–258`) still pass — env-fallback deploys keep functioning until #404 lands.

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---

### 2026-06-05 23:17 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4e00461` | review | PR #407 — typed handshake reason (#405 fix) | **NEW** |
| `1e12cd0` | implementation | Issue #404 — remove env-fallback API key | **NEW** |

🚀 **Spawned 2 Workers (parallel)**

1. **Review Worker for PR #407**
   - PR: [#407 — feat(server): typed reason for missing-WS-handshake failure](https://github.com/jpshackelford/voice-relay/pull/407)
   - Conversation: [`4e00461`](https://app.all-hands.dev/conversations/4e00461c7ec1445ea5bbeae1437d5241) (start-task `04f4c787` → READY → `execution_status=running`)
   - Scope: rebase onto latest main (PR #406 just landed at `6641c71` and creates a conflict in `server/src/openhands.ts` + auto-connect/agent-rehydrate code paths), then condense the 5 pr-review bot 🟡 *Suggestion* threads (all about verbose change-history comments). No 🔴 *Blocker* threads.

2. **Implementation Worker for Issue #404**
   - Issue: [#404 — Remove vestigial OPENHANDS_CLOUD_API_KEY / OPENHANDS_API_KEY env fallback](https://github.com/jpshackelford/voice-relay/issues/404) (`priority:medium`, `audit`, `scope:full-stack`)
   - Conversation: [`1e12cd0`](https://app.all-hands.dev/conversations/1e12cd0ee1264706bb41b2fa71f061c9) (start-task `57afa4b6` → READY → `execution_status=running`)
   - Scope: remove env-key constructor default in `server/src/openhands.ts`, drop `AISessionManager.isAvailable()` + `/api/ai/status`, update `docs/DESIGN.md` env sample, swap regression guards in `auto-connect.test.ts` / `agent-rehydrate.test.ts` over to workspace-scoped keys. **Strictly-narrowing change** — production must have `workspace_settings.openhands_api_key_encrypted` set before this lands.

**Workers Reaped to `completed`:**
- `0211d27` (merge, PR #406) → finished. Outcome: squash-merged PR #406 as `6641c71` (`fix(server): refresh & rebind honor per-workspace OpenHands API key`). Issue #403 auto-closed at 23:07:52Z. Server-only logic change, no migration risk for prod auto-deploy.

**Current State:**
- **Open PRs:**
  - [PR #407](https://github.com/jpshackelford/voice-relay/pull/407) — `oR? dirty ready 💬5` (CI all green, `mergeStateStatus=DIRTY` from #406 landing, 5 unresolved pr-review bot suggestion threads — being addressed by `4e00461`).
- **Ready+prioritized issues (unblocked):**
  - **#404** (`priority:medium`) — implementation in flight via `1e12cd0` (dependency on #403 now satisfied).
  - **#405** (`priority:low`) — covered by PR #407 (review in flight via `4e00461`).
- **Issues needing expansion:** 0 actionable. All unexpanded issues remain `on-hold` (#210, #239, #299, #300, #301, #302, #384) or `needs-human` (#372).
- **Ready issues on-hold (excluded):** #351, #363.
- **Slot summary:** expansion 0/4 (no eligible work), implementation 1/1 (full — #404), review 1/2 (PR #407 in flight; second slot held for the next PR to need attention).

**Decision rationale:**
- `0211d27` merge worker for PR #406 transitioned to `finished` via `/api/v1/app-conversations/search`. PR was already squash-merged (last WORKLOG entry confirms the merge at 23:08 UTC), so the conv lingering was just sandbox cleanup. Reaped to `completed`.
- PR #407 needed both rebase (DIRTY) **and** thread cleanup. Spawned one review worker to handle both in a single round — cheaper than two passes.
- Issue #404's gate just opened (#403/PR #406 landed). Spawned the implementation worker immediately rather than waiting a tick; this is the only unblocked, prioritized, ready issue without a PR in flight.
- No expansion worker spawned — every issue without `ready` is `on-hold` or `needs-human`. Same backlog state as the previous two ticks.

**Quiet-tick counter:** reset `0 → 0` (productive tick: 2 workers spawned, 1 worker reaped).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-05 23:35 UTC - Review Worker (PR #407 — #405 typed handshake reason)

✅ **Rebased + addressed pr-review feedback on PR #407**

| Item | Status |
|------|--------|
| Rebase onto `8e07ac8` (post-#406) | ✅ resolved 2 conflicts in `server/src/openhands.ts` (`pollSandboxRunning` signature + call site) — combined #403's workspace-client param with #405's `onTransientError` option |
| Server typecheck (`tsc --noEmit`) | ✅ clean |
| Server tests (`vitest run`) | ✅ 1578 / 1578 pass (76 files) |
| Force-push rebase (`ad6eca8`) | ✅ CI re-ran: Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title all green |
| Style-tightening commit (`3247e10`) — 5 pr-review 🟡 *Suggestion* threads | ✅ `style(server): tighten comments per pr-review on #405 typed-reason` (+11/-65) |
| CI on combined branch | ✅ all green, `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE` |
| 5 review threads replied + resolved (referencing `3247e10`) | ✅ all `isResolved=true` |
| PR back to ready | ✅ `isDraft=false` |

**Changes in style commit:**
- `MissingWsHandshakeReason` docblock — collapsed 19-line value-by-value enumeration into a 4-line priority-order summary.
- `auto-connect.ts` / `agent-rehydrate.ts` `degradedError` comments — replaced 7-line change-history narration with a single-line invariant ("Propagate typed WS-handshake failures; sanitize everything else.").
- `agent-driver/openhands.ts` `BindResult` docblock — dropped duplicate stale block + condensed the 11-line "intentional design" prose into a 3-line statement of the typed-cause invariant.
- Two `throw bind.cause` comment blocks — replaced "used to drop / wrapping was wrong" change-narration with a one-liner.
- Inline `// Issue #405: classify ...` block at the attach-path throw site — condensed to one line.

**Next tick:** PR #407 is ready for the merge worker. No further review action needed unless a new push lands.

_This worklog entry was written by an AI agent (OpenHands review worker) on behalf of @jpshackelford._

---

### 2026-06-05 23:50 UTC - Implementation Worker (#404)

🚀 **Issue #404 — vestigial OPENHANDS_CLOUD_API_KEY env fallback removed**

PR opened: [#408](https://github.com/jpshackelford/voice-relay/pull/408) (`chore/404-remove-env-fallback` → `main`), commit `878499f`. Built on top of `8e07ac8` and the post-#406 main HEAD `c9fbcdc`.

| Layer | Change |
|---|---|
| Server `openhands.ts` | `OpenHandsClient` ctor now requires `apiKey` (env reads dropped). `AISessionManager` no-arg ctor no longer builds a client; `setClientForTesting` is the only test seam. `getOrCreateForSession` / `attachExistingForSession` throw a #404-tagged typed-message error when neither a test client nor `options.apiKey` is supplied (incl. empty-string `apiKey`). |
| Server `index.ts` | `/api/ai/status` endpoint deleted (tombstone comment retained). |
| Agent-driver interface | `isAvailable()` removed from `AgentDriver`, OH driver, and `FakeDriver` (incl. the `available` field + `setAvailable()`). |
| Auto-connect / rehydrate | Gates collapsed to `if (!apiKey)`. Workspace key is now the only credential source. |
| Client | `useAI.checkAvailability` + `aiAvailable` startup probe removed from `KioskMode` / `MobileMode` and matching test mocks. |
| Docs | `.env.example`, `README.md`, `docs/DEPLOYMENT.md`, `docs/DESIGN.md` no longer reference the env var. `docs/openhands-platform.md` keeps `OPENHANDS_API_KEY` (OH's own bearer term) with a #404 note. `tests/smoke/*` updated. |
| Tests | 1546 server + 1074 client all green locally. New positive tests cover the post-removal contract; env-fallback regression tests deleted. CI green: Build Client / Client Tests / Server Tests / E2E / lint-pr-title all ✅. |

**Out of scope (per issue body):**
- `scripts/openhands-websocket-demo.ts`, `scripts/capture-events.ts` — standalone dev CLIs with their own env contract.
- `.github/workflows/enable-orchestrator.yml` `OPENHANDS_API_KEY` Actions secret — different system; not touched.
- No schema changes.

**Production risk:** strictly narrowing. After merge any deployment without `workspace_settings.openhands_api_key_encrypted` set will get a hard `'OpenHands API not configured: workspace API key required (#404).'` error at session-open time instead of the prior soft-warn → env-fallback. Production currently has the env vars set; they become noise once #404 ships and can be removed from `.env` on the next deploy.

**Status:** PR #408 moved from draft → ready for review (CI fully green). Review handling is a separate orchestrator-spawned conversation.

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---

### 2026-06-05 23:55 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `7264a05` | review | PR #407 — typed handshake reason (#405) | **NEW** |
| `910dfdc` | review | PR #408 — drop env-key fallback (#404) | **NEW** |

🚀 **Spawned 2 Review Workers (parallel)**

1. **Review Worker for PR #407** ([round 2](https://github.com/jpshackelford/voice-relay/pull/407))
   - Conversation: [`7264a05`](https://app.all-hands.dev/conversations/7264a057d2eb4c24bb66e658a1279cdd) (start-task `4ac77bac` → READY → `execution_status=running`)
   - Scope: address the lingering 🟡 *Suggestion* thread `PRRT_kwDOSTUWGM6HgMp2` (github-actions, 2026-06-05 23:37:05Z) that asks for an 8→2-line condensation of a typed-reason test comment. CI 5/5 required green; `mergeStateStatus=CLEAN`. Single-commit round expected (one suggestion only).

2. **Review Worker for PR #408** ([round 1](https://github.com/jpshackelford/voice-relay/pull/408))
   - Conversation: [`910dfdc`](https://app.all-hands.dev/conversations/910dfdcc8c0c45889febd70b78c1c600) (start-task `ee217a0d` → READY → `execution_status=running`)
   - Scope: address 🟡 *Suggestion* thread `PRRT_kwDOSTUWGM6HgQnD` (github-actions, 2026-06-05 23:44:52Z) by **both** tightening `OpenHandsClient` ctor to treat whitespace as missing (`if (!apiKey || !apiKey.trim())`) **and** adding the matching whitespace regression test so the existing test docblock ("Empty/whitespace strings") matches reality. CI 5/5 required green; `mergeStateStatus=CLEAN`.

**Workers Reaped to `completed`:**
- `1e12cd0` (implementation, Issue #404) → finished. Outcome: opened [PR #408](https://github.com/jpshackelford/voice-relay/pull/408) (`refactor(server): remove vestigial OPENHANDS_CLOUD_API_KEY env fallback`). All required CI green at reap; `mergeStateStatus=CLEAN`. Server-only refactor, no migration. Production currently has the env var set; it becomes inert after #408 merges.
- `4e00461` (review, PR #407) → finished. Outcome: rebased onto post-#406 main (resolved 2 conflicts in `server/src/openhands.ts`: `pollSandboxRunning` signature + call site combined #403's workspace-client param with #405's `onTransientError`), then condensed 5 pr-review 🟡 suggestion threads in style commit `3247e10`. Required CI green; `mergeStateStatus=CLEAN`; 1 new lingering bot suggestion at reap (the one `7264a05` is now addressing).

**Current State:**
- **Open PRs (both fully green, both 1 unresolved 🟡 thread):**
  - [PR #407](https://github.com/jpshackelford/voice-relay/pull/407) — `oRF clean ready 💬1` — review in flight via `7264a05`.
  - [PR #408](https://github.com/jpshackelford/voice-relay/pull/408) — `o clean ready 💬1` — review in flight via `910dfdc`.
- **Ready+prioritized issues (unblocked):** 0 actionable. The only two prioritized-ready issues — #404 and #405 — both have PRs in flight.
- **Issues needing expansion:** 0 actionable. All unexpanded issues remain `on-hold` (#210, #239, #299, #300, #301, #302, #384) or `needs-human` (#372).
- **Ready issues on-hold (excluded):** #351 (`priority:low`, `on-hold`), #363 (`priority:medium`, `on-hold`).
- **Slot summary:** expansion 0/4 (no eligible work), implementation 0/1 (no eligible work — every unblocked ready issue has an in-flight PR), review 2/2 (full — both PRs in their review round).

**Decision rationale:**
- Both finished workers had completed productive work end-to-end (visible in WORKLOG entries at 23:35 / 23:50 UTC); reaped both to `completed`.
- PR #407 needed one more pass for the just-posted 🟡 suggestion; the established pattern on this PR family has been to accept these comment-tightening suggestions, so a quick second review round is cheaper than letting the merge worker decide and then having to bounce back.
- PR #408 likewise needs one round to handle the whitespace-input suggestion; combining the constructor tightening with the test-coverage addition lets one commit close the thread.
- No implementation worker spawned — every unblocked, prioritized, ready issue currently has a PR in flight. Spawning a parallel impl on the same fixed point would just create branch noise.
- No expansion worker spawned — same backlog as the previous tick: every unexpanded issue is `on-hold` or `needs-human`. Until @jpshackelford lifts the S3 design freeze (#298–#302) or releases #372 from `needs-human`, the expansion slot will remain idle.

**Quiet-tick counter:** reset `1 → 0` (productive tick: 2 workers spawned, 2 workers reaped).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-05 23:58 UTC - Review worker (PR #408, round 1)

✅ **Addressed PR #408 pr-review 🟡 suggestion thread (`PRRT_kwDOSTUWGM6HgQnD`)**

Picked **both** halves of the bot's suggestion in one commit — the tweaks are tiny and aligned with the audit-style scope of #404:

| Layer | Change |
|-------|--------|
| `OpenHandsClient` ctor (`server/src/openhands.ts`) | Tightened guard to `if (!apiKey || !apiKey.trim())`. Direct construction (not just via the manager) with a doomed all-whitespace key now fails at the same gate with the same `Missing OpenHands API key…` message. |
| `AISessionManager.getOrCreateForSession` | Short-circuited on `options.apiKey?.trim()` so a whitespace `options.apiKey` falls through to the manager-level typed `OpenHands API not configured: workspace API key required (#404).` error — same path as the existing empty-string sibling test. |
| `server/src/openhands.test.ts` | Added the whitespace regression test the bot proposed. The sibling test's `"Empty/whitespace strings"` comment now matches reality. |

**Verification (local):** `npx vitest run` in `server/` → 1547 tests pass (was 1546; +1, the new whitespace case). No other test files needed updates — the change is fully additive at the test layer and additive-narrowing at the runtime layer.

**Verification (CI):** all 5 required checks ✅ on commit `ecfd0a6`.

| Check | Status | Duration |
|-------|--------|----------|
| CI/Build Client | ✅ | 27s |
| CI/Client Tests | ✅ | 38s |
| CI/Server Tests | ✅ | 45s |
| CI/E2E Tests | ✅ | 2m0s |
| Conventional Commits/lint-pr-title | ✅ | 5s |

`pr-review` did not re-run on this push (the bot only ran once at PR open, ~14m ago). No new bot threads posted; the original thread was the only one open and is now resolved with a reply pointing at commit `ecfd0a6`.

**Workflow steps performed:**
1. `gh pr ready 408 --undo` → PR back to draft for the iteration.
2. Edits + local `vitest run` (server only — 1547 pass).
3. Commit `ecfd0a6` (`fix(server): treat whitespace-only API key as missing per pr-review on #404`).
4. Pushed; watched `gh pr checks 408 --watch` until all 5 required green.
5. Posted reply via `addPullRequestReviewThreadReply` (comment `PRRC_kwDOSTUWGM7IoJ7K`) referencing `ecfd0a6`.
6. `resolveReviewThread` on `PRRT_kwDOSTUWGM6HgQnD` → `isResolved: true`.
7. `gh pr ready 408` → PR back to ready for review.

**State at handoff:**
- PR #408 — `o clean ready` (5/5 CI green, 0 unresolved review threads, no Branch Hygiene violations — neither `WORKLOG.md` nor `.workflow-state.json` touched on the feature branch).
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`.
- Production impact unchanged from the original PR description: this is strictly a narrowing tightening. Production currently has `OPENHANDS_API_KEY` set; once #408 ships that env var becomes inert. The workspace must have `workspace_settings.openhands_api_key_encrypted` set or session-open errors hard with the typed `#404` message. Deploy target: `vr.chorecraft.net`.

Ready for the merge worker.

_This worklog entry was written by an AI agent (OpenHands review worker) on behalf of @jpshackelford._

---

### 2026-06-06 00:02 UTC - Review worker (PR #407 residual bot suggestions)

✅ Cleared the last unresolved 🟡 pr-review thread on PR #407 and the two follow-up threads the bot posted after the re-trigger. PR is ready for review with all CI green and 0 unresolved threads.

**Round 1 — thread `PRRT_kwDOSTUWGM6HgMp2`** (`server/src/agent-driver/openhands.test.ts:270`):
- Bot suggested condensing an 8-line "previously/now" test comment to a 2-line invariant. Applied verbatim.
- Commit: `3fc43af` — `style(server): tighten test comment per pr-review on #405 typed-reason`.

**Round 2 — re-triggered pr-review after `gh pr ready 407` posted 2 new threads on `server/src/openhands.ts`:**
- `PRRT_kwDOSTUWGM6HgVxT` (line 2422) — 8-line #405-narrating block above `explainMissingHandshake`. Condensed to a single-line invariant.
- `PRRT_kwDOSTUWGM6HgVxb` (line 2592) — 5-line "remember the most recent swallowed transient error" comment on `lastPollError = err`. Condensed to a single-line capture comment.
- Commit: `055f687` — `style(server): tighten openhands.ts comments per pr-review on #405 typed-reason`.

All three threads replied to via `addPullRequestReviewThreadReply` with the commit SHA, then resolved via `resolveReviewThread`. No further bot rounds expected (we explicitly capped at one extra round per the task brief; if a third batch posts after this, it's a separate cycle).

| Check | Status | Duration |
|-------|--------|----------|
| CI/Build Client | ✅ | 26s |
| CI/Client Tests | ✅ | 46s |
| CI/Server Tests | ✅ | 44s |
| CI/E2E Tests | ✅ | 2m9s |
| Conventional Commits/lint-pr-title | ✅ | 5s |

**Workflow steps performed:**
1. `gh pr ready 407 --undo` → draft.
2. Edit + commit `3fc43af` for the test-file thread; push.
3. `gh pr checks 407 --watch` → all 5 green.
4. Replied & resolved `PRRT_kwDOSTUWGM6HgMp2` referencing `3fc43af`.
5. `gh pr ready 407` → triggered a fresh `PR Review by OpenHands` run.
6. Bot posted 2 new 🟡 suggestions on `openhands.ts`. Applied both verbatim in commit `055f687`; pushed.
7. `gh pr checks 407 --watch` → all 5 green again.
8. Replied & resolved `PRRT_kwDOSTUWGM6HgVxT` and `PRRT_kwDOSTUWGM6HgVxb` referencing `055f687`.

**State at handoff:**
- PR #407 — ready for review (not draft), 5/5 required CI green, 0 unresolved review threads, no Branch Hygiene violations (neither `WORKLOG.md` nor `.workflow-state.json` modified on the feature branch).
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, `reviewDecision=""` (no required human reviewer).
- Production impact: server-only typed-reason refactor for missing-WS-handshake failures; no DB migration. Comment-tightening commits are documentation-only — no behavior change since `ad6eca8`. Deploy target: `vr.chorecraft.net`.

Ready for the merge worker.

_This worklog entry was written by an AI agent (OpenHands review worker) on behalf of @jpshackelford._
---

### 2026-06-06 00:08 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4515f17` | merge | PR #407 — typed handshake reason (#405) | **NEW** |
| `60663f9` | merge | PR #408 — drop env-key fallback (#404) | **NEW** |

🚀 **Spawned 2 Merge Workers (parallel)**

1. **Merge Worker for PR #407** ([typed handshake reason](https://github.com/jpshackelford/voice-relay/pull/407))
   - Conversation: [`4515f17`](https://app.all-hands.dev/conversations/4515f17f520146688eca73f4175384d2) (start-task `eedc35de` → READY → `execution_status=running`)
   - Issue: [#405](https://github.com/jpshackelford/voice-relay/issues/405) (`priority:low`, `scope:server-only`).
   - Final state at hand-off: 5/5 required CI ✅, `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE`, 0 unresolved review threads.
   - Sibling-merge note baked into the prompt: PR #408 touches the same file (`server/src/openhands.ts`); if #407 merges second, the worker will rebase + force-push + re-verify CI before re-attempting the squash.

2. **Merge Worker for PR #408** ([drop env-key fallback](https://github.com/jpshackelford/voice-relay/pull/408))
   - Conversation: [`60663f9`](https://app.all-hands.dev/conversations/60663f95e3334f0db7969a5f73c317ab) (start-task `7ccfc5be` → READY → `execution_status=running`)
   - Issue: [#404](https://github.com/jpshackelford/voice-relay/issues/404) (`priority:medium`, `audit`, `scope:full-stack`).
   - Final state at hand-off: 5/5 required CI ✅, `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE`, 0 unresolved review threads.
   - Production-impact note baked into the prompt: post-merge, any deploy without `workspace_settings.openhands_api_key_encrypted` set will hard-error at session-open with the typed `#404` message. Production has the env var set, so live sessions are unaffected; the env var becomes inert and can be removed on the next deploy.

**Workers Reaped to `completed`:**
- `7264a05` (review, PR #407) → finished (success). Outcome: addressed the 8→2-line comment-condensation 🟡 suggestion that was the only open thread; PR back to `CLEAN`/`MERGEABLE`, 0 unresolved threads, 5/5 required CI green.
- `910dfdc` (review, PR #408) → finished (success). Outcome: tightened `OpenHandsClient` ctor to `if (!apiKey || !apiKey.trim())`, added the matching whitespace regression test (1546 → 1547 server tests), resolved the only open 🟡 thread; commit `ecfd0a6` landed; 5/5 required CI green.

**Current State:**
- **Open PRs (both fully green, both merge-ready, both in flight via merge workers):**
  - [PR #407](https://github.com/jpshackelford/voice-relay/pull/407) — `oCRF clean ready 💬0`
  - [PR #408](https://github.com/jpshackelford/voice-relay/pull/408) — `oRF clean ready 💬0`
- **Ready+prioritized issues (unblocked):** 0 actionable. The only two prioritized-ready issues — #404 and #405 — both have PRs about to merge.
- **Issues needing expansion:** 0 actionable. All unexpanded issues remain `on-hold` (#210, #239, #299, #300, #301, #302, #384) or `needs-human` (#372).
- **Ready issues on-hold (excluded):** #351 (`priority:low`, `on-hold`), #363 (`priority:medium`, `on-hold`).
- **Slot summary:** expansion 0/4 (no eligible work), implementation 0/1 (no eligible work — every unblocked ready issue has an in-flight PR), review 2/2 (full — both PRs in merge round).

**Decision rationale:**
- Both review workers from the 23:55Z tick had completed productive work end-to-end (see WORKLOG entry at 23:58 UTC for PR #408; PR #407's round-2 condensation was confirmed via PR poll: 0 unresolved threads, all required CI green). Reaped both to `completed`.
- Both PRs cleared the merge criteria (CI green, MERGEABLE, CLEAN, 0 unresolved threads), so spawning merge workers was the obvious next step.
- Spawned both merge workers in parallel (filling the 2-slot review pool) rather than serializing one-per-tick. Both prompts explicitly cover the rebase-on-conflict path because the two PRs co-locate in `server/src/openhands.ts` — the second to merge will need a rebase + force-push + CI re-verify. Each worker carries the resolution recipe for the specific overlap (typed-reason plumbing + `onTransientError` vs. strict apiKey gate + whitespace trim).
- No implementation worker spawned — every unblocked, prioritized, ready issue has a PR about to land. Once these merge, the next tick will find an empty work pool unless the S3 design-freeze on #298–#302 lifts or #372 comes off `needs-human`.
- No expansion worker spawned — same backlog as the prior two ticks: every unexpanded issue is `on-hold` or `needs-human`.

**Quiet-tick counter:** reset `0 → 0` (productive tick: 2 workers spawned, 2 workers reaped).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._
---

### 2026-06-06 00:10 UTC - Merge Worker (PR #407 → main)

✅ **PR #407 squash-merged.** Issue #405 auto-closed via `Fixes #405`.

| Field | Value |
|---|---|
| Squash SHA | `d37f6cea5e5012b15e2e0d0686d51ad4a465f938` |
| PR title | feat(server): typed reason for missing-WS-handshake failure |
| Required checks | 5/5 green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title) |
| Merge state | `CLEAN` / `MERGEABLE` at merge time — no rebase needed |
| Review threads | 8/8 resolved (all 🟡 suggestion comment-tightenings from prior rounds) |
| Issue #405 | auto-closed (`COMPLETED`) |

**What shipped:**
- Typed `MissingWsHandshakeReason` union on `UpstreamConversationEndedError` and an `explainMissingHandshake` classifier in `server/src/openhands.ts` (priority: 401 → STOPPED → MISSING → PAUSED-no-id → unknown).
- `pollSandboxRunning` gained an optional `onTransientError` callback so the attach-path can capture the last swallowed 401 and feed it to the classifier.
- `agent-driver/openhands.ts` `BindResult.error` now carries `cause: Error`; `openSession` / `restartSession` re-throw the original cause instead of `new Error(msg)` — this preserves the typed `.reason` all the way to the broadcast.
- `auto-connect.ts` and `agent-rehydrate.ts` propagate the typed message into the `degraded` `session-state.error` field (and the legacy `session-ai-status.error` field); generic sanitized fallback retained for non-typed errors.
- 31 new server tests; full suite 1570 passing; coverage 93.9% statements / 88.6% branches.

**Rebase work:** none. PR branched from `8e07ac8` (post-#406); diverging commits on `main` since were worklog-only and did not touch the same files. PR #408 (sibling, Issue #404, strict apiKey gate, same file) is still open as of merge — it will need to rebase next.

**Production-impact notes:**
- Server-only observability narrowing. No schema change, no migrations, no new env vars, no new dependencies. SQLite production storage untouched.
- A `degraded` `session-state` broadcast may now carry one of five typed reason strings ("…cannot open a WS session: sandbox is STOPPED.", etc.) instead of the historical generic "Upstream conversation no longer available — restart session" string. The `error` field is treated as free-form display text on the client, so no client-side changes are required.
- Auto-deploy to `vr.chorecraft.net` triggered by merge.

**Sibling-PR coordination:** PR #408 (chore/404-remove-env-fallback) remains `OPEN` and touches the same `server/src/openhands.ts`. Its merge worker will need to rebase onto `d37f6ce` and re-verify checks before merging.

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---

### 2026-06-06 00:13 UTC - Merge worker (PR #408 / Issue #404)

✅ **PR #408 squash-merged.** Issue #404 auto-closed via `Fixes #404`.

| Field | Value |
|---|---|
| Squash SHA | `e68580d62777b0d365314027cdb8ff6b6052efed` |
| PR title | refactor(server): remove vestigial OPENHANDS_CLOUD_API_KEY env fallback (#404) |
| Required checks | 5/5 green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title) |
| Merge state | `CLEAN` / `MERGEABLE` at merge time |
| Review threads | 1/1 resolved (the lone 🟡 whitespace-coverage suggestion, addressed in `ecfd0a6`) |
| Issue #404 | auto-closed at `00:13:24Z` via `Fixes #404` link in PR body |

**What shipped:**
- `OpenHandsClient` ctor: `apiKey` now required; `OPENHANDS_CLOUD_API_KEY` / `OPENHANDS_API_KEY` env reads deleted. Whitespace-only keys are rejected via `!apiKey || !apiKey.trim()` (pr-review on #404) so they don't construct a doomed client.
- `AISessionManager` no-arg ctor no longer builds a default client. The only construction paths are `setClientForTesting(client)` (tests) and `clientForSession(session)` (per-request, using `session.apiKey`).
- `getOrCreateForSession` / `attachExistingForSession` throw a typed `'OpenHands API not configured: workspace API key required (#404).'` error when no test client and no usable workspace `apiKey` are supplied. Empty-string and whitespace-string cases now have positive test coverage.
- `isAvailable()` deleted from `AgentDriver`, `AISessionManager`, `OpenHandsAgentDriver`, and `FakeDriver`. `/api/ai/status` endpoint removed; per-session readiness is broadcast via `session-state`.
- Client: `useAI.checkAvailability`, the `/api/ai/status` probe, and the `aiAvailable` startup flag deleted from `useAI`, `KioskMode`, and `MobileMode`. The AI status indicator gates purely on `connected || connecting` from the session-state reducer.
- Auto-connect / agent-rehydrate gates collapse to `if (!apiKey)`; comments tombstone-reference #404.
- Docs scrub: `.env.example`, `README.md`, `docs/DEPLOYMENT.md`, `docs/DESIGN.md` no longer mention the env vars. `docs/openhands-platform.md` keeps the term (it's OH's own bearer-token name) with a #404 note.
- 1546 / 1546 server + 1074 / 1074 client tests pass locally; full suite 1578 passing after the rebase replay (with #407's typed-reason work also in).

**Rebase work:** PR #407 (issue #405, typed handshake reason) merged at `00:10:34Z` as `d37f6ce`, three minutes before this merge. The two PRs both touch `server/src/openhands.ts` but in disjoint regions, so the rebase was a no-op — `git merge-tree` showed no conflict markers and a dry-run `git rebase origin/main` succeeded without prompts. Re-ran `npx vitest run` in `server/` post-rebase: **1578 / 1578 passing**. The PR's recorded `mergeStateStatus` flipped from `CLEAN` → `UNKNOWN` → `CLEAN` over ~15s while GitHub re-validated against the new base; merged via `gh pr merge 408 --squash` from the original PR head (no force-push needed).

**Production-impact notes:**
- Auto-deploy to `vr.chorecraft.net` triggered by merge to `main`.
- **Hard breaking change at session-open time.** Any workspace without `workspace_settings.openhands_api_key_encrypted` configured will now fail to start AI sessions with `Error: 'OpenHands API not configured: workspace API key required (#404).'` (previously a `console.warn` soft-deprecation). Production currently has both `OPENHANDS_CLOUD_API_KEY` and `OPENHANDS_API_KEY` set in `/var/www/vr.chorecraft.net/app/.env`; **existing sessions keep working** because they're flowing through per-workspace keys (plumbed in #406/#403). The env vars are now inert and can be removed on the next deploy.
- **No schema / migration changes.** SQLite production DB unchanged. `workspace_settings.openhands_api_key_encrypted` (migration `003`) already exists on production.
- Failure mode for a mis-configured workspace is a `session-state` broadcast with `error: 'OpenHands API not configured…'` — same wire shape the kiosk already handles. No silent degradation.

**Cleanup follow-up (informational, not blocking):** at the next deploy, remove `OPENHANDS_CLOUD_API_KEY` and `OPENHANDS_API_KEY` from `/var/www/vr.chorecraft.net/app/.env`. The server no longer reads them. Leaving them in place is harmless (inert) until then.

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---
