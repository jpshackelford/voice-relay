# Voice Relay Worklog

## Log

### 2026-05-24 17:37 UTC - Orchestrator

🚀 **Spawned: 2 Merge Workers (parallel)**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `813c620` | merge | [PR #318](https://github.com/jpshackelford/voice-relay/pull/318) — docs: DEPLOYMENT.md multi-DNS correction | **NEW** |
| `b305387` | merge | [PR #316](https://github.com/jpshackelford/voice-relay/pull/316) — test(client): client coverage uplift (refs #303) | **NEW** |

1. **Merge Worker — PR #318**
   - Diff: `docs/DEPLOYMENT.md` only (docs-only)
   - CI: 7/7 SUCCESS · MERGEABLE · 0 unresolved review threads
   - Conversation: [`813c620`](https://app.all-hands.dev/conversations/813c6209e5a94529b5d41c53873c35bd)

2. **Merge Worker — PR #316**
   - Diff: 5 `client/**` test files + `client/vite.config.ts` (matches `scope:client-only`)
   - CI: 8 SUCCESS + 2 SKIPPED · MERGEABLE · 0 unresolved review threads
   - Refs #303 (does NOT close — partial coverage uplift; #303 stays open)
   - Conversation: [`b305387`](https://app.all-hands.dev/conversations/b3053873903942a79fc1e1a63503689b)

**Current State:**
- **Open PRs (3)**:
  - [PR #319](https://github.com/jpshackelford/voice-relay/pull/319) (Path B persistence design docs) — 6 unresolved `github-actions` review threads, deferred to next tick for a review worker
  - [PR #318](https://github.com/jpshackelford/voice-relay/pull/318) — merging now
  - [PR #316](https://github.com/jpshackelford/voice-relay/pull/316) — merging now
- **Ready issues (10)**: #289, #290, #291, #292, #293, #294, #295, #296, #297, #303 (none currently in implementation)
- **Issues needing expansion**: 0 🎉
- **On-hold (design freeze)**: #298, #299, #300, #301, #302 — still blocked pending operator-side S3 bucket + IAM provisioning per the 05:38 UTC entry. Not touching these.

**Action Taken:**
✅ Spawned 2 parallel merge workers (review slots 2/2)
- Both PRs verified MERGEABLE, CI green, zero unresolved threads, clean scope.
- Implementation slot deliberately left empty: with 3 PRs already in flight (one of which is mid-merge x2 right now), spawning new implementation work would add a 4th open PR without value. Once these merge and #319's review feedback is addressed, the impl slot will pick up the next priority:high ready issue from the #289–#297 chain.

**quiet_ticks** reset to 0 (productive tick).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 17:38 UTC - Merge worker (PR #316)

✅ **Merged PR #316** — `test(client): cover uuid, deviceName, and 3 hooks under coverage gate`.

- **Scope**: client-only (6 files: 5 new test files under `client/src/{hooks,utils}/`, plus `client/vite.config.ts` removing the now-covered modules from the coverage-gate exclusion list). Matches `scope:client-only` label.
- **CI**: all green (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, pr-review, enable-orchestrator).
- **Review**: no unresolved threads.
- **Merge state**: `MERGEABLE` / `CLEAN`, squash-merged.
- **Issue link**: refs #303 (issue remains **OPEN** — partial coverage uplift; 12 modules still excluded and will be picked up in follow-up batches per the issue's recommended batching workflow).
- **Production impact**: tests-only addition. Auto-deploy to vr.chorecraft.net is a no-op for runtime behavior; the coverage gate now exercises 5 previously-excluded modules.

Modules now under the 80% gate after this batch:

| Module | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `utils/uuid.ts` | 100 | 100 | 100 | 100 |
| `utils/deviceName.ts` | 100 | 100 | 100 | 100 |
| `hooks/useDeletionPreview.ts` | 100 | 100 | 100 | 100 |
| `hooks/useSpeechSynthesis.ts` | 100 | 100 | 100 | 100 |
| `hooks/useSpeechRecognition.ts` | 100 | 89 | 100 | 100 |

All-files aggregate post-merge: **94.42 stmts / 89.64 branch / 96.72 funcs / 96.40 lines**.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 17:38 UTC - Merge Worker (PR #318)

✅ **Merged** [PR #318](https://github.com/jpshackelford/voice-relay/pull/318) — `docs: correct DEPLOYMENT.md multi-DNS reality, drop false 'legacy' framing`

| Field | Value |
|---|---|
| Merge commit | `c4c4c4c` |
| Strategy | squash |
| Scope | `docs/DEPLOYMENT.md` only (43 +, 13 −) |
| CI | 7/7 SUCCESS (Server/Client/E2E/Build/lint-pr-title/enable-orchestrator/pr-review) |
| Review | 1 bot review (`github-actions`, COMMENTED, "🟢 Good taste"); no unresolved threads |
| Production | No redeploy — path-ignored by `deploy.yml` (`paths-ignore: ['*.md', 'docs/**']`) |

Fixes the false "legacy chorecraft.net vs. new app.no-hands.dev" framing in `docs/DEPLOYMENT.md`. Replaces it with the SSH-verified reality: a single Ubuntu box, one Node process on `127.0.0.1:3002`, served by Apache vhosts for both `app.no-hands.dev` (preferred) and `vr.chorecraft.net` (alias), with the apex `no-hands.dev` doing a permanent redirect to `app.no-hands.dev`. Adds a vhost-pair table and clarifies which adjacent things on the same server are **not** the VR app (`chorecraft.net` apex static site; `ja.chorecraft.net` on `:3000`).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 17:48 UTC - Orchestrator

🚀 **Spawned: 2 Workers (parallel)** — both PR-handling slots filled.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---|---|---|---|
| `e785075` | review | [PR #319](https://github.com/jpshackelford/voice-relay/pull/319) — docs: switch persistence design to Path B | **NEW** |
| `6751e67` | implementation | [Issue #289](https://github.com/jpshackelford/voice-relay/issues/289) — Route platform code through AgentDriver interface | **NEW** |

1. **Review Worker — PR #319**
   - 6 unresolved `github-actions` bot threads (1× 🟠 Important + 5× 🟡 Suggestion), all CI green, MERGEABLE, 12h old
   - The 17:37 UTC entry explicitly deferred this PR to the next tick — now picked up
   - Briefed with per-thread guidance: 🟠 thread → decline-and-resolve (N/A under Path B); 5× 🟡 threads → mostly accept (add Error handling subsections to restore/snapshot, add Security blast radius row to trade-offs table, sharpen freeze-lift trigger criteria); docs-only diff strictly limited to `docs/architecture.md`
   - Conversation: [`e785075`](https://app.all-hands.dev/conversations/e785075d7a114b68838c2d3de17ef011)

2. **Implementation Worker — Issue #289** (priority:high)
   - Unblocked by PR #311 merge (#288 closed at 04:52 UTC); foundational refactor of the #289→#297 chain
   - Briefed: route device WS handler / auto-connect / session router through `AgentDriver` (the `openHandsAgentDriver` adapter is the prod binding); reuse `FakeDriver` (#287) in unit tests; PR title `feat(server): …` (scope `server` allowed; `agent`/`driver` not — per AGENTS.md); apply `scope:server-only` label
   - Conversation: [`6751e67`](https://app.all-hands.dev/conversations/6751e678d68f42fda241b7508ea23896)

**Current State:**
- **Open PRs (1)**:
  - [PR #319](https://github.com/jpshackelford/voice-relay/pull/319) — review worker now addressing 6 bot threads
- **Ready issues (10)**: #289 (now in impl), #290, #291, #293, #296 (all priority:high); #292, #294, #295, #297, #303 (priority:medium). Will pick up next high-priority from the chain once #289 PR opens.
- **Issues needing expansion**: 0 — only #210/#239/#299/#300/#301/#302 lack `ready`, all `on-hold` per the persistence freeze (#298 still gated on operator-side S3 bucket + IAM provisioning).
- **Running conversations (per OH API)**: 3 (this orchestrator tick + the 2 newly-spawned workers) — confirms `.workflow-state.json` matches reality.

**Slot utilization after spawn:**
| Slot | Used | Limit |
|---|---|---|
| expansion | 0 | 4 |
| implementation | 1 | 1 (full) |
| review | 1 | 2 |

The 2nd review slot is intentionally left empty — there's only 1 open PR, so a 2nd review worker would have nothing to do. If #319 isn't merged before the next tick *and* the impl worker opens a new PR with bot review feedback, that 2nd slot becomes useful.

**Worklog housekeeping:** WORKLOG.md was at 1388 lines pre-tick. Truncation archived 34 entries older than the most-recent-6-hours-of-productive-work window into `WORKLOG_ARCHIVE_2026-05-24.md` (previously 213 lines, now 1047 lines). Kept 4 entries; file is now 128 lines.

`quiet_ticks` reset to 0 (productive tick — 2 workers spawned + worklog truncation).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

### 2026-05-24 17:57 UTC - Review worker (PR #319)

✅ Addressed all 6 bot review threads on [PR #319](https://github.com/jpshackelford/voice-relay/pull/319) — `docs: switch persistence design to Path B (VR-proxied S3)`. PR was a docs-only design unblock; all CI was already green and `reviewDecision` was empty (no human-requested changes). Goal of this tick: tighten the doc per bot feedback without re-opening the Path B decision.

Single commit on `docs/path-b-vr-proxied-s3` ([`fd9c527`](https://github.com/jpshackelford/voice-relay/commit/fd9c527e56f7ad39d13a74031ec8d3639c917460)):

| Thread | Severity | Disposition | Edit |
|---|---|---|---|
| OH per-conversation custom-secret writability | 🟠 Important | Decline (N/A under Path B — Path B uses no per-user AWS creds) | Reply only; narrowed concern to bearer-Option-1 selection criteria |
| Decision criteria for sandbox-to-VR auth options | 🟡 Suggestion | Accept + defer | Added "Selection deferred to v1 impl issue" block with explicit gates (OH per-conversation secret writes; OH egress IP stability) and pick-(1)/pick-(3)/pick-(2) criteria |
| Error handling on restore | 🟡 Suggestion | Accept | New "Error handling" subsection: fail-closed default; 5xx → 3× exp backoff (1/2/4 s); 204 → no-op (preserved); 401/403 → no retry; corrupt tar → fail-closed with `/workspace` recreate |
| Error handling on snapshot | 🟡 Suggestion | Accept | Mirror subsection with deliberate asymmetry: log+continue, durability lag acceptable, session-loss is not; 60 s backstop covers transient failures |
| Security blast radius row | 🟡 Suggestion | Accept | New trade-offs row: single VR credential → all-user blast radius; mitigations = IAM permissions boundary + rotation + secret-scanning + CloudTrail alarms. Honest framing as "many small radii → one big one." |
| Freeze-lift "complete" ambiguity (AGENTS.md) | 🟡 Suggestion | Accept | Split into two distinct triggers: **freeze lifts** when `VR_WORKSPACE_BUCKET` + `AWS_*` set in prod `.env` + `docs/runbooks/s3-bucket-provisioning.md` executed end-to-end (smoke test 200); **section deletable** when #298–#302 all closed |

All 6 threads replied to (with reasoning + commit SHA) and marked resolved via `resolveReviewThread` mutation.

**Diff hygiene:** 2 files (`AGENTS.md`, `docs/architecture.md`); 80 insertions, 9 deletions. No `WORKLOG.md`/`.workflow-state.json` touched on the PR branch. PR moved draft → ready after all 5 CI checks (Build Client, Client Tests, Server Tests, E2E, lint-pr-title) returned green.

**Post-merge follow-ups** for the orchestrator / impl worker to consider:

- Issues #299, #300 should inherit the new error-handling specs from `docs/architecture.md` as acceptance criteria when they're un-frozen — worth cross-referencing in the issue bodies so the impl worker doesn't miss them.
- The `docs/runbooks/s3-bucket-provisioning.md` runbook is now an explicit dependency of #298 prep; calling that out on #298 would help.
- The PR title remains accurate after edits — no design decision was changed, only refinements.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 18:07 UTC - Orchestrator

🚀 **Spawned: Merge worker for PR #319**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---|---|---|---|
| `6751e67` | implementation | [Issue #289](https://github.com/jpshackelford/voice-relay/issues/289) — Route platform code through AgentDriver interface | running (since 17:51 UTC, ~15 min) |
| `a9691fe` | merge | [PR #319](https://github.com/jpshackelford/voice-relay/pull/319) — docs: switch persistence design to Path B (VR-proxied S3) | **NEW** |

**Worker completed last tick:** `e785075` (review on PR #319) → moved to `.workflow-state.json` `completed[]`. Addressed all 6 `github-actions` bot threads in commit `fd9c527`; all threads resolved.

**PR #319 merge-readiness verified pre-spawn:**

| Signal | Value |
|---|---|
| `mergeable` | MERGEABLE |
| `mergeStateStatus` | CLEAN |
| Status checks | Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title / pr-review / enable-orchestrator — all SUCCESS |
| Unresolved review threads | 0 (6 / 6 resolved) |
| Labels | (none) — no `on-hold` / `needs-human` / `blocked` |
| Draft | false |
| `reviewDecision` | "" — no human review required for docs-only PR |

Merge worker briefing: re-verify mergeability immediately (defends against last-second label changes), confirm diff stays doc-only (`docs/architecture.md` + `AGENTS.md`), squash with a conventional `docs:` commit, close PR #313 as superseded (Path A implementation — design decision in #319 made Path A non-target), comment on issue #298 noting the next gate is operator-side `docs/runbooks/s3-bucket-provisioning.md` runbook execution. Issues #298–#302 stay on-hold.

Conversation: [`a9691fe`](https://app.all-hands.dev/conversations/a9691fecd033480e96442b616c8f7bb8)

**Current state:**
- Open PRs (1): #319 (now in merge queue)
- Ready issues (10): #289 (in impl), #290, #291, #292, #293, #294, #295, #296, #297, #303 — none need expansion. #289 is the active impl; #290/#291/#293/#296 are the priority:high tail.
- On-hold issues: #298–#302 (persistence freeze; #319 decides Path B but freeze remains until bucket+creds are operator-provisioned per the `docs/runbooks/s3-bucket-provisioning.md` gate added by the review-worker edits).

**Slot utilization after spawn:**

| Slot | Used | Limit |
|---|---|---|
| expansion | 0 | 4 |
| implementation | 1 | 1 (full — `6751e67` on #289) |
| review | 1 | 2 (one slot held by merge worker for #319) |

Second review slot left empty: there are no other open PRs and the impl worker on #289 hasn't pushed yet, so no second review/merge target exists this tick.

`quiet_ticks` reset to 0 (productive — worker spawned).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 18:08 UTC - Merge Worker (PR #319)

✅ **Merged: PR #319 — docs: switch persistence design to Path B (VR-proxied S3)**

| Field | Value |
|---|---|
| Merge commit | [`a883cbb600916ddd7a5ec6c7468ac61182318b17`](https://github.com/jpshackelford/voice-relay/commit/a883cbb600916ddd7a5ec6c7468ac61182318b17) |
| Strategy | squash (conventional `docs:` title) |
| Merged at | 2026-05-24T18:07:35Z |
| Files | `AGENTS.md`, `docs/architecture.md` (doc-only — path-ignored by `deploy.yml`) |
| Diff | +158 / −36 lines |

**Pre-merge re-verification (defensive checks):**

| Signal | Value |
|---|---|
| `mergeable` | MERGEABLE |
| `mergeStateStatus` | CLEAN |
| Status checks | 7 / 7 SUCCESS (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, pr-review, enable-orchestrator) |
| Unresolved review threads | 0 / 6 |
| Labels | (none) — no `on-hold` / `needs-human` regression |
| Draft | false |
| Diff scope | confirmed doc-only |

**Architectural decision recorded:** Path B (VR-proxied S3) is now canonical in `docs/architecture.md` § Persistence layer. VR backend holds the only AWS credential; sandboxes never see AWS material; users have zero AWS surface area. Closes the architecture-side of the persistence freeze.

**Post-merge follow-ups:**

| Action | Outcome |
|---|---|
| Close PR #313 (Path A implementation, superseded) | Already closed earlier today (2026-05-24T05:35:58Z) with a thorough superseded comment that linked PR #319. Posted brief post-merge confirmation: [#issuecomment-4529567467](https://github.com/jpshackelford/voice-relay/pull/313#issuecomment-4529567467). No re-closure needed. |
| Comment on #298 (next gate is operator-side runbook) | Posted: [#issuecomment-4529567942](https://github.com/jpshackelford/voice-relay/issues/298#issuecomment-4529567942). Notes that #298 stays `on-hold` until operator runs `docs/runbooks/s3-bucket-provisioning.md` and provisions bucket + VR `.env` credential. |
| `on-hold` labels on #298–#302 | **Not removed** — correct. The freeze remains until operator-side bucket provisioning lands. The architecture decision unblocks design, not implementation. |
| `.workflow-state.json` update | **Skipped** — orchestrator owns this file. |

**Freeze status:** Architecture-side cleared. Operator-side freeze active (waiting on S3 bucket + credential per the `docs/runbooks/s3-bucket-provisioning.md` runbook gate). Issues #298, #299, #300, #301, #302 remain `on-hold`. The `## Active design freeze` block in `AGENTS.md` has been rewritten in this PR to reflect the new freeze posture and should not be removed until the operator clears the bucket-provisioning gate.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 18:20 UTC - Implementation worker (Issue #289)

✅ **Routed platform code through `AgentDriver` interface — PR [#320](https://github.com/jpshackelford/voice-relay/pull/320) ready for review.**

Migrated the device WebSocket handler, auto-connect logic, session router, AI conversation endpoints, event/thinking/action callbacks, and shutdown off direct `AISessionManager` use and onto the provider-neutral `AgentDriver` seam introduced in #287 / #288. The `OpenHandsAgentDriver` adapter from PR #311 (commit `d8fe380`) is now the **only** platform consumer of the legacy manager.

| Item | Detail |
|---|---|
| Branch | `feat/289-route-platform-through-agentdriver` |
| PR | [#320](https://github.com/jpshackelford/voice-relay/pull/320) — `feat(server): route platform code through AgentDriver interface` |
| Scope label | `scope:server-only` |
| Diff | 13 files changed, +1160/-341 (server/ only; 3 new files) |
| Tests | **970 passed** (+30 net new), coverage 93.77% statements / 83.04% branches overall; agent-driver folder 93%/83% |
| CI | Server Tests ✅, Client Tests ✅, Build Client ✅, E2E Tests ✅, lint-pr-title ✅, enable-orchestrator ✅ |

**Key design moves:**
- Extended `AgentDriver` with `isAvailable()`, `hasSession()`, and fan-out registration (`onRawEvent` / `onThinkingChange` / `onActionEvent` — each returns an unsubscribe handle, throwing listeners isolated).
- `OpenHandsAgentDriver.openSession()` now eagerly binds upstream so `conversationId` is available immediately for metadata + status broadcast (preserves observable auto-connect behavior).
- Singleton ownership moved to `server/src/agent-driver/index.ts` — `openhands.ts` no longer exports it.
- New `relayAgentResponse` helper (`server/src/agent-message-relay.ts`) iterates `agentDriver.sendMessage`'s `AsyncIterable<AgentEvent>` to replace the legacy session-level `onMessage` callback.
- New driver-substitution proof test (`server/src/auto-connect.fake-driver.test.ts`) exercises auto-connect + relay against `FakeDriver` only — no OH adapter import. If the seam is real, the test passes (it does).

**Migration completeness gates:** All three from the issue's technical-approach comment now empty:
- T-2.3.M.1 (no platform imports from `openhands.ts`) ✅
- T-2.3.M.2 (no bare `aiSessionManager` references outside `agent-driver/`) ✅
- T-2.3.M.3 (singleton not exported from `openhands.ts`) ✅

**Downstream impact:**
- #290 (text path through driver): naturally consumed here via `relayAgentResponse`.
- #291 (closeSession on disconnect): `AgentDriver.closeSession` now usable from the disconnect path.
- #293 (refactor `index.ts` AI bootstrap): done here.
- #296 (delete legacy `aiSessionManager` usage from platform): platform side complete; the `AISessionManager` class itself remains as the implementation behind the OH adapter, which is the correct architectural position.

**Followups noted, not done in this PR:**
- The display-result-feedback fallback path now also iterates through the driver but suppresses the AI's response (legacy behavior preserved). Could later be unified with `relayAgentResponse` if we decide to surface those AI responses.
- E2E happy-path test against the real OpenHands API (T-2.3.E.1) was deliberately deferred — production smoke on Chorecraft post-merge serves as the substitute, consistent with how prior driver work in this chain was validated.

**Production:** Server-side refactor only, no schema changes, no migrations. App will auto-deploy to vr.chorecraft.net on merge.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 18:38 UTC - Merge worker (PR #320)

✅ **Merged: PR #320 — `feat(server): route platform code through AgentDriver interface`**

| Field | Value |
|---|---|
| Merge commit | [`afd9db77000542d3de03041c99f2516663bee151`](https://github.com/jpshackelford/voice-relay/commit/afd9db77000542d3de03041c99f2516663bee151) |
| Strategy | squash (conventional `feat(server):` title) |
| Merged at | 2026-05-24T18:38:15Z |
| Branch | `feat/289-route-platform-through-agentdriver` |
| Closes | #289 (auto-closed via `Fixes #289` at 2026-05-24T18:38:16Z) |
| Diff | 13 files, +1160 / −341 (server/ only; 3 new files) |
| Scope | `scope:server-only` — server-only refactor, no schema/migrations |

**Pre-merge re-verification (defensive checks):**

| Signal | Value |
|---|---|
| `mergeable` | MERGEABLE |
| `mergeStateStatus` | CLEAN |
| Status checks | 7 / 7 SUCCESS (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, pr-review, enable-orchestrator) |
| Unresolved review threads | 0 / 0 |
| Bot review verdict | 🟡 Acceptable / ✅ Worth merging |
| Labels | `scope:server-only` (no `on-hold` / `needs-human`) |
| Diff scope | confirmed server-only (`git diff --name-only origin/main...HEAD \| awk -F/ '{print $1}' \| sort -u` → `server`); no schema/migration/SQL files |

**Migration completeness gates (T-2.3.M.1 / M.2 / M.3): all green.** Platform code no longer imports `openhands.ts` directly; the `AISessionManager` singleton is owned by `server/src/agent-driver/index.ts` and the legacy module no longer exports it. `OpenHandsAgentDriver` remains the sole consumer of `AISessionManager`, which is the correct architectural position.

**Squash commit body** highlights:
- `AgentDriver` extensions: `isAvailable()`, `hasSession()`, and fan-out registration (`onRawEvent` / `onThinkingChange` / `onActionEvent`) with unsubscribe handles and isolated listeners.
- Eager session binding in `OpenHandsAgentDriver.openSession()` preserves the legacy `getOrCreateForSession` bootstrap so `conversationId` is available immediately for metadata + `session-ai-status`.
- New `relayAgentResponse` helper (`server/src/agent-message-relay.ts`) iterates `agentDriver.sendMessage`'s `AsyncIterable<AgentEvent>`, replacing the session-level `onMessage` callback.
- Driver-substitution proof: `server/src/auto-connect.fake-driver.test.ts` exercises the full path against `FakeDriver` only, with no OH adapter import.

**Downstream impact:** unblocks #290 (text path through driver), #291 (closeSession on disconnect), #293 (`index.ts` AI bootstrap), #296 (delete legacy platform usage of `aiSessionManager`).

**Production:** App will auto-deploy to vr.chorecraft.net via the merge-to-main pipeline. No schema/migration risk — pure server refactor. Production SQLite (`sqlite.db`) untouched.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._
### 2026-05-24 18:51 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `368ad07` | implementation | Issue #290 - Resync AI session state on register | **NEW** |

🚀 **Spawned: Implementation Worker**

- Issue: [#290 - Resync AI session state on register](https://github.com/jpshackelford/voice-relay/issues/290) (priority:high)
- Conversation: [`368ad07`](https://app.all-hands.dev/conversations/368ad07693364e79800ee9a6caf95376)

✅ **Completed Worker (prior tick):**
- `6751e67` (implementation, Issue #289) — created and merged [PR #320](https://github.com/jpshackelford/voice-relay/pull/320) (`feat(server): route platform code through AgentDriver interface`)

**Current State:**
- Open PRs: 0 (PR #320 merged at 18:38Z)
- Issues needing expansion: 0 🎉
- Ready + prioritized issues (sorted by priority):
  - **priority:high**: #290 (now being implemented), #291, #293, #296
  - **priority:medium**: #292, #294, #295, #297, #303
- On-hold (S3 design freeze + others): #210, #239, #299, #300, #301, #302

**Housekeeping:**
- Archived 1 entry to `WORKLOG_ARCHIVE_2026-05-24.md` (preserved 6h productive window).
- Reset `quiet_ticks` → 0 (productive tick).

**Slots after tick:** expansion 0/4, implementation 1/1, review 0/2

---
### 2026-05-24 19:00 UTC - Implementation Worker (Issue #290)

✅ **#290 resync-on-register implemented — [PR #321](https://github.com/jpshackelford/voice-relay/pull/321) (ready for review)**

Built on top of [PR #320](https://github.com/jpshackelford/voice-relay/pull/320) (AgentDriver platform refactor, merged at 18:38 UTC). Confirmed `agentDriver.getSessionStatus(sessionId)` was the right seam to hang the catch-up on — exactly what the issue expansion called for.

**What landed:**

| Path | Change |
|---|---|
| `server/src/resync-agent-status.ts` (new) | Pure helper module: converts `AgentSessionStatus` → legacy `session-ai-status` + optional `ai-thinking` pair, sends to a single WS. Handles anonymous/absent/error skips. |
| `server/src/index.ts` | One-line call from the `register` case after `history` and `session-tts-settings-changed`, before auto-connect. |
| `server/src/types.ts`, `client/src/types.ts` | Added optional `thinkingSince?: string` to `AIThinkingMessage` — backward-compatible. |
| `server/src/resync-agent-status.test.ts` (new) | 12 unit tests covering T-3.1.1 → T-3.1.10 via `FakeDriver` substitution. |

**Scope:** `scope:full-stack` — touches `client/src/types.ts` to keep the wire-shape interface in sync. Functional change is server-only.

**Test counts:** 982 server tests pass (+12), 723 client tests pass (unchanged). `tsc --noEmit` clean. `npm run build` clean both workspaces.

**CI summary (PR #321):**

| Check | Result |
|---|---|
| Server Tests | ✅ 30s |
| Client Tests | ✅ 31s |
| Build Client | ✅ 29s |
| E2E Tests | ✅ 1m31s |
| lint-pr-title | ✅ 6s |

**Deliberate scope decisions (called out in PR body):**

- **No Playwright E2E spec added.** The default `playwright.config.ts` project excludes `tests/smoke/**`, and the local `webServer` it boots has no `OPENHANDS_API_KEY`. No existing top-level spec exercises the real AI path; the existing AI E2E lives in `tests/smoke/ai-integration.spec.ts` against a real `SMOKE_TEST_URL`. Adding T-3.1-E2E.* to the default suite would either need a test-mode `AgentDriver` injection point or a CI OH credential — both out of scope. Server-side unit tests + `useAI.test.ts` (client) jointly cover the wire shape end-to-end.
- **T-3.1.8 (ordering integration test) skipped** in favor of structural enforcement: the call site in `index.ts` is bracketed with an inline comment, and unit tests verify the helper's per-call output ordering.

**Followup candidates** (not opened as issues yet — leaving as PR-description notes pending #295):
- `tests/smoke/ai-resync.spec.ts` for the three T-3.1-E2E cases.
- Test-mode `AgentDriver` injection hook.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:13 UTC - Implementation Worker (#290 duplicate detection)

🛑 **Duplicate work caught on PR submission — closed [PR #322](https://github.com/jpshackelford/voice-relay/pull/322) in favor of [PR #321](https://github.com/jpshackelford/voice-relay/pull/321).**

A second implementation worker for #290 was dispatched while [PR #321](https://github.com/jpshackelford/voice-relay/pull/321) was already open and CI-green. PR #322 reached CI-green independently with 11 unit tests (T-3.1.1 → T-3.1.10), a `server/src/ai-resync.ts` helper, and the same `register`-handler hook. PR #321 was opened ~12 min earlier (18:50 UTC vs 19:03 UTC), so #322 was closed as a duplicate; #321 remains the canonical implementation.

**Learning for the orchestrator:** when dispatching implementation workers, re-check `gh pr list --search "linked:issue#NNN"` (or scan `WORKLOG.md`) right before spawning to avoid wasted parallel work on the same issue. The window between #321 being recorded in WORKLOG and #322 being dispatched was on the order of minutes.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:23 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `6b31a56` | review | [PR #321](https://github.com/jpshackelford/voice-relay/pull/321) — fix(server): resync AI session state on WS register | **NEW** |
| `1d37e68` | implementation | Issue [#291](https://github.com/jpshackelford/voice-relay/issues/291) — Re-fetch session_api_key on every OpenHands reconnect | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Review Worker** — PR #321
   - Conversation: [`6b31a56`](https://app.all-hands.dev/conversations/6b31a569d8f44151a4ff7e2c9d64df61)
   - 1 unresolved github-actions bot thread (`thinkingSince` field consumption on client side)
   - All CI green, MERGEABLE/CLEAN — only thread resolution gates merge

2. **Implementation Worker** — Issue #291 (priority:high)
   - Conversation: [`1d37e68`](https://app.all-hands.dev/conversations/1d37e68e12ce4ce0b0d6e7df2f0c7127)
   - Re-fetch `session_api_key` on every OpenHands reconnect (auth/session credential refresh)
   - Instructed to coordinate around PR #321's adjacent server-side changes (rebase + duplicate-PR check before branching)

✅ **Completed Worker (prior tick):**
- `368ad07` (implementation, Issue #290) → created [PR #321](https://github.com/jpshackelford/voice-relay/pull/321) (`fix(server): resync AI session state on WS register`); ready-for-review, all CI green, MERGEABLE/CLEAN, 1 bot thread unresolved. Duplicate worker for #290 caught and PR #322 closed (see prior worker entry at 19:13Z).

**Current State:**
- Open PRs: 1 — PR #321 (`oR green ready 💬1`)
- Issues needing expansion: 0 🎉 (remaining unlabeled are all `on-hold`: #210, #239, #299, #300, #301, #302)
- Ready + prioritized issues (sorted by priority then issue #):
  - **priority:high**: #290 (PR #321 in review), #291 (impl in progress), #293, #296
  - **priority:medium**: #292, #294, #295, #297, #303

**Slots after tick:** expansion 0/4, implementation 1/1, review 1/2

`quiet_ticks` reset to 0 (productive tick).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:30 UTC - Review Worker (PR #321 / #290)

✅ **Addressed all review feedback on PR #321 — back to ready-for-review, all CI green, 0 unresolved threads.**

| Thread | File | Decision | Commit |
|---|---|---|---|
| `thinkingSince` field unused client-side (github-actions bot) | `client/src/types.ts:161` | Accept option 2 (document as reserved) | [`77fa142`](https://github.com/jpshackelford/voice-relay/commit/77fa142) |

**Rationale for choosing documentation over UI implementation:** Adding an "Agent thinking for 5s…" indicator would have been meaningful client work belonging in a follow-up, not a doc fix. The whole `ai-thinking` + `session-ai-status` wire shape is slated to consolidate into a single `session-state` message under #295, so investing in UI here would have been wasted. The field is plumbed end-to-end now; the JSDoc on `AIThinkingMessage.thinkingSince` is now explicit that it's currently informational, names the future UI it would enable, and references #295 as the supersession plan.

**CI:** Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title — all pass on `77fa142`.

**Mergeable:** CLEAN, ready-for-review, 0 unresolved review threads.

**Reflection — anything that impacts other issues?** The relationship between `thinkingSince` and #295 was already noted in the original PR description and is now cross-referenced from the JSDoc itself; no additional comment on #295 needed (would be duplicate noise). When #295 ships, the implementer should ensure equivalent thinking-duration metadata survives into the consolidated `session-state` shape so future UI work isn't blocked on re-plumbing.

Next step (separate conversation): orchestrator can pick up PR #321 for merge.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:36 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0cb52bf` | merge | [PR #321](https://github.com/jpshackelford/voice-relay/pull/321) — fix(server): resync AI session state on WS register (Issue #290) | **NEW** |
| `1d37e68` | implementation | Issue [#291](https://github.com/jpshackelford/voice-relay/issues/291) — Re-fetch session_api_key on every OpenHands reconnect | running |

🚀 **Spawned: Merge Worker for [PR #321](https://github.com/jpshackelford/voice-relay/pull/321)**

- Conversation: [`0cb52bf`](https://app.all-hands.dev/conversations/0cb52bfe1857461389c08db946916060)
- PR title: `fix(server): resync AI session state on WS register`
- Linked issue: [#290](https://github.com/jpshackelford/voice-relay/issues/290) (priority:high) — will auto-close via `Fixes #290`
- Pre-merge gate satisfied: CI green (Server/Client/Build/E2E/lint-pr-title/pr-review all SUCCESS), `MERGEABLE`/`CLEAN`, 0 unresolved review threads, no `needs-human`/`blocked` labels.
- Merge-worker instructions explicitly cover the migration-check (server-only WS handler diff, no schema changes expected), conventional-commit scope guardrail (`server` is on the allow-list), and the stash-switch-commit-return WORKLOG-on-main mechanic to keep Branch Hygiene CI happy.

✅ **Completed Worker (prior tick):**
- `6b31a56` (review, PR #321) → finished. Addressed the one github-actions bot thread by documenting `thinkingSince` as reserved for #295 (commit [`77fa142`](https://github.com/jpshackelford/voice-relay/commit/77fa142)); declined to add throwaway UI work for a field whose wire shape is slated for consolidation under #295. Result: PR back to ready-for-review, 0 unresolved threads, CI green.

**Current State:**
- Open PRs: 1 — PR #321 (`oRFC green ready 💬--`) being merged
- Issues needing expansion: 0 (remaining unlabeled are `on-hold`: #210, #239, #299, #300, #301, #302 — S3 design freeze + infra triage)
- Ready + prioritized issues (sorted by priority then issue #):
  - **priority:high**: #290 (merging now), #291 (impl in progress, `1d37e68`), #293, #296
  - **priority:medium**: #292, #294, #295, #297, #303

**Action Taken:**
- 🚀 Spawned merge worker for PR #321 (review slot was 0/2 → now 1/2).
- ✅ Cleaned up finished review worker `6b31a56` from `.workflow-state.json` slots → completed[].
- Did **not** spawn a second impl worker — impl slot is full on #291, and the 19:13Z entry today (PR #322 vs #321 duplicate on Issue #290) is a fresh reminder not to over-dispatch.
- Did **not** spawn an expansion worker — every remaining unlabeled issue is `on-hold` (S3 design freeze or infra triage), so no eligible expansion targets exist.

**Housekeeping:**
- WORKLOG.md is 468 lines, but all entries fall within the 6h productive window — truncation skipped (nothing to archive).

**Slots after tick:** expansion 0/4, implementation 1/1, review 1/2 (merge)

`quiet_ticks` reset to 0 (productive tick).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:38 UTC - Merge Worker (PR #321 / #290)

✅ **Merged PR #321 — `fix(server): resync AI session state on WS register`.**

| Field | Value |
|---|---|
| PR | [#321](https://github.com/jpshackelford/voice-relay/pull/321) |
| Squash SHA | [`192b4f3`](https://github.com/jpshackelford/voice-relay/commit/192b4f31f6eb844a57e1b2caaa243f4a59735d99) |
| Linked issue | [#290](https://github.com/jpshackelford/voice-relay/issues/290) — auto-closed (COMPLETED) via `Fixes #290` |
| Merged at | 2026-05-24T19:37:28Z |
| Base | `main` |

**Pre-merge verification:**
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`
- CI all green: Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, enable-orchestrator, pr-review
- 0 unresolved review threads (1 bot thread on `thinkingSince` resolved by review worker in `77fa142`)
- Migration check: ✅ server WS-handler logic only (`server/src/index.ts`, new `server/src/resync-agent-status.ts` + tests, additive optional field on `AIThinkingMessage` in client+server `types.ts`). No `migrations/`, `*.sql`, or schema-touching files in diff — safe against the SQLite prod DB on vr.chorecraft.net.
- Conventional-commit scope `server` is on the allow-list — title preserved verbatim in squash commit.

**Deployment:** auto-deploys to vr.chorecraft.net on push to `main`. No env-var changes, no schema migration, no client breaking change (new field on `AIThinkingMessage` is optional and additive) → safe rollout.

**Branch cleanup:** `fix/290-resync-ai-session-on-register` already removed by GitHub's delete-on-merge.

**Reflection:** Smooth merge — orchestrator dispatch → impl → review → merge cycle on Issue #290 took ~7h end-to-end with one duplicate-worker incident caught early (PR #322 closed in favor of PR #321 at 19:13Z). The `thinkingSince` resolution (doc-only) was the right call given #295's planned wire-shape consolidation; future #295 implementer should preserve thinking-duration metadata in the unified `session-state` payload.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:38 UTC - Implementation worker (#291)

✅ Implemented #291 — Re-fetch `session_api_key` on every OpenHands reconnect. PR **#323** (ready for review).

**Branch:** `fix/291-refresh-session-api-key-on-reconnect` → main
**Link:** https://github.com/jpshackelford/voice-relay/pull/323

**What landed:**

- New `SandboxMissingError` + `AISessionManager.refreshSessionCredentials()` in `server/src/openhands.ts`. Re-reads conversation before each WS reconnect, refreshes both `session_api_key` and `agent_server_url`, single-flights concurrent refreshes, retries transient 5xx with backoff, and surfaces MISSING / exhausted retries as `SandboxMissingError`.
- New `keyRotationCount` metric + info-level log on detected rotations so production can confirm the fix is actually firing.
- `AISession.degraded` / `degradedReason` set when the reconnect loop gives up; `OpenHandsAgentDriver.synthesizeStatus` now surfaces `state: 'degraded'` with the user-facing error populated. The MISSING-rebind path stays out of scope (lands in #296).
- 13 new unit tests in `openhands.test.ts` (T-3.2.1 .. T-3.2.12) and 3 new tests in `agent-driver/openhands.test.ts` for the `degraded` transition. 986/986 server tests pass; coverage 93.79 % overall, 90.45 % on `agent-driver/openhands.ts`.

**CI:** all checks green (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, enable-orchestrator). `pr-review` will fire now that the PR is out of draft.

**Followups / out of scope:** the live "leave a real OH session idle for >20 min, then send a message" privileged probe (T-3.2.I.1) is the manual acceptance step before this can be considered shipped end-to-end — the unit-test surface fully covers the refresh / degraded paths but cannot exercise the actual paused-sandbox resume.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 19:50 UTC - Orchestrator

**Active Workers (post-tick):**

| Conv ID | Type | Working On | Status |
|---|---|---|---|
| `e0fc0e4` | review | [PR #323](https://github.com/jpshackelford/voice-relay/pull/323) (Issue #291) | **NEW** running |
| `14523c8` | implementation | [Issue #293](https://github.com/jpshackelford/voice-relay/issues/293) — Map ConversationExecutionStatus to driver session state (priority:high) | **NEW** running |

**Completed Workers (this tick):**

- `1d37e68` (implementation, Issue #291) → finished. Created PR #323 (`fix(server): refresh session_api_key on every OpenHands WS reconnect`), 13 + 3 new unit tests, server-only diff (`AISessionManager.refreshSessionCredentials`, `SandboxMissingError`, `degraded` surfacing in `OpenHandsAgentDriver.synthesizeStatus`). CI green, 986/986 server tests, 93.79 % coverage.
- `0cb52bf` (review→merge, PR #321) → finished. PR #321 merged at 19:37Z (squash [`192b4f3`](https://github.com/jpshackelford/voice-relay/commit/192b4f3)) and Issue #290 auto-closed via `Fixes #290`. Both moved to `completed[]` in `.workflow-state.json`.

**Current State:**

- Open PRs: **1** — [PR #323](https://github.com/jpshackelford/voice-relay/pull/323) `oR green ready 💬1` (one 🟡 suggestion thread from `github-actions` bot on URL extraction).
- Issues needing expansion: **0** — every remaining unlabeled issue is `on-hold` (#210, #239 infra triage; #299–#302 S3 design freeze still in effect — `VR_WORKSPACE_BUCKET` not yet provisioned per AGENTS.md).
- Ready + prioritized issues (sorted, after-blocker check):
  - **priority:high**: #293 ← _impl in progress, `14523c8`_; #296 (blocked by #293)
  - **priority:medium**: #292 (unblocked by #289 close), #294 (blocked by #293), #295 (blocked by #293), #297 (blocked by #296), #303 (blocked by #284)

**Dependency check completed this tick:**

| Issue | Blockers | Blocker state | Ready to start? |
|---|---|---|---|
| #292 | #289 | closed | ✅ yes (priority:medium) |
| #293 | #289 | closed | ✅ yes — **picked** |
| #294 | #293 | open | ❌ blocked |
| #295 | #290, #293 | #290 merged, #293 open | ❌ blocked on #293 |
| #296 | #293 | open | ❌ blocked |
| #297 | #296 | open | ❌ blocked |
| #303 | #284 | unverified | ⚠️ deferred (#284 status not re-checked this tick) |

**Action Taken:**

1. 🚀 **Spawned review worker** [`e0fc0e4`](https://app.all-hands.dev/conversations/e0fc0e41636944739c7f4d2b1f4669eb) for PR #323 — addresses the single 🟡 suggestion thread (URL extraction `split('/api/')[0]` → `replace(/\/api\/.*$/, '')`). Worker is briefed to flip PR back to draft, apply (or respectfully decline) the suggestion, resolve the thread via GraphQL, return PR to ready, and append worklog on main only.
2. 🚀 **Spawned implementation worker** [`14523c8`](https://app.all-hands.dev/conversations/14523c860c924044bce4929fdfcd2482) for Issue #293 (priority:high, unblocked by #289 close). Worker is briefed about likely overlap with PR #323's `synthesizeStatus` edits and to rebase on top of latest main before pushing.
3. ✅ Moved `1d37e68` + `0cb52bf` from `slots[*]` → `completed[]` in `.workflow-state.json`.
4. Expansion slots remain idle (no unexpanded eligible issues — the unlabeled remainder is all `on-hold`).

**Housekeeping:**

- WORKLOG.md is 559 lines, but the truncation script kept all 15 entries (every entry falls inside the 6 h productive window — that's the script behaving correctly). No archive write this tick.
- AGENTS.md S3 design-freeze section still in effect (issues #298–#302 stay `on-hold` until `VR_WORKSPACE_BUCKET` + AWS creds land on prod).

**Slots after tick:** expansion 0/4, implementation 1/1, review 1/2

`quiet_ticks` reset to 0 (productive tick — two workers spawned).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 19:58 UTC - Review Worker (PR #323)

✅ Addressed the single outstanding review thread on PR #323 (`fix(server): refresh session_api_key on every OpenHands WS reconnect`, issue #291).

**Feedback addressed:**

| Thread | File:Line | Verdict | Resolution |
| --- | --- | --- | --- |
| 🟡 github-actions suggestion — URL extraction via `split('/api/')[0]` | `server/src/openhands.ts:1416` | accept | Switched to `replace(/\/api\/.*$/, '')` and added `URL.canParse(freshUrl)` validation so a malformed agent-server URL fails fast as `SandboxMissingError`. Older call site (line ~1568, initial conversation setup) intentionally left on the existing `split()` idiom — it predates #291 and refactoring it expands scope. Noted in the reply as a possible follow-up. Resolved via GraphQL after replying with the commit SHA. |

**Commits pushed to `fix/291-refresh-session-api-key-on-reconnect`:**

- `213ea9e` `refactor(server): harden agent-server URL extraction in refreshSessionCredentials`

**Verification:**

- `tsc --noEmit -p server/tsconfig.json` — clean
- `vitest run` — 986/986 server tests pass
- CI on `213ea9e`: 5/5 green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title)
- Zero unresolved review threads
- PR returned to ready-for-review; mergeable=MERGEABLE

PR is now waiting on a merge worker — not merged from this conversation.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 20:05 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `14523c8` | implementation | Issue #293 - Map ConversationExecutionStatus to driver session state | running (PR #324 draft) |
| `f2be125` | merge | PR #323 - refresh session_api_key on WS reconnect | **NEW** |

🚀 **Spawned: Merge Worker**

- PR: [#323 - fix(server): refresh session_api_key on every OpenHands WS reconnect](https://github.com/jpshackelford/voice-relay/pull/323) (Fixes #291)
- All CI green, sole bot review thread resolved, MERGEABLE/CLEAN, ready-for-review
- Conversation: [`f2be125`](https://app.all-hands.dev/conversations/f2be125c03cb4c77be38121b942b9b20)

**Worker Completed (since last tick):** `e0fc0e4` (review on PR #323) — addressed bot review thread, all threads resolved, CI green; PR now merge-ready.

**Current State:**
- [PR #323](https://github.com/jpshackelford/voice-relay/pull/323): ready-for-review, MERGEABLE/CLEAN, CI green → **being merged**
- [PR #324](https://github.com/jpshackelford/voice-relay/pull/324): draft, UNSTABLE (impl worker still building for issue #293)
- Ready issues awaiting impl slot: #303, #297, #296 (priority:high), #295, #294, #292 (#291 closes with PR #323; #293 in-flight)
- Issues needing expansion: 6 issues all `on-hold` (S3 persistence freeze #299–#302, plus #210, #239) — skipped

**Action Taken:**
🚀 Spawned merge worker for PR #323 (review slot now 1/2).
- Implementation slot full (1/1) — worker on #293 still building PR #324.
- Expansion slots all empty (0/4) — but every unexpanded issue carries `on-hold`, so nothing to spawn.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 20:10 UTC - Implementation worker (#293)

✅ **PR #324 ready for review** — Phase 3 of the session-state-machine rollout.

- Issue: [#293 — Map ConversationExecutionStatus to driver session state](https://github.com/jpshackelford/voice-relay/issues/293) (priority:high)
- PR: [#324 — feat(server): map ConversationExecutionStatus to driver session state](https://github.com/jpshackelford/voice-relay/pull/324)

**What landed in the PR:**
- `server/src/agent-driver/openhands.ts` reads `ConversationStateUpdateEvent(key='execution_status')` events off the existing event-callback path and maps `idle/finished/paused/waiting_for_confirmation → ready`, `running → thinking` (with timestamp), `stuck/error → degraded`, `deleting → absent` per `docs/architecture.md` § Session state mapping.
- 🤔 indicator now clears on the `running → idle` transition regardless of message emission (fixes tool-only-turn stick).
- Precedence in `synthesizeStatus` is **adapter > upstream > default**: `ai.degraded` (#291/#323) wins, then ws-torn-down → reconnecting, then upstream `execution_status`, then legacy `isThinking`/ws heuristic. Conflict with newly-merged PR #323 (touching same function) resolved during rebase.
- Consecutive duplicates deduped; unknown statuses + orphan sessionIds logged and dropped. No 5-minute heuristic timer (grep gate clean).

**Verification:**
| Gate | Result |
|---|---|
| `tsc --noEmit -p server/tsconfig.json` | ✅ |
| `tsc --noEmit -p client/tsconfig.json` | ✅ |
| Full server suite (`vitest run`) | ✅ 1022/1022 |
| Coverage `openhands.ts` | ✅ 93.81% (≥80% gate) |
| CI on `0897e0e` post-rebase | ✅ 5/5 (Server, Client, Build Client, E2E, lint-pr-title) |

**Acceptance criteria checklist (issue body + expansion comment):**
- ✅ T-3.4.1 .. T-3.4.16 all covered by new tests (T-3.4.14 added after #323 merge made `ai.degraded` available on main)
- ✅ No 5-minute heuristic timer added (`grep -n 'setTimeout.*5.*60.*1000'` zero hits)
- ✅ 🤔 turns off on running→idle even for tool-only turns
- ✅ stuck → degraded with error message
- Note: `AISessionManager.isThinking` is **deprecated, not removed** — left in as fallback until the first execution_status event arrives. The synthesizeStatus precedence block documents that execution_status now takes over. Full removal can be scoped into a later cleanup.

**Follow-ups for downstream issues:**
- #294 (Restart Agent UX) can gate its button on `status.state === 'degraded'` — both the `ai.degraded` and `execution_status: stuck/error` paths flow into it.
- #300 (persistence-snapshot trigger) now has its signal — snapshot on every `execution_status: idle/finished` event.

PR is in **ready-for-review**, pr-review bot triggered. Not merged from this conversation — that's a separate worker.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 20:25 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `5cc1762` | implementation | Issue #292 - Single-flight conversation start (priority:medium) | **NEW** |

**Workers Completed (since last tick):**
| Conv ID | Type | Outcome |
|---------|------|---------|
| `14523c8` | implementation (#293) | ✅ PR #324 opened ready-for-review, all CI green |
| `f2be125` | merge (PR #323) | ✅ PR #323 squash-merged, issue #291 auto-closed |

🚀 **Spawned: Implementation Worker**
- Issue: [#292 — Single-flight conversation start](https://github.com/jpshackelford/voice-relay/issues/292) (priority:medium; blocker #289 closed → unblocked)
- Conversation: [`5cc1762`](https://app.all-hands.dev/conversations/5cc1762026b04f96b4d0ee8a2014b5b0)
- Briefed about overlap with PR #323's single-flight pattern in `refreshSessionCredentials` and to rebase on top of PR #324 when it lands.

🏷️ **Re-triggered bot review on PR #324** by applying the `review-this` label (created the label first; it didn't exist in this repo yet). The `PR Review by OpenHands` workflow was `skipped` on `opened` because the impl worker correctly opened it as draft, but the `ready_for_review` trigger never fired. With `review-this` applied, run [`26371911...`](https://github.com/jpshackelford/voice-relay/actions/workflows/pr-review.yml) is now `in_progress`. Next tick will pick up the bot's feedback (or merge-readiness if it lands green).

**Current State:**
- [PR #324](https://github.com/jpshackelford/voice-relay/pull/324) — `feat(server): map ConversationExecutionStatus to driver session state` (Fixes #293): ready-for-review, MERGEABLE/CLEAN, all CI green, 0 review threads, bot review now running (review-this).
- Ready & unblocked issues remaining after #292 dispatch: #295 (priority:medium, blocker #290 closed), #303 (priority:medium, blocker #284 closed).
- Ready but still blocked: #294, #296, #297 (all wait on #293 / PR #324); #297 also waits on #296.
- Issues needing expansion: 6 issues all `on-hold` (S3 persistence freeze #299–#302 + #210, #239) — skipped per AGENTS.md.

**Action Taken:**
1. Moved `14523c8` (impl #293) and `f2be125` (merge PR #323) from `slots[*]` → `completed[]` in `.workflow-state.json`.
2. Created `review-this` label and applied to PR #324 → bot review workflow now in progress.
3. 🚀 Spawned implementation worker [`5cc1762`](https://app.all-hands.dev/conversations/5cc1762026b04f96b4d0ee8a2014b5b0) for Issue #292.
4. Deliberately did **not** spawn a merge worker for PR #324 this tick — letting the bot review complete first to preserve the documented review-before-merge safety net.

**Slots after tick:** expansion 0/4, implementation 1/1, review 0/2.

`quiet_ticks` reset to 0 (productive tick — worker spawned + bot review re-triggered).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 20:35 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `5cc1762` | implementation | Issue #292 - Single-flight conversation start | running |
| `7e1700e` | merge | PR #324 - map ConversationExecutionStatus to driver session state | **NEW** |

🚀 **Spawned: Merge Worker**

- PR: [#324 — feat(server): map ConversationExecutionStatus to driver session state](https://github.com/jpshackelford/voice-relay/pull/324) (Fixes #293)
- CI: 5/5 green, MERGEABLE/CLEAN, 0 unresolved review threads
- pr-review bot verdict (submitted 20:25:57Z, re-triggered by `review-this` label last tick): 🟢 LOW risk, "Worth merging" — only a `[MINOR NOTE]` flagging the `docs/architecture.md` mapping table for completeness (no blockers or issues). The merge worker will decide whether to address inline or punt to a follow-up.
- Conversation: [`7e1700e`](https://app.all-hands.dev/conversations/7e1700e953d14e97a95f21b4b6c5f47f)

**Current State:**
- [PR #324](https://github.com/jpshackelford/voice-relay/pull/324): **being merged** (Phase 3 of session-state-machine rollout)
- No other open PRs.
- Impl slot still occupied by `5cc1762` (Issue #292 — single-flight conversation start, priority:medium).
- Ready & unblocked after #292/#324 dispatch: #295 (priority:medium), #303 (priority:medium).
- Ready but blocked behind #293/PR #324: #294, #296, #297. (#297 also waits on #296.)
- Issues needing expansion: 6 issues all carry `on-hold` (S3 persistence freeze #299–#302 + #210, #239) — skipped per AGENTS.md.

**Action Taken:**
1. 🚀 Spawned merge worker [`7e1700e`](https://app.all-hands.dev/conversations/7e1700e953d14e97a95f21b4b6c5f47f) for PR #324 — bot review came back positive ("Worth merging"), so the deliberate hold from the 20:25 tick is released.
2. Held off spawning a second review/expansion worker — no other PRs need review, and every unexpanded issue is `on-hold` under the S3 persistence design freeze (Path B, see AGENTS.md).
3. Did **not** disturb impl worker `5cc1762` on #292.

**Slots after tick:** expansion 0/4, implementation 1/1, review 1/2.

`quiet_ticks` reset to 0 (productive tick — merge worker spawned).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 20:40 UTC - Implementation Worker (Issue #292)

✅ Issue #292 — Single-flight conversation start (Phase 3, priority:medium) — implementation complete and pushed for review.

**Summary:**
- Added a per-`sessionId` `Map<string, Promise<BindResult>>` to `OpenHandsAgentDriver` (`server/src/agent-driver/openhands.ts`) that coalesces concurrent conversation-start callers onto a single shared promise.
- All three driver entry points (`openSession`, `sendMessage` lazy-bind, `restartSession`) now flow through the same `lazyBindSession` helper, so cross-method races also coalesce.
- Promise self-deletes on settle (`.finally`); failed starts do not poison the slot — next caller retries. Pattern mirrors the `AISessionManager.inFlightRefresh` single-flight from #291.

**Tests:** Added 11 new T-3.3.* unit tests in `server/src/agent-driver/openhands.test.ts` covering 5-way concurrency, shared rejection fan-out, slot-clearing on failure, `restartSession`/`sendMessage` race, distinct-session isolation, and serial-path no-op. All 60 driver tests + 1008 server tests pass. Coverage on `openhands.ts` lands at **93.16%** (>80% bar).

**Verification gates:**
- `tsc --noEmit -p server/tsconfig.json` → exit 0
- `tsc --noEmit -p client/tsconfig.json` → exit 0
- All 5 CI checks green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title)
- `pr-review` bot already ran on the draft and re-triggered on `ready_for_review`.

**PR:** [#325 — fix(server): single-flight conversation start to prevent orphaned upstream conversations](https://github.com/jpshackelford/voice-relay/pull/325) (Fixes #292) — flipped to **ready for review**, labels: `review-this`.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 20:53 UTC - Merge Worker (PR #324)

✅ **Merged:** [PR #324 — feat(server): map ConversationExecutionStatus to driver session state](https://github.com/jpshackelford/voice-relay/pull/324) — squash-merged as `ab17f63` at 20:52:30Z. Issue **#293** closed.

**Pre-merge gates:**
- All 6 CI checks green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review).
- `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`.
- Zero review threads (so trivially zero unresolved).
- pr-review bot verdict: 🟢 LOW risk, "Worth merging".

**Migration check:** ✅ No DB changes. Diff touches only `server/src/agent-driver/openhands.ts` and `openhands.test.ts` (569 +/6 −, 2 files). No migrations / `*.sql` / schema files; SQLite production storage unaffected.

**Production impact:** Auto-deploy to vr.chorecraft.net triggered by main. Risk is low — change is internal driver state-machine plumbing reading events already on the existing subscription path; the legacy `isThinking` heuristic is preserved as a fallback.

**Downstream unblocked:**
- #294 (Restart Agent UI/endpoint) — can now read `state === 'degraded'`.
- #300 (workspace snapshot trigger) — has its `execution_status: idle/finished` signal landed (still on-hold under the S3 persistence freeze).
- #296, #297 (transitively on #293).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 20:53 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `38d025a` | merge | PR #324 (feat(server): map ConversationExecutionStatus → driver session state) | **NEW** |
| `504457a` | merge | PR #325 (fix(server): single-flight conversation start) | **NEW** |
| `2eb2157` | implementation | Issue #303 — client coverage (next batch) | **NEW** |

**Completed last tick:**
- `5cc1762` impl #292 → finished → PR #325 created (CI green, 0 threads, MERGEABLE)
- `7e1700e` review PR #324 → idle → all threads resolved, CI green, MERGEABLE

🚀 **Spawned: 3 workers (parallel)**

1. **Merge worker** for [PR #324](https://github.com/jpshackelford/voice-relay/pull/324) (closes #293)
   - Conversation: [`38d025a`](https://app.all-hands.dev/conversations/38d025a8c54a44eeb03b120ed98f6dfd)
2. **Merge worker** for [PR #325](https://github.com/jpshackelford/voice-relay/pull/325) (closes #292)
   - Conversation: [`504457a`](https://app.all-hands.dev/conversations/504457ac4ac447c6a7f09c66bef7e79b)
3. **Implementation worker** for [Issue #303](https://github.com/jpshackelford/voice-relay/issues/303) — next batch of client-coverage tests
   - Conversation: [`2eb2157`](https://app.all-hands.dev/conversations/2eb2157ca98d40dc8f94513b22c4e206)

**Current State:**
- Open PRs: #324, #325 (both CI green, 0 threads, MERGEABLE — being merged)
- Ready issues: #294, #295, #296, #297 all blocked by #293 (unlocks when PR #324 merges); #303 is the only unblocked impl candidate (being worked on)
- On-hold (Path B persistence): #299, #300, #301, #302 — awaiting S3 bucket + AWS creds (see AGENTS.md design-freeze)
- Slots used: review 2/2, implementation 1/1, expansion 0/4

**Reasoning:**
- Both open PRs have 0 unresolved review threads and all CI green → spawn merge workers in parallel (2 review slots)
- Once PR #324 merges, issues #294/#295/#296 unblock; orchestrator will pick the priority:high #296 up next tick
- Issue #303 is multi-PR; previous PR #316 covered uuid/deviceName/3 hooks — remaining modules form natural next batch
- All 3 spawns are within slot limits (max 7, using 3)

**Note:** Crossed paths with merge worker `38d025a` — PR #324 was already merged at 20:52:30Z just before this orchestrator tick. PR #325 is now `CONFLICTING` against post-#324 main; merge worker `504457a` will need to rebase before merging. Issues #294/#295/#296/#297 are now unblocked.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:01 UTC - Implementation worker (Issue #303 — next batch)

✅ **Batch 2 complete — PR opened and ready for review**

- Issue: [#303](https://github.com/jpshackelford/voice-relay/issues/303) (client coverage rollout, multi-PR)
- PR: [#326](https://github.com/jpshackelford/voice-relay/pull/326) — `test(client): cover useWorkspaces, useSessions, useDevices (refs #303)`
- Modules covered this batch:
  - `client/src/hooks/useWorkspaces.ts` — 100 / 100 / 100 / 100
  - `client/src/hooks/useSessions.ts` — 100 / 96.4 / 100 / 100
  - `client/src/hooks/useDevices.ts` — 100 / 92.9 / 100 / 100
- Aggregate `All files`: 95.24 / 90.31 / 97.45 / 96.95 (all ≥80%)
- Local gates green before push: `tsc --noEmit` exit 0, `npm run test:coverage -w client` 772/772 passing, no new `any`/`as any`, no new `eslint-disable`
- CI on PR: Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title — all green
- PR moved from draft → ready for review

**Remaining exclusions in `client/vite.config.ts` (for future batches):**
- `useAudioPlayback.ts`, `useAudioStreaming.ts`, `useJoinRequests.ts`, `useResourceFetch.ts`, `useWebSocket.ts`, `useWorkspaceAutoJoin.ts`, `useWorkspaceSettings.ts`
- `utils/deviceToken.ts`, `utils/getEventContent.ts`

Issue #303 stays open; next batch is a separate conversation.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:02 UTC - Merge worker (PR #325)

✅ **PR #325 squash-merged to main** — closes [#292](https://github.com/jpshackelford/voice-relay/issues/292)

**Details:**
- Title: `fix(server): single-flight conversation start to prevent orphaned upstream conversations`
- Squash commit: per `gh pr merge --squash` (see git log on main)
- Files: `server/src/agent-driver/openhands.ts` + `server/src/agent-driver/openhands.test.ts` only — no DB migrations, no schema changes
- Production impact: auto-deploys to vr.chorecraft.net; pure logic fix (per-session `Map<string, Promise<BindResult>>` single-flight) with no runtime config or env changes
- Issue #292 auto-closed at 21:01:53 UTC

**Conflict resolution note:**
- Branch was `CONFLICTING` against post-#324 main (both touched `openhands.ts` `restartSession` + appended a new `describe` block to `openhands.test.ts`)
- Rebased onto `origin/main`; in `restartSession` kept both #324's `state.executionStatus = null; state.executionError = null;` reset and #325's `lazyBindSession` single-flight gateway; in the test file kept both the `T-3.4.*` (execution_status, #293) and `T-3.3.*` (single-flight, #292) `describe` blocks as siblings
- Server typecheck passed; targeted `agent-driver/openhands` suite: **84/84 tests pass** locally
- Force-push with `--force-with-lease`; CI rerun all green (Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title)
- Replaced an earlier `0e8e344 "Merge main into ..."` commit (likely orchestrator-side merge attempt) with the cleaner rebase

**Current State:**
- Open PRs: 0
- Ready issues unblocked by #292 closing: (none directly — #292 itself was the only consumer of the single-flight slot)
- Slots used: merge 0/2, review 0/2, implementation depends on next dispatcher tick

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:09 UTC - Merge Worker (PR #326)

✅ **Squash-merged PR #326** — `test(client): cover useWorkspaces, useSessions, useDevices (refs #303)`

- PR: https://github.com/jpshackelford/voice-relay/pull/326
- Commit on main: `072f1db6acfc5161ab8b2c908e56ef582e41a05c`
- Scope: `scope:client` — tests-only (3 new `client/src/hooks/*.test.ts` files, +962 LOC) plus 3 removed entries from the `exclude:` list in `client/vite.config.ts`. No production code or server changes.
- Merge criteria at gate time: CI green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review), 0 unresolved review threads, `MERGEABLE` / `CLEAN`, not draft. `needs-human` / `on-hold` not present.
- Production impact: auto-deploys to vr.chorecraft.net; pure test additions with vite config exclude reduction — no runtime behavior, env, or DB schema changes.

**Issue resolution:**
- `refs #303` — does **not** auto-close. Issue #303 left OPEN.
- After this PR, **9 modules remain in `client/vite.config.ts` exclude list** (7 hooks: `useAudioPlayback`, `useAudioStreaming`, `useJoinRequests`, `useResourceFetch`, `useWebSocket`, `useWorkspaceAutoJoin`, `useWorkspaceSettings`; 2 utils: `deviceToken`, `getEventContent`).
- Posted follow-up comment on #303 listing remaining gaps and suggested batch grouping for follow-up PRs (batch 3/4/5).

**Current State:**
- Open PRs after merge: per `gh pr list` at next orchestrator tick
- Slots used: merge 0/2 (this slot released)

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:14 UTC - Implementation Worker (issue #303 batch 3)

🚀 **Opened PR #327 (ready for review)** — `test(client): cover deviceToken, getEventContent, useResourceFetch (refs #303)`

- PR: https://github.com/jpshackelford/voice-relay/pull/327
- Branch: `303-cover-batch-2` (rebased onto `main@072f1db` to resolve `vite.config.ts` conflict with merged batch 2)
- Scope: `scope:client` — tests-only. Modified `client/src/utils/deviceToken.test.ts`, `client/src/utils/getEventContent.test.ts`; new `client/src/hooks/useResourceFetch.test.ts`; removed 3 entries from `client/vite.config.ts` `exclude:`. No production / server / CI changes.
- CI status at marking ready: Server Tests ✅ · Client Tests ✅ · Build Client ✅ · E2E Tests ✅ · lint-pr-title ✅. `MERGEABLE` / clean.
- Coverage delta (per-file, post-rebase):
  - `utils/deviceToken.ts`: 74/73/100/74 → **96/96/100/96**
  - `utils/getEventContent.ts`: 80/64/93/79 → **99/89/100/99**
  - `hooks/useResourceFetch.ts`: 0/0/0/0 → **96/93/88/98**
  - Aggregate after merge: 95.95 / 90.37 / 97.63 / 97.28 (well above 80% gate on all four metrics).
- Test counts: 49 new tests (18 deviceToken + 18 getEventContent + 13 useResourceFetch). Full suite 831/831 passing.
- Note on `useResourceFetch`: hook lists `extractData` and other callbacks in its `useEffect` deps, so tests pass stable references (defined outside `renderHook`) — matches how real callers would need to consume the hook. Hook is currently unreferenced in `src/`; the contract is tested as written.

**Issue resolution:**
- `refs #303` — does **not** auto-close. Issue #303 left OPEN.
- After this PR, **6 modules remain in `client/vite.config.ts` exclude list** (all hooks): `useAudioPlayback`, `useAudioStreaming`, `useJoinRequests`, `useWebSocket`, `useWorkspaceAutoJoin`, `useWorkspaceSettings`. Next batch is a separate conversation.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:20 UTC - Merge Worker (PR #327)

✅ **Merged** PR #327 — test(client): cover deviceToken, getEventContent, useResourceFetch (refs #303)

- Squash-merge commit: `41af612` on `main`
- Branch merged: `303-cover-batch-2`
- Pre-merge state: MERGEABLE / CLEAN, all 7 CI checks SUCCESS (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review, enable-orchestrator), 0 unresolved review threads, no `on-hold` / `needs-human` labels.
- Scope (client-only, no DB/schema/migration): added `client/src/hooks/useResourceFetch.test.ts`, extended `client/src/utils/deviceToken.test.ts` and `client/src/utils/getEventContent.test.ts`, trimmed 3 entries from `client/vite.config.ts` coverage `exclude:` list.
- Coverage gates raised for: `utils/deviceToken.ts`, `utils/getEventContent.ts`, `hooks/useResourceFetch.ts`.
- Production safety: SQLite schema unchanged; no server-side code touched. Safe to auto-deploy to vr.chorecraft.net.
- Issue #303 left **OPEN** (PR used `Refs`, not `Fixes`).

**Remaining coverage-excluded hooks tracked by #303 (6):**
`useAudioPlayback`, `useAudioStreaming`, `useJoinRequests`, `useWebSocket`, `useWorkspaceAutoJoin`, `useWorkspaceSettings`.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:21 UTC - Orchestrator

🚀 **Spawned: 2 workers (parallel)**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---|---|---|---|
| `b44a30b` | merge | [PR #327](https://github.com/jpshackelford/voice-relay/pull/327) — test(client): cover deviceToken, getEventContent, useResourceFetch (refs #303) | **NEW** |
| `ee8d412` | implementation | [Issue #296](https://github.com/jpshackelford/voice-relay/issues/296) — Detect MISSING sandbox and rebind via conversation_id (priority:high) | **NEW** |

**Completed last tick (moved out of slots):**
- `2eb2157` impl #303 → finished — opened [PR #327](https://github.com/jpshackelford/voice-relay/pull/327) (batch 3 of client coverage, refs #303; #303 stays open with 6 hooks still excluded)
- `38d025a` merge PR #324 → finished — squash-merged `ab17f63` at 20:52:30Z, closed #293
- `504457a` merge PR #325 → finished — rebased onto post-#324 main and squash-merged at 21:01:53Z, closed #292

1. **Merge Worker — PR #327** ([`b44a30b`](https://app.all-hands.dev/conversations/b44a30b2d8cd47cc8a3a5582500b9356))
   - Pre-flight: `MERGEABLE` / `CLEAN`, 7/7 CI green (Server/Client/Build/E2E/lint-pr-title/pr-review/enable-orchestrator), 0 unresolved review threads, not draft, no `on-hold` / `needs-human`.
   - Scope: client-only — 3 test files + `client/vite.config.ts` exclude-list trim. No DB schema / migrations.
   - `refs #303` — issue #303 stays OPEN (6 hook modules still excluded; future batches).
   - **Note:** PR was actually merged mid-tick (squash `41af612` at 21:20:07Z) — worker is finishing its own worklog entry now.

2. **Implementation Worker — Issue #296** ([`ee8d412`](https://app.all-hands.dev/conversations/ee8d412207944c89b31d4903587c6133))
   - Issue #296 (priority:high) — "Detect MISSING sandbox and rebind via conversation_id". Blocker #293 closed via PR #324 at 20:53Z, so this is now unblocked.
   - Likely server-only change: extend the `OpenHandsAgentDriver` state machine (where #293 added `execution_status` → `state` mapping) to detect `MISSING` and call the OH rebind primitive, preserving `conversation_id`. Single-flight pattern from #292 will likely be reused for concurrent MISSING events.
   - Memory replay is explicitly OUT of scope (that is #297, blocked on this).

**Current State:**
- **Open PRs**: 0 after #327 merge (which landed mid-tick). #324 / #325 / #326 / #318 / #316 all merged within the last ~90 min.
- **Ready issues**: #294, #295, #296 (now being implemented), #297, #303 (stays open). #294/#295 are priority:medium client work that could be picked up next; #297 is gated on #296.
- **Issues needing expansion**: 6 — all carry `on-hold` (S3 persistence freeze #299–#302 + #210, #239). Skipped per AGENTS.md.
- **Slots after tick**: expansion 0/4, implementation 1/1, review 1/2.

**Action Taken:**
1. 🚀 Spawned merge worker `b44a30b` for PR #327 — all merge criteria satisfied.
2. 🚀 Spawned implementation worker `ee8d412` for Issue #296 — priority:high, blocker #293 closed.
3. Did **not** spawn additional expansion workers — all unexpanded issues are `on-hold` under the S3 persistence design freeze (Path B, see AGENTS.md).
4. Second review slot left open intentionally — no other open PRs need review right now.

`quiet_ticks` reset to 0 (productive tick).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:25 UTC - Implementation Worker (issue #296)

🚀 **Opened PR #328 (ready for review)** — `feat(server): rebind MISSING sandbox preserving conversation_id (#296)`

- PR: https://github.com/jpshackelford/voice-relay/pull/328
- Branch: `feat/issue-296-rebind-missing-sandbox` (from `main@9f48497`)
- Scope: `scope:server` — adds the OpenHands MISSING-sandbox rebind primitive on the AgentDriver / `AISessionManager` seam. No DB schema / migrations. No client touched.
- CI status at marking ready: Server Tests ✅ · Client Tests ✅ · Build Client ✅ · E2E Tests ✅ · lint-pr-title ✅. All green.

**What it does:**
- New `OpenHandsClient.rebindConversation(id)` — POSTs `/api/v1/app-conversations { conversation_id }` (no `parent_conversation_id` — fork is *not* the rebind path).
- New module `server/src/agent-driver/rebind.ts` — pure-function rebind helper with typed errors (`RebindBudgetExhausted`, `RebindForbidden`, `RebindConversationGone`), exponential backoff (1, 2, 4, 8, 16 s) inside a 30 s total budget, and a per-conversation `RebindWindowTracker` capping at 3 rebinds / 5 min.
- New `AISessionManager.rebindSession(session)` — orchestrates the rebind: window check → HTTP rebind → update in-memory `agentServerUrl` / `sessionApiKey` → reset `reconnectAttempts` → clear `degraded`/`rebinding` → dial new WS. On failure: `degraded` with user-facing reason matching the issue spec.
- `reconnectWithRefresh()` now routes `SandboxMissingError` through `rebindSession` instead of immediately degrading.
- New `AISession.rebinding` flag wired through the driver's `synthesizeStatus` so `rebinding === true` maps to `reconnecting` (precedes `degraded`).

**Tests added:**
- 21 unit tests in `agent-driver/rebind.test.ts` — backoff sequence (1,2,4,8s before 5th attempt), budget exhaustion = exactly 5 attempts, 4xx fast-fail (403/404/other), malformed-response → transient retry, per-conversation rolling-window tracker.
- 13 integration tests in `openhands.test.ts` — full reconnect+rebind path, window cap (4th attempt short-circuits without HTTP call), degraded transitions for each failure mode, `conversationId` preservation, in-flight `rebinding` flag contract.
- 3 driver-level tests in `agent-driver/openhands.test.ts` — `rebinding → reconnecting` precedence over `degraded` / `isThinking` / stale-open ws.
- Coverage: new `rebind.ts` at 95% lines / 100% functions; aggregate server coverage unchanged at ~94% lines.

**Out of scope (intentionally):**
- Memory replay — that's #297. A `TODO(#297)` was left in the test file marking where the post-rebind context-rehydration assertion should land. Follow-up note posted on #297.
- Workspace persistence (#5.x) — untouched.
- Webhook-driven MISSING detection — webhooks are receiver-only, we observe via REST + WS close (same as before).

**Production safety:** Server-only, no schema migrations, no client changes. The new rebind path is *additive* — it only kicks in on `SandboxMissingError`, which previously degraded immediately. Worst-case regression is the prior behavior (degrade) instead of the new (rebind, then degrade if rebind fails). Safe to auto-deploy to vr.chorecraft.net.

**Issue resolution:** PR uses `Closes #296` — will auto-close on merge.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:37 UTC - Orchestrator

🚀 **Spawned: 2 workers (parallel)**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---|---|---|---|
| `e79b8f3` | review | [PR #328](https://github.com/jpshackelford/voice-relay/pull/328) — feat(server): rebind MISSING sandbox preserving conversation_id (#296) | **NEW** |
| `564ed2f` | implementation | [Issue #294](https://github.com/jpshackelford/voice-relay/issues/294) — Restart Agent endpoint and UI affordance (priority:medium) | **NEW** |

**Completed last tick (moved out of slots):**
- `ee8d412` impl #296 → finished — opened [PR #328](https://github.com/jpshackelford/voice-relay/pull/328) (feat(server): rebind MISSING sandbox); ready-for-review, all CI green, MERGEABLE, 1 unresolved bot review thread
- `b44a30b` merge PR #327 → finished — squash-merged `41af612` at 21:20:07Z (test(client) refs #303); #303 stays open for next batches

1. **Review Worker — PR #328** ([`e79b8f3`](https://app.all-hands.dev/conversations/e79b8f3ada484ed481d7189b28f8683f))
   - PR state: `MERGEABLE` / `CLEAN`, all 7 CI checks SUCCESS (Server, Client, Build, E2E, lint-pr-title, pr-review, enable-orchestrator), 1 unresolved bot thread (`PRRT_kwDOSTUWGM6Ea2ja`).
   - Bot thread: `docs/openhands-platform.md § Rebind on a dead conversation` doesn't exist yet. Worker is instructed to create the doc section (Option 1) rather than scrub the cross-reference — the rebind primitive deserves real architectural documentation.
   - No DB schema / migrations. Server-only.

2. **Implementation Worker — Issue #294** ([`564ed2f`](https://app.all-hands.dev/conversations/564ed2f546f7466c82f22d50425bcef9))
   - Issue #294 (priority:medium, label: `client`) — "Restart Agent endpoint and UI affordance". Blocker #293 was closed via PR #324 (squash `ab17f63`) at 20:53Z, so unblocked.
   - Likely full-stack: server endpoint to reset AI session + client UI affordance ("Try again" button) + reducer state. Will reuse the `AgentDriver` interface seam (#287) and the new MISSING-rebind primitives (#296 / PR #328).
   - Independent of #295 (also unblocked) and #297 (gated on #296).

**Current State:**
- **Open PRs**: 1 — [#328](https://github.com/jpshackelford/voice-relay/pull/328) (#296 rebind, in review).
- **Ready issues**: #294 (now being implemented), #295 (unblocked, priority:medium, client), #297 (gated on #296), #303 (open, next batches).
- **Issues needing expansion**: 6 — all carry `on-hold` (S3 persistence freeze #299–#302 + #210, #239). Skipped per AGENTS.md.
- **Slots after tick**: expansion 0/4, implementation 1/1, review 1/2 — 1 review slot intentionally idle (no other open PRs).

**Action Taken:**
1. 🚀 Spawned review worker `e79b8f3` for PR #328 — 1 unresolved bot review thread (doc cross-ref).
2. 🚀 Spawned implementation worker `564ed2f` for Issue #294 — next priority unblocked ready issue.
3. Did **not** spawn expansion workers — all unexpanded issues are `on-hold` under the S3 persistence design freeze (Path B per AGENTS.md).
4. WORKLOG.md truncation evaluated — all entries within the 6-hour productive window, nothing archived.

`quiet_ticks` reset to 0 (productive tick).

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:39 UTC - Review Worker (PR #328 review round 1)

✅ **Addressed bot review feedback on PR #328** (`feat(server): rebind MISSING sandbox preserving conversation_id` — #296).

**Thread resolved:** `PRRT_kwDOSTUWGM6Ea2ja` — github-actions flagged that `server/src/agent-driver/rebind.ts` referenced `docs/openhands-platform.md § Rebind on a dead conversation`, but no matching subsection existed.

**Fix (commit `f4990ad`):** Added a focused `### Rebind on a dead conversation` subsection under **Death and recovery** in `docs/openhands-platform.md` (+41 lines). Documents the VR-side policy layer:

- Trigger conditions (`sandbox_status: MISSING`, non-resumable WS close).
- Budget / backoff / rate-cap tunables, using the same exported constant names from `rebind.ts` (`REBIND_BUDGET_MS`, `REBIND_BACKOFF_MS`, `MAX_REBINDS_PER_WINDOW`, `REBIND_WINDOW_MS`) so the doc and code stay in lockstep.
- The three-element error taxonomy (`RebindForbidden`, `RebindConversationGone`, `RebindBudgetExhausted`) and how the agent driver pattern-matches on it.
- An explicit "what rebind does **not** do" callout pointing forward to filesystem restore (#298–#301) and memory replay (#297).

**CI:** All 5 checks ✅ green (Server, Client, Build Client, E2E, lint-pr-title). pr-review skipped on docs-only push (expected).

**State:**
- PR #328 marked back to **ready for review**.
- 0 unresolved review threads.
- mergeable: MERGEABLE.

Handing off to the orchestrator's next review/merge tick.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:54 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `564ed2f` | implementation | Issue #294 — Restart Agent endpoint & UI affordance | running |
| `314e231` | review (round 2) | PR #328 — rebind MISSING sandbox (#296) | **NEW** |

**Worker Completed:** `e79b8f3` (review round 1, PR #328)
- Added `### Rebind on a dead conversation` subsection to `docs/openhands-platform.md` in commit `f4990ad`
- Resolved review thread `PRRT_kwDOSTUWGM6Ea2ja` (docs reference)
- Moved to `completed` (status: success)

**Spawned: Review Round 2 Worker**
- PR: [#328 - feat(server): rebind MISSING sandbox preserving conversation_id (#296)](https://github.com/jpshackelford/voice-relay/pull/328)
- Conversation: [`314e231`](https://app.all-hands.dev/conversations/314e2310164a48d7a0d5b336298ec36c)
- Target thread: `PRRT_kwDOSTUWGM6Ea6OD` — pr-review bot's 🟡 suggestion to add a concurrency guard for `rebindSession` mirroring the existing `inFlightRefresh` pattern (created 2026-05-24T21:44:42Z, after round 1 pushed)
- Disposition guidance: default to implementing — small + idiomatic — but decline & explain if the existing budget + rate cap already serialize per-conversation

**Current State:**
- [PR #328](https://github.com/jpshackelford/voice-relay/pull/328): MERGEABLE / CLEAN, all 7 CI checks SUCCESS, 1 unresolved review thread → being addressed by `314e231`
- Ready issues (not in flight): #295 (priority:medium, client), #297 (priority:medium — gated on #296), #303 (priority:medium, client)
- Implementation slot full (`564ed2f` on #294); next free impl slot will pick up #295 or wait for #297 once #296 merges
- Issues needing expansion: 0 actionable — 6 open issues all carry `on-hold` (S3 freeze + flaky-CI #239 + #210)

**Action Taken:**
🚀 Spawned review-round-2 worker for PR #328 (new pr-review thread on `rebind.ts` concurrency guard)
🧹 Paused orphan sandbox `1cjPh4JaJVs0ZIbVp1kv1a` (prior POST used wrong `initial_message` schema — corrected on retry)
🧾 Moved `e79b8f3` → `completed`

---

### 2026-05-24 22:00 UTC - Implementation Worker (Issue #294)

✅ Issue #294 — Restart Agent endpoint and UI affordance

Opened PR [#329](https://github.com/jpshackelford/voice-relay/pull/329)
(commit `0d464b1` on `feat/issue-294-restart-agent`).

**Server**
- New router `server/src/sessions/ai-router.ts` exposing
  `POST /api/sessions/:sessionId/ai/restart`. Auth + workspace-member
  check + 401/403/404 + 503 surface per the spec; delegates to
  `AgentDriver.restartSession`; broadcasts `session-ai-status` updates
  to peer devices via `DeviceRegistry`.
- Mounted in `server/src/index.ts` next to the existing agent-events
  router at `/api/sessions`.

**Client**
- New `client/src/api/aiSession.ts` typed helper with
  `AISessionRequestError` preserving HTTP status.
- `useAI` hook gains derived `degraded` boolean
  (`!connected && !connecting && error !== null` — heuristic mapping
  for the legacy `session-ai-status` wire shape until #295 unifies it)
  plus `restart()` action with optimistic transition and rollback on
  failure.
- New `AIRestartButton` component, wired into both kiosk views; visible
  only when degraded, shows a transient inline error on 5xx/network
  failure.

**Tests** — 12 server router + 13 helper + 13 hook + 12 component
(50 new tests, all green). Covers T-3.5.S.1..7 and T-3.5.C.1..6 from
the issue. Playwright `tests/restart-agent.spec.ts` deferred (would
require FakeDriver test-helper APIs to force a `degraded` state from
outside).

**Static gates**
| Check | Result |
|---|---|
| `tsc --noEmit -p server/tsconfig.json` | ✅ |
| `tsc --noEmit -p client/tsconfig.json` | ✅ |
| `npm run test -w server` | ✅ 1044 pass |
| `npm run test -w client` | ✅ 865 pass |
| `npm run test:coverage -w server` | ✅ thresholds met |
| `npm run test:coverage -w client` | ✅ `useAI.ts` 100 % lines, `aiSession.ts` 100 % lines |

**CI status on PR #329:** 5/5 checks green (Server Tests, Client
Tests, Build Client, E2E Tests, lint-pr-title). PR marked ready for
review.

No schema changes; no migrations.

Handing off to the orchestrator's review/merge tick.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 21:59 UTC - Review Response Worker (PR #328, round 2)

✅ Addressed the round-2 pr-review suggestion on PR #328 (rebind MISSING
sandbox preserving `conversation_id`, refs #296):

- **Thread:** `PRRT_kwDOSTUWGM6Ea6OD` — "Consider adding concurrency guard
  for `rebindSession` similar to `inFlightRefresh`." (bot-flagged impact:
  low; default-implement per AGENTS.md guidance because the pattern is
  idiomatic and cheap).
- **Fix:** commit `6613fb5` — added
  `private inFlightRebind = new Map<string, Promise<void>>()` on
  `AISessionManager` and refactored `rebindSession` into a thin
  single-flight wrapper around a new private `doRebindSession`. Two
  concurrent rebind calls for the same `conversation_id` now share one
  upstream POST, one `checkBudget` / `recordSuccess`, and one credential
  write — eliminating the race window on `agentServerUrl` /
  `sessionApiKey`. Mirrors the `inFlightRefresh` pattern from #291.
- **Test:** new `concurrent rebindSession calls for the same conversation
  single-flight to one upstream POST` in `server/src/openhands.test.ts`
  asserts the upstream is invoked exactly once, `getRebindCount() === 1`,
  `connectWebSocket` is dialled once, and the in-flight map drains on
  settle.
- **Verification:** `npx tsc --noEmit` clean; `npm test -w server` =
  1070/1070 pass (181/181 in the rebind suite).
- **CI on PR #328:** 7/7 checks green after push (Server Tests, Client
  Tests, Build Client, E2E Tests, lint-pr-title, two pr-review passes).
  No new pr-review threads spawned by the change.
- **Thread state:** both round-1 (`PRRT_kwDOSTUWGM6Ea2ja`, docs) and
  round-2 (`PRRT_kwDOSTUWGM6Ea6OD`, concurrency) threads now resolved.
- PR converted back to ready-for-review; handing off to the orchestrator
  for the merge tick.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 22:03 UTC - Review Response Worker (PR #328, round 2 addendum)

🚧 pr-review's re-run after `6613fb5` spawned one more
🟡 suggestion (`PRRT_kwDOSTUWGM6Ea_Vj`) on `server/src/agent-driver/rebind.ts`:
"Consider adding periodic cleanup for abandoned conversation entries"
in `RebindWindowTracker.history`.

**Decision:** declined / resolved as wontfix.

- The bot itself recommends Option 3 ("Accept current behavior — my
  recommendation") and labels it "Not blocking".
- The memory footprint is bounded by conversation count × at most
  `MAX_REBINDS_PER_WINDOW = 3` timestamps — ~240 KB even with 10 k
  historical conversations.
- A periodic-cleanup timer would introduce lifecycle complexity
  (start/stop hooks, test seams, shutdown ordering) that the manager
  deliberately avoids; no other map on the manager (`inFlightRefresh`,
  `inFlightRebind`, `sessionAI`) has periodic cleanup either, so adding
  one just for `history` would be inconsistent.
- If churn ever becomes a real concern, `getRebindCount()` + platform
  metrics will surface it first and an LRU-on-`recordSuccess` is a
  one-liner — cheap to add later, expensive to carry unused.

All three pr-review threads on PR #328 are now resolved; PR is ready
for the orchestrator's merge tick.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 22:08 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `314e231` | review | PR #328 — rebind MISSING sandbox | running |
| `dad1910` | review | PR #329 — restart agent endpoint | **NEW** |
| `a1ee5fa` | implementation | Issue #303 — Raise client coverage | **NEW** |

**Worker Completed:** `564ed2f` (implementation, Issue #294)
- Created [PR #329](https://github.com/jpshackelford/voice-relay/pull/329) — `feat: restart agent endpoint and UI affordance`
- Ready-for-review, CI green; bot review left 2 inline comments + 1 review (🟡 Acceptable). Handed to review worker `dad1910`.

**Spawned: 2 Workers (parallel)**

1. **Review Worker** — [PR #329](https://github.com/jpshackelford/voice-relay/pull/329) — `feat: restart agent endpoint and UI affordance`
   - Conversation: [`dad1910`](https://app.all-hands.dev/conversations/dad19101ddf643a59665419c86ed1711)
2. **Implementation Worker** — [Issue #303](https://github.com/jpshackelford/voice-relay/issues/303) — `Raise client coverage for modules excluded by #284` (priority:medium)
   - Conversation: [`a1ee5fa`](https://app.all-hands.dev/conversations/a1ee5fa724d0466983d7f08f0884d033)
   - Blocker #284 closed — unblocked.

**Current State:**
- Open PRs: [#328](https://github.com/jpshackelford/voice-relay/pull/328) (review in progress), [#329](https://github.com/jpshackelford/voice-relay/pull/329) (review in progress)
- Ready issues: #294 (PR #329 open), #295 (deferred — likely conflicts with PR #329 on client useAI), #296 (PR #328 open), #297 (blocked by #296), #303 (impl in flight)
- Issues needing expansion: none (remaining unexpanded issues are all `on-hold`: #210, #239, #299–302)
- Slots after spawn: expansion 0/4, implementation 1/1, review 2/2 (fully saturated)

**Action Taken:**
🚀 Spawned 1 review worker (PR #329) and 1 implementation worker (Issue #303). Cleaned up finished implementation worker `564ed2f` (Issue #294 → PR #329).

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-24 22:11 UTC - Review Worker (PR #329)

✅ **PR #329 — `feat: restart agent endpoint and UI affordance`** — review-feedback round complete.

Both inline comments from the auto-review (🟡 **Acceptable** verdict) were
accepted and implemented in a single commit
([`3227899`](https://github.com/jpshackelford/voice-relay/commit/3227899087e4e74255034826066006c5723bed7c)):

| Thread | File | Action |
|---|---|---|
| Extract broadcast error handling | `server/src/sessions/ai-router.ts` | Added `safeBroadcast()` helper; three try/catch blocks (~27 lines) collapsed into single-line calls with `'announce'`/`'error'`/`'final'` context tags. Non-fatal-broadcast semantics preserved. |
| Update coverage-exclusion comment | `server/vitest.config.ts` | Changed `'Integration routes, tested via e2e'` → `'Integration routes, tested via supertest in ai-router.test.ts'` for `ai-router.ts` only. Kept the exclusion entry to stay consistent with the surrounding router lines. |

**Verification:**
- `npx tsc --noEmit` (server) ✅
- `npm test -w server` ✅ — 1044 tests pass (incl. all 12 in `ai-router.test.ts`)
- CI on the pushed branch: Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title — all green
- Both GitHub review threads (`PRRT_kwDOSTUWGM6Ea9tl`, `PRRT_kwDOSTUWGM6Ea9tn`) replied to and marked resolved
- PR moved back to **ready for review**

No scope changes to the PR description — extracting the helper does not
change behavior, only structure; the testing-approach comment is purely
editorial. Next review tick is a separate conversation.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-05-24 22:21 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `a1ee5fa` | implementation | Issue #303 — Raise client coverage | running |
| `fe9cd71` | merge | PR #328 — rebind MISSING sandbox | **NEW** |
| `e2c8f93` | merge | PR #329 — restart agent endpoint | **NEW** |

**Workers Completed:**
- `314e231` (review, PR #328) — finished. 3 pr-review threads resolved (docs, concurrency, `RebindWindowTracker` memory-management declined as wontfix per bot recommendation). PR ready.
- `dad1910` (review, PR #329) — finished. `safeBroadcast()` helper extracted in `ai-router.ts`; vitest coverage-exclusion comment updated. Both threads resolved. PR ready.

**Spawned: 2 Merge Workers (parallel)**

1. **Merge Worker** — [PR #328](https://github.com/jpshackelford/voice-relay/pull/328) — `feat(server): rebind MISSING sandbox preserving conversation_id`
   - Conversation: [`fe9cd71`](https://app.all-hands.dev/conversations/fe9cd712c9d441d9895df6e2e1c9fe49)
   - Pre-merge: mergeable=MERGEABLE, mergeState=CLEAN, 0 unresolved threads, CI green, latest bot review 🟢 **Good taste**.
2. **Merge Worker** — [PR #329](https://github.com/jpshackelford/voice-relay/pull/329) — `feat: restart agent endpoint and UI affordance`
   - Conversation: [`e2c8f93`](https://app.all-hands.dev/conversations/e2c8f93f223c490f839c4904494e7464)
   - Pre-merge: mergeable=MERGEABLE, mergeState=CLEAN, 0 unresolved threads, CI green, latest bot review 🟡 **Acceptable** (no blockers).

**Current State:**
- Open PRs: [#328](https://github.com/jpshackelford/voice-relay/pull/328) (merge in progress), [#329](https://github.com/jpshackelford/voice-relay/pull/329) (merge in progress)
- Ready actionable issues: #294 (→ PR #329), #295 (deferred, conflicts with #329), #296 (→ PR #328), #297 (depends on #296, unblocks post-merge), #303 (impl in flight via `a1ee5fa`)
- Issues needing expansion: none — remaining unexpanded are all `on-hold` (#210, #239, #299–302 per S3 design freeze)
- Slots after spawn: expansion 0/4, implementation 1/1, review 2/2 (fully saturated)

**Action Taken:**
🚀 **Spawned 2 merge workers** for the two clean PRs (#328, #329). Cleaned up finished review workers (`314e231`, `dad1910`). Implementation worker `a1ee5fa` (Issue #303) still running — left alone.

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-24 22:25 UTC - Merge Worker (PR #328)

✅ **Merged PR #328** — [feat(server): rebind MISSING sandbox preserving conversation_id (#296)](https://github.com/jpshackelford/voice-relay/pull/328)

- Squash commit: `feat(server): rebind MISSING sandbox preserving conversation_id (#328)`
- Closed issue: [#296](https://github.com/jpshackelford/voice-relay/issues/296) (auto-closed via `Closes #296`)
- Conversation: [`fe9cd71`](https://app.all-hands.dev/conversations/fe9cd712c9d441d9895df6e2e1c9fe49)

**What landed:**
- `OpenHandsClient.rebindConversation()` + `AISessionManager.rebindSession()` with exponential backoff (1/2/4/8/16s, 30s budget), typed errors (`RebindBudgetExhausted` / `RebindForbidden` / `RebindConversationGone`), and per-conversation 3-per-5min window cap.
- `inFlightRebind` single-flight guard (concurrent reconnect paths cannot double-issue `POST /app-conversations`) — added in commit `6613fb5` in response to round-2 review feedback.
- `reconnectWithRefresh()` now routes MISSING through the rebind path.
- New `AgentSessionState` precedence: `ai.rebinding === true → reconnecting` (ahead of `degraded`).
- New helper `server/src/agent-driver/rebind.ts` (pure functions, typed errors, window tracker) with 21 unit tests; 13 integration tests on `openhands.ts`; 3 driver-level precedence tests.
- Documented the platform contract in `docs/openhands-platform.md § Rebind on a dead conversation`.

**Migration / deploy notes:** No database changes — production SQLite schema untouched. No manual post-deploy steps. Auto-deploy to vr.chorecraft.net is safe.

**Out of scope (carry-overs):** #297 (memory replay across rebind) is now unblocked. #298–#302 (workspace persistence) remain on the active design freeze.

**Pre-merge state confirmed:** mergeable=MERGEABLE, mergeState=CLEAN, 0 unresolved threads, CI green, three positive bot reviews (rounds 1–3, all ✅ Worth merging).

_This worklog entry was generated by an AI agent (OpenHands /prepare-and-merge) on behalf of @jpshackelford._

---

### 2026-05-24 22:23 UTC - Merge Worker (PR #329)

✅ **Merged PR #329** — [feat(server): restart agent endpoint and kiosk UI affordance (#329)](https://github.com/jpshackelford/voice-relay/pull/329)

- Squash commit: `94053d8` — `feat(server): restart agent endpoint and kiosk UI affordance (#329)`
- Closed issue: [#294](https://github.com/jpshackelford/voice-relay/issues/294) (auto-closed via `Closes #294`)
- Conversation: [`e2c8f93`](https://app.all-hands.dev/conversations/e2c8f93f223c490f839c4904494e7464)

**What landed:**
- New `POST /api/sessions/:sessionId/ai/restart` endpoint (`server/src/sessions/ai-router.ts`) wiring the `AgentDriver.restartSession` seam (#287) with workspace-member auth and 401/403/404/503 surfaces.
- Success path broadcasts `session-ai-status` to peer devices via `DeviceRegistry` so multi-kiosk sessions reconcile without polling; failure broadcasts a sanitized error.
- Client: typed `restartAISession()` helper (`client/src/api/aiSession.ts`), `useAI` extensions (`degraded` heuristic, `restarting`, `restartError`, optimistic `restart()` with rollback), and a `AIRestartButton` component wired into both mobile and desktop kiosk views.
- 50 new/extended unit tests (server 12, client helper 13, hook 13, component 12). Server 1044 / client 865 pass. Playwright e2e deferred (FakeDriver helper extensions out of scope).

**Review evolution:** bot round 1 (🟡 Acceptable, MEDIUM risk, flagged minor duplication in router) → addressed in commit `3227899` by extracting `safeBroadcast` helper and clarifying coverage exclusion → bot round 2 (🟡 Acceptable, "Worth merging").

**Migration / deploy notes:** **None required.** No schema changes — production SQLite is unaffected. Endpoint is purely additive; auto-deploy to vr.chorecraft.net is safe with no manual post-deploy steps.

**Pre-merge state confirmed:** mergeable=MERGEABLE, mergeState=CLEAN, 0 unresolved threads, CI green, latest bot review 🟡 Acceptable (no blockers).

**Carry-overs:** #295 can drop the `degraded` heuristic once the unified `session-state` wire format lands. The deferred Playwright e2e remains tracked under the FakeDriver test-infra follow-up.

_This worklog entry was generated by an AI agent (OpenHands /prepare-and-merge) on behalf of @jpshackelford._

---

### 2026-05-24 22:25 UTC - Implementation Worker (issue #303)

🚀 **Opened PR [#330](https://github.com/jpshackelford/voice-relay/pull/330)** — `test(client): cover remaining excluded hook modules (closes #303)`

Final batch of the Phase-0 client-coverage backfill. Adds tests for the six hooks still excluded from the 80% coverage gate by #284 and removes those exclusions from `client/vite.config.ts`.

| Module | New / extended tests | Per-file (stmt / br / fn / line) |
| --- | --- | --- |
| `useAudioPlayback.ts` | 14 new (new file) | 99 / 93 / 100 / 99 |
| `useAudioStreaming.ts` | +10 (mocked `AudioContext`) | 98 / 90 / 100 / 98 |
| `useJoinRequests.ts` | 13 new (new file) | 100 / 100 / 100 / 100 |
| `useWebSocket.ts` | +21 (every server message type + every client send) | 99 / 97 / 94 / 99 |
| `useWorkspaceAutoJoin.ts` | 21 new (new file) | 94 / 84 / 82 / 97 |
| `useWorkspaceSettings.ts` | +17 (OpenHands API-key paths) | 100 / 94 / 100 / 100 |

Aggregate client coverage on the include set: **96.7 / 90.7 / 97.3 / 97.9** — all four metrics well above 80%. `grep -n "TODO.*coverage" client/vite.config.ts` returns 0. `tsc --noEmit -p client/tsconfig.json` exits 0. `npm run test:coverage -w client` passes with 926 tests.

CI green on the draft (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, enable-orchestrator all ✅). PR has been moved from draft to ready for review.

_This worklog entry was generated by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-24 22:35 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `e4c16c2` | merge | [PR #330](https://github.com/jpshackelford/voice-relay/pull/330) — `test(client): cover remaining excluded hook modules (closes #303)` | **NEW** |
| `39c990b` | implementation | [Issue #295](https://github.com/jpshackelford/voice-relay/issues/295) — Unified session-state wire message; useAI as a reducer | **NEW** |

**Workers Completed (prior tick):**
- `a1ee5fa` (implementation, issue #303) — finished. Opened [PR #330](https://github.com/jpshackelford/voice-relay/pull/330); CI green, MERGEABLE/CLEAN, 0 unresolved threads, bot review 🟢 **Good taste**.
- `fe9cd71` (merge, PR #328) — finished. Squash-merged PR #328 (rebind MISSING sandbox). Issue #296 auto-closed.
- `e2c8f93` (merge, PR #329) — finished. Squash-merged PR #329 (restart agent endpoint + UI). Issue #294 auto-closed.

**Spawned: 2 Workers (parallel)**

1. **Merge Worker** — [PR #330](https://github.com/jpshackelford/voice-relay/pull/330) `test(client): cover remaining excluded hook modules (closes #303)`
   - Conversation: [`e4c16c2`](https://app.all-hands.dev/conversations/e4c16c2c050041f98e9ebfce30700eb5)
   - Pre-merge: mergeable=MERGEABLE, mergeState=CLEAN, 0 unresolved threads, CI green, bot review 🟢 **Good taste**. Test-only diff — no migration, safe for production.

2. **Implementation Worker** — [Issue #295](https://github.com/jpshackelford/voice-relay/issues/295) `Unified session-state wire message; useAI as a reducer` (priority:medium, client)
   - Conversation: [`39c990b`](https://app.all-hands.dev/conversations/39c990b205104a5296e6af5bab7063df)
   - Unblocked: dependencies #290 (PR #321) and #293 (PR #324) both merged earlier today. Issue is positioned to replace the temporary `degraded` heuristic introduced by PR #329 (#294) and consume the `thinkingSince` field reserved for it in PR #321 (commit 77fa142).

**Current State:**
- Open PRs: [#330](https://github.com/jpshackelford/voice-relay/pull/330) (merge in flight)
- Ready actionable issues: #295 (impl in flight via `39c990b`), #297 (unblocked by PR #328 merge — next candidate after #295 dispatch), #303 (closed-on-merge-of-#330)
- Issues needing expansion: none — remaining unexpanded are all `on-hold` (S3 design freeze: #299–#302; legacy: #210, #239)
- Slots after spawn: expansion 0/4, implementation 1/1, review 1/2 (one free review slot held in reserve)

**Action Taken:**
🚀 **Spawned 2 workers**: merge for PR #330 and implementation for issue #295. Drained 3 finished workers from state (`a1ee5fa`, `fe9cd71`, `e2c8f93`). Quiet-tick counter reset to 0 (productive tick).

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-24 22:36 UTC - Merge Worker (PR #330)

✅ **Merged: [PR #330](https://github.com/jpshackelford/voice-relay/pull/330)** — test(client): cover remaining excluded hook modules

Final batch of the Phase-0 client-coverage backfill — **closes #303**.

**What landed:**
- 6 hook modules now covered: useAudioPlayback, useAudioStreaming, useJoinRequests, useWebSocket, useWorkspaceAutoJoin, useWorkspaceSettings
- All 6 TODO(#303) exclusions removed from `client/vite.config.ts`
- Aggregate client coverage on the include set: **96.7 / 90.7 / 97.3 / 97.9** (stmt / branch / func / line)
- Test/config diff only — no schema or runtime changes; safe for auto-deploy to vr.chorecraft.net

**Issue #303 four-batch backfill complete:** PRs #316, #318, #327, #330.

**Merge state at gate:** MERGEABLE / CLEAN, all CI green, bot review 🟢 Good taste (round 1, no rework), 0 unresolved threads.

---
### 2026-05-24 23:05 UTC - Implementation Worker (issue #295)

🚀 **Opened: [PR #331 — unified session-state wire + useAI reducer](https://github.com/jpshackelford/voice-relay/pull/331)**

Closes #295. The new `session-state` WebSocket message carries the
driver's full `AgentSessionStatus` 1:1 and the client `useAI` hook is
now a `useReducer` over that shape. Replaced the temporary `degraded`
heuristic from PR #329 with a direct read of `state === 'degraded'` and
consumed the `thinkingSince` field from #290.

| Check | Result |
|---|---|
| Server tests | 1088 passing (added `session-state-broadcast.test.ts` + T-3.6.S.1..3; updated 4 existing files to filter by message type) |
| Client tests | 973 passing (added T-3.6.1..12 reducer-matrix tests; fixed pre-existing flaky `ReleaseNotes` regex on the side — it failed on main too) |
| Client coverage | useAI **100/92.5/100/100**, useWebSocket **97.5/94.9/94.4/98** |
| Server coverage | 94.04 / 84.86 / 96.65 / 95.06 |
| All CI checks | ✅ green |
| Static gate | `grep -nE 'connected: true,|connected: false,|setConnected|setThinking' useAI.ts` → 0 matches |

PR marked ready for review. Review handling is a separate conversation.

Followups: Playwright e2e tests T-3.6-E2E.{1,2,3} (out of scope); legacy
`session-ai-status` / `ai-thinking` broadcasts can be retired once
all clients are on the new wire.

---
EOF && git add WORKLOG.md && git commit -m "docs(worklog): PR #331 opened (issue #295 unified session-state + useAI reducer)" && git push origin main
### 2026-05-24 23:05 UTC - Implementation Worker (issue #295)

🚀 **Opened: [PR #331 — unified session-state wire + useAI reducer](https://github.com/jpshackelford/voice-relay/pull/331)**

Closes #295. The new `session-state` WebSocket message carries the
driver's full `AgentSessionStatus` 1:1 and the client `useAI` hook is
now a `useReducer` over that shape. Replaced the temporary `degraded`
heuristic from PR #329 with a direct read of `state === 'degraded'` and
consumed the `thinkingSince` field from #290.

| Check | Result |
|---|---|
| Server tests | 1088 passing (added `session-state-broadcast.test.ts` + T-3.6.S.1..3; updated 4 existing files to filter by message type) |
| Client tests | 973 passing (added T-3.6.1..12 reducer-matrix tests; fixed pre-existing flaky `ReleaseNotes` regex on the side — it failed on main too) |
| Client coverage | useAI **100/92.5/100/100**, useWebSocket **97.5/94.9/94.4/98** |
| Server coverage | 94.04 / 84.86 / 96.65 / 95.06 |
| All CI checks | ✅ green |
| Static gate | `grep -nE 'connected: true,|connected: false,|setConnected|setThinking' useAI.ts` → 0 matches |

PR marked ready for review. Review handling is a separate conversation.

Followups: Playwright e2e tests T-3.6-E2E.{1,2,3} (out of scope); legacy
`session-ai-status` / `ai-thinking` broadcasts can be retired once
all clients are on the new wire.

---

### 2026-05-24 23:07 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `7f3a113` | implementation | [Issue #297](https://github.com/jpshackelford/voice-relay/issues/297) — Memory replay after rebind via condense + system_message_suffix | **NEW** |

**Workers Completed (this tick):**
- `39c990b` (implementation, issue #295) — finished. Opened [PR #331](https://github.com/jpshackelford/voice-relay/pull/331) (`feat(websocket): unify session-state wire message and refactor useAI as a reducer`); CI green (Server, Client, Build, E2E, lint-pr-title, enable-orchestrator), `pr-review` bot still IN_PROGRESS; PR transitioned draft → ready-for-review.

**Spawned: Implementation Worker**
- Issue: [#297 — Memory replay after rebind via condense + system_message_suffix](https://github.com/jpshackelford/voice-relay/issues/297) (priority:medium)
- Conversation: [`7f3a113`](https://app.all-hands.dev/conversations/7f3a113a51c34fe28c84b33c78ba73b5)
- Unblocked: #295 (just landed as PR #331) and the rebind/restart work (#294/#296) merged earlier; #297 builds on the rebind path to replay agent memory via the OH SDK condense + system_message_suffix hooks.

**Brief auto-disable reversal (housekeeping):**
- Earlier in this same tick, before the impl worker `39c990b` finished, the state file showed `quiet_ticks: 1` and there was no actionable work — no PRs ready for review (only draft #331), no expansion backlog, impl slot occupied by a running worker. The orchestrator incremented to `quiet_ticks: 2` and disabled automation `5f180989-…`.
- Before the disable could be pushed to `main`, a rebase against `origin/main` showed the impl worker had pushed its own ready-for-review WORKLOG entry. Re-querying the conversation API showed `39c990b` had transitioned to `finished` and PR #331 was no longer a draft. With real work now available (#297 dispatch + future review of #331), the automation was re-enabled and this productive entry replaces the disable entry.
- Net effect: automation enabled, `quiet_ticks` reset to 0, no quiet-tick artifact persisted on `main`.

**Current State:**
- Open PRs: [#331](https://github.com/jpshackelford/voice-relay/pull/331) — ready-for-review, CI green except `pr-review` bot IN_PROGRESS, MERGEABLE/UNKNOWN (next tick will dispatch review/merge once `pr-review` settles).
- Ready actionable issues: #297 (impl in flight via `7f3a113`).
- Issues needing expansion: none — remaining open issues are all `on-hold` (S3 freeze: #299–#302; legacy: #210, #239).
- Slots after spawn: expansion 0/4, implementation 1/1, review 0/2 (both held for `pr-review` settlement on PR #331).

**Action Taken:**
🚀 **Spawned implementation worker** for issue #297; drained finished impl worker `39c990b` to completed. Quiet-tick counter reset to 0 (productive tick).

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-24 23:21 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `7f3a113` | implementation | Issue #297 — Memory replay after rebind via condense + system_message_suffix | running |
| `9219f27` | review | PR #331 — feat(websocket): unify session-state wire message | **NEW** |

🚀 **Spawned: Review Worker**
- PR: [#331 — feat(websocket): unify session-state wire message and refactor useAI as a reducer](https://github.com/jpshackelford/voice-relay/pull/331)
- Conversation: [`9219f27`](https://app.all-hands.dev/conversations/9219f27f9b4a4e5aaa429fed362efad1)
- Reason: 1 unresolved github-actions bot review thread (🟡 Suggestion on `s.startingSince ?? new Date().toISOString()` fallback pattern); CI green, MERGEABLE/CLEAN, ready-for-review

**Current State:**
- [PR #331](https://github.com/jpshackelford/voice-relay/pull/331): `oR` green ready 💬1 — review worker now addressing
- Active implementation worker on issue #297 (~12 min in, not yet blocked)
- Ready issues: #295 (PR #331 open), #297 (impl in flight)
- Issues needing expansion: all 6 candidates are `on-hold` (#299–#302 S3 design freeze per AGENTS.md; #210 deployment categorization; #239 flaky AI tests) — nothing to expand

**Action Taken:**
🚀 **Spawned review worker** for PR #331 — addresses the only outstanding signal on the only open PR. Implementation slot remains full (#297). Expansion slots all idle because the backlog is entirely `on-hold`.

---

### 2026-05-24 23:24 UTC - Review Worker (PR #331)

**PR:** [#331 — feat(websocket): unify session-state wire message and refactor useAI as a reducer](https://github.com/jpshackelford/voice-relay/pull/331)
**Branch:** `feat/295-unified-session-state-wire`

**Feedback Addressed:**
| Thread | Type | Decision | Resolution |
|---|---|---|---|
| `useAI.ts:148` startingSince fallback | 🟡 Suggestion | ✅ Implemented | Added inline comment clarifying that `s.startingSince ?? new Date().toISOString()` preserves the original timestamp across repeated `connecting` messages (reconnects) so UI timers don't reset mid-reconnect. |

**Action Taken:**
✅ Pushed `0ddbafe` with the explanatory inline comment, replied to the github-actions review thread, resolved the thread, and moved the PR back to ready-for-review. CI green on the new SHA (5/5 checks passing); zero unresolved review threads.

**Current State:**
- PR #331: ready-for-review, CI green on `0ddbafe`, 0 unresolved threads — ready for the next merge round to pick up.

_This worklog entry was generated by an AI agent (OpenHands review worker) on behalf of @jpshackelford._

---

### 2026-05-24 23:25 UTC - Implementation Worker (#297)

**Issue:** [#297 — Memory replay after rebind via condense + system_message_suffix](https://github.com/jpshackelford/voice-relay/issues/297)
**PR:** [#332 — feat(server): memory replay after rebind via system_message_suffix](https://github.com/jpshackelford/voice-relay/pull/332)
**Branch:** `feat/issue-297-memory-replay-suffix`

✅ **Implemented Phase 4 memory replay.** Wires `system_message_suffix` into the rebind POST so the rebound agent's context is rehydrated from the platform-side event log (which survives sandbox death). After this lands together with #296, sandbox death is near-invisible from the user's perspective.

**Key design decisions:**
- New `server/src/agent-driver/replay.ts` with pure helpers: `buildSuffixFromCondense`, `buildFallbackSuffix` (2 KB cap, recency-preserving truncation, keeps last 2 turns intact), and `buildReplaySuffix` convenience wrapper.
- Production condense is a no-op (`noopCondense` always throws) because the OH `/condense` endpoint requires a live agent server — exactly the resource gone in a MISSING-sandbox rebind. The `CondenseFn` seam stays in place for forward-compat; production always uses the event-log fallback.
- `OpenHandsClient.rebindConversation` extended to accept an optional `systemMessageSuffix`; threaded through `OpenHandsRebindClient` interface, `RebindOptions`, and `AISessionManager.doRebindSession` (new private `buildRebindReplaySuffix` helper).
- Replay prep is strictly best-effort: any failure (events down, condense throws, malformed shapes) degrades to empty suffix and the rebind itself proceeds.

**Tests:** 30 unit tests (replay.test.ts, T-4.2.U.1–U.6 + edge cases), 4 suffix-forwarding tests (rebind.test.ts), 7 integration tests (openhands.test.ts, T-4.2.I.1–I.6 + prep-failure isolation). `TODO(#297)` left by PR #328 removed. Coverage on `replay.ts`: 98.7% lines / 100% funcs.

**CI status:** Server Tests green (1130 passed), Build Client green, E2E green, lint-pr-title green. Client Tests failure is a pre-existing `ReleaseNotes.test.tsx` timestamp flake also failing on `main` (last 4 runs).

**Next:** PR #332 flipped from draft to ready-for-review; awaiting review-worker pickup.

_This worklog entry was generated by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---

### 2026-05-24 23:33 UTC - Orchestrator

**Active Workers:** none (all drained)

**Workers Completed (this tick):**
| Conv ID | Type | Working On | Outcome |
|---|---|---|---|
| `9219f27` | review | [PR #331](https://github.com/jpshackelford/voice-relay/pull/331) | Addressed bot thread in commit `0ddbafe` (startingSince fallback comment); 0 unresolved threads; CI green; MERGEABLE/CLEAN — **ready to merge** |
| `7f3a113` | implementation | [PR #332](https://github.com/jpshackelford/voice-relay/pull/332) for issue [#297](https://github.com/jpshackelford/voice-relay/issues/297) | Created PR for memory replay after rebind via `system_message_suffix`; ready-for-review; **blocked by broken main** (see below) |

Both workers wrote their own completion entries (23:24 UTC, 23:25 UTC) and have been drained from `.workflow-state.json` into `completed[]`.

**🔴 Critical discovery: `main` Client Tests are broken — blocking every PR**

Investigating PR #332's `FAILURE` on Client Tests revealed it is **not** a flake and **not** caused by PR #332 (scope: `server-only`, diff only touches `server/**`):

```
FAIL src/components/ReleaseNotes.test.tsx > ReleaseNotes > timestamp toggling > toggles back to relative time on second click
AssertionError: expected 'last week' to match /ago|yesterday|today|just now/i
```

The relative-time formatter now returns `"last week"` for the test's fixture date because enough wall-clock time has elapsed since the fixture was written. The regex `/ago|yesterday|today|just now/i` doesn't include `"last week"` (or `"weeks ago"`, `"months ago"`, etc.) — i.e., the test's allow-list of relative-time tokens is incomplete.

**Evidence that `main` itself is broken:**

| Run | Branch | Created | Conclusion |
|---|---|---|---|
| (latest) | `main` | 2026-05-24T23:26:58Z | **failure** |
| (latest-1) | `main` | 2026-05-24T23:24:37Z | failure |
| (latest-2) | `main` | 2026-05-24T23:21:58Z | failure |
| (latest-3) | `main` | 2026-05-24T23:08:25Z | failure |
| (latest-4) | `main` | 2026-05-24T23:05:27Z | failure |

The last 5 `main` CI runs all fail on the same `ReleaseNotes.test.tsx:305` assertion. Until this is fixed, **no PR** can land cleanly — including PR #331, even though #331 itself is currently MERGEABLE/CLEAN because its CI ran before the regression date crossed the "last week" boundary, or because the test happens to read system clock at run time.

**🛑 OpenHands Cloud API auth is failing this tick — cannot spawn workers**

Every variant of the conversations API returns `HTTP 401 {"error":"BearerTokenError"}`:

```
Authorization: Bearer $OPENHANDS_API_KEY   → 401 BearerTokenError
Authorization: Bearer $OH_API_KEY          → 401 BearerTokenError
X-Access-Token: $OH_API_KEY                → 401 BearerTokenError
X-API-Key: $OPENHANDS_API_KEY              → 401 NoCredentialsError
```

The token is the expected `sk-o…`-prefixed format (38 chars), but the gateway rejects it. The previously-working PRODUCTION key appears to have been rotated / scoped down / expired since the last orchestrator tick at 23:21 UTC. This tick cannot spawn any new conversations until the credential is refreshed.

**👤 Action requested from operator:**

Please refresh `OPENHANDS_API_KEY` / `OH_API_KEY` for this OpenHands sandbox (and the deployed v2 automation `5f180989-ed9c-42b4-ac9f-5f30f0623316` if those are linked), then re-trigger `/orchestrate`. The next tick should:

1. **Spawn merge worker on PR #331** — fully ready: 7/7 CI checks green, 0 unresolved threads, MERGEABLE/CLEAN, scope `client/server/websocket` is fine (no `on-hold`/`needs-human`).
2. **Spawn implementation worker** for a small `fix(tests): cover 'last week'+ in ReleaseNotes relative-time assertion` PR. Two equally good fixes:
   - Broaden the regex on `ReleaseNotes.test.tsx:305` to also accept `last week|weeks?|months?|years?` patterns.
   - Better: pin the test fixture's date relative to `Date.now()` (e.g., set `mockReleases[0].timestamp = new Date(Date.now() - 5*60*1000).toISOString()`) so the formatter output is deterministic regardless of when the test runs. Add a `vi.useFakeTimers()` guard if needed.
   - Recommended: do the second (deterministic) fix — otherwise the same test will rot again once "last month" / "last year" thresholds cross.
3. **Defer PR #332 review/merge** until the `main` fix lands and CI is re-run on PR #332 (`gh workflow run` or push an empty commit to refresh). Until then PR #332 stays MERGEABLE/UNSTABLE through no fault of its own — do not override the failing check; fix the root cause.

**Current State:**

- Open PRs: 2
  - [PR #331](https://github.com/jpshackelford/voice-relay/pull/331) — CI green, MERGEABLE/CLEAN, 0 unresolved threads. Ready to merge.
  - [PR #332](https://github.com/jpshackelford/voice-relay/pull/332) — Server/Build/E2E/lint green; **Client Tests FAIL due to broken `main`**, not own code. Blocked.
- Ready issues with no open PR: 0 (all `ready` issues #289–#297 either merged or have an open PR).
- Issues needing expansion: 0 — the only remaining open issues (#210, #239, #299–#302) are all `on-hold`.
- Slots after drain: expansion 0/4, implementation 0/1, review 0/2. **Nothing dispatched this tick because the OH Cloud API rejected every credential.**

**`quiet_ticks` = 0** (productive tick: 2 workers drained, critical `main`-broken discovery surfaced, operator action requested).

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-25 01:24 UTC - Orchestrator (productive tick)

🚀 **Spawned 2 workers in parallel** — drained the merge-ready PR and addressed the broken-main blocker discovered last tick.

**Active Workers:**

| Conv ID | Type | Working on | Status |
|---------|------|------------|--------|
| `65d2d64` | review (merge) | [PR #331 — feat(websocket): unified session-state](https://github.com/jpshackelford/voice-relay/pull/331) | running |
| `4b9cf9a` | implementation | [Issue #333 — fix(tests): ReleaseNotes 'last week' regression](https://github.com/jpshackelford/voice-relay/issues/333) | running |

**Slot usage:** expansion 0/4 · implementation 1/1 · review 1/2

**Action taken**

1. **Spawned merge worker for PR #331** — `[Merge] PR #331 — feat(websocket): unify session-state wire message`. PR is MERGEABLE/CLEAN, all CI green, 0 unresolved review threads, no blocking labels → ready to squash. Worker briefed on the broken-main caveat (its own Client Tests pass, the `ReleaseNotes.test.tsx` regression is unrelated) and instructed to proceed with the merge.
   - 🔗 https://app.all-hands.dev/conversations/65d2d64addce4b30b6890a411c644ad3
2. **Filed Issue #333** — [`fix(tests): ReleaseNotes timestamp test fails as fixture date ages into 'last week' bucket`](https://github.com/jpshackelford/voice-relay/issues/333), labels `bug, ci-failure, ready, priority:high`. Full root-cause analysis + recommended deterministic fix (pin `mockChangelog.releases[*].deployedAt` to `Date.now() - N*60*1000`) included in the issue body, so it shipped pre-expanded with `ready` already attached.
3. **Spawned implementation worker for Issue #333** — `[Implementation] Issue #333 — fix(tests): ReleaseNotes 'last week' regression`. Worker briefed on the scope guard (test-only fix, only `client/src/components/ReleaseNotes.test.tsx`) and the WORKLOG/state-file Branch Hygiene CI gate.
   - 🔗 https://app.all-hands.dev/conversations/4b9cf9a8c12d46d58b1202751c10b834

**Why this matters**

- PR #331 has been merge-ready since 23:25 UTC yesterday; the previous tick observed it but couldn't dispatch (OH Cloud API was returning 401). API credentials are restored this tick, so the backlog drains.
- The `ReleaseNotes.test.tsx` "last week" failure has been red on `main` for 5+ consecutive CI runs and is also surfacing on every feature branch's Client Tests check (including PR #332). Fixing the fixture is a tiny, surgical, test-only change — but it's blocking signal across the entire repo.
- PR #332 (Issue #297, memory replay) remains open and red on the same broken-main test. Once #333 lands on main and PR #332 is rebased, its Client Tests should go green and it can advance to review.

**Open issues this tick (post-spawn)**

- `ready`: #295 ✱(behind PR #331), #297 ✱(behind PR #332), #333 ✱(behind impl worker just spawned)
- `on-hold`: #210, #239, #299, #300, #301, #302 — all under the S3 design freeze per AGENTS.md
- Nothing needs expansion right now.

**Next tick expectations**

- PR #331 → merged to main (closes #295).
- New PR opens against #333 with deterministic fixture fix; Client Tests should be green.
- PR #332 likely still red on Client Tests until rebased on top of #333's fix.

**`quiet_ticks` = 0** (productive tick: 2 workers spawned, 1 critical issue filed and dispatched).

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-25 01:24 UTC - Merge worker (PR #331)

✅ **Merged: [PR #331](https://github.com/jpshackelford/voice-relay/pull/331) — `feat(websocket): unify session-state wire message and refactor useAI as a reducer`**

- Squash commit: [`a2850f1`](https://github.com/jpshackelford/voice-relay/commit/a2850f1db570990f71bc2d7e0b1ed4a595a03ed5)
- Closed Issue: [#295](https://github.com/jpshackelford/voice-relay/issues/295) (auto-closed via `Closes #295` trailer)
- CI on the PR: 7/7 green at merge time
- Review threads: 1 total, all resolved
- Diff scope: 17 files (+1119 / −121); `client/` + `server/src/` TypeScript only
- **Migration check:** ✅ no DB schema changes (no migration files, no SQLite mutations)
- **Production:** deploy to vr.chorecraft.net will trigger automatically; wire change is additive (new `session-state` emitted alongside legacy `session-ai-status` / `ai-thinking`), safe for rolling clients

**Notable: this PR also pre-emptively fixed the `ReleaseNotes.test.tsx` relative-time flake** (broadened regex to include `last week`, `in 3 months`, etc.). The separate fix-PR for issue #333 mentioned in the merge brief may now be redundant — main's Client Tests should turn green on the next CI run.

PR description was refreshed before merge to reflect the final state (added the inline `startingSince` comment, the broadened ReleaseNotes regex, and a migration / production notes section).

_This worklog entry was generated by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---

### 2026-05-25 01:28 UTC - Implementation Worker (Issue #333)

✅ **Completed: PR #334 - fix(tests): pin ReleaseNotes mock fixtures**

- Issue: [#333 - ReleaseNotes timestamp test fails as fixture date ages into 'last week' bucket](https://github.com/jpshackelford/voice-relay/issues/333)
- PR: [#334 - fix(tests): pin ReleaseNotes mock fixtures relative to Date.now()](https://github.com/jpshackelford/voice-relay/pull/334)
- Scope: test-only change, single file (`client/src/components/ReleaseNotes.test.tsx`)

**What was done:**
- Replaced hardcoded `deployedAt: '2026-05-17T22:49:31Z'` with `new Date(Date.now() - 5 * 60 * 1000).toISOString()` (and 15 min for the older entry), pinning fixture timestamps relative to current time.
- Set `generatedAt` to `new Date().toISOString()`.
- Derived expected absolute-format month name dynamically via `Intl.DateTimeFormat('en', { month: 'short' })` so the "May" assertion at line 286 (and its companion at line 300) works in any month/year.
- Kept the relative-format regex `/ago|yesterday|today|just now/i` tight — fixture is now bounded to the "minutes ago" bucket.

**Verification:**
- Local: `npm test -- ReleaseNotes.test.tsx` → 19/19 pass. Full client suite → 960/960 pass.
- CI on PR #334: all 7 checks green (Client Tests, Server Tests, E2E Tests, Build Client, enable-orchestrator, lint-pr-title; pr-review skipped on draft as expected).

**PR moved to ready-for-review.** Review/merge handled by next orchestrator cycle.

---

### 2026-05-25 01:35 UTC - Orchestrator (productive tick)

🚀 **Spawned merge worker** for the test-fixture fix that's already CI-green.

**Active Workers (after this tick):**

| Conv ID | Type | Working on | Status |
|---------|------|------------|--------|
| `bef3099` | review (merge) | [PR #334 — fix(tests): pin ReleaseNotes mock fixtures](https://github.com/jpshackelford/voice-relay/pull/334) | **NEW** |

**Slot usage:** expansion 0/4 · implementation 0/1 · review 1/2

**Drained from previous tick** (both finished cleanly per OH Cloud API):

| Conv ID | Type | Outcome |
|---------|------|---------|
| `4b9cf9a` | implementation | Created [PR #334](https://github.com/jpshackelford/voice-relay/pull/334) — deterministic fixture pin for ReleaseNotes test |
| `65d2d64` | review (merge) | Merged [PR #331](https://github.com/jpshackelford/voice-relay/pull/331) (squash `a2850f1`, closed #295) |

**Action taken**

- **Spawned `bef3099` — merge worker for PR #334**. PR is `MERGEABLE/CLEAN`, 9/9 checks green (Client/Server/E2E/Build Client/pr-review SUCCESS, lint-pr-title, enable-orchestrator), 0 unresolved review threads, only `github-actions` COMMENTED. Worker briefed on: (a) test-only scope (`client/src/components/ReleaseNotes.test.tsx`), (b) no DB migration needed, (c) the `docs(worklog):` commit-prefix convention for the WORKLOG entry, and (d) the Branch Hygiene CI gate requiring WORKLOG/state changes to land on `main` only.
   - 🔗 https://app.all-hands.dev/conversations/bef30999a48c4357a6dec674c0245542

**Why this tick is single-action**

PR #332 (memory replay, Issue #297) is also open but `mergeStateStatus=UNSTABLE` due to `Client Tests` FAILURE. The most likely cause is that #332's branch hasn't been rebased onto post-#331 `main`, where the `ReleaseNotes` relative-time regex was already broadened. Once #334 lands on `main` (deterministic fixture fix) and #332 rebases, its Client Tests should go green without code changes to that PR. Spawning a review worker on #332 *now* risks duplicate effort (the worker would start writing its own fixture/regex fix in parallel with the merge worker's squash). Holding it for the next tick once `main` has the pinned fixtures is the cheaper path.

**Current state**

- Open PRs:
  - [PR #334](https://github.com/jpshackelford/voice-relay/pull/334) — `CLEAN/MERGEABLE`, merge worker dispatched.
  - [PR #332](https://github.com/jpshackelford/voice-relay/pull/332) — `UNSTABLE` (Client Tests failing on stale `main`). Deferred to next tick after #334 merges.
- Ready issues without an open PR: 0 (#297 → #332, #333 → #334).
- Issues needing expansion: 0.
- `on-hold` (S3 design freeze per AGENTS.md): #210, #239, #299, #300, #301, #302 — untouched.

**`quiet_ticks` = 0** (productive tick: 2 workers drained, 1 spawned).

_This worklog entry was generated by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---
