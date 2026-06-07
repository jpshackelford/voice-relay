# Voice Relay Worklog Archive - 2026-06-07

Archived entries from WORKLOG.md.

---

### 2026-06-07 01:29 UTC - Expansion Worker (manual /expand-issue, issue #426)

✅ **Expanded Issue #426 — Styling Inconsistencies on the Workspace Home Page**

- Issue: [#426 Styling Inconsistencies on the Workspace Home Page](https://github.com/jpshackelford/voice-relay/issues/426)
- Type: Enhancement (UI / design-system consistency)
- Status: **Ready for implementation** (`ready` label applied)
- Root cause confirmed by inspection of merged diffs:
  - PR #422 (`feat(client): workspace settings UI for hosted STT engine, cap, key, and usage`, merged 2026-06-06 16:24 UTC) — **not** PR #402 as the issue body suggests; #402 was the server-side broker — added new wrapper class names in `client/src/pages/WorkspaceHome.tsx` (`stt-engine-setting`, `stt-engine-row`, `stt-engine-option`, `inline-hint`, `stt-cap-setting`, `stt-cap-input`, `stt-usage-setting`, `stt-usage-row`, `stt-usage-counter`) but **did not add matching CSS rules to `client/src/App.css`**.
  - Without rules, the two `<label class="stt-engine-option">` radio options for "Speech recognition engine" inline-collapse into one line, producing the "●" between sentences visible in the issue screenshot.
  - The Deepgram API Key sub-panel reuses the existing `.api-key-setting` / `.api-key-input-row` / `.api-key-status` / `.api-key-btn` classes and renders correctly — the inconsistency is concentrated in the radio group and the cap/usage rows.
- Proposed fix: CSS-only addition (~25–35 lines) in the "API Key Settings" block of `client/src/App.css` (after line ~4339). No JSX changes, no DB, no migration, no server impact.
- Complexity: **Low.** UI-only fix, auto-deploys to vr.chorecraft.net on merge.
- Acceptance criteria: 8 bullet points covering radio stacking, hint placement, vertical rhythm match with sibling panels, preservation of Deepgram panel mirror of ElevenLabs, no new tokens/JSX/deps, test pass-through, and visual smoke against the issue screenshot.

**Actions taken:**

| Action | Result |
| --- | --- |
| Rewrote issue body with Problem Statement / Proposed Solution / Acceptance Criteria / Out of Scope / Environment | ✅ [issue #426](https://github.com/jpshackelford/voice-relay/issues/426) |
| Posted technical comment with Root Cause table, Implementation Plan, CSS sketch, files affected | ✅ [comment 4641022191](https://github.com/jpshackelford/voice-relay/issues/426#issuecomment-4641022191) |
| Added `ready` label | ✅ |

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 01:36 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `204eef3` | implementation | Issue #363 — persist AISession state in DB | **NEW** |

🚀 **Spawned: Implementation Worker** + 🎯 **Priority-assessed #426** + ✅ **Unblock pass: 0 lifts (mechanical match deferred to AGENTS.md policy)**

**State observed (verified at 01:35Z):**

| Bucket | Count | Items |
| --- | --- | --- |
| Open PRs | 0 | — |
| Active workers (pre-tick) | 0 | all slot arrays empty |
| Ready + actionable (no `on-hold` / `needs-human`) | **3** | [#351](https://github.com/jpshackelford/voice-relay/issues/351) (`priority:low`, server), [#363](https://github.com/jpshackelford/voice-relay/issues/363) (`priority:medium`, server), [#384](https://github.com/jpshackelford/voice-relay/issues/384) (`priority:medium`, full-stack) |
| Ready, unprioritized → assessed this tick | **1** | [#426](https://github.com/jpshackelford/voice-relay/issues/426) — labeled `priority:medium`, `scope:client-only`, `client` |
| Needs expansion + actionable | 0 | — |
| Policy `on-hold` (skip) | 7 | #210, #239, #299–#302, #386 |
| `needs-human` (skip) | 1 | #372 |

**Unblock pass:** 0 issues lifted.

- Mechanical grep `'blocked by #[0-9]+'` matched on #299 (`Blocked by #298` — CLOSED) and #301 (`Blocked by #295` — CLOSED).
- **Intentionally did not lift either label.** Per the orchestrate skill's "Anti-Stall: Decision Table is Exhaustive" §3 (codified policy in `AGENTS.md`), the active design freeze in [AGENTS.md § "Active design freeze: workspace persistence (S3 / #298)"](AGENTS.md) gates #298–#302 until S3 bucket + creds + smoke-test land. The 2026-06-06 23:30Z human cleanup table explicitly classified #299–#302 as `Keep (policy hold)` for the same reason. Same call as the 2026-06-06 23:42Z tick.
- The remaining `on-hold` issues (#210, #239, #386) had no machine-parseable blocker references at all — policy-tracked, correctly skipped.

**Priority assessment inline (#426):**

- Issue was expanded by the manual 01:29 UTC expansion worker but landed without a `priority:*` label.
- Set `priority:medium` + `scope:client-only` + `client` (visible UI regression on workspace home since PR #422 merged 2026-06-06 16:24Z; CSS-only fix, low risk).
- Posted [comment 4641033366](https://github.com/jpshackelford/voice-relay/issues/426#issuecomment-4641033366) recording the rationale.
- Queues behind #363 (same priority tier, lower issue #).

**Decision per the decision table:**

- Expansion (0/4 → 0/4): no actionable expansion candidates → idle slot.
- Implementation (0/1 → 1/1): 4 ready+prioritized targets after #426 assessment. Highest-priority pick = **#363** (`priority:medium`, lowest issue # among medium-tier candidates). #384 (medium, full-stack) and #426 (medium, client) queue behind; #351 (low) deeper in queue.
- Review (0/2 → 0/2): no open PRs → idle slots.

**Spawned: Implementation Worker for #363**

- Issue: [#363 feat(server): persist operational AISession state in DB instead of holding it only in-memory](https://github.com/jpshackelford/voice-relay/issues/363) (`priority:medium`, `scope:server-only`)
- Schema-touching — worker prompt warns about backward-compatible migration (sequential after `019_*`).
- Start-task id: `bad10a9c20a6410c81764b221d152cdf` → `app_conversation_id = 204eef38a6104eaeabaa4df7b3736c28` (status `READY` after 5 polls; `execution_status = running`, `sandbox_status = RUNNING` at verification).
- Conversation: [`204eef3`](https://app.all-hands.dev/conversations/204eef38a6104eaeabaa4df7b3736c28)
- Plugin ref: `voice-relay-workflow @ main`

**Anti-stall note:** the decision table is exhaustive. No `## INSTRUCTION:` override, `hold` label, or codified policy currently defers PR-less work on #363, #384, #426, or #351. All four are dispatchable on their merits; only the impl-slot cap of 1 prevents parallel dispatch.

**Slot accounting at end of tick:** expansion 0/4, implementation 1/1, review 0/2. Total active conversations: 1/7.

**Quiet-tick counter:** reset `(prior productive tick value) → 0` (productive — 1 impl worker spawned + 1 priority assessment).

**Production-impact:** none from this orchestrator action. The dispatched impl worker will eventually open a draft PR; production deploys only on merge to `main`. State + WORKLOG changes are repo-metadata-only.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 01:55 UTC - Implementation Worker (#363)

✅ **Shipped: `feat(server): persist operational AISession state in SQLite (#363)`**

- PR: [#427](https://github.com/jpshackelford/voice-relay/pull/427) (draft → ready)
- Branch: `feat/363-persist-ai-session-state`
- Base: `34ebbd6`
- AC-gate verdict: **all 8 non-exempt items satisfied → trailer `Fixes #363`**.
- Follow-up issues: **none required** (no `## Deferred to follow-ups` section).

**What lands:**

| Layer | Change |
|---|---|
| DB | Migration `020_session_ai_state.ts` — additive, idempotent. New table + index + `INSERT OR IGNORE` backfill from `sessions.metadata.aiConversationId` for `active` rows. `state` CHECK excludes `paused` per the issue (#360 extends). |
| Sessions repo | New `SessionAIStateRepository` with `findBySessionId`, `listByState`, `listAll`, `upsert`, `transitionTo`, `setRebindAttempts`, `deleteBySessionId`. 22 unit tests at 100% coverage. |
| AISessionManager | Single `transitionTo(session, state, reason)` chokepoint replaces all scattered `session.degraded = …` / `session.rebinding = …` writes. Added `persistInitialState` (UPSERT on create), `persistRebindAttempts` (after every `recordSuccess`), `setAIStateRepository` (also seeds the rebind tracker from disk). |
| Lifecycle | `shutdown()` no longer calls `endSessionAI` — closes WS + clears in-memory cache but **preserves** the durable rows. Only user-initiated driver `close`/`restart` paths delete rows. |
| Rebind budget | `RebindWindowTracker.getHistory` + `seedFromHistory` (tracker stays storage-agnostic). Budget survives restart end-to-end (test: a restored tracker with 2 entries lets a 3rd succeed and a 4th throw). |
| Rehydrate | `rehydrateAgentSessions` branches on the durable state — `running` re-attach, `degraded` skip+broadcast, `rebinding` 2 s backoff + 1 retry then degrade, `ended` skip silently. Failed re-attach on a `running` row upserts `degraded` so the next restart doesn't loop. |
| Wiring | `index.ts` constructs `SessionAIStateRepository` next to the other repos and installs it via `setAgentAIStateRepository`. Same repo passed into `rehydrateAgentSessions`. |
| Docs | `docs/architecture.md` § Persistence layer → new subsection "Durable AI-session state (#363)" — schema, write/read paths, rollback. |

**Test summary:** server suite 1633/1633 pass; coverage 94.43% lines / 89.22% branches / 97.08% functions / 95.28% statements (above the 80% gate). New code (repository + migration) at 100%.

**CI:** all checks green at ready-mark — Build Client ✅, Client Tests ✅, Server Tests ✅, E2E Tests ✅, lint-pr-title ✅, enable-orchestrator ✅, pr-review pending (will run on ready).

**Production-impact:** safe — purely additive schema. Rollback is `DROP TABLE`; every code path falls back to in-memory only (= pre-#363 behavior).

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 02:00 UTC - Implementation Worker (#363) — duplicate-spawn no-op

🛑 **Spawn collision.** This worker (OpenHands conversation, branch
`feat/363-persist-ai-session-state`) was dispatched against #363 at
01:34 UTC, the same window in which another implementation worker
opened PR [#427][pr-427] (01:49 UTC). Both workers produced functionally
equivalent diffs against the same branch name — same migration filename
(`020_session_ai_state.ts`), same `SessionAIStateRepository`, same
`transitionTo` chokepoint, same state-aware `rehydrateAgentSessions`.

[pr-427]: https://github.com/jpshackelford/voice-relay/pull/427

Discovery happened at `git push -u origin feat/363-persist-ai-session-state`
which was rejected (non-FF) because the remote branch already held
`4b89789` from the parallel worker. PR #427 is already `Ready for review`,
CI is fully green (Server / Client / E2E / Build / lint-pr-title), and
the `pr-review` bot is engaged.

**Action taken:** abandoned the local commit (`a3abbc0`, never pushed),
deleted the local feature branch, and logged this entry so the
orchestrator knows two workers were spawned. No code, PR, or issue
mutation by this worker.

**Note for orchestrator:** PR #427 is the canonical implementation
for #363. If the dispatcher considers re-spawning, gate on
`gh pr list --search "feat/363" --state all` first.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 02:09 UTC - Orchestrator (manual /orchestrate)

🚀 **Reaped 1 worker + Spawned 2 workers (parallel)**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `366d104` | merge | PR #427 → Issue #363 | **NEW** running |
| `2bded59` | implementation | Issue #384 — Show person name on Workspace page | **NEW** running |

**Worker Completed (reaped):** `204eef3` (implementation, issue #363)
- Outcome: Opened [PR #427](https://github.com/jpshackelford/voice-relay/pull/427) — `feat(server): persist operational AISession state in SQLite` (Fixes #363)
- At reap: required CI 8 SUCCESS + 1 SKIPPED (all green), `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, `isDraft=false`
- pr-review bot review: ✅ COMMENTED "Worth merging" (🟢 Good taste, 🟡 MEDIUM overall risk)
- 0 review threads, 0 unresolved threads, 0 human comments

**Spawned 1: Merge Worker → PR #427**
- PR: [#427 — feat(server): persist AISession state in SQLite (#363)](https://github.com/jpshackelford/voice-relay/pull/427)
- Linked issue: #363 (priority:medium, scope:server-only)
- Conversation: [`366d104`](https://app.all-hands.dev/conversations/366d10404b414fdeaa9cb013bb06659f)
- Task: migration check → AC-gate (hard gate) → squash & merge → close #363 → log SHA

**Spawned 2: Implementation Worker → Issue #384**
- Issue: [#384 — Workspace page: show person name (device name) for connected devices](https://github.com/jpshackelford/voice-relay/issues/384)
- Labels: enhancement, ready, priority:medium, scope:full-stack
- Conversation: [`2bded59`](https://app.all-hands.dev/conversations/2bded598b8884e2bbeeb0d63b6f004c3)
- Selected over #426 (also priority:medium) by oldest-first tiebreak; #351 deferred (priority:low)
- Worker advised to branch from latest main and rebase if conflict surfaces after #427 merges

**Unblock Pass: 0 issues lifted**
- Candidates `#299` and `#301` have machine-readable blockers (`#298`, `#295`) that are now CLOSED, so the mechanical pass *would* lift them — **but** AGENTS.md "Active design freeze: workspace persistence (S3 / #298)" is a codified policy gate (per the anti-stall section's third gate-source) that explicitly keeps `#298–#302` on `on-hold` until the operator-side preconditions are met:
  - `VR_WORKSPACE_BUCKET` set in prod `.env`
  - AWS credential env vars in place
  - S3 provisioning runbook executed + `/api/internal/health/s3` smoke test passes
- None of those preconditions can be verified from orchestrator context, and the freeze remains in force. Honoring the AGENTS.md gate over the mechanical pass.
- `#210`, `#239`, `#386` are policy-tracked (no machine-readable `Blocked by #N`) — left alone per spec.

**Anti-Stall Note:**
Per the "Anti-Stall: Decision Table is Exhaustive" section of the orchestrate skill, the four candidate-eligible issues called out for this tick (`#363`, `#384`, `#426`, `#351`) carry no codified gate that would defer them: no `## INSTRUCTION:` block, no `on-hold`/`needs-human` label, no AGENTS.md policy. The only constraint is the 1-slot implementation cap. With #363 now in the merge slot, #384 takes the impl slot. #426 and #351 remain in the ready backlog for future ticks.

**Current State:**
- [PR #427](https://github.com/jpshackelford/voice-relay/pull/427) — `oCR ready merge-dispatched` (merge worker active)
- Ready issues remaining: #384 (now in impl), #426 (priority:medium), #351 (priority:low)
- Issues needing expansion: none this tick (all open non-ready issues are on-hold / needs-human / policy)
- Slots: expansion 0/4 · implementation 1/1 · review 1/2

**Action Taken:**
- ✅ Reaped finished impl worker for #363 → moved to `completed[]` with outcome
- ✅ Spawned merge worker for PR #427 (review slot)
- ✅ Spawned impl worker for issue #384 (impl slot)
- ✅ Reset `quiet_ticks = 0`
- ✅ Pruned `completed[]` to last 24h (26 → 16 entries)

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-07 02:10 UTC - Merge Worker (PR #427 → main)

✅ **Merged: `feat(server): persist operational AISession state in SQLite (#363)`**

- PR: [#427](https://github.com/jpshackelford/voice-relay/pull/427)
- Linked issue: [#363](https://github.com/jpshackelford/voice-relay/issues/363) — **CLOSED** automatically by the `Fixes #363` trailer (02:09:48Z).
- Squash SHA on `main`: [`e90181a`](https://github.com/jpshackelford/voice-relay/commit/e90181ab89d6693b86fee1b11a884796232ddcaf)
- Merged at: 2026-06-07 02:09:46Z

**Pre-merge gates**

| Gate | Result | Detail |
|---|---|---|
| Required CI (`Build Client` / `Client Tests` / `Server Tests` / `E2E Tests` / `lint-pr-title` / `enable-orchestrator` ×2 / `pr-review`) | 8 SUCCESS + 1 SKIPPED | green |
| `mergeable` / `mergeStateStatus` / draft | MERGEABLE / CLEAN / false | clean |
| pr-review bot verdict | 🟢 Good taste, 🟡 MEDIUM overall risk | Worth merging |
| Review threads | 0 open / 0 unresolved | — |
| AGENTS.md orchestrator-file guard | n/a | branch did not modify `WORKLOG.md` / `.workflow-state.json` |
| `## INSTRUCTION:` override in `WORKLOG.md` | none | grep returned no match for #427 |

**Closing-trailer AC gate — verdict: PASS**

Trailer was `Fixes #363`. Walked every non-exempt AC item in issue #363 against the final diff (the `mergeSha` above). The PR description carries the full item-by-item evidence table; spot-checked here:

| AC | Evidence in merged commit |
|---|---|
| Migration creates `session_ai_state` with additive, idempotent backfill from `sessions.metadata.aiConversationId` for `active` sessions | `server/src/storage/migrations/020_session_ai_state.ts` — `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + `INSERT OR IGNORE … WHERE status=active AND json_extract(metadata,$.aiConversationId) IS NOT NULL`. Filename is `020_*` because slot 016 was already taken; the ACs new-migration intent is satisfied. |
| `SessionAIStateRepository` exposes `findBySessionId` / `listByState` / `upsert` / `transitionTo` / `setRebindAttempts` / `deleteBySessionId` | `server/src/sessions/session-ai-state-repository.ts` — all six present (plus `listAll` for the tracker-seed path). |
| Single `transitionTo` chokepoint replaces scattered `degraded`/`rebinding` writes | `server/src/openhands.ts` — `transitionTo(session, state, reason)` introduced; previous direct field writes removed. |
| `RebindWindowTracker` budget survives restart; tracker stays storage-agnostic | `server/src/agent-driver/rebind.ts` — adds `getHistory` + `seedFromHistory`; manager re-seeds on `setAIStateRepository` and persists via `persistRebindAttempts`. Restart-simulation test in `openhands.test.ts`. |
| `rehydrateAgentSessions` branches on lifecycle state (running re-attach / degraded skip+broadcast / rebinding one-shot retry / ended skip) | `server/src/agent-rehydrate.ts` — all four branches present; seven new state-aware tests in `agent-rehydrate.test.ts`. |
| `docs/architecture.md` documents the table and rehydration policy | New subsection "Durable AI-session state (`session_ai_state`) — issue #363" in the Persistence layer. |
| Existing tests pass; new restart-simulation + rebind-budget-survival tests | Server suite 1633/1633 passing on the green CI run. |
| No regressions to user-visible reconnect UX | In-memory cache updated first inside `transitionTo` so device-state broadcasts fire at the same moment as pre-#363. All reconnect/rebind/refresh tests still pass. |

No exemptions claimed in the issue body (no `(deferred)` / `(out of scope)` markers inside `## Acceptance Criteria`; the four Non-goals items are separately listed under `## Out of Scope` and are *not* AC). Gate clears without an override.

**Squash commit body** recorded the verdict line `AC gate: PASS — all 8 non-exempt acceptance criteria on #363 verified` plus the `Fixes #363` trailer.

**Production-deploy notes** (auto-deploy will pick this up on next vr.chorecraft.net cycle):

- Migration is purely additive (`CREATE TABLE` / `CREATE INDEX` / `INSERT OR IGNORE`) — safe against the live SQLite DB.
- Rollback path: `DROP INDEX idx_session_ai_state_by_state; DROP TABLE session_ai_state;` — every code path falls back to pre-#363 in-memory behaviour. `sessions.metadata.aiConversationId` is untouched.
- No required post-deploy steps. Best-effort persistence: transient SQLite failures on a `transitionTo` write log but never alter control flow.

**Follow-ups**

- None filed. The CHECK constraint deliberately excludes `paused`; #360 (already merged) extends it in its own migration if/when the PAUSED-state work expands the lifecycle set further. No work hidden behind a `Refs/Part-of` trailer.

**Slot accounting**

- Merge slot: 1 → 0 (PR #427 closed-merged).
- Implementation slot: 0/1 (impl worker for #363 reaped on its own ~01:55Z).
- Backlog after this merge: `ready + actionable + not on-hold` set still includes #351 (server, low), #384 (full-stack, medium), plus any newcomers since 01:55Z. Next orchestrator tick can dispatch normally.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 02:18 UTC - Implementation worker (#384)

✅ **PR #428 opened (ready for review)** — workspace page now shows
`<preferredName> (<deviceName>)` for connected devices.

**Scope:** full-stack, additive.

- **Server:** `GET /api/workspaces/:id/devices` returns a nullable
  `primaryUser: { userId, preferredName }` per device, joining
  `devices.primary_user_id` against the #383 `speakers` table.
  Lookups are cached by `userId` within the request so an N-device
  workspace with one owner only hits the speakers table once. A
  failed speaker lookup degrades to `preferredName: null` rather
  than breaking the device list.
- **Client:** `DeviceInfo` gains `primaryUser?`; `EditableDeviceName`
  renders the person name in primary weight followed by a muted,
  parenthesized device name when resolved. Click-to-edit on the
  device-name portion is unchanged. Older servers that omit the
  field are handled the same as `null`.
- **No migrations.** Schema work landed in #383.

**Tests:** 4 new server tests + 6 new client component tests cover
the three AC states (resolved name, null preferred_name, no
`primary_user_id`), the "no speaker row" fallback, the
older-server omitted-field case, and click-to-edit in both display
branches. Full suites green: server 1592/1592, client 1156/1156.

**CI:** all green (Build Client, Client Tests, Server Tests, E2E,
lint-pr-title).

**AC Gate verdict:** PASS — all 5 acceptance-criteria items
satisfied. Trailer: `Fixes #384`. No follow-ups filed.

**Cross-link note:** PR #402's suggestion to also surface the
per-device STT engine (`devices.config.stt_engine`) on the same
row is **not** included here — it's a separate concern and can be
its own issue if/when an operator wants it.

PR: https://github.com/jpshackelford/voice-relay/pull/428

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 02:30 UTC - Implementation worker (#426 → PR #429)

✅ **#426 — Styling Inconsistencies on the Workspace Home Page** — draft → ready.

PR #422 added new wrapper class names in `WorkspaceHome.tsx`
(`.stt-engine-setting`, `.stt-engine-row`, `.stt-engine-option`,
`.inline-hint`, `.stt-cap-input`, `.stt-usage-row`,
`.stt-usage-counter`) but never added matching CSS rules to
`client/src/App.css`. The "Speech recognition engine" radio group
fell back to browser-default inline layout and collapsed onto a
single line with the second radio's `●` glyph mashed against the
preceding label text. Italic helper hint
"(set an API key below first)" also wrapped awkwardly.

**Fix (CSS-only, +69 / -0 in `client/src/App.css`):** Added rules
under the existing `/* API Key Settings */` block:

- `.stt-engine-setting` — top divider matching `.api-key-setting`
  to introduce the STT group cleanly under the kiosk-ticker toggle.
- `.stt-engine-row` — flex column, 0.4rem gap → vertical stacking.
- `.stt-engine-option` — flex row, `align-items: center`, 0.5rem
  gap → native-form-control look for each radio + label pair.
- `.stt-engine-option input[type='radio']:disabled ~ span` —
  dims the disabled hosted-engine option (`opacity: 0.55`,
  `cursor: not-allowed`) until a Deepgram key is configured.
- `.inline-hint` — `#666` italic helper that stays inline with its
  sibling text (`margin-top: 0` cancels `.setting-hint`'s push).
- `.stt-cap-input` — caps width at 12rem with an 8rem min.
- `.stt-usage-row`, `.stt-usage-counter[ strong]` — align the
  usage line at the same font rhythm as the API-key rows.

No JSX, server, DB, or migration changes. All 1150 client tests
green; `npm run build -w client` (tsc + Vite) clean.

**CI:** all green — Build Client (31s), Client Tests (41s),
Server Tests (50s), E2E Tests (1m48s), lint-pr-title.

**AC Gate verdict:** PASS — items 1–7 satisfied by the diff.
Item 8 ("manual smoke test in workspace home settings tab
confirms the screenshot in #426 no longer reproduces") is the
standard post-deploy visual smoke step on `vr.chorecraft.net`
once #429 auto-deploys; called out in the PR's Test Plan. No
deferred follow-ups. Trailer: `Fixes #426`.

PR: https://github.com/jpshackelford/voice-relay/pull/429

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 02:55 UTC - Review worker (PR #428 round 2)

✅ Addressed pr-review feedback on PR #428 — feat(client): show person name (device name) on workspace page (Fixes #384).

| Item | Value |
| --- | --- |
| PR | [#428](https://github.com/jpshackelford/voice-relay/pull/428) |
| Branch | `feat/384-workspace-device-person-name` |
| Commit | `761f372` — _refactor: trim verbose comments per PR #428 review_ |
| Threads resolved | 6 / 6 (all 🟡 Suggestion from `github-actions`) |
| AC Gate verdict | **PASS** (unchanged — comment-only diff, all 5 ACs still backed by tests, `Fixes #384` trailer intact) |

Decisions per thread (consistent stance — pragmatic project style favors self-documenting code; kept short notes only where information was not derivable from the code):

| Location | Action |
| --- | --- |
| `client/src/pages/WorkspaceHome.tsx:128` | Dropped 8-line preamble; var name + `?.` + JSX self-document. |
| `client/src/hooks/useDevices.ts:13` | Collapsed 9-line JSDoc → single-line summary. |
| `client/src/hooks/useDevices.ts:29` | Collapsed 5-line JSDoc → 1-line inline note (kept pre-#384 backwards-compat hint). |
| `server/src/workspaces/router.ts:1221` | Collapsed 11-line block → 3 lines (cache rationale + speakerRepository fallback). |
| `server/src/workspaces/router.ts:1246` | Trimmed 8-line block → 3 lines preserving the "no speaker row" vs "speaker without preferred name" distinction (the one suggestion with real ambiguity worth keeping). |
| `client/src/App.css:3271` | Collapsed 6-line block → 1 line. |

Net diff: +9 / −49 across 4 files. PR moved back to ready; CI re-running (mergeStateStatus=UNSTABLE pending checks). No code/test/behaviour change.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 02:56 UTC - Merge worker (PR #429)

✅ **Merged PR #429** — `fix(client): add CSS for hosted-STT settings wrapper classes` (Fixes #426)

| Field | Value |
| --- | --- |
| Merge commit | `036a988` |
| Merged at | 2026-06-07T02:56:13Z |
| Issue #426 | CLOSED (COMPLETED) at 2026-06-07T02:56:14Z — auto-closed via `Fixes` trailer |
| Strategy | Squash |
| Mergeability | CLEAN, all required CI green (Build Client, Client Tests, E2E Tests, Server Tests, lint-pr-title, pr-review, enable-orchestrator) |
| Review | pr-review bot 🟢 Good taste; 0 unresolved threads |
| Labels | `priority:medium`, `client`, `scope:client-only` |

**AC Gate verdict: PASS** — walked issue #426's 8 acceptance criteria against the final +69-line CSS diff in `client/src/App.css`:

| # | AC | Evidence |
| --- | --- | --- |
| 1 | Two distinct radio rows | `.stt-engine-row { flex-direction: column; gap: 0.4rem }` |
| 2 | Horizontal spacing radio + label | `.stt-engine-option { display: flex; align-items: center; gap: 0.5rem }` |
| 3 | `.inline-hint` muted (`#666`), inline | `color: #666; margin-top: 0; font-style: italic` cancels `.setting-hint` top-margin |
| 4 | Vertical rhythm matches sibling `.setting-row` panels | `.stt-engine-setting { border-top: 1px solid #333; padding-top: 1rem }` mirrors `.api-key-setting` |
| 5 | Deepgram panel unchanged (no regression) | Diff purely additive; `.deepgram-setting` and `.api-key-*` untouched |
| 6 | CSS-only, no new deps/tokens/JSX | Single-file diff, +69 lines, uses existing `#ddd`/`#fff`/`#666`/`#333` palette |
| 7 | Tests + `data-testid` hooks preserved | All CI green; 1150/1150 client tests pass; no JSX change |
| 8 | Manual smoke on `vr.chorecraft.net` | ⏳ Post-deploy visual check (standard for CSS fixes; auto-deploys on merge to main) |

No `## INSTRUCTION:` override block was present for PR #429 + #426; gate passed cleanly on merits. Production auto-deploys from `main` to `vr.chorecraft.net`, so AC #8 becomes visually verifiable shortly after this push lands.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 03:05 UTC - Implementation worker (#351)

✅ Opened PR #430 for issue #351 — bug(server): startup rehydration failures are silent until the user types — kiosks should learn at register time.

| Item | Value |
| --- | --- |
| Issue | [#351](https://github.com/jpshackelford/voice-relay/issues/351) (priority:low, scope:server-only) |
| PR | [#430](https://github.com/jpshackelford/voice-relay/pull/430) |
| Branch | `fix/351-register-time-degraded-broadcast` |
| Commit | `75ea5e9` — _fix(server): broadcast degraded snapshot at register time after failed rehydration_ |
| CI | ✅ Server Tests, ✅ Client Tests, ✅ Build Client, ✅ E2E Tests, ✅ lint-pr-title |
| AC Gate verdict | **PASS** — all 4 non-exempt ACs satisfied → trailer `Fixes #351` |
| Follow-ups filed | None |
| Status | Draft → Ready |

**Implementation note:** the original expansion comment (pre-#363) proposed a new `rehydrationFailure` field on `session.metadata` plus writes/clears at four call-sites. Since then, the `session_ai_state` table (issue #363) shipped with the same semantics: the rehydration failure path already persists `state='degraded'` there, and both `AISessionManager.openSession` paths overwrite it with `running` via `persistInitialState`. The only missing piece was the register-time read. PR #430 threads `sessionAIStateRepository` into `resyncAgentSessionStatus` and synthesizes a `degraded` `AgentSessionStatus` (legacy `session-ai-status` + unified `session-state`) when the driver reports `absent` but the durable row carries `degraded`.

**Tests:** 8 new unit tests in `resync-agent-status.test.ts` (T-3.1.11 block) + 2-case integration test in new `register-time-degraded.integration.test.ts` (real in-memory SQLite + `SessionAIStateRepository` exercising the full failed-boot → register flow). Coverage on `resync-agent-status.ts`: 100% stmts/funcs/lines, 96% branches. Full server suite: 1644/1644 passing.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-07 03:12 UTC - Merge worker (PR #428)

✅ **Merged: `feat(client): show person name (device name) on workspace page`**

| Item | Value |
| --- | --- |
| PR | [#428](https://github.com/jpshackelford/voice-relay/pull/428) |
| Issue | [#384](https://github.com/jpshackelford/voice-relay/issues/384) — closed via `Fixes #384` trailer |
| Merge commit | `fc99791b13f56815bc9e33f3f2a35bd57345d005` |
| Strategy | Squash |
| CI at merge | ✅ Server Tests, ✅ Client Tests, ✅ Build Client, ✅ E2E Tests, ✅ lint-pr-title, ✅ pr-review |
| Review threads | 6 / 6 resolved (all `🟡 Suggestion` items from `pr-review` bot, addressed in prior tick) |
| Migrations | None — additive endpoint field + client rendering only |
| Production impact | Auto-deploys to vr.chorecraft.net. Endpoint change is backwards-compatible in both directions (older clients ignore new `primaryUser`; older servers omit it and new client treats as `null`). |

**Closing-trailer AC gate — verdict: PASS**

Walked all 5 non-exempt AC items in #384 against the merged diff (`fc99791b…`):

| # | AC | Evidence in merged commit |
|---|----|---|
| 1 | `<preferredName> (<deviceName>)` when primary speaker resolved | `client/src/pages/WorkspaceHome.tsx` — `EditableDeviceName` renders `{personName} ({device.name})` when `device.primaryUser?.preferredName` is non-null. `server/src/workspaces/router.ts` — `resolvePrimaryUser` returns `{userId, preferredName}` from the `speakers` row. Server + client tests assert this. |
| 2 | Falls back to bare `<deviceName>` (3 sub-states: no `primary_user_id`, no speaker row, no `preferred_name`) | All three states verified — server returns `null` for the first, `{userId, preferredName: null}` for the latter two; client treats both as "no personName" → bare device name. Server: 3 fallback tests; client: 3 (incl. older-server omitted-field case). |
| 3 | Edit-on-click still works | `onClick={() => setIsEditing(true)}` preserved on the device-name span in both rendering branches. Client tests verify entry-to-edit-mode in resolved + bare cases. |
| 4 | Visual treatment | `client/src/App.css` — `.person-name { font-weight: 600; color: #fff; }` + `.device-name-text.is-secondary { color: #aaa; font-size: 0.9rem; }`. JSX parenthesizes device name. Test asserts `is-secondary` className. |
| 5 | Tests cover the three states | Server: `router.test.ts` 4 cases. Client: `EditableDeviceName.test.tsx` 6 cases. |

No `## INSTRUCTION:` override block was present for PR #428 + #384; gate passed cleanly on merits. Trailer `Fixes #384` retained → GitHub auto-closed #384 (verified: closed at 03:12:30 UTC).

**Follow-up issues:** None filed. The "STT engine alongside device name" cross-link from PR #402 is mentioned as a possible follow-up in the PR body but is a separate concern outside #384's ACs — not auto-filed; @jpshackelford can request if desired.

**Slot accounting after merge:** review slot freed (merge worker exits).

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._