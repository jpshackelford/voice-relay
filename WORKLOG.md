# Voice Relay Worklog

## Log

### 2026-05-28 16:34 UTC - Orchestrator

🔒 **Auto-disabled due to inactivity**

Two consecutive quiet ticks detected (`quiet_ticks = 1 → 2`) with no productive work to dispatch. Automation **`Voice Relay Workflow Orchestrator v2`** (`5f180989-ed9c-42b4-ac9f-5f30f0623316`) has been disabled via PATCH to `/api/automation/v1/...`.

**Why quiet:**

| Slot | Available | Reason idle |
|---|---|---|
| Expansion (4) | 4 | All 6 unexpanded issues carry `on-hold` |
| Implementation (1) | 1 | 0 issues have the `ready` label |
| Review (2) | 2 | 0 open PRs (PR #345 merged at 16:07Z, #341 closed) |

**Backlog (all on-hold, deliberately):**

| Issue | Labels | Reason held |
|---|---|---|
| [#210](https://github.com/jpshackelford/voice-relay/issues/210) | enhancement, on-hold | Deployment-failure categorization — awaiting decision |
| [#239](https://github.com/jpshackelford/voice-relay/issues/239) | bug, ci-failure, on-hold | Flaky AI integration tests — upstream OH API reliability |
| [#299](https://github.com/jpshackelford/voice-relay/issues/299) | enhancement, priority:medium, on-hold | S3 design freeze (Path B): `/workspace` restore on provisioning |
| [#300](https://github.com/jpshackelford/voice-relay/issues/300) | enhancement, priority:medium, on-hold | S3 design freeze (Path B): `/workspace` snapshot on idle |
| [#301](https://github.com/jpshackelford/voice-relay/issues/301) | enhancement, priority:low, on-hold, client | S3 design freeze: granular startup status UX |
| [#302](https://github.com/jpshackelford/voice-relay/issues/302) | enhancement, priority:low, on-hold | S3 design freeze: pause sandbox on idle |

The S3 cluster (#299–#302) is the active design freeze documented in `AGENTS.md` — blocked on @jpshackelford provisioning the S3 bucket, AWS credentials, and running the bucket-provisioning runbook end-to-end. The freeze lifts when `VR_WORKSPACE_BUCKET` + AWS creds are present on prod `.env` and `curl $VR_BASE_URL/api/internal/health/s3` returns 200.

**To re-enable** (after unblocking work — e.g. removing `on-hold` from one or more issues, or adding a new bug report):

```bash
curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
  -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Or toggle via the OpenHands UI: <https://app.all-hands.dev/automations> → `Voice Relay Workflow Orchestrator v2` → enable.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-05-28 23:38 UTC - Orchestrator

🚀 **Spawned: Expansion Worker** (manual `/orchestrate` tick)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `a6a9ba2` | expansion | Issue #346 — improvements to kiosk footer tickers | **NEW** |

**Current State:**
- Open PRs: **0** (PR #345 merged 16:07Z; queue is clear).
- New issue [`#346`](https://github.com/jpshackelford/voice-relay/issues/346) opened by @jpshackelford ~7h ago — no labels, follow-up polish on the kiosk footer tickers shipped in PR #343/#345.
- All other open issues remain `on-hold` (S3 design freeze #299–#302, deploy-categorization #210, CI-flake #239).

**Action Taken:**
🚀 Spawned expansion worker [`a6a9ba2`](https://app.all-hands.dev/conversations/a6a9ba2cbcdc48abbc1c83b24b8d06b3) for [#346](https://github.com/jpshackelford/voice-relay/issues/346). Start-task transitioned `WORKING → READY` on the first poll; `execution_status: running`, `sandbox_status: RUNNING` verified.

**Worker scope:** five bundled polish items — (1) oscilloscope-style transcription visualization inside a purple circle on the left, mirroring the sparkle's visual weight on the right; (2) fixed-width marquee on the right where words arrive from the right and old words scroll off to the left as the band fills; (3) agent-action strip on black (no colored background) with no overlap of the sparkle / thinking indicator; (4) collapse the agent-action observation into a green checkmark on the paired action and prefix the action with an emoji that mirrors the sidebar card map; (5) settings-toggle parity for "Show transcription" on the workspace page (currently mis-styled vs. the adjacent "Enable ElevenLabs TTS" toggle). The expansion worker will inventory the current implementation that landed in #343/#345, decide per-item file scope and component contracts, post a Technical Approach comment, and add `ready` + `priority:medium` + `client` once analysis is complete.

**Why no other workers spawned this tick:**
- Implementation slot idle: 0 issues have the `ready` label (#346 is in expansion as of this tick — implementation will be picked up on a later tick once expansion completes).
- Review slots idle: 0 open PRs.
- Other expansion slots idle: all 6 remaining open issues carry `on-hold` (active S3 design freeze and other holds documented in `AGENTS.md`).

**Automation status:** `Voice Relay Workflow Orchestrator v2` (`5f180989-ed9c-42b4-ac9f-5f30f0623316`) confirmed **enabled** at tick start — the 16:34Z auto-disable was already reverted upstream before this run, so no PATCH was needed.

**Quiet-tick counter:** reset `2 → 0` (productive tick — expansion worker dispatched).

_This worklog entry was written by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---
### 2026-05-28 23:44 UTC - Expansion Worker (`a6a9ba2`)

✅ **Expanded Issue [#346](https://github.com/jpshackelford/voice-relay/issues/346) — improvements to kiosk footer tickers**

- **Type:** Enhancement (UX polish — 5 bundled items)
- **Status:** Ready for implementation
- **Labels added:** `ready`, `priority:medium`, `client`
- **Approach (per-item):**
  - Item 1 — Mount a 3rem purple-circle wrapper at bottom-left of `.kiosk-display` containing the existing `<Oscilloscope />`; drive it via a new `useFauxAudioActivity` hook because `KioskMode` has no local mic stream (kiosk never calls `getUserMedia` — only `MobileMode` does).
  - Item 2 — Extract a `MarqueeTicker` component using measured-pixel-width and CSS `transform` translation for the right→left word arrival animation; replaces the current ellipsis-truncation in `.kiosk-ticker-transcription`.
  - Item 3 — CSS-only: drop the blue tint on `.kiosk-ticker-action` (falls back to base black) and add `padding-right: 4rem` so the sparkle has clean backdrop. Flagged left-vs-right phrasing in original issue as an open question.
  - Item 4 — Rewrite `actionTickerText` memo in `KioskMode.tsx` to skip observation-kind entries, prefix `getActionIcon(kind)` emoji, and append ✅ when the matching observation arrives (correlated via `observation.action_id === action.id` — canonical pairing key from `pairAgentEvents.ts`).
  - Item 5 — Reuse `.tts-toggle-setting` / `.tts-checkbox` classes on the kiosk-tickers row in `WorkspaceHome.tsx` (alternative: rename to `.settings-toggle*` — flagged as Open Question 4).
- **Scope:** estimated < 500 lines diff; suggested commit order in the comment goes 5 → 4 → 3 → 2 → 1 (small/isolated first).
- **Open questions raised for @jpshackelford** (in expansion comment):
  1. Item 3 left-vs-right phrasing (suspected typo — assumed action ticker stays on the right).
  2. Item 1 — faux waveform vs. plumbing real audio levels over WebSocket.
  3. Item 4 — should completed-action checkmark linger before being replaced?
  4. Item 5 — class reuse vs. rename to `.settings-toggle*`.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-05-28 23:51 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4f91505` | implementation | Issue #346 - kiosk footer tickers | **NEW** |

🚀 **Spawned: Implementation Worker**

- Issue: [#346 - improvements to kiosk footer tickers](https://github.com/jpshackelford/voice-relay/issues/346) (`ready`, `priority:medium`, `client`)
- Conversation: [`4f91505`](https://app.all-hands.dev/conversations/4f915053455b443c9d3ff8b4f1e56bb6) (execution_status=`running`, sandbox=`RUNNING`)

**Worker Transitions This Tick:**
- ✅ Expansion worker `a6a9ba2` (Issue #346) → `finished`. Issue now carries `ready` + `priority:medium` + `client` labels and has a technical-approach comment. Moved from `slots.expansion` to `completed`.

**Current State:**
- Open PRs: **none** (PR #345 merged 16:07Z; backlog now empty until #346 ships)
- Ready + prioritized issues: `#346` only (now picked up)
- Issues needing expansion: **none** — all other open issues (#210, #239, #299–#302) are `on-hold` per the active design freeze on workspace persistence
- Slots: expansion 0/4, impl **1/1**, review 0/2

**Housekeeping:**
- 📦 Truncated WORKLOG.md (636 → 97 lines pre-append). Archived 21 entries into `WORKLOG_ARCHIVE_2026-05-26.md` (+1) and `WORKLOG_ARCHIVE_2026-05-28.md` (+20), preserving the most-recent 6 h productive window (PR #345 review/merge timeline).
- Reset `quiet_ticks` → 0 (this tick is productive).

---
### 2026-05-29 00:07 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4f91505` | implementation | Issue #346 — kiosk footer tickers | running |
| `20ba68e` | expansion | Issue #347 — /ai/restart conv-id persistence | **NEW** |
| `8391b09` | expansion | Issue #348 — auto-connect / rehydrate fresh-create fallback | **NEW** |
| `0d87ed2` | expansion | Issue #349 — buildReplaySuffix into fresh-create path | **NEW** |
| `c9c9242` | expansion | Issue #350 — refresh 401 NoCredentialsError → rebind | **NEW** |

🚀 **Spawned: 4 Expansion Workers (parallel)** — @jpshackelford filed five related server-side issues (#347–#351) since the last tick. Picked up 4 of them this cycle (slot limit); #351 deferred to next tick.

1. **Expansion Worker** [`20ba68e`](https://app.all-hands.dev/conversations/20ba68e3b96944a88607c80a178a06b8) — [#347 — `/ai/restart` never persists the new aiConversationId](https://github.com/jpshackelford/voice-relay/issues/347) (bug, priority:high, scope:server-only)
2. **Expansion Worker** [`8391b09`](https://app.all-hands.dev/conversations/8391b09d395c4b07871a05ba8dfe5805) — [#348 — auto-connect / rehydrate fresh-create fallback](https://github.com/jpshackelford/voice-relay/issues/348) (bug, priority:high, scope:server-only)
3. **Expansion Worker** [`0d87ed2`](https://app.all-hands.dev/conversations/0d87ed24b6e34c40ab870ce26e157705) — [#349 — wire `buildReplaySuffix` into fresh-create path](https://github.com/jpshackelford/voice-relay/issues/349) (enhancement, priority:medium, scope:server-only)
4. **Expansion Worker** [`c9c9242`](https://app.all-hands.dev/conversations/c9c9242e816d4b8c98d42d1e556e366b) — [#350 — refresh 401 `NoCredentialsError` should trigger rebind, not degrade](https://github.com/jpshackelford/voice-relay/issues/350) (bug, priority:low, scope:server-only)

All four start tasks reached `READY`; all four conversations verified `execution_status=running`, `sandbox_status=RUNNING`.

**Cross-worker context (passed in every prompt):** issues #347–#351 are a coherent batch about session/conversation rehydration and auth handling in the server. Each worker is asked to surface overlapping root causes / shared fixes in its expansion comment so we can decide later whether to implement them as one PR or several.

**Current State:**
- Open PRs: **0** (PR #345 merged 16:07Z yesterday; backlog has caught up).
- Ready + prioritized issues: only `#346` (currently being implemented by `4f91505`).
- Issues being expanded this tick: `#347`, `#348`, `#349`, `#350`.
- Issues needing expansion next tick: `#351` (sibling of the above; will pick up when an expansion slot frees).
- Other open issues: `#210`, `#239`, `#299`–`#302` all carry `on-hold` per the active design freezes documented in `AGENTS.md` (S3 persistence freeze + deploy categorization + CI-flake).
- Slots: expansion **4/4**, impl **1/1**, review 0/2.

**Why no impl/review/merge dispatched:**
- Impl slot occupied by `4f91505` (Issue #346).
- 0 open PRs → review/merge slots idle by design.

**Quiet-tick counter:** reset `0 → 0` (productive tick — 4 expansion workers dispatched).

_This worklog entry was written by an AI agent (OpenHands /orchestrate) on behalf of @jpshackelford._

---

### 2026-05-29 00:08 UTC - Expansion Worker (#347)

✅ **Expanded Issue #347** — `bug(server): /ai/restart never persists the new aiConversationId`

- Type: Bug (confirmed)
- Status: Ready for implementation (`ready` label applied)
- Root cause: `server/src/sessions/ai-router.ts` POST `/:sessionId/ai/restart` never calls `sessionRepository.updateMetadata({ aiConversationId: status.conversationId })` after `AgentDriver.restartSession` succeeds; `auto-connect.ts:145-156` already does this. Verified against the current code on `main` (build `986adb7` per production logs).
- Proposed fix: extract a tiny shared `persistAiConversationId` helper used by both `auto-connect.ts` and the restart handler; persist before the final broadcast. Three unit tests added (success / null-conversationId / persist-throws). Low complexity, ~10 LOC of prod code.
- Related: #341 (rehydration gap, closed) is what made this latent bug visible; #348 (no fresh-create fallback on stale-id attach) is the companion gap and stays separate.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-05-29 00:15 UTC - Expansion Worker (#348)

✅ **Expanded Issue #348** — bug(server): auto-connect / rehydrate have no fresh-create fallback when attach-to-existing fails

- Issue: [#348](https://github.com/jpshackelford/voice-relay/issues/348)
- Type: Bug
- Status: Ready for implementation (`ready` label applied)
- Root cause confirmed against `main`: both `auto-connect.ts` (~L130-171) and `agent-rehydrate.ts` (`rehydrateSingleSession`) pass `existingConversationId` to `agentDriver.openSession` and rethrow on `UpstreamConversationEndedError` with no fresh-create fallback. Error is raised in three places inside `AISessionManager.attachExistingForSession` (`openhands.ts:1821 / 1827 / 1832-1835`).
- Proposed fix: new shared helper `attachOrCreateAgentSession` used by both call sites — on `UpstreamConversationEndedError`, stash dead id in `previousAiConversationId`, clear `aiConversationId`, retry once without `existingConversationId`, persist new id via the shared helper from #347.
- Sibling coordination noted in expansion comment: depends on #347 (shared persistence helper); pairs with #349 (replay suffix on fresh-create) for full UX recovery; orthogonal to #351 (boot-time broadcast).
- Risk flagged: `getConversation` transient REST errors are currently wrapped as `UpstreamConversationEndedError` (`openhands.ts:1821`), which could cause spurious fresh-creates on a 5xx blip. Recommended follow-up: tighten the error class to only fire on null/missing-handshake cases.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-05-29 00:08 UTC - Expansion Worker (#350)

✅ **Expanded Issue #350** — _bug(server): refresh 401 NoCredentialsError marks session degraded instead of attempting a rebind_

- Issue: [#350](https://github.com/jpshackelford/voice-relay/issues/350) → labeled `ready`
- Type: Bug (server-side reconnect path)
- Status: Ready for implementation
- Root cause confirmed against `main` (`8387ccc`): `reconnectWithRefresh` at `server/src/openhands.ts:2117` only routes `SandboxMissingError` to `rebindSession`; any other refresh failure — including the `OpenHandsApiError(401, "…NoCredentialsError…")` thrown out of `getConversation` via `OpenHandsClient.request()` — falls into the generic degrade branch. 401 is not in the `transient` set so it doesn't even retry.
- Proposed fix: introduce `UpstreamCredentialsLostError`, translate `status===401 && message.includes('NoCredentialsError')` into it inside `doRefreshSessionCredentials`, and extend the catch in `reconnectWithRefresh` to route it through `rebindSession` (same path as MISSING). Existing `RebindWindowTracker` (max 3/5min, #296) caps the blast radius — no new throttling needed.
- Tests: 3 new unit tests in `server/src/openhands.test.ts` (1 direct refresh, 2 reconnect-integration including the negative case for non-NoCredentials 401s).
- Complexity: Low (~30 LOC prod + tests). Risk: Low — strict status+message discriminator.
- Independent of siblings #347 / #348 / #349 / #351 (different code paths); can be implemented in parallel.

---

### 2026-05-29 00:10 UTC - Expansion Worker (#349)

✅ **Expanded Issue #349** — _feat(server): wire existing buildReplaySuffix into the fresh-create path so new conversations carry prior context_

- Issue: [#349](https://github.com/jpshackelford/voice-relay/issues/349) → labeled `ready`
- Type: Enhancement (server-side; small wiring change, not new infrastructure)
- Status: Ready for implementation
- Codebase verification (against `main` @ `8387ccc`):
  - `AISessionManager.buildRebindReplaySuffix` exists at `openhands.ts:2192` (private) — body is name-neutral, takes only a conversation id, returns `''` on any error after logging. Reusable as-is once promoted.
  - `OpenHandsClient.startConversation` at `openhands.ts:225` currently has **no** `systemMessageSuffix` arg (the original issue's parenthetical was correct — only `rebindConversation` at `:315` supports it today). One-line signature addition + payload field needed.
  - `getOrCreateForSession` at `openhands.ts:1658` calls `startConversation` at `:1719` with 3 args; this is the single wiring site.
  - Driver shim: `OpenSessionOpts` (`agent-driver/types.ts:72`) and `OpenHandsDriver.doBindSession` (`agent-driver/openhands.ts:604`) need a `previousConversationId?: string` pass-through alongside the existing `existingConversationId`.
  - `previousAiConversationId` does **not** exist in the code today — confirms #348 owns the write convention; #349 only reads it.
- Implementation plan: 5 steps (signature ext → helper rename + un-private → wire into `getOrCreateForSession` → driver shim plumbing → read sites). Read sites split between this PR (`restartSession`-only, which can land independently) and #348's PR (auto-connect / rehydrate, which write the prior id).
- Test plan: reuse the `setCondenseImplForTesting` + `getEventsPage` mock scaffold already proven by #332's rebind-suffix tests (`openhands.test.ts:2786+`).
- Complexity: **Low** (~25 LOC prod + ~80 LOC tests).
- Sibling coordination noted in expansion: depends on #348 for the auto-connect / rehydrate read sites and the `metadata.previousAiConversationId` write convention; independent of #347 (`/ai/restart` persistence — different file) and #350/#351 (different recovery paths).

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
