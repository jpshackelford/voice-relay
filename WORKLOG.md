# Voice Relay Worklog

## Log

### 2026-06-01 12:19 UTC - Orchestrator

🔒 **Auto-disabled due to inactivity**

Second consecutive quiet tick — no actionable work available. All 9 open issues carry either `on-hold` (#363, #351, #302, #301, #300, #299, #239, #210) or `needs-human` (#372). No open PRs. No active workers in `.workflow-state.json`. Per the orchestrate skill's quiet-tick policy, `quiet_ticks` advanced 1 → 2, which triggers auto-disable.

| Signal | Value |
|---|---|
| Open PRs | 0 |
| Open issues | 9 (all `on-hold` or `needs-human`) |
| Ready + unblocked | 0 |
| Active workers | 0 (expansion / impl / review all empty) |
| `quiet_ticks` | 2 → triggered auto-disable |
| Automation | `5f180989-ed9c-42b4-ac9f-5f30f0623316` → `enabled: false` (confirmed via API) |

Blocking context (see `AGENTS.md`):

- **#298–#302** remain on hold pending S3 bucket provisioning by @jpshackelford (`VR_WORKSPACE_BUCKET` + AWS creds in production `.env`, plus end-to-end run of the S3 provisioning runbook).
- **#363, #351** are explicitly `on-hold` from earlier orchestrator decisions.
- **#372** carries `needs-human` and must be reviewed by a person before pickup.
- **#239, #210** are `on-hold` (flaky test infra / deployment-failure taxonomy work, both deferred).

**To re-enable** once any of the above is unblocked (label removed, or `ready` added to a new issue):

```bash
curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
  -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Or toggle via the OpenHands UI: https://app.all-hands.dev/automations → "Voice Relay Workflow Orchestrator v2" → enable.

---
### 2026-06-04 17:00 UTC - Orchestrator (manual `/orchestrate`)

🚀 **Spawned: Expansion Worker** — Issue #377 picked up; automation re-enabled.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---|---|---|---|
| [`4bc9c35`](https://app.all-hands.dev/conversations/4bc9c35382ea4de69fe62feab59e1021) | expansion | [#377 — Mobile Settings: Back link hidden behind iOS status bar on iPhone SE](https://github.com/jpshackelford/voice-relay/issues/377) | **NEW** (running) |

**Current State:**

- Open PRs: **0**
- Open issues: **10** — new arrival #377 (unlabeled, needs expansion); the other 9 are all `on-hold` or `needs-human` (#210, #239, #299, #300, #301, #302, #351, #363, #372).
- Ready + unblocked: 1 (after #377 expansion lands)
- Active workers: 1 expansion / 0 impl / 0 review
- `quiet_ticks`: 2 → 0 (productive tick)
- Automation `5f180989-…`: `enabled: false` → `enabled: true` (re-enabled via PATCH; productive work is back).

**Why this tick is productive:**

Issue #377 was filed by @jpshackelford at 16:56Z — three days after the auto-disable from 2026-06-01 12:19Z. It's a well-scoped iPhone SE safe-area bug in `client/src/App.css` (`.mobile-settings-modal` missing `padding-top: env(safe-area-inset-top)` and `max-height` / scrollable content). The reporter already provided suggested CSS. The expansion worker will verify the analysis against the current file, audit sibling modal rules, lock down a Testing plan, set priority/scope labels, and label `ready` so the next cron tick can spawn an implementation worker.

The other 9 issues remain blocked per the AGENTS.md design-freeze and prior orchestrator decisions; none were re-touched this tick.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._


---

### 2026-06-04 17:15 UTC - Expansion Worker (`4bc9c35`)

✅ **Expanded Issue #377** — Mobile Settings: Back link hidden behind iOS status bar on iPhone SE

| Field | Value |
|---|---|
| Issue | [#377](https://github.com/jpshackelford/voice-relay/issues/377) |
| Type | Bug (mobile UI / iOS safe-area) |
| Status | `ready` |
| Labels applied | `bug`, `ready`, `priority:low`, `scope:client-only` |
| Files in scope | `client/src/App.css` (lines 5216, 5231, 5272) |

**Verification against current source (`main` @ `3972b52`):**

- Confirmed `.mobile-settings-modal` at `client/src/App.css:5231` has `padding-bottom: max(1.5rem, env(safe-area-inset-bottom))` but **no `padding-top`** for safe-area-inset-top, **no `max-height`**, and **no flex column layout**.
- Confirmed `.mobile-settings-content` at `client/src/App.css:5272` has **no `overflow-y`**.
- Sibling `.release-notes-modal` (L5504) already implements the correct pattern (`max-height: 80vh` + flex column + `.release-notes-content { flex: 1; overflow-y: auto }`) and is the reference fix.

**Audit of related modals:** `.qr-modal` and `.delete-workspace-modal` are centered with `max-width: 90vw` and don't span the viewport — out of scope. No JS state changes or focus-trap concerns; modal is dismissed by overlay click in `MobileSettings.tsx`.

**Fix:** Pure CSS, ~10 lines diff across the three rules. Includes `100vh` fallback before `100dvh` for iOS Safari < 15.4 stragglers, and `overscroll-behavior: contain` on both overlay and content to suppress page rubber-band. Detailed before/after diff posted as a follow-up comment on #377.

**Testing plan:** Vitest `MobileSettings.test.tsx` unchanged; manual repro in Chrome DevTools iPhone SE preset + Safari Responsive Design Mode; suggested Playwright assertion at 375×667 viewport added to the comment. Noted that `env(safe-area-inset-top)` evaluates to `0` in Chromium emulation, so the safe-area half of the fix must be confirmed in Safari RDM or on a real iPhone SE before close.

Next tick should find #377 `ready` + unblocked and can dispatch an implementation worker.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:08 UTC - Orchestrator (manual `/orchestrate`)

🚀 **Spawned 3 workers (2 expansion + 1 implementation) — 4-worker fan-out this tick.**

**Active Workers:**

| Conv ID | Type | Working On | Status |
|---|---|---|---|
| [`4bc9c35`](https://app.all-hands.dev/conversations/4bc9c35382ea4de69fe62feab59e1021) | expansion | [#377 — Mobile Settings safe-area iPhone SE](https://github.com/jpshackelford/voice-relay/issues/377) | finished ✓ (→ completed array) |
| [`afbccd4`](https://app.all-hands.dev/conversations/afbccd4e12c7443eb47635409c07560a) | expansion | [#378 — Expose session settings over REST](https://github.com/jpshackelford/voice-relay/issues/378) | **NEW** (running) |
| [`ca530a6`](https://app.all-hands.dev/conversations/ca530a6cc61a4b078550166db1afca7b) | expansion | [#379 — CSS Grid layout for kiosk overlays](https://github.com/jpshackelford/voice-relay/issues/379) | **NEW** (running) |
| [`401f9d3`](https://app.all-hands.dev/conversations/401f9d387e514a6a841d8a1081d7a602) | implementation | [#377 — Mobile Settings safe-area iPhone SE](https://github.com/jpshackelford/voice-relay/issues/377) | **NEW** (running) |

**Tick walkthrough:**

1. **Housekeeping:** WORKLOG.md was 383 lines (>300 threshold) → archived 8 older entries across `WORKLOG_ARCHIVE_2026-05-29.md` and a new `WORKLOG_ARCHIVE_2026-06-01.md`; kept the 2 most recent productive entries (commit `21e1762`).
2. **#377 expansion completed mid-tick.** `4bc9c35` had been spawned at 17:00Z by the prior orchestrator run. By the time this tick polled, it had already pushed `b9b1b89` (`docs(worklog): expansion worker — #377`) and applied `ready` + `priority:low` + `scope:client-only`. Moved to `.workflow-state.json` `completed[]`.
3. **Two new GitHub issues arrived** — #378 (REST surface for session settings + per-session agent prompt, authored 16:59Z) and #379 (CSS Grid migration for kiosk overlays, authored 17:02Z), both from @jpshackelford, both unlabeled. Spawned an expansion worker per issue (slot usage 1/4 → 3/4 → settled at 2/4 after #377 cleared).
4. **Implementation slot was free** and #377 became the only `ready` + unblocked + prioritized issue. Dispatched `401f9d3` as the implementation worker with the exact CSS diff plan from the expansion comment (mirror `.release-notes-modal`'s flex-column + scroll pattern, plus `padding-top: max(1rem, env(safe-area-inset-top))` + `overscroll-behavior: contain`).

**Current state:**

| Signal | Value |
|---|---|
| Open PRs | 0 (PR for #377 should land within this tick window) |
| Open issues | 12 total — 9 blocked (`on-hold`/`needs-human`: #210, #239, #299, #300, #301, #302, #351, #363, #372), 1 ready-in-flight (#377), 2 expanding (#378, #379) |
| Active workers | 2 expansion / 1 impl / 0 review (3/7 slot capacity used) |
| `quiet_ticks` | 0 (productive) |
| Automation `5f180989-…` | `enabled: true` |

**Next tick should see:**

- `401f9d3` either open a draft PR for #377 or be still in CI; if PR exists with reviews → spawn review worker.
- `afbccd4` / `ca530a6` likely still running (REST API design and CSS-grid audit both have nontrivial codebase exploration). If they finish, expect new `ready` labels on #378 / #379 and a free slot for the next impl cycle.
- No new dispatches expected unless additional issues land or PR #377 needs a review round.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-04 17:09 UTC - Expansion Worker (`ca530a6`)

✅ **Expanded Issue [#379 — CSS Grid layout for kiosk overlays](https://github.com/jpshackelford/voice-relay/issues/379)**

- Type: Enhancement (client-only CSS refactor)
- Status: Ready for implementation
- Approach: Replace `.kiosk-display` flex+5×`position: absolute` overlay pattern with `display: grid` + named areas (`tl`/`tr`/`bl`/`br`/`main`/`tick-l`/`tick-r`). 4rem gutter columns become the single source of truth for circle placement, retiring the `padding-{left,right}: 4rem` magic on both ticker strips. The `[data-tickers-enabled="true"] .connection-indicator` attribute toggle in `App.css:3809` is replaced by a grid-area assignment.
- Files: primary edit in `client/src/App.css` (L1409, 1647, 1671, 1693, 3799–3815, 3842–3866, 3884); JSX in `client/src/components/KioskMode.tsx` likely needs no change (grid areas decouple visual from DOM order). Existing Playwright + unit tests are class-locator based and should pass unchanged — confirmed no `toHaveScreenshot` calls in `tests/`.
- Labels applied: `scope:client-only`, `client`, `enhancement`, `priority:low`, `ready`. Clarified in the issue body that this does **not** subsume #377 (independent `MobileSettings.tsx` bug).

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:12 UTC - Expansion Worker (`afbccd4`)

✅ **Expanded Issue [#378 — Expose session settings (TTS, input mode, etc.) over REST + add per-session agent prompt](https://github.com/jpshackelford/voice-relay/issues/378)**

- Type: Enhancement (server-only)
- Status: Ready for implementation
- Approach: New `/api/sessions/:sessionId/settings` (`GET`/`PATCH`) mounted alongside existing `ai-router.ts`. Reuses `DISPLAY_API_SECRET` Bearer auth (per-session) plus JWT workspace-member fallback. All writes funnel through one new `settings-service.applyPatch` so REST and the existing `'session-tts-settings'` WS handler share the same persist+broadcast code path. Adds back-compat `session-tts-settings-changed` plus new `session-settings-changed` snapshot message. Lifts `inputMode`/`autoSubmit` out of client-only React state into `sessions.metadata` (no migration — JSON column). Adds per-session `agentPrompt` (override) + new `workspace_settings.default_agent_prompt` column via migration `016` (workspace default). `openhands.ts` gets a `resolveSessionSystemPrompt` helper that layers session > workspace > built-in `system-prompt.md` and is wired into both `lazyBindSession` and `restartSession`.
- Scope note: Resolved the issue's reference to a non-existent "workspace API key" — session-scoped operations use `DISPLAY_API_SECRET`; workspace-default agent prompt uses existing JWT workspace-owner auth. Default-prompt rewrite to teach the agent how to call `PATCH /settings` is out of scope (follow-up issue).
- Independence check: No dependency on the S3 / Path B persistence freeze (#298–#302) — everything fits in existing SQLite (one JSON column + one new TEXT column).
- Files (planned, see issue comment): `server/src/sessions/settings-router.ts`, `settings-service.ts` (both new) + tests; `sessions/types.ts`, `index.ts`, `openhands.ts`, `types.ts` edits; `storage/migrations/016_default_agent_prompt.ts`; `workspaces/{types,workspace-repository,router}.ts` edits; `tests/e2e/session-settings-api.spec.ts`; `README.md` curl examples.
- Labels applied: `enhancement`, `server`, `scope:server-only`, `priority:medium`, `ready`.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:13 UTC - Implementation Worker (#377 mobile settings safe-area)

✅ Implemented #377 — Mobile Settings: Back link hidden behind iOS status bar on iPhone SE.

- Branch: `fix/377-mobile-settings-safe-area`
- PR: [#381](https://github.com/jpshackelford/voice-relay/pull/381) — ready for review.
- Scope: CSS-only (`client/src/App.css`), 11 lines added across three rule blocks.
- Pattern: mirrored `.release-notes-modal` (L5504) — added `padding-top: env(safe-area-inset-top)`, `max-height: 100vh`/`100dvh`, flex column on `.mobile-settings-modal`; added `flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; min-height: 0;` on `.mobile-settings-content`; added `overscroll-behavior: contain` on the overlay.
- CI: all checks green (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title).
- Tests: existing `MobileSettings.test.tsx` (32 tests) unchanged & passing — they assert DOM shape, not computed styles. Playwright safe-area assertion skipped: Chromium emulation reports `env(safe-area-inset-top)` as `0`, and the smoke suite lacks an authenticated mobile flow fixture — noted in the PR description.
- Sibling modals (`.qr-modal`, `.delete-workspace-modal`) confirmed out-of-scope: centered, `max-width: 90vw`, small content, no full-viewport span.

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:21 UTC - Merge Worker (#381 mobile settings safe-area)

✅ Merged PR [#381](https://github.com/jpshackelford/voice-relay/pull/381) — `fix(client): respect iOS safe-area-inset-top in mobile settings modal`.

- Squash-merge commit: `c95f4f9` on `main`.
- Issue [#377](https://github.com/jpshackelford/voice-relay/issues/377) auto-closed via `Fixes #377` (state: COMPLETED, 17:21 UTC).
- Scope: CSS-only (`client/src/App.css`, +11 lines across 3 adjacent rule blocks). No DB migration; production SQLite unchanged.
- Pre-merge gate confirmed: all CI green (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, pr-review); bot review 🟢 Good taste (LOW risk); 0 unresolved threads; 0 PR comments; MERGEABLE; not draft.
- Auto-deploy to vr.chorecraft.net triggered by merge to main.

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:23 UTC - Expansion Worker (issue #380)

✅ **Expanded Issue #380** — Left kiosk indicator (oscilloscope) should be blue, not purple

- Issue: [#380](https://github.com/jpshackelford/voice-relay/issues/380)
- Type: Bug (cosmetic)
- Status: Ready for implementation
- Root cause: Both kiosk indicators share `#a855f7` (AI purple). Left indicator's container styling lives in `client/src/App.css` (`.kiosk-oscilloscope-indicator` background + border, lines 1693–1708) and the canvas stroke/glow is driven by the `color="#a855f7"` prop passed to `<Oscilloscope>` in `client/src/components/KioskMode.tsx` line 987.
- Proposed fix: Two-file, three-line change. Swap container background to `rgba(50, 130, 184, 0.2)` and border + canvas `color` prop to `#3282b8` (the existing user-message accent used by `.message` border-left / sender color). `.kiosk-ai-status` stays purple.
- Labels applied: `bug`, `client`, `scope:client-only`, `ready`, `priority:low`
- No blockers; can land independently of #379 (broader kiosk grid cleanup) per the original issue note.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:30 UTC - Expansion Worker (#382 ticker speaker label)

✅ **Expanded Issue [#382](https://github.com/jpshackelford/voice-relay/issues/382)** — Transcription ticker should identify the sending device / speaker.

- Type: Enhancement (kiosk UX).
- Status: **Ready for implementation.**
- Labels applied: `enhancement`, `scope:client-only`, `priority:medium`, `ready`.
- Scope verdict: **client-only**. `Utterance.senderName` is already on the wire (`client/src/types.ts:475`) and the ticker filter at `KioskMode.tsx:455` already excludes AI + own-device messages, so the data plumbing for human-speaker labeling exists.
- Dependency on PR [#376](https://github.com/jpshackelford/voice-relay/pull/376) (`4fac7b3`, `[vr A=Name tz=…]` header to OpenHands): **none**. PR #376 is server→agent only (`server/src/agent-driver/*`, `server/src/openhands.ts`); it does not modify the `RelayedTextMessage` shape that the kiosk consumes. `senderName` has been on relayed utterances since #346.
- Proposed approach:
  - `MarqueeTicker` grows an optional `prefix?: string` prop, rendered as a sibling `<span class="kiosk-ticker-speaker">` **inside** the existing measured/translated inner span — preserves `scrollWidth - clientWidth` marquee math.
  - `KioskMode.tsx` derives `{ prefix, text }` from `mostRecentForeignUtterance`, debouncing the prefix on consecutive same-`senderId` partials so the strip doesn't restart on every frame.
  - `.kiosk-ticker-speaker` gets a heavier weight + muted color for at-a-glance "who vs. what" separation.
  - `fauxPulse` effect dependency updated to track `transcriptionTicker.text` so same-sender partials still bump the oscilloscope.
- Files affected (≤5, all client): `client/src/components/MarqueeTicker.tsx`, `client/src/components/KioskMode.tsx`, `client/src/App.css`, `client/src/components/KioskMode.test.tsx`, plus optional `MarqueeTicker.test.tsx`.
- Complexity: Low. No protocol/DB/server change. Already gated by `kioskFooterTickersEnabled`.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:36 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `329d0f1` | implementation | Issue #378 — Expose session settings over REST + per-session agent prompt | **NEW** |

**Spawned: Implementation Worker**
- Issue: [#378 — Expose session settings (TTS, input mode, etc.) over REST + add per-session agent prompt](https://github.com/jpshackelford/voice-relay/issues/378) (priority:medium, scope:server-only)
- Conversation: [`329d0f1`](https://app.all-hands.dev/conversations/329d0f16b4924e4291e5598853a3b4b8)

**Reconciled state:**
- `afbccd4` (expansion #378) → completed (added ready label + technical-approach comment)
- `ca530a6` (expansion #379) → completed (added ready label, CSS Grid kiosk overlays)
- `401f9d3` (implementation #377) → completed (PR #381 squash-merged at `c95f4f9`; #377 auto-closed)

**Current State:**
- Open PRs: 0
- Issues needing expansion: 0 (all open issues are either expanded or `on-hold`/`needs-human`)
- Ready issues: #378 (priority:medium, **now being implemented**), #382 (priority:medium, client-only), #379 (priority:low), #380 (priority:low)
- On-hold (S3 freeze + earlier): #210, #239, #299, #300, #301, #302, #351, #363
- Needs-human: #372

**Action Taken:**
🚀 Spawned implementation worker for #378 (highest priority ready, server-only, oldest of the medium-priority pair).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-04 17:51 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `329d0f1` | implementation | Issue #378 — Expose session settings over REST + per-session agent prompt | running |
| `21fe6fd` | expansion | Issue #383 — Speaker identity model | **NEW** |
| `d48597e` | expansion | Issue #384 — Workspace page: show person/device name | **NEW** |

**Spawned: 2 Expansion Workers (parallel)**

1. **Expansion Worker — Issue #383**
   - Issue: [#383 — Speaker identity model](https://github.com/jpshackelford/voice-relay/issues/383)
   - Conversation: [`21fe6fd`](https://app.all-hands.dev/conversations/21fe6fd77f3449cc8d9a94f738635052)

2. **Expansion Worker — Issue #384**
   - Issue: [#384 — Workspace page: show person/device name](https://github.com/jpshackelford/voice-relay/issues/384)
   - Conversation: [`d48597e`](https://app.all-hands.dev/conversations/d48597e7ec104e199b7d39e7184dc239)
   - Note: prompt flags possible dependency on #383

**Current State:**
- Open PRs: none
- Implementation slot: 1/1 (in flight on #378, conv `329d0f1`)
- Expansion slots: 2/4 (just spawned #383, #384)
- Review slots: 0/2
- Ready+prioritized issues waiting on impl slot: #382 (priority:medium), #380 (priority:low), #379 (priority:low)
- On-hold / needs-human (skipped): #372, #363, #351, #302, #301, #300, #299, #239, #210

**Action Taken:**
🚀 Spawned 2 expansion workers in parallel for the newest unlabeled issues (#383, #384). Implementation slot is occupied by `329d0f1` working on #378, so no new impl worker spawned this tick.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-04 17:53 UTC - Expansion Worker (`d48597e`)

🛑 **Expanded Issue #384 — Workspace page: show person name (device name) for connected devices**

- Issue: [#384](https://github.com/jpshackelford/voice-relay/issues/384)
- Type: Enhancement (client-visible, requires backend assist)
- Status: **on-hold** — hard-blocked by #383 (speaker identity model not yet in schema)

**What I did**
- Verified current code: `server/src/workspaces/router.ts` `GET /:id/devices` returns no `primary_user_id`; no `workspace_speakers` table exists. Data source genuinely doesn't exist yet.
- Rewrote issue body with Problem Statement, Proposed Solution, Acceptance Criteria, Out of Scope, Dependencies.
- Added technical-approach comment: API shape change (additive `primaryUser` field on `/devices` payload), client `DeviceInfo` extension, `EditableDeviceName` render change, three test states, files affected.
- Labels applied: `scope:full-stack`, `priority:medium`, `on-hold`, `enhancement`. **Did not** add `ready` (per skill: hard-blocked → on-hold, not ready).

**Unblock condition**
When #383 ships (`devices.primary_user_id` + `workspace_speakers.preferred_name` in schema), remove `on-hold` and add `ready`.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-04 17:54 UTC - Expansion Worker (`6PqdOvr`)

✅ **Expanded Issue #383 — Speaker identity model**

- Issue: [#383](https://github.com/jpshackelford/voice-relay/issues/383)
- Type: Enhancement (foundational schema + REST + agent-prompt wiring)
- Status: **ready** for implementation

**What I did**
- Explored current schema (`users`, `devices`, `session_devices`, `messages`) and the agent header pipeline (`server/src/agent-driver/voice-relay-header.ts`) to confirm the design lines up with the actual code.
- Rewrote issue body with Problem Statement, Proposed Solution (four-part schema: provider-agnostic `users` + `auth_identities`, `devices.primary_user_id`, workspace-scoped `speakers`, `session_devices.active_speaker_id` + `messages.speaker_id`), REST surface, agent wiring, Acceptance Criteria, Out of Scope, Related.
- Added technical-approach comment: migration sketch (`server/src/storage/migrations/016_speakers.ts` with users-table recreate to drop `github_id NOT NULL`, plus additive ALTERs and two new tables), implementation plan (9 steps), files-affected table (~16 files), risks, sequencing notes vs #378 / #382.
- Labels applied: `scope:server-only`, `priority:medium`, `ready`.

**Unblocks**
- #382 — transcription ticker can read `speakers.preferred_name` once this lands.
- #384 — currently on-hold pending this issue.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 17:56 UTC - Implementation worker (#378)

🚀 **Dispatched PR #385 — session settings REST + per-session agent prompt**

- Issue: [#378](https://github.com/jpshackelford/voice-relay/issues/378)
- PR: [#385](https://github.com/jpshackelford/voice-relay/pull/385) — ready for review
- Branch: `feat/378-session-settings-rest`
- Scope: server-only, additive schema (migration 016 nullable column)

**What I shipped**

| Layer            | Change                                                                 |
|------------------|------------------------------------------------------------------------|
| HTTP             | `GET` + `PATCH /api/sessions/:id/settings`, mounted alongside `ai-router` |
| Service          | `SessionSettingsService.applyPatch()` — one funnel for REST + WS writes  |
| WS               | `'session-tts-settings'` handler refactored to delegate; new `session-settings-changed` snapshot broadcast; legacy `session-tts-settings-changed` preserved for back-compat |
| Schema           | Migration `016_default_agent_prompt.ts` (nullable TEXT, up/down)        |
| Agent prompt     | `resolveSessionSystemPrompt`: session > workspace-default > built-in    |
| Auth             | DISPLAY_API_SECRET Bearer → JWT workspace-member fallback              |

**Tests**

- Server: **1381 / 1381 passing** (+33 new)
- Client: **1019 / 1019 passing** (unchanged)
- Coverage on new files: settings-service 96.3 % stmts / 98.6 % branches, settings-router 87.3 % / 82.6 %, migration 016 100 %
- New Playwright spec `tests/session-settings-api.spec.ts` for the JWT round-trip

**CI**

All required checks green on commit `6223d17`: Server Tests ✅ · Client Tests ✅ · Build Client ✅ · E2E Tests ✅ · lint-pr-title ✅

**Follow-ups (out of scope per #378 expansion)**

- Teach the built-in `prompts/system-prompt.md` to call `PATCH /settings` so the agent can self-tune.
- Client UI for the new fields (input mode / auto-submit / agent-prompt editor).

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---

### 2026-06-04 18:07 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `329d0f1` | implementation | Issue #378 — session settings REST | running |
| `7c19afa` | expansion | Issue #386 — hosted STT w/ diarization | **NEW** |
| `ae7301e` | expansion | Issue #388 — kiosk mic muted icon | **NEW** |

**Workers Completed Since Last Tick:**
- `21fe6fd` (expansion) → Issue #383 expanded; `ready` label added
- `d48597e` (expansion) → Issue #384 triaged to `on-hold` (hard-blocked by #383)

🚀 **Spawned: 2 Expansion Workers (parallel)**

1. **Expansion #386** — [Hosted STT with diarization (Deepgram/AssemblyAI)](https://github.com/jpshackelford/voice-relay/issues/386)
   - Conversation: [`7c19afa`](https://app.all-hands.dev/conversations/7c19afa9ce2c44a79958395a2bedcb9b)

2. **Expansion #388** — [Propagate per-device mic mute state + kiosk muted icon](https://github.com/jpshackelford/voice-relay/issues/388)
   - Conversation: [`ae7301e`](https://app.all-hands.dev/conversations/ae7301e4add14aea894cc252d283fb8d)

**Current State:**
- Open PRs: **#385** (ready, all checks green, bot review COMMENTED, no review threads) and **#387** (also feat/session-settings, draft cleared, UNSTABLE — actively being pushed by impl worker `329d0f1`). ⚠️ Duplicate PRs for issue #378 — letting the running impl worker converge before spawning a merge worker.
- Ready issues (priority order): #378 (in impl), #382 (medium, depends on #383 schema), #383 (medium, just expanded), #379 #380 (low)
- Issues needing expansion: none remaining (#386, #388 now being expanded)
- On-hold: #384 (blocked by #383)

**Action Taken:**
✅ Spawned 2 expansion workers for the last two unexpanded issues. Implementation slot still occupied by `329d0f1` working on #378 — deferring review/merge until that worker exits and the duplicate-PR situation resolves.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-04 18:15 UTC - Expansion Worker (#386)

✅ **Expanded Issue #386** — [Optional hosted STT with diarization (Deepgram / AssemblyAI) for shared-device use cases](https://github.com/jpshackelford/voice-relay/issues/386)

| Field | Value |
|---|---|
| Type | Enhancement |
| Status | Ready for implementation |
| Approach | Opt-in Deepgram streaming STT alongside Web Speech, per-device override, server-side token broker (no audio through VR), engine speaker labels propagated end-to-end and mapped via new `session_engine_speakers` table |
| Hard deps | #383 (speakers table FK), #378 (REST/auth pattern) |
| Soft dep | #382 (ticker label render) |
| Complexity | High — touches storage, server routing, WS protocol, hooks, AudioWorklet |

Rewrote issue body into Problem Statement / Proposed Solution / Acceptance Criteria / Out of Scope / Depends-on sections. Added a technical-approach comment with merge-order plan, file-by-file impact list, migration SQL sketch, API/WS changes, and risk list. Labeled `ready`.

---

### 2026-06-04 18:10 UTC - Expansion Worker (#388)

✅ **Expanded Issue #388** — Propagate per-device mic listening/mute state and show a muted icon on the kiosk oscilloscope

- Issue: [#388](https://github.com/jpshackelford/voice-relay/issues/388)
- Type: Enhancement
- Status: Ready for implementation (`ready` label applied)
- Scope: client + server (small additive WS message + 3-state indicator render)

**What I did**

- Rewrote the issue body with a tightened Problem Statement, three-state acceptance criteria, non-goals, and related-issue cross-references.
- Added a technical-approach comment grounded in current code: file/line references for `KioskMode.tsx` L239/L487/L977, `MobileMode.tsx` L112/L174, `useWebSocket.ts` L402/L418, `registry.ts` L274, `index.ts` L728, `types.ts` L5/L302, `App.css` L1693.
- Files-affected table (~14 files, 1–2 new), no database changes, no new migration, additive wire format that is backward-compatible with older clients.
- Called out keepalive-driven disconnect semantics, effect-thrash mitigation on mobile, and PR-scope guidance per AGENTS.md (`feat:` no scope, or split client/server).

**Approach summary**

Symmetric with the existing `update-device` flow: new `device-listening-state` client→server message, two transient fields on the in-memory `Device`, projected on `broadcastDeviceList`, aggregated kiosk-side into `'no-mic' | 'muted' | 'listening'` driving the three render states (dimmed / flat+muted-glyph / animated-as-today).

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-04 18:23 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `692af3b` | merge (review slot) | PR #385 — session settings REST | **NEW** |
| `a0b08f1` | implementation | Issue #383 — Speaker identity model (priority:medium) | **NEW** |
| `2db4bd8` | expansion | Issue #389 — Teach prompt to call PATCH /api/sessions/:id/settings | **NEW** |
| `655a6df` | expansion | Issue #390 — Login page footer layout bug | **NEW** |

**Previous workers (now in `completed`):**
- `7c19afa` (expansion) → #386 expanded with hosted-STT/diarization design, `ready` label added
- `ae7301e` (expansion) → #388 expanded with three-state mic/listening state design, `ready` label added
- `329d0f1` (implementation) → #378 implemented as PR #385 (all CI green, mergeable); duplicate PR #387 closed

🚀 **Spawned: 4 Workers (parallel)**

1. **Merge Worker** for [PR #385 — feat(server): expose session settings over REST + per-session agent prompt](https://github.com/jpshackelford/voice-relay/pull/385)
   - All checks green, mergeable, no unresolved review threads (only bot `COMMENTED`)
   - Will close issue #378 on merge
   - Conversation: [`692af3b`](https://app.all-hands.dev/conversations/692af3b420244ef992980fd42ac991f1)

2. **Implementation Worker** for [Issue #383 — Speaker identity model](https://github.com/jpshackelford/voice-relay/issues/383) (priority:medium, scope:server-only)
   - Builds on PR #385's REST/migration scaffold (worker instructed to pull main after #385 merges)
   - Conversation: [`a0b08f1`](https://app.all-hands.dev/conversations/a0b08f15a8e045a08a2a920400d26920)

3. **Expansion Worker** for [Issue #389 — Teach default system prompt to PATCH /api/sessions/:id/settings](https://github.com/jpshackelford/voice-relay/issues/389)
   - Follow-up to PR #385; prompt-text-only change expected
   - Conversation: [`2db4bd8`](https://app.all-hands.dev/conversations/2db4bd8c21a3445dbc43210579f8dd9e)

4. **Expansion Worker** for [Issue #390 — Login page footer layout bug](https://github.com/jpshackelford/voice-relay/issues/390)
   - Visual layout bug, needs reproduction + root cause; will be triaged with bug/client/scope:client-only/priority:low/ready
   - Conversation: [`655a6df`](https://app.all-hands.dev/conversations/655a6df7d5cc4326a6101bd60d333c71)

**Current State:**
- Open PRs: **#385** (about to be merged) — closes #378
- Ready issues (priority order, unblocked by stuck PRs):
  - **#383** (medium, in impl) — speaker identity foundation
  - **#382** (medium, blocked by #383) — ticker speaker identity
  - **#386** (ready, no priority) — hosted STT (depends on #383, #378)
  - **#388** (ready, no priority) — per-device mic state
  - **#379** (low) — CSS Grid kiosk overlays
  - **#380** (low) — kiosk indicator color
- Issues needing expansion: **#389, #390** (now in flight)
- On-hold: #210, #239, #299–302, #351, #363, #384, #372 (needs-human)

**Action Taken:**
🚀 Spawned 4 workers across 3 slot types. Remaining capacity: 2 expansion + 1 review slots free. Next tick (~15 min) will check progress and potentially fill remaining capacity (e.g. spawn impl for #379/#380 if #383 finishes, or expansion for newly-opened issues).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-04 18:24 UTC - Expansion Worker (issue #390)

✅ **Expanded Issue #390** — Login page footer renders next to card instead of below

- Issue: [Login page footer (Terms / Privacy) renders next to the card instead of below it](https://github.com/jpshackelford/voice-relay/issues/390)
- Type: Bug (client-only, visual/layout)
- Status: Ready for implementation
- Root cause: `.login-page` uses `display: flex` with no `flex-direction` (defaults to `row`); `<footer>` is a flex sibling of `.login-card` so they sit side-by-side instead of stacked. Verified against `client/src/pages/Login.tsx` lines 57–89 and `client/src/App.css` line 1848.
- Recommended fix: one-line CSS change — add `flex-direction: column;` to `.login-page` in `client/src/App.css`. No JSX changes, no new tests required (manual viewport check at 1440×900 / 768×1024 / 375×667).
- Labels applied: `bug`, `client`, `scope:client-only`, `priority:low`, `ready`.
- Issue body was already exceptionally complete (problem, repro, root cause, visual, fix, acceptance criteria); added a verification + recommendation comment rather than rewriting.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 18:25 UTC - Merge Worker (#385)

✅ Squash-merged PR #385 (`feat/378-session-settings-rest`) into `main`.

- **Closes:** #378 (auto-closed via "Fixes #378")
- **CI:** all 7 checks green; mergeable = CLEAN; no review threads
- **Migration:** 016 `default_agent_prompt` — single `ALTER TABLE workspace_settings ADD COLUMN default_agent_prompt TEXT` (nullable, no default) → additive, safe for existing production rows. Down migration recreates the table and was round-trip tested.
- **Surface added:** `GET`/`PATCH /api/sessions/:sessionId/settings` (Bearer or JWT), `session-settings-changed` WS snapshot; legacy `session-tts-settings-changed` preserved for back-compat.
- **Behavior added:** per-session `agentPrompt` > workspace `default_agent_prompt` > built-in `system-prompt.md`, wired into `AISessionManager` via injectable `SystemPromptResolver`.
- **Test delta:** +33 server tests + 1 Playwright e2e. Coverage: settings-service 96.3%, settings-router 87.3%, migration 100%.
- **Production impact:** auto-deploys to vr.chorecraft.net; migration is purely additive on SQLite, so existing `sqlite.db` rows continue to use the built-in prompt until an operator sets one.

Review verdict from `github-actions[bot]` (COMMENTED, no blockers): 🟢 Good taste — "Solid implementation that follows engineering best practices."

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---

### 2026-06-04 18:27 UTC - Expansion Worker (#389)

✅ **Expanded Issue #389** — Teach default system prompt to call `PATCH /api/sessions/:id/settings`

- Type: Enhancement (prompt-engineering follow-up to merged PR #385)
- Status: **Ready for implementation** (`ready` label applied)
- Approach: Insert a new "Session Settings API" section into `server/prompts/system-prompt.md` immediately after the existing "Display API" block. Documents `PATCH /api/sessions/{{SESSION_ID}}/settings` with `Authorization: Bearer $DISPLAY_API_SECRET` and the four mutable fields (`tts`, `inputMode`, `autoSubmit`, `agentPrompt`), with 5 concrete `curl` examples and a "When NOT to call" carve-out for device-volume / one-off / stylistic asks.
- Files affected: `server/prompts/system-prompt.md` (+~45 lines), `server/src/openhands.test.ts` (+~30 lines, plus updating `sessionIdMatches.length` from 4 → 9). No server code, no router, no schema, no migration.
- Risks flagged in technical comment: prompt bloat, ambiguous triggers ("turn it down"), agent self-reprogramming via `agentPrompt`, and the well-known flakiness of LLM-driven e2e tests. Recommended a server-side contract test for CI + a manual live-LLM smoke for the PR description, instead of trying to gate on real-LLM behaviour.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-04 19:18 UTC - Implementation Worker (#383)

🚧 **Opened PR [#391](https://github.com/jpshackelford/voice-relay/pull/391)** — Speaker identity model (server-only, scope: server, priority: medium)

- **Status:** Draft → Ready. All CI green (Server Tests, Client Tests, Build Client, E2E Tests 2m14s, lint-pr-title, enable-orchestrator).
- **Migration:** 017 `speakers` — additive only. Creates `auth_identities` + `speakers`; adds `devices.primary_user_id`, `session_devices.active_speaker_id`, `messages.speaker_id`. Backfills existing GitHub users into `auth_identities`. Down migration restores v16 schema and round-trips cleanly.
- **REST surface added:** `GET/POST /api/workspaces/:wsId/speakers` and `GET/PUT/DELETE /api/workspaces/:wsId/speakers/:speakerId` — owner-only writes, member reads. Input validated (length caps, trim, blanks→null). 409 on duplicate speaker-per-user.
- **Agent wiring:** `[speaker name=… pronouns=… notes=…]` header emitted into the next prompt frame on inbound utterances; falls back to `[speaker id=unknown]` when the resolved speaker has no `preferred_name`, prompting the agent to ask and `PUT` it back. Updated `prompts/system-prompt.md` with a "Speaker identity" section.
- **Back-compat:** `users` table left intact (additive only). `UserRepository.create` dual-writes into `auth_identities` so existing GitHub OAuth flow keeps working unchanged.
- **Test delta:** +59 server tests (10 migration, 20 SpeakerRepository, 17 router, 12 AuthIdentityRepository). Total **1447 server tests passing / 68 files**. Coverage on new code: speakers 92.5% stmts / 87.5% branch / 100% funcs; auth/identity-repository 100% / 91% / 100%; migration 017 100% across the board — all over the 80% gate.
- **Production impact:** auto-deploys to vr.chorecraft.net on merge. Migration is additive on SQLite, safe on existing `sqlite.db`.

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---
