# Voice Relay Worklog

## Log

### 2026-05-29 17:03 UTC - Orchestrator (manual `/orchestrate`)

🔒 **Auto-disabled due to inactivity**

Two consecutive quiet ticks detected (`quiet_ticks` reached 2). No productive work was available either tick:

| Slot | Active | Limit | Why no spawn? |
|---|---|---|---|
| expansion | 0 | 4 | Only `needs-expansion` candidates are #210, #239 — both `on-hold` |
| implementation | 0 | 1 | The only `ready` issues are #351 and #363 — both `on-hold`; #299–#302 still under the workspace-persistence freeze (see AGENTS.md) |
| review/merge | 0 | 2 | No open PRs (PR #371 squash-merged at `10b647b` on the previous productive tick) |

**Open issues snapshot (all 8 carry `on-hold`):**
- #210, #239 — needs expansion (`on-hold`)
- #299, #300, #301, #302 — workspace-persistence freeze (Path B; see AGENTS.md "Active design freeze")
- #351, #363 — `ready` + `on-hold` (server scope; awaiting human decision)

**No human `## INSTRUCTION:`** entries found in WORKLOG.md.

Automation **disabled** to prevent unnecessary cron wake-ups. Bounded heartbeat noise: only `.workflow-state.json` was committed on the prior quiet tick (no WORKLOG entry), and this tick writes a single disable entry. This is the design contract from the post-2026-05-22 livelock fix (see jpshackelford/.openhands#22).

**To re-enable** (after the workspace-persistence S3 prereqs land, or after `on-hold` is removed from #351/#363):

- OpenHands UI: https://app.all-hands.dev/automations → "Voice Relay Workflow Orchestrator v2" → toggle enable
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```

The orchestrator will resume on the next cron trigger after re-enable.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-01 10:20 UTC - Orchestrator (manual `/orchestrate`)

🚀 **Spawned: Implementation Worker for Issue #373**

| | |
|---|---|
| Issue | [#373 — bug(server): `reportDroppedText` clobbers legitimate `starting`/`reconnecting` snapshot with `degraded`](https://github.com/jpshackelford/voice-relay/issues/373) |
| Labels | `bug`, `ready`, `priority:low`, `scope:server-only`, `server` |
| Conversation | [`bb4de8f`](https://app.all-hands.dev/conversations/bb4de8fcb90842e08e71903df03b5bbe) (execution_status=running, sandbox=RUNNING) |
| Plugin ref | `add-voice-relay-workflow-plugin` |

**Why this tick is productive:**

Since the previous orchestrator wake-up (2026-05-29 17:03Z, which auto-disabled the automation), two new issues have appeared and one is now eligible for implementation:

| Issue | Labels | Eligible? |
|---|---|---|
| #372 | `enhancement`, `priority:medium`, `needs-human`, `scope:full-stack`, `server` | ❌ skip — `needs-human` |
| #373 | `bug`, `ready`, `priority:low`, `scope:server-only`, `server` | ✅ **pick up** — `ready` + prioritized + no `on-hold` / `needs-human` / `blocked` |

Body of #373 is 6.7 KB and the `ready` label is already applied — no expansion worker needed. Implementation slot was idle (0/1), so this fills it cleanly.

**Active Workers:**

| Conv ID | Type | Working On | Status |
|---|---|---|---|
| [`bb4de8f`](https://app.all-hands.dev/conversations/bb4de8fcb90842e08e71903df03b5bbe) | implementation | Issue #373 — `reportDroppedText` snapshot clobber | **NEW** (execution_status=running) |

**Slot Utilization:**

| Slot Type | Active | Limit | Available |
|---|---|---|---|
| expansion | 0 | 4 | 4 (only `needs-expansion` candidates are #210, #239 — both `on-hold`) |
| implementation | 1 | 1 | 0 (#373 in flight; `ready`+`on-hold` items #351 and #363 remain parked) |
| review/merge | 0 | 2 | 2 (no open PRs yet) |

**Current State:**

- Open PRs: **0** (PR #371 squash-merged at `10b647b` on 2026-05-29)
- Open issues: **10**
  - `ready` + unblocked: ~~#373~~ (now in flight)
  - `needs-human`: #372
  - `on-hold`: #210, #239, #299, #300, #301, #302, #351, #363 (workspace-persistence freeze for #299–#302 per AGENTS.md; #351/#363 still awaiting human decision)
- `quiet_ticks`: 0 (productive tick — reset from 2)

**Re-enabling automation:** the orchestrator was auto-disabled on 2026-05-29 17:03Z because all open issues at that point carried `on-hold`. With #373 freshly filed as `ready` + unblocked, that disable condition no longer holds. Re-enabling automation ID `5f180989-ed9c-42b4-ac9f-5f30f0623316` so subsequent cron ticks can pick up the review / merge cycle for the new PR.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-01 10:26 UTC - Implementation worker (issue #373)

✅ Implemented #373 (`bug(server): reportDroppedText clobbers legitimate starting/reconnecting snapshot with degraded`) — Option 1 from the issue.

- Added `agentDriver` to `DroppedTextArgs` and made `reportDroppedText` async.
- Defer to `agentDriver.getSessionStatus(sessionId)`; only broadcast when `state === 'degraded'`, using the driver's authoritative status (preserves the "try restarting the session" affordance for genuine failures).
- For `absent` / `starting` / `reconnecting` / `ready` / `thinking` the handler now stays silent so the next legitimate transition broadcast wins — fixes the spurious "AI not attached" flash on the kiosk during warm-up / rebind windows.
- Warn log fires unconditionally (preserves the #341 § D silent-drop observability hook).
- `getSessionStatus` rejection path: log + skip broadcast.
- Updated the WS `case 'text'` call site in `server/src/index.ts` to fire-and-forget with `.catch`.
- Tests: `server/src/dropped-text-handler.test.ts` now 11 tests including `test.each` over all five non-degraded states. Full server suite green (1287 tests).
- Scope: server-only, no schema/migration changes.

PR: https://github.com/jpshackelford/voice-relay/pull/374 (ready for review, CI green: Server / Client / Build / E2E / lint-pr-title all pass).

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---
### 2026-06-01 10:36 UTC - Merge worker (PR #374)

✅ **PR #374 squash-merged → main** (commit `50d3fb5`). Issue #373 auto-closed as completed via `Fixes #373` in the PR body.

**Merge criteria verified before merge:**

| Gate | Result |
|---|---|
| CI checks | 🟢 All green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, pr-review) |
| pr-review verdict | 🟢 **LOW risk, ✅ Worth merging** — no actionable feedback, no review threads to resolve |
| Unresolved threads | 0 |
| mergeable / mergeStateStatus | `MERGEABLE` / `CLEAN` |
| Labels (blocking) | none (`on-hold`/`needs-human` not set) |
| Migration check | ✅ No `server/migrations/*` and no `knex`/`drizzle`/schema files in the diff |
| Diff scope | Only `server/src/dropped-text-handler.ts` (+75 lines: defer to driver), `server/src/dropped-text-handler.test.ts` (+212 lines: per-state broadcast cases + rejection path), and `server/src/index.ts` (+7 lines: fire-and-forget WS call site). `scope:server-only` confirmed |

**Squash commit:** `fix(server): don't clobber starting/reconnecting snapshot from reportDroppedText (#373) (#374)` — Option 1 from #373 implemented: `reportDroppedText` defers to `agentDriver.getSessionStatus(sessionId)` and broadcasts only when `state === 'degraded'`, using the driver's authoritative status object. Warn log preserved as the silent-drop observability hook (symmetric to #341 § D). WS `case 'text'` call site now fire-and-forget with `.catch`. No DB schema changes; production SQLite untouched.

**Production impact:** auto-deploys to vr.chorecraft.net on merge. Eliminates the spurious "AI not attached — try restarting the session" flash on the kiosk during legitimate `starting` / `reconnecting` / `absent` warm-up windows; the genuine-`degraded` restart affordance remains intact. Server-only behaviour change — no migration risk.

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---
### 2026-06-01 10:38 UTC - Orchestrator (manual `/orchestrate`)

🚀 **Spawned: Merge Worker for PR #374** → ✅ **completed in-band** (PR merged at `50d3fb5`).

Picked up the cycle where the prior tick left off: implementation worker `bb4de8f` had just produced PR #374, CI was green, the `pr-review` bot returned 🟢 LOW risk / ✅ "Worth merging", `mergeStateStatus=CLEAN`, no unresolved threads, no blocking labels. Spawned merge worker [`3fb018d`](https://app.all-hands.dev/conversations/3fb018dfa43f4d2cbdd5f5f6345eca77) for PR #374 at 10:36 UTC; it executed the merge before this orchestrator tick finished writing — see the dedicated `Merge worker (PR #374)` entry above for the squash-message, gate-by-gate verification, and production-impact summary.

**Worker disposition (this tick):**

| Worker | Slot | Final status | Outcome |
|---|---|---|---|
| `bb4de8f` | implementation | finished `2026-06-01T10:27:12Z` | PR #374 opened |
| `3fb018d` | review (merge) | finished by `2026-06-01 10:38Z` | PR #374 squash-merged → main (`50d3fb5`); issue #373 auto-closed |

Both moved from `slots.*` → `completed[]` in `.workflow-state.json`. All seven slots are now empty.

**State after this tick:**

| Slot Type | Active | Limit | Available |
|---|---|---|---|
| expansion | 0 | 4 | 4 |
| implementation | 0 | 1 | 1 |
| review/merge | 0 | 2 | 2 |

**Open work:**

- Open PRs: **0** (PR #374 just merged)
- Open issues: **9** (#373 closed)
  - `ready` + unblocked: none
  - `needs-human`: #372
  - `on-hold`: #210, #239, #299, #300, #301, #302, #351, #363 (workspace-persistence freeze for #299–#302 per AGENTS.md still in effect; #351/#363 awaiting human decision)
- **No expansion candidates** — the only unexpanded issues (#210, #239) carry `on-hold`.
- **No implementation candidates** — no `ready` issue is currently unblocked.

Next cron tick will therefore observe a fully-quiet backlog and bump `quiet_ticks` from 0 → 1; if the situation persists, the tick after that will trigger the auto-disable per the orchestrate skill's two-quiet-tick rule. This is the intended steady-state behavior given the current label set.

**`quiet_ticks`:** 0 (productive — merge dispatched).

**No human `## INSTRUCTION:`** entries found in WORKLOG.md.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-01 11:03 UTC - Orchestrator (manual `/orchestrate`)

🔒 **Auto-disabled due to inactivity**

Second consecutive quiet tick — `quiet_ticks` reached **2** — per the orchestrate skill's two-quiet-tick rule, automation ID `5f180989-ed9c-42b4-ac9f-5f30f0623316` has been disabled (`enabled: false` confirmed via `PATCH /api/automation/v1/...`).

**Why this tick is quiet (matches the forecast in the 2026-06-01 10:38 UTC entry):**

| Slot | Active | Limit | Why no spawn? |
|---|---|---|---|
| expansion | 0 | 4 | Only `needs-expansion` candidates are #210, #239 — both `on-hold` |
| implementation | 0 | 1 | No `ready` issue is currently unblocked: #351 and #363 are `ready` + `on-hold`; #299–#302 remain under the workspace-persistence freeze (see AGENTS.md "Active design freeze") |
| review/merge | 0 | 2 | No open PRs (PR #374 squash-merged at `50d3fb5` on the productive 10:36 UTC tick) |

**Open issues snapshot (9 total — all blocked):**

| # | Labels | Blocker |
|---|---|---|
| #210 | `enhancement`, `on-hold` | on-hold |
| #239 | `bug`, `ci-failure`, `on-hold` | on-hold |
| #299 | `enhancement`, `priority:medium`, `on-hold` | workspace-persistence freeze |
| #300 | `enhancement`, `priority:medium`, `on-hold` | workspace-persistence freeze |
| #301 | `enhancement`, `priority:low`, `on-hold`, `client` | workspace-persistence freeze |
| #302 | `enhancement`, `priority:low`, `on-hold` | workspace-persistence freeze |
| #351 | `bug`, `ready`, `priority:low`, `on-hold`, `scope:server-only` | on-hold (awaiting human decision) |
| #363 | `enhancement`, `ready`, `priority:medium`, `on-hold`, `scope:server-only`, `server` | on-hold (awaiting human decision) |
| #372 | `enhancement`, `priority:medium`, `needs-human`, `scope:full-stack`, `server` | needs-human |

**No human `## INSTRUCTION:`** entries found in WORKLOG.md.

**Tick history since the last productive cycle:**

| Tick | Result | `quiet_ticks` |
|---|---|---|
| 2026-06-01 10:18 UTC | 🚀 Productive — spawned impl worker for #373 | 0 |
| 2026-06-01 10:36 UTC | 🚀 Productive — spawned merge worker for PR #374 (merged at `50d3fb5`) | 0 |
| 2026-06-01 ~10:47 UTC | 🤫 Quiet — state-only commit, no WORKLOG entry | 1 |
| 2026-06-01 11:03 UTC | 🤫 Quiet → **auto-disable fires** | 2 |

**To re-enable** (after `on-hold` is removed from #351/#363, the workspace-persistence S3 prereqs land for #299–#302, or `needs-human` is cleared from #372):

- OpenHands UI: https://app.all-hands.dev/automations → "Voice Relay Workflow Orchestrator v2" → toggle enable
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```

The orchestrator will resume on the next `*/15` cron trigger after re-enable.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

### 2026-06-01 11:18 UTC - Orchestrator (manual /orchestrate)

🚀 **Spawned: Implementation Worker**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `50c1195` | implementation | Issue #375 - forward device identity & UTC timestamp to OH | **NEW** |

**Spawned:**
- Issue: [#375 — feat: forward device identity and UTC timestamp to OpenHands with token-efficient header](https://github.com/jpshackelford/voice-relay/issues/375) (priority:medium, scope:full-stack)
- Conversation: [`50c1195`](https://app.all-hands.dev/conversations/50c1195fa8b645af8a4f8f32754ef10c)

**Current State:**
- Open PRs: **0** (last merged: PR #374 → main at `50d3fb5` for #373)
- Ready, prioritized, not on-hold: **#375** only → picked up
- Issues with `on-hold` (S3 freeze + other): #210, #239, #299, #300, #301, #302, #351, #363 — skipped per AGENTS.md
- Issues with `needs-human`: #372 — skipped
- Available slots: expansion 4/4, impl 0/1, review 2/2

**Action Taken:**
✅ Reset quiet_ticks → 0 (productive tick)
✅ Implementation worker spawned for #375
ℹ️ v2 automation (`5f180989-…`) is already `enabled: true`; previous auto-disable was tied to the stale v1 ID and didn't actually disable v2. No automation toggle needed.

_This entry was created by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-06-01 11:39 UTC - Implementation Worker (`50c1195`)

✅ **Closed: Issue #375**

- Issue: [#375 — feat: forward device identity and UTC timestamp to OpenHands with token-efficient header](https://github.com/jpshackelford/voice-relay/issues/375)
- PR: [#376 — feat: forward device identity and UTC timestamp to OpenHands](https://github.com/jpshackelford/voice-relay/pull/376) (ready, all CI green)
- Scope: full-stack — client + server + system prompt + tests

**What landed:**

- New `agent-driver/voice-relay-header.ts`: pure builder for the
  `[vr A=Name tz=IANA]` / `[t=...]` per-turn header, with spreadsheet-style
  alias allocation, 2m30s quiet-period re-anchoring, and a sanitizer
  that strips `]`, newlines, and control chars from device names so a
  malicious display name can't break out of the bracket grammar.
- `AgentDriver.sendMessage` gains an optional `sender?: AgentSenderMeta`.
  OpenHands driver composes + prepends the header in
  `AISession.sendSessionMessage`; FakeDriver ignores the arg
  (non-behavior-changing).
- WS `register` handler validates IANA timezone (ICU-backed) and
  threads it onto the `Device`. WS `text` handler validates ISO-Zulu
  `clientTimestamp` (substitutes server-receipt time if missing) and
  forwards `AgentSenderMeta` to `relayAgentResponse`.
- Client captures `Intl.DateTimeFormat().resolvedOptions().timeZone` +
  UTC offset on register and stamps each `sendText` with an ISO-Zulu
  `clientTimestamp`. `RelayedTextMessage` also carries
  `senderTimezone` so peer messages on the kiosk can later be rendered
  in the sender's local time.
- `server/prompts/system-prompt.md` § "Message format" teaches the agent
  to parse the header without echoing or addressing it.

**Tests added:** 19 + 33 + 2 + 2 + 2 = 58 new test cases.
Full suite: **server 1343 / client 1019 / E2E pass**, build green,
typecheck clean. No schema changes — fully backward-compatible.

**Follow-ups (not in this PR):**

- Kiosk UI can render `senderTimezone` for peer messages.
- Telemetry on header sizes / quiet-period misses if we want to
  validate the 2m30s constant in production.

---

### 2026-06-01 11:52 UTC - Merge Worker (PR #376)

✅ **Squash-merged PR #376** — `feat: forward device identity and UTC timestamp to OpenHands with token-efficient header` (fixes #375).

| Check | Result |
|---|---|
| mergeable / mergeStateStatus | MERGEABLE / CLEAN |
| Server Tests | ✅ |
| Client Tests | ✅ |
| Build Client | ✅ |
| E2E Tests | ✅ |
| lint-pr-title | ✅ |
| pr-review | ✅ (🟢 Good taste, MEDIUM risk well-managed) |
| Unresolved threads | 0 |
| DB migrations | None — no schema changes, fully backward-compatible on the wire |
| Issue #375 | auto-closed via "Fixes #375" |

Merge commit: `4fac7b3` on `main`. Auto-deploy to vr.chorecraft.net will pick this up; no manual post-deploy steps required (clientTimestamp / timezone / tzOffsetMinutes are all optional fields, server falls back to receipt time when absent).

---
