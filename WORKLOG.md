# Voice Relay Worklog

## Log

### 2026-06-06 00:31 UTC - Orchestrator

🔒 **Auto-disabled due to inactivity**

Two consecutive quiet ticks (`quiet_ticks` 1 → 2) with no productive work available — every open issue carries an `on-hold` or `needs-human` label, and there are no open PRs after PR #407 / #408 merged at `00:10–00:13Z`. Automation `5f180989-ed9c-42b4-ac9f-5f30f0623316` ("Voice Relay Workflow Orchestrator v2") has been disabled to stop tick-cadence noise.

**State snapshot at disable:**

| Bucket | Count | Items |
|---|---|---|
| Open PRs | 0 | — |
| Active workers | 0 | — |
| Issues needing expansion (actionable) | 0 | All open expansion candidates are `on-hold` (#210, #239, #299–#302, #384) or `needs-human` (#372) |
| Ready issues (actionable) | 0 | #351, #363 both `on-hold` |

The Path B / S3 design freeze documented in `AGENTS.md` still gates #299–#302; the workspace-persistence prep work has not yet landed, so those remain `on-hold` by design. #372 (`needs-human`) is awaiting a human decision.

**To re-enable** once new actionable issues land (e.g., a fresh bug report, or the S3 freeze lifts):

```bash
curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
  -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Or toggle via the OpenHands UI: <https://app.all-hands.dev/automations> → "Voice Relay Workflow Orchestrator v2" → enable.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-06 14:21 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `cb181e6` | expansion (one-off) | INSTRUCTION: retroactive AC gate run for PR #402 / Issue #386 | **NEW** |

📋 **Following Human Instructions** + 🔓 **Re-enabled automation** + 🚀 **Spawned worker**

Found unacknowledged `## INSTRUCTION:` block at the top of WORKLOG.md authorizing a one-off retroactive Closing-Trailer Acceptance-Criteria Gate run on PR #402 / Issue #386 (per the policy merged in [.openhands#30](https://github.com/jpshackelford/.openhands/pull/30)). Acknowledged the instruction (`[ACKNOWLEDGED 2026-06-06]`) and dispatched a dedicated worker conversation to execute its five required steps end-to-end.

**Spawned: Retroactive AC-Gate Worker**

- Task: Re-walk Issue #386's `## Acceptance Criteria` checklist against PR #402's final diff; for each uncovered AC section file one follow-up issue with `Refs #386` and inherited `priority:low` + appropriate `scope:*` label; add `## Deferred to follow-ups` block to PR #402's body just above the (immutable) `Fixes #386` trailer; re-open Issue #386 as the umbrella tracker with an explanatory comment; log a `Retroactive AC gate run for PR #402 / Issue #386` WORKLOG entry with the verdict.
- Start-task id: `544dcf2ad4494399ae90cb98946d5997` → `app_conversation_id = cb181e6c08b041b8be9da0b8ccb45c79` (status `READY` on second poll; `execution_status = running`, `sandbox_status = RUNNING` at verification).
- Conversation: [`cb181e6`](https://app.all-hands.dev/conversations/cb181e6c08b041b8be9da0b8ccb45c79)
- Plugin ref: `voice-relay-workflow @ main`
- Slot accounting: filed in the expansion slot (issue-touching, no PR creation, runs alongside the parallel-safe expansion fleet).

🔓 **Re-enabled automation `5f180989-ed9c-42b4-ac9f-5f30f0623316`** ("Voice Relay Workflow Orchestrator v2") — `PATCH /api/automation/v1/{id}` with `{"enabled": true}` returned 200. Was auto-disabled at 2026-06-06 00:31Z after two quiet ticks following the PR #407 / #408 merges. The human-filed INSTRUCTION block (which is itself actionable work) plus the expected fan-out of follow-up issues makes the next several ticks productive, so resuming.

**Current State (pre-worker):**

- **Open PRs:** 0.
- **Issues needing expansion (actionable):** 0. All open expansion candidates are `on-hold` (#210, #239, #299–#302, #384) or `needs-human` (#372).
- **Ready issues (actionable):** 0. #351, #363 are both `on-hold`; the recently-merged #403/#404/#405 chain is closed.
- **Active slot summary after this spawn:** expansion 1/4, implementation 0/1, review 0/2.

**Decision rationale:**

- The decision-table-driven dispatch yields nothing this tick (every open issue carries `on-hold` or `needs-human`, and there are no PRs).
- However, the `## INSTRUCTION:` block at the top of WORKLOG.md takes precedence over the decision table per the orchestrate skill's "Step 1: Check for Human Instructions" rule, and that instruction is explicit, single-use, and authorized.
- The instruction allows either inline execution or a spawned conversation. Spawning is cleaner: it gives the gate run its own short-lived context, keeps writes (issue create / reopen / PR-body edit / WORKLOG append) attributable, and survives the end of this orchestrator tick.
- After the worker finishes, several new follow-up issues (likely 2–4, all `priority:low`, mostly `scope:client-only`) will appear and trigger normal expansion-slot dispatch on the next tick.

**Quiet-tick counter:** reset `2 → 0` (productive tick — instruction followed + worker spawned).

**Production-impact:** none. The dispatched work is GitHub-metadata-only (issue create / reopen / labels / PR body edit / WORKLOG). No code change, no migration, no deploy.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---
### 2026-06-06 14:26 UTC - Expansion worker (retroactive AC gate for PR #402 / Issue #386)

✅ Retroactive Closing-Trailer Acceptance-Criteria Gate run for [PR #402](https://github.com/jpshackelford/voice-relay/pull/402) (`feat(server): hosted STT (Deepgram) broker + workspace settings`, merged 2026-06-05 13:21:35Z with a `Fixes #386` trailer) and [Issue #386](https://github.com/jpshackelford/voice-relay/issues/386). Authorised by the `## INSTRUCTION:` block at the top of `WORKLOG.md` and the policy codified in [.openhands#30](https://github.com/jpshackelford/.openhands/pull/30).

**AC sections found unsatisfied** by re-walking #386's `## Acceptance Criteria` against PR #402's final diff (server-scoped, 25 files, no `client/` paths and no `README.md` change):

- **Client hook `useHostedSpeechRecognition`** — entire section unsatisfied; no hook file in `client/src/hooks/`, no lifecycle test.
- **Engine selection** — `KioskMode.tsx` and `MobileMode.tsx` untouched; no resolved-engine wiring; no transparent Web-Speech fallback.
- **Message pipeline** (partial) — server-side WS relay + engine-label → `speakers.id` swap ✓ covered in `server/src/index.ts`; **agent driver** (`server/src/agent-message-relay.ts`) and **kiosk ticker `S1: …` prefix** (#382) ✗ uncovered.
- **Usage / cap** (partial) — table, counter, `GET`/`POST /api/stt/usage` ✓ covered; **workspace settings page showing minutes-used + cap** ✗ uncovered (no UI surface on vr.chorecraft.net — exactly the failure the human observer flagged).
- **Docs** (partial) — `docs/architecture.md` paragraph ✓ covered; **README "Hosted STT (Deepgram)" section** ✗ uncovered.

Items confirmed **covered** by PR #402 (no follow-up needed): Setting plumbing (migration 019 columns + owner-gated mutations), Token broker (`POST /api/stt/token` + full 401/402/403/404/503/502 error matrix), Session mapping table + repository (`session_engine_speakers` + `resolveEngineSpeaker`), server side of Usage / cap, wire-protocol field `engineSpeakerLabel?` on `TextMessage` / `RelayedTextMessage`, `docs/architecture.md` paragraph.

**Follow-up issues filed** (each carries `priority:low` inherited from #386 and `Refs #386`; none carries `ready` — the expansion worker will add that on subsequent normal ticks):

| Issue | Title | Scope |
|-------|-------|-------|
| [#409](https://github.com/jpshackelford/voice-relay/issues/409) | `feat(client): useHostedSpeechRecognition hook for hosted STT (follow-up to #386)` | `scope:client-only` |
| [#410](https://github.com/jpshackelford/voice-relay/issues/410) | `feat(client): engine selection (Deepgram vs Web Speech) in Kiosk/MobileMode (follow-up to #386)` | `scope:client-only` |
| [#411](https://github.com/jpshackelford/voice-relay/issues/411) | `feat(server,client): propagate engineSpeakerLabel through agent driver + render kiosk ticker S1: prefix (follow-up to #386)` | `scope:full-stack` |
| [#412](https://github.com/jpshackelford/voice-relay/issues/412) | `feat(client): workspace settings UI for hosted STT engine, cap, key, and usage (follow-up to #386)` | `scope:client-only` |
| [#413](https://github.com/jpshackelford/voice-relay/issues/413) | `docs: README section "Hosted STT (Deepgram)" (follow-up to #386)` | `scope:docs-only` |

**Gate verdict:** `downgraded Fixes → Refs + 5 follow-ups`.

**Other artefacts written:**

- [PR #402](https://github.com/jpshackelford/voice-relay/pull/402) body edited (post-merge, description-only) to add a `## Deferred to follow-ups` section listing #409–#413, placed just above the (immutable) `Fixes #386` trailer. The squash commit on `main` is unchanged. A note about the retroactive gate edit was appended to the AI-disclosure footer.
- [Issue #386](https://github.com/jpshackelford/voice-relay/issues/386) re-opened as the umbrella tracker with an explanatory comment ([#issuecomment-4639185739](https://github.com/jpshackelford/voice-relay/issues/386#issuecomment-4639185739)) covering (a) the retroactive nature of the gate per `.openhands#30`, (b) why the original `Fixes #386` trailer was incorrect, (c) the filed follow-ups, and (d) that #386 will close once all five follow-ups close.

**Branch hygiene:** This WORKLOG entry was pushed directly to `main` per the `AGENTS.md` exception for `docs(worklog):` commits. No feature branch touched WORKLOG. `.workflow-state.json` was **not** modified — the orchestrator already attributed this conversation in its expansion-slot entry when it spawned the worker.

[ACKNOWLEDGED: ## INSTRUCTION: Retroactive Closing-Trailer AC Gate run for PR #402 / Issue #386]

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:33 UTC - Expansion worker (retroactive AC gate for PR #402 / Issue #386, second pass)

🛑 No-op pass — the earlier 14:26 UTC entry above already executed all five steps of the INSTRUCTION (follow-ups #409–#413 filed, PR #402 body updated, #386 re-opened, INSTRUCTION marked `[ACKNOWLEDGED 2026-06-06]`, WORKLOG entry logged). This conversation was dispatched after that work landed but before its state had propagated to the running orchestrator decision table, so it independently re-walked the gate.

**Side effect to clean up.** I re-walked the AC against PR #402's final diff, reached the same verdict (`downgraded Fixes → Refs + 5 follow-ups`), and filed a second set of follow-up issues before noticing #409–#413 already existed. Those duplicates are now closed as `not planned` with a comment pointing to the canonical issue:

| Duplicate (closed) | Canonical (open) |
|---|---|
| [#414](https://github.com/jpshackelford/voice-relay/issues/414) | [#409](https://github.com/jpshackelford/voice-relay/issues/409) |
| [#415](https://github.com/jpshackelford/voice-relay/issues/415) | [#410](https://github.com/jpshackelford/voice-relay/issues/410) |
| [#416](https://github.com/jpshackelford/voice-relay/issues/416) | [#411](https://github.com/jpshackelford/voice-relay/issues/411) |
| [#417](https://github.com/jpshackelford/voice-relay/issues/417) | [#412](https://github.com/jpshackelford/voice-relay/issues/412) |
| [#418](https://github.com/jpshackelford/voice-relay/issues/418) | [#413](https://github.com/jpshackelford/voice-relay/issues/413) |

No other state changed. PR #402 body is unchanged (still references #409–#413). Issue #386 is unchanged (still open, the 14:25 UTC re-open comment still stands). The INSTRUCTION block is already `[ACKNOWLEDGED]` and is not touched again.

**Process lesson for the next agent.** Before filing follow-ups in a retroactive gate run, check both: (a) the PR's `## Deferred to follow-ups` section if present, and (b) `gh issue list --search "in:title 'follow-up to #<umbrella>'" --state all`. The expansion-worker variant of this skill should grep for an existing matching `## Deferred to follow-ups` block in the closing PR's description before walking the AC, and short-circuit to "already filed" if found. This duplicate run was avoidable.

**Gate verdict (unchanged):** `downgraded Fixes → Refs + 5 follow-ups` — same five sections, same five canonical issue numbers as the 14:26 UTC entry above.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:37 UTC - Expansion Worker (issue #412)

✅ **Expanded Issue [#412](https://github.com/jpshackelford/voice-relay/issues/412)** — `feat(client): workspace settings UI for hosted STT engine, cap, key, and usage (follow-up to #386)`

- **Type:** Enhancement (client-only follow-up filed by retroactive AC Gate on PR #402 / umbrella #386).
- **Verdict:** Already well-specified by the AC Gate body. Sanity-checked the technical plan against the codebase — no rewrite needed.
- **Verified file paths exist:** `client/src/pages/WorkspaceHome.tsx` (1315 lines) and `client/src/hooks/useWorkspaceSettings.ts` (325 lines). The hook already implements the exact mask-aware + PUT/DELETE pattern for the ElevenLabs key (`setElevenlabsApiKey` / `removeElevenlabsApiKey` / `hasElevenlabsApiKey`, lines ~201–263) that the issue tells the implementer to mirror for Deepgram. No Deepgram or `sttEngine` fields exist on the client side yet — confirms the server-only landing of PR #402.
- **Test scope:** No `WorkspaceHome.test.tsx` exists today; sibling components have their own `*.test.tsx` (e.g. `MobileSettings.test.tsx`, `JoinPage.test.tsx`). The issue explicitly allows "component-level" tests, so the implementer can either add `WorkspaceHome.test.tsx` or split out a small `WorkspaceSettingsPanel` component and test that. No additional guidance needed.
- **Action:** Added `ready` label. No comment added (issue body is already complete per AC-Gate convention — adding boilerplate would just be noise).

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:40 UTC - Expansion Worker (issue #409)

✅ **Expanded Issue [#409](https://github.com/jpshackelford/voice-relay/issues/409)** — `feat(client): useHostedSpeechRecognition hook for hosted STT (follow-up to #386)`

- **Type:** Enhancement (client-only follow-up filed by retroactive AC Gate on PR #402 / umbrella #386).
- **Verdict:** Issue body already well-specified by the AC Gate. Sanity-checked against `main` — server prerequisites and reference hook all exist as claimed. No rewrite needed.
- **Verified against main:**
  - Reference hook `client/src/hooks/useSpeechRecognition.ts` (147 lines) and test scaffolding `useSpeechRecognition.test.ts` (`FakeSpeechRecognition` class pattern) — confirmed mirror target.
  - Server endpoints `POST /api/stt/token`, `POST /api/stt/usage`, `GET /api/stt/usage` live at `server/src/transcription/router.ts` with the full 401/402/403/404/502/503 error matrix. Verified token-success shape: `{ engine: 'deepgram', token, expiresAt }`.
  - `engineSpeakerLabel?: string` is already on `TextMessage` / `RelayedTextMessage` (`server/src/types.ts:233,521`) and is relayed in `server/src/index.ts:972-1006` — confirms zero server-side work for this issue.
- **Action:** Added a single implementation-notes [comment](https://github.com/jpshackelford/voice-relay/issues/409#issuecomment-4639239842) covering the verified response shape, fallback-eligible error matrix, Deepgram WS URL/sub-protocol auth note, and recommended `error` shape (`{ message, fallbackEligible, cause }`). Added `ready` label.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:42 UTC - Expansion Worker (issue #411)

✅ **Expanded Issue [#411](https://github.com/jpshackelford/voice-relay/issues/411)** — `feat(server,client): propagate engineSpeakerLabel through agent driver + render kiosk ticker S1: prefix (follow-up to #386)`

- **Type:** Enhancement (full-stack follow-up filed by retroactive AC Gate on PR #402 / umbrella #386).
- **Verdict:** Issue body already well-specified by the AC Gate. Sanity-checked against `main`, found one client-side gap (mirror type missing), and added a single concrete file-path + test-scope comment before labeling ready.
- **Verified against main:**
  - Server wire/storage already done: `engineSpeakerLabel?: string` on `TextMessage` and `RelayedTextMessage` at `server/src/types.ts:233,521`; WS handler reads + relays + does the `session_engine_speakers` swap at `server/src/index.ts:972-1006`.
  - Server-side gap confirmed: `server/src/agent-message-relay.ts` and `server/src/agent-message-relay.test.ts` have **zero** references to `engineSpeakerLabel`; existing `sender` plumbing test at L107 forwards `AgentSenderMeta` to the driver but never carries the engine label.
  - Header builder lives in `server/src/agent-driver/voice-relay-header.ts` (not in `agent-message-relay.ts`); the `[speaker …]` line at L160–L185 already dedupes per-device via `state.deviceSpeakerId` — natural place to add an `engine=…` fallback when `sender.speaker` is unresolved.
  - **Client-side mirror gap found:** `client/src/types.ts:190` `RelayedTextMessage` is missing `engineSpeakerLabel?: string`; `Utterance` at L549 is also missing it; `handleTextMessage` in both `client/src/pages/SessionView.tsx:192` and `client/src/pages/Workspace.tsx:139` need to thread it through. The kiosk ticker `transcriptionTicker` memo at `client/src/components/KioskMode.tsx:526` is where the `S1:` prefix lands.
- **Key clarification added in [comment](https://github.com/jpshackelford/voice-relay/issues/411#issuecomment-4639249948):**
  - Plumbing spine: extend `AgentSenderMeta` (`server/src/agent-driver/types.ts:107`) with `engineSpeakerLabel?: string`; spread into the existing `sender` literal in `server/src/index.ts:1047-1053`; extend the `[speaker …]` line in `voice-relay-header.ts` to emit `[speaker engine=S1]` when `sender.speaker` is absent. Resolved `speaker` always wins — engine label is fallback only.
  - Explicit file-path list for client mirror (`types.ts`, `SessionView.tsx`, `Workspace.tsx`, `KioskMode.tsx`).
  - Test scope: `agent-message-relay.test.ts` (forwarding), `voice-relay-header.test.ts` (4 new cases incl. dedup), `KioskMode.test.tsx` (prefix render + Web-Speech regression guard).
- **Action:** Added expansion comment, added `ready` label.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:48 UTC - Expansion Worker (issue #410)

✅ **Expanded Issue [#410](https://github.com/jpshackelford/voice-relay/issues/410)** — `feat(client): engine selection (Deepgram vs Web Speech) in Kiosk/MobileMode (follow-up to #386)`

- **Type:** Enhancement (client-only follow-up filed by retroactive AC Gate on PR #402 / umbrella #386).
- **Verdict:** Issue body already well-specified by the AC Gate. Sanity-checked against `main` and added one clarification re: anonymous-safe engine discovery before labeling ready.
- **Verified against main:**
  - `client/src/components/KioskMode.tsx:4,260` and `client/src/components/MobileMode.tsx:3,142` both mount `useSpeechRecognition` unconditionally — confirms the AC's "currently always Web Speech" framing.
  - Existing `useSpeechRecognition` hook at `client/src/hooks/useSpeechRecognition.ts` (to wrap, not replace).
  - `useWorkspaceSettings` (`client/src/hooks/useWorkspaceSettings.ts`) is owner-only via `GET /api/workspaces/:id/settings` (returns 403 for non-owners) and currently does **not** expose `sttEngine`.
  - `useKioskConfig` (`client/src/hooks/useKioskConfig.ts`) is the anonymous-safe slice via `GET /api/workspaces/:id/kiosk-config` (`server/src/workspaces/router.ts:119`). Currently returns only `kioskFooterTickersEnabled`.
- **Key clarification added in [comment](https://github.com/jpshackelford/voice-relay/issues/410#issuecomment-4639245225):** non-owner kiosks/mobile devices joining via QR cannot read `sttEngine` from the owner-scoped `/settings` endpoint, so the implementation must extend the `/kiosk-config` endpoint (and `useKioskConfig`) with an anonymous-safe `sttEngine` field. Included implementation plan (wrapper hook `useSttEngine` that always calls both `useSpeechRecognition` and `useHostedSpeechRecognition` to avoid conditional-hook violations), fallback semantics (session-scoped `useRef` dedupe for the one-time warn), banner-eligible errors (402 cap-exhausted, 503 missing-key), and explicit test scope.
- **Dependency flagged:** blocks on #409 (`useHostedSpeechRecognition`) — must merge first so there's a second hook to wrap.
- **Action:** Added expansion comment, added `ready` label.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:51 UTC - Expansion Worker (issue #413)

✅ **Expanded Issue [#413](https://github.com/jpshackelford/voice-relay/issues/413)** — `docs: README section "Hosted STT (Deepgram)" (follow-up to #386)` — docs-only follow-up from the retroactive AC Gate on PR #402; rewrote body with Problem Statement / Proposed Solution / Acceptance Criteria (9 verifiable bullets the closing-trailer gate will walk), added technical-approach comment with insertion-point line numbers (between README.md:191 and :207) + pricing-source guidance, labeled `ready`.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---
### 2026-06-06 14:58 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `a682dfa` | implementation | Issue #409 — `useHostedSpeechRecognition` hook | running |

**Spawned earlier this tick: 2 Workers (parallel)**

1. **Expansion Worker** — `43824af` for [#413 — docs README "Hosted STT (Deepgram)"](https://github.com/jpshackelford/voice-relay/issues/413) (`priority:low`, `scope:docs-only`)
   - Conversation: [`43824af`](https://app.all-hands.dev/conversations/43824afdafa44801a6f315f7506652b5)
   - **Already finished this tick** — see the preceding `14:56 UTC - Expansion Worker (issue #413)` entry. Reaped into `completed[]`.

2. **Implementation Worker** — `a682dfa` for [#409 — `feat(client): useHostedSpeechRecognition` hook](https://github.com/jpshackelford/voice-relay/issues/409) (`priority:low`, `scope:client-only`)
   - Conversation: [`a682dfa`](https://app.all-hands.dev/conversations/a682dfaeb6fe4243a79f4146e68e713e)
   - Chosen because it's the foundation for the rest of the #386 follow-up tree: #410 wires this hook into Kiosk/MobileMode, #411 propagates engine speaker labels, #412 builds the settings UI, #413 documents it. #410's expansion comment already flagged the `#409 first` dependency.

**Reaped Workers (this tick):**
- `cb181e6` (retroactive AC-Gate expansion for PR #402 / Issue #386) → `finished`. Outcome: filed follow-ups #409–#413, edited PR #402 body with `## Deferred to follow-ups`, re-opened #386 as the umbrella tracker. The earlier 14:33 UTC redundant second-pass run was a no-op as logged.
- `43824af` (expansion for #413) → `finished` mid-tick. Outcome: rewrote #413 body with 9 verifiable AC bullets, added README insertion-point comment, labeled `ready`.

**State Gathered:**
- **Open PRs:** 0.
- **Unexpanded eligible issues (no `on-hold` / `needs-human`):** none — `#413` was the only candidate and it's now `ready`.
- **Other unexpanded issues:** `#210`, `#239`, `#299`, `#300`, `#301`, `#302`, `#384` (all `on-hold`); `#372` (`needs-human`). Skipped per decision table.
- **Ready, prioritised eligible:** `#409` (now being implemented), `#410`, `#411`, `#412`, `#413` (all `priority:low`). Implementation slot is full; the rest queue for subsequent ticks.
- **Ready but skipped:** `#351`, `#363` (`on-hold`); **`#386`** — explicit umbrella tracker, now labelled `on-hold` ([issue comment](https://github.com/jpshackelford/voice-relay/issues/386#issuecomment-4639287479)) so the orchestrator does not re-dispatch it. It stays open and `ready` so it remains a visible tracker; will auto-close when all five follow-ups close.

**Action Taken:**
🚀 **Spawned 2 workers** (expansion #413 — already complete, implementation #409 — running). One of the two became productive within the tick (#413 expansion landed and pushed to main while this entry was being assembled), which forced an in-tick rebase and a second WORKLOG truncation pass.

**Housekeeping:**
- WORKLOG.md was 920 lines (after the #413 expansion entry from worker `43824af` landed on main) → re-ran truncation preserving the 6-hour productive window. Archived 17 entries (13 → `WORKLOG_ARCHIVE_2026-06-05.md`, 4 → `WORKLOG_ARCHIVE_2026-06-06.md`); WORKLOG.md now 209 lines, 9 entries.

**Quiet-tick counter:** reset to `0` (productive tick — 2 workers spawned + 1 reaped to completion).

**Production-impact:** none from this orchestrator action. Worker `a682dfa` will eventually open a draft PR for #409 (client-only hook + tests; no migration expected).

**Next tick expectations:**
- If `a682dfa` is still running → implementation slot stays full, expansion remains free. Decision table will yield "no expansion candidates, impl full, no PRs → quiet tick."
- If `a682dfa` is done with a PR open → review slot opens up.
- If `a682dfa` is done without a PR (failure / no work) → impl slot frees; orchestrator will dispatch the next priority issue (likely `#411` or `#412`, whichever doesn't depend on `#409` being merged first).

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

### 2026-06-06 15:03 UTC - Implementation Worker (issue #409)

✅ Shipped the `useHostedSpeechRecognition` hook — the client piece that PR #402 left out when shipping the Deepgram broker server-side.

| Field | Value |
|---|---|
| PR | [#419](https://github.com/jpshackelford/voice-relay/pull/419) — ready for review |
| Issue | [#409](https://github.com/jpshackelford/voice-relay/issues/409) |
| AC-gate verdict | **closes #409** (all 5 non-exempt AC items satisfied — both passes) |
| Follow-ups filed | none — gate was clean both passes |
| CI | green: Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title |
| Coverage on new file | 90.7% lines / 80.2% branches / 94.7% functions / 93.8% statements |
| Production impact | client-only; auto-deploys to vr.chorecraft.net on merge. No schema change. Hook is dormant until #410 wires it into KioskMode/MobileMode. |

**Implementation notes worth carrying forward:**

- Used `ScriptProcessorNode` rather than `AudioWorkletNode` (issue's technical-approach mentioned AudioWorklet). Reasoning: matches existing `useAudioStreaming` pattern, no separate worklet asset to ship, equivalent 16 kHz Int16 PCM output, easier to test in happy-dom. Documented in the file-level JSDoc with a future-swap pointer.
- Deepgram browser WS auth uses the sub-protocol field (`new WebSocket(url, ['token', key])`) — `Authorization: Token …` is not settable from browser JS. Worth knowing for the engine-selection wrapper (#410) in case it ever needs to peek at the connection.
- Speaker label mapping picks the dominant speaker per result, then maps `0→S1`, `1→S2`, … (human-readable). When Deepgram returns no diarization info, `speakerLabel` is `undefined` — the relay's `engineSpeakerLabel?: string` field on `TextMessage` already tolerates that.
- A clean `1000` close *after* `is_final` is treated as the normal stop path and NOT surfaced as an error. Without that guard every successful session would have ended in `onError`.
- Usage reporting is `Math.max(1, ceil((Date.now() - startedAt) / 60000))` — happy-dom returned `0` for sub-millisecond sessions in tests, but more importantly a session that opened the mic at all should count as ≥1 minute against the soft cap.

**Reflection (Step 11):** Verdict unchanged between the first and second AC-gate pass. The CI run added no new commits. Single-take implementation; the only mid-flight adjustment was the `Math.max(1, …)` floor for the usage-minutes path described above.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford as part of the implementation worker for #409._

---

### 2026-06-06 15:09 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `39df1fc` | implementation | Issue #411 — propagate `engineSpeakerLabel` (server agent-driver + kiosk ticker `S1:` prefix) | **NEW** |

**Reaped:** `a682dfa` (implementation, #409) → completed[]
- Outcome: Opened [PR #419](https://github.com/jpshackelford/voice-relay/pull/419) — feat(client): `useHostedSpeechRecognition` hook for hosted STT (Fixes #409).
- CI at reap: 8/9 checks COMPLETED (required green), only `pr-review` bot still `IN_PROGRESS`. No review comments yet. PR is not draft.

🚀 **Spawned: Implementation Worker** for [Issue #411](https://github.com/jpshackelford/voice-relay/issues/411)
- Conversation: [`39df1fc`](https://app.all-hands.dev/conversations/39df1fcb743f4c23a5732c5d78bff7b8)
- Rationale (decision-table application):
  - Impl slot freed by `a682dfa` finishing (execution_status=`finished` per OH API at 15:04Z).
  - Eligible ready/prioritized queue (after deferring #410 which depends on #409): **#411, #412, #413** — all `priority:low`. #411 chosen as lowest-numbered tiebreak.
  - Independence check: #411 touches `server/src/agent-message-relay.ts`, `server/src/agent-driver/voice-relay-header.ts`, and kiosk-ticker client components — disjoint from PR #419's `client/src/hooks/` footprint. No merge conflict surface.
  - Anti-stall rule: no codified gate (`## INSTRUCTION:`, `hold` label, AGENTS.md / skill policy) defers #411. The previous tick's "wait for #419" framing was advisory, not codified.

**Current State:**
- Open PRs: [#419](https://github.com/jpshackelford/voice-relay/pull/419) (Issue #409, awaiting pr-review bot to finish; no review comments yet)
- Active workers: 1 impl (#411). Expansion slots 4/4 free. Review slots 2/2 free.
- Ready issues queued behind impl: #410 (deferred — depends on #409 merging), #412, #413.
- All unexpanded open issues are `on-hold` or `needs-human` — no expansion eligible.

**Quiet-tick counter:** reset to 0 (productive tick — 1 reap + 1 spawn).

**Note on prior commit in this cycle:** Commit `2e854c8` set `quiet_ticks: 0 → 1` based on a snapshot taken before `a682dfa` pushed its final worklog entry (`c11cad7`) and flipped to `finished`. Re-checking the OH API caught the transition and turned this tick productive. State has been corrected to 0 in the same commit as the new worker.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford as part of the orchestrator tick._

---

### 2026-06-06 15:22 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `39df1fc` | implementation | Issue #411 — propagate `engineSpeakerLabel` (server agent-driver + kiosk ticker `S1:` prefix) → PR [#420](https://github.com/jpshackelford/voice-relay/pull/420) (draft) | running |
| `97d4ead` | review | PR [#419](https://github.com/jpshackelford/voice-relay/pull/419) — `useHostedSpeechRecognition` hook | **NEW** |

🚀 **Spawned: Review Worker** for [PR #419](https://github.com/jpshackelford/voice-relay/pull/419) (`feat(client): useHostedSpeechRecognition hook for hosted STT`, Fixes #409)
- Conversation: [`97d4ead`](https://app.all-hands.dev/conversations/97d4ead55ea74e4990d2915eeb4dff01) — verified `execution_status=running`, `sandbox_status=RUNNING` at 15:22Z.
- Plugin ref: `voice-relay-workflow @ main`.
- Rationale: PR #419 is ready (not draft), all required CI green (Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title; `pr-review` SUCCESS), but carries **1 unresolved review thread** from the `pr-review` bot — a 🟡 Suggestion that a comment in `useHostedSpeechRecognition.ts` referencing "the live ref pattern above" is confusing because `workspaceId` and `deviceId` aren't refs. Per the decision table (REVIEW_AVAILABLE=2, PR needs review with 💬>0), dispatching a review worker is the correct action.

**Current State:**
- **Open PRs (2):**
  - [#419](https://github.com/jpshackelford/voice-relay/pull/419) — Fixes #409, ready, 1 unresolved 🟡 suggestion thread, `mergeable=UNKNOWN` (GitHub still computing), no human reviews. **Now being addressed.**
  - [#420](https://github.com/jpshackelford/voice-relay/pull/420) — Fixes #411, draft, `mergeable=MERGEABLE`, CI 6/7 green (E2E Tests `IN_PROGRESS`). In flight under impl worker `39df1fc`.
- **Active workers:** 1 impl (`39df1fc` on #411), 1 review (`97d4ead` on #419), 0 expansion. Slot accounting: expansion 0/4, implementation 1/1 (full), review 1/2.
- **Unexpanded eligible issues:** 0 — every open unexpanded issue is `on-hold` (#210, #239, #299–#302, #384) or `needs-human` (#372). No expansion to dispatch.
- **Ready, prioritised, eligible queue (behind impl slot):** #410 (depends on #409 / PR #419 merging first), #412, #413 — all `priority:low`. Cannot dispatch this tick.
- **Ready, skipped:** #351, #363, #386 (umbrella) — all `on-hold`.

**Decision rationale:**
- Impl slot full → cannot dispatch more impl. The eligible ready/prioritised queue (#410, #412, #413) waits for either #411 → PR #420 to land, or for a future tick where the impl slot frees.
- Review slot 1/2 available → PR #419 has 1 unresolved 🟡 suggestion → spawn review worker. The single bot-only "Suggestion" is advisory and the worker prompt explicitly authorises a respectfully-decline-with-reply outcome if the suggestion is a nit; the worker will also re-run the closing-trailer AC gate.
- Anti-stall rule: no codified gate (`## INSTRUCTION:`, `hold` label, AGENTS.md / skill policy) defers PR #419's review pass.

**Quiet-tick counter:** reset to `0` (productive tick — 1 review worker spawned).

**Production-impact:** none from this orchestrator action. The review worker may push a docs/comment-only follow-up commit to PR #419's branch; that does not auto-deploy until PR #419 merges. PR #420 (separate impl worker) is still draft and isolated to server agent-driver + kiosk ticker paths — disjoint from PR #419's client `hooks/` footprint, so no conflict surface.

**Next tick expectations:**
- If `97d4ead` finishes with PR #419 back to ready and CI green / 0 unresolved threads → review slot frees up and a merge worker can be dispatched.
- If `39df1fc` finishes with PR #420 moved to ready → review slot still has capacity (1/2 → 2/2 absorbable) for a parallel review round on #420.
- The eligible queue (#410 blocked on #419 merge; #412, #413 free) will start dispatching once the impl slot frees.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-06 15:23 UTC - Implementation worker (issue #411 → PR #420)

✅ **Implemented issue #411** — `feat(server,client): propagate engineSpeakerLabel through agent driver + render kiosk ticker S1: prefix` (follow-up to PR #402 / issue #386).

**PR:** https://github.com/jpshackelford/voice-relay/pull/420 (ready for review)
**Branch:** `feat/411-engine-speaker-label-propagation`
**Trailer:** `Fixes #411`

| Layer | Change |
| --- | --- |
| Server | `AgentSenderMeta.engineSpeakerLabel` added; `voice-relay-header.ts` emits `[speaker engine=<label>]` as fallback when `sender.speaker` is unresolved; resolved speaker still wins; per-device `deviceEngineSpeakerLabel` suppression map mirrors the existing `deviceSpeakerId` map. `index.ts` forwards the field on the `sender` literal. |
| Client | `RelayedTextMessage` + `Utterance` extended with `engineSpeakerLabel?: string`; threaded through `SessionView.handleTextMessage` / `handleHistoryMessage` and the same handlers in `Workspace.tsx`; `KioskMode.transcriptionTicker` memo prefers the engine label over `senderName` when set. |
| Tests | +8 cases on `voice-relay-header.test.ts`, +1 on `agent-message-relay.test.ts`, +3 on `KioskMode.test.tsx` (S1 prefix, Web-Speech regression guard, post-resolution flip). |

**AC-gate verdict:** ✅ all in-scope items in #411 (inherited Message-pipeline group from #386) satisfied → trailer is `Fixes #411`. No follow-up issues filed.

**CI:** Server Tests / Client Tests / Build Client / E2E Tests / lint-pr-title — all green on `dd42e5a`. `pr-review` skipped on draft (will re-trigger now that PR is ready).

**Production impact:** auto-deploys to vr.chorecraft.net on merge. Server agent-driver header gains a `[speaker engine=…]` line only when hosted-STT is configured AND `session_engine_speakers` hasn't resolved the label yet — Web-Speech sessions are untouched (explicit regression-guard test). Kiosk ticker shows `S1: …` before resolution and falls back to `senderName: …` after — both paths covered by tests.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-06-06 15:35 UTC - Review worker (PR #419, review round 1)

✅ Addressed review feedback on [PR #419](https://github.com/jpshackelford/voice-relay/pull/419) (`feat(client): useHostedSpeechRecognition hook for hosted STT`, Fixes #409).

**Threads addressed (1):**

| Thread | Reviewer | Severity | Action | Commit |
|---|---|---|---|---|
| Confusing "live ref pattern above" comment in unmount `useEffect` (line 552–556) | `github-actions` (pr-review bot) | 🟡 Suggestion | Accepted — comment was misleading: `workspaceId`/`deviceId` are closure-captured via `cleanup`'s own `useCallback` deps, not via the live-ref pattern (which only solves callback staleness around lines 263–271). Reworded to call out closure capture, intent of empty deps array, and separation from the callback live-ref pattern. | `82accbf` |

**AC-gate re-run (Issue #409):** **unchanged** — verdict remains `Fixes #409`.

Change was a single-comment rewording in `client/src/hooks/useHostedSpeechRecognition.ts`; none of #409's 5 AC items (hook surface, callback surface, fallback-eligible errors, mic+WS release, lifecycle tests) are affected by a docs-only edit. All still satisfied by the diff.

**CI:** Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title — all green on `82accbf`. `pr-review` skipped while in draft; will re-trigger now that PR is ready.

**No follow-up issues filed.** No new learnings impacting other open issues.

PR moved back to ready; next review round (if any) is a separate conversation.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-06-06 15:40 UTC - Merge worker (PR #419)

✅ Merged [PR #419](https://github.com/jpshackelford/voice-relay/pull/419) — `feat(client): useHostedSpeechRecognition hook for hosted STT` — squash commit `a8a1561`.

**Closing-Trailer AC Gate (Issue #409): PASSED**

| AC item | Evidence |
|---|---|
| Hook surface `{ isListening, isSupported, startListening, stopListening, error }` matches `useSpeechRecognition` | `UseHostedSpeechRecognitionReturn` (line 89) + return at line 563 of `client/src/hooks/useHostedSpeechRecognition.ts` |
| `onInterimResult(text, speakerLabel)` / `onFinalResult(text, speakerLabel)` callbacks | Options interface lines 80–81; dominant-speaker mapping in `dominantSpeakerLabel` |
| Network errors surface fallback-eligible error for Web Speech downgrade | `tokenMintErrorFromStatus` + WS-close / WS-error / network-failure paths; `fallbackEligible: true` on 5xx / network / mid-stream close |
| Releases mic + WebSocket on `stopListening` and on unmount | `cleanup()` invoked from `stopListening` (line 542) and unmount `useEffect` (line 550) |
| Lifecycle tests at `client/src/hooks/useHostedSpeechRecognition.test.ts` | 27 tests covering cold-start, stop, unmount, full token-mint matrix, mic-denial, mid-stream WS close, WS error, clean close after final, swallowed usage failure |

All 5 non-exempt AC items covered → gate passes; trailer `Fixes #409` honored.

**Migration check:** client-only diff (`useHostedSpeechRecognition.ts` + tests). No schema / migration files touched — production SQLite is unaffected, auto-deploy to vr.chorecraft.net safe.

**Issue #409:** already `CLOSED` (`COMPLETED`) at 2026-06-06T15:04:37Z prior to merge; no manual close needed.

**Pre-merge state:** `MERGEABLE / CLEAN`, 0 unresolved review threads, required CI all green (Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title / pr-review).

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-06-06 15:42 UTC - Review worker (PR #420 round 1)

✅ **PR #420** — `feat(server,client): propagate engineSpeakerLabel through agent driver + render kiosk ticker S1: prefix (Fixes #411)` — addressed 1st review round.

| Thread source | Severity | Count | Disposition |
| --- | --- | --- | --- |
| `pr-review` bot | 🟡 Suggestion | 7 | All accepted (verbose / redundant comments) |

**Commits pushed:**

- `b859de3` — `style(server): trim verbose comments in voice-relay-header` (threads ×2 on `server/src/agent-driver/voice-relay-header.ts`)
- `d574f1f` — `style(client): trim verbose engineSpeakerLabel comments` (threads ×1 KioskMode + ×2 SessionView + ×2 Workspace)

All 7 threads replied + resolved via GraphQL. CI green (Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title). PR moved back to ready.

**AC gate re-run:** **unchanged** — trailer remains `Fixes #411`. Round was comment-only with no behavior change; both in-scope AC bullets inherited from #386 (agent driver receives engine label on user-turn header; kiosk ticker renders `S1: …` prefix) still satisfied by the now-current diff. No follow-up issues filed or closed.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---

### 2026-06-06 15:53 UTC - Merge worker (PR #420 / Issue #411)

✅ Squash-merged [PR #420](https://github.com/jpshackelford/voice-relay/pull/420) — `feat(server,client): propagate engineSpeakerLabel through agent driver + render kiosk ticker S1: prefix`. Merge commit `90c7fa2`. Issue #411 auto-closed at 2026-06-06 15:53:30Z by the `Fixes #411` trailer.

**Pre-merge state at 15:50 UTC tick:** `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE`, isDraft=false, 7 review threads all RESOLVED, required checks all green (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, enable-orchestrator, pr-review).

**Closing-Trailer AC gate (re-walked at merge time, hard gate):** **PASS** — `Fixes #411` retained.

| Inherited AC bullet from #386 (Message pipeline group) | Verdict on PR #420 final diff |
|---|---|
| Server relays the label unchanged; **agent driver receives it on the user-turn header** | ✅ `AgentSenderMeta.engineSpeakerLabel` plumbed from `server/src/index.ts` → `relayAgentResponse` → `buildVoiceRelayHeader` → `[speaker engine=<label>]` fallback; 8 new `voice-relay-header.test.ts` cases + 1 new `agent-message-relay.test.ts` case cover emit / suppress / resolved-wins / engine-only-after-unclaim / sanitize / forwarding. |
| **Kiosk ticker prefix (#382) renders `S1: …` until the label is linked to a real speaker** | ✅ `client/src/types.ts` adds `engineSpeakerLabel?: string` to `RelayedTextMessage` / `Utterance`; `SessionView.tsx` + `Workspace.tsx` thread it through `handleTextMessage` / `handleHistoryMessage`; `KioskMode.transcriptionTicker` prefers `engineSpeakerLabel` over `senderName`. 3 new `KioskMode.test.tsx` cases incl. the Web-Speech regression guard. |

No `## INSTRUCTION:` override was needed — gate passed cleanly on its merits.

**Migration check:** N/A — diff is 10 files, all `.ts`/`.tsx`, no `server/src/db/migrations/` files and no `.sql`. Additive optional fields only (`engineSpeakerLabel?: string`), so production SQLite is unaffected.

**Production-impact:** vr.chorecraft.net will auto-deploy this merge. Behavioural changes are scoped to hosted-STT sessions (Deepgram path) — Web-Speech sessions are explicitly covered by the regression guard test (no engine label → renders `senderName: …` exactly as before). No env-var or secret changes required.

**Follow-ups still open from the #386 retro-gate fan-out:** #410, #412, #413. #409 is being handled in PR #419 (still open at this merge).

_This worklog entry was written by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---


### 2026-06-06 15:56 UTC - Orchestrator (manual /orchestrate)

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0874f34` | expansion | Issue #421 — Smoke test failure after deployment | **NEW** |
| `fbf942c` | implementation | Issue #410 — engine selection in Kiosk/MobileMode | **NEW** |

🚀 **Spawned: 2 workers (parallel) + 1 spawned-and-completed within the tick**

**Reaped finished workers (and one self-resolving spawn):**
- `39df1fc` (implementation, Issue #411) — finished. Opened PR #420 → squash-merged at `15:54:37Z` by the merge worker spawned below.
- `97d4ead` (review, PR #419) — finished. PR #419 (`useHostedSpeechRecognition` hook) squash-merged at `15:39:56Z` (Fixes #409); Issue #409 auto-closed.
- `a5a42ea` (merge, PR #420) — spawned at the top of this tick and finished within ~2 min. Squash-merged PR #420 (commit `90c7fa2`); Issue #411 auto-closed. See sibling WORKLOG entry `15:54 UTC - Merge worker (PR #420)`.

**Dispatched this tick (still running):**

1. **Expansion Worker** for [Issue #421 — 🚨 Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/421)
   - Conversation: [`0874f34`](https://app.all-hands.dev/conversations/0874f34553774f3b93d6669c3851d926)
   - Routing: expansion slot — newly auto-filed by `github-actions` at `15:42:37Z`; smoke test failed at commit `a8a1561`, automatic rollback to `92c8bea`. Worker will inspect [workflow run 27066534570](https://github.com/jpshackelford/voice-relay/actions/runs/27066534570), correlate with recent merges, and either expand to `ready` (+ `priority:high` if real) or downgrade to `needs-human`.

2. **Implementation Worker** for [Issue #410 — feat(client): engine selection (Deepgram vs Web Speech) in Kiosk/MobileMode](https://github.com/jpshackelford/voice-relay/issues/410)
   - Conversation: [`fbf942c`](https://app.all-hands.dev/conversations/fbf942cc8aed4dd18b3894ddbad47c0a)
   - Routing: implementation slot — oldest `ready` + `priority:low` + actionable issue (no `on-hold`/`needs-human`). Worker was briefed about co-pending PR #420 (now merged) so a rebase against fresh main should be clean.

**Current State (post-tick):**

- **Open PRs**: none. PR #420 merged at `15:54:37Z`; PR #419 merged at `15:39:56Z` earlier.
- **Issues needing expansion (actionable)**: [#421](https://github.com/jpshackelford/voice-relay/issues/421) — expansion in flight. All other expansion candidates remain `on-hold` (Path B / S3 design freeze per AGENTS.md — #299–#302, #210, #239, #384) or `needs-human` (#372).
- **Ready issues (actionable, not yet implemented)**: #412, #413 — left in queue for next tick (impl slot consumed by #410). All other ready issues are `on-hold` (#351, #363, #386).
- **Quiet ticks**: reset to `0` (productive tick: 3 spawns + 3 reaps + 1 merge to main via merge worker).

**Anti-stall note:** Per the orchestrate skill, the decision table is exhaustive — no codified `## INSTRUCTION:` block, `hold` label, or AGENTS.md / skill policy currently defers PR #420, Issue #421, or Issue #410. All three were dispatched without an override gate.

_This worklog entry was written by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---

### 2026-06-06 15:56 UTC - Implementation worker (Issue #412)

✅ Opened [PR #422](https://github.com/jpshackelford/voice-relay/pull/422) — `feat(client): workspace settings UI for hosted STT engine, cap, key, and usage`. Marked ready-for-review after all required CI checks green (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, enable-orchestrator).

**AC-gate verdict: PASS — trailer `Fixes #412`.** All seven non-exempt AC items satisfied by concrete changes in the diff:

| AC item | Where in diff |
|---|---|
| Usage + cap on workspace settings page | `stt-usage-setting` + `stt-cap-setting` rows in `WorkspaceHome.tsx` |
| Engine selector (web-speech / deepgram) | `stt-engine-setting` radio group |
| Deepgram API key entry/clear mirroring ElevenLabs | `deepgram-api-key-setting` reusing `.api-key-*` CSS classes |
| Monthly minute-cap input (integer or "no cap") | `stt-cap-input` with empty ⇒ `null` semantics + client-side integer validation |
| `/api/stt/usage` read + hide row when engine is `web-speech` | `fetchSttUsage` effect short-circuits on web-speech; usage row gated on `sttEngine === 'deepgram'` |
| Owner gate | All new rows live inside the existing `{workspace.isOwner && (<section className="settings-section">…)}` wrapper |
| `WorkspaceHome.test.tsx` covering engine flip / cap entry / key set+clear / usage display | New file with 8 tests; full client suite at 1094 tests still green |

Hook surface additions (`useWorkspaceSettings`): `sttEngine`, `sttMonthlyMinuteCap`, `hasDeepgramApiKey` fields; `setDeepgramApiKey` / `removeDeepgramApiKey` / `fetchSttUsage` methods; new `SttUsage` type. 13 new hook tests cover PUT/DELETE/GET error fallbacks, URL-encoded `workspaceId`, no-id guards, and PATCH with `sttEngine` + `sttMonthlyMinuteCap` including explicit-null cap-clear.

No follow-up issues filed; nothing deferred. Per-device override UI (#386 § Out of Scope) and the streaming-hook/KioskMode wiring (separate follow-ups, incl. #411 already merged via #420, #409 in flight via #419) remain explicitly out of scope per #412 § Scope notes.

**Coordination:** No file collisions with PR #419 (`useHostedSpeechRecognition`) — that work is on a new hook file and `KioskMode.tsx`. PR #420 already merged; its `engineSpeakerLabel` plumbing touches different files. Rebase-on-merge unlikely to need anything beyond a fast-forward.

_This worklog entry was written by an AI agent (OpenHands implementation worker) on behalf of @jpshackelford._

---

### 2026-06-06 15:59 UTC - Expansion Worker (CI-failure triage #421)

✅ **Expanded Issue #421** (auto-filed by smoke-test failure on `a8a1561`, rolled back to `92c8bea`)

- Issue: [🚨 Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/421)
- Type: CI failure (deploy gate)
- Root cause: Smoke test at `tests/smoke/ai-integration.spec.ts:290` calls `GET /api/ai/status`, which was deleted in PR #408 / #404. The endpoint now returns `404 {"error":"Not found"}`, so `status.available` is permanently `undefined` and the `if (status.available) test.skip(...)` guard never fires. The test then asserts `.ai-status` is hidden against `workspaces[0]`, which on production happens to be a workspace whose `useAI` reducer is broadcasting `state: 'starting'` from a real auto-connect. PR #419 did NOT cause the regression — it only added two new files (`useHostedSpeechRecognition.ts` + test). The test became a non-deterministic probe of OpenHands cloud runtime state the moment #408 merged at `e68580d` (00:13 UTC). At `e68580d` smoke-time the workspace happened to be idle; 15h later at `a8a1561` smoke-time it was actively connecting.
- Proposed fix (Option 1, low-risk): mark the failing `test(...)` as `test.skip(...)` with a comment pointing at #421 — same approach as #238/#239 for other AI-API-dependent smoke tests. Follow-up (Option 2): introduce a `getAIDisabledWorkspace(page)` helper that picks a workspace without an OpenHands API key and assert hidden against *that*, recovering the original test intent without depending on the deleted endpoint.
- Labels applied: `ready`, `priority:high`, `scope:ci-only` (deploy gate is currently blocked — rollback already fired)
- Files affected (Option 1): `tests/smoke/ai-integration.spec.ts` only; no server / client / migration changes.

_This worklog entry was written by an AI agent (OpenHands expansion worker) on behalf of @jpshackelford._

---

### 2026-06-06 16:08 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `fbf942c` | implementation | Issue #410 — engine selection in Kiosk/MobileMode | running |
| `64a10a2` | review | PR #422 — workspace settings UI for hosted STT (#412) | **NEW** |

**Worker Completed:** `0874f34` (expansion)
- Issue #421 (🚨 Smoke test failure after deployment) now `ready` + `priority:high`.
- Will be picked up by the implementation slot once `fbf942c` (Issue #410) finishes.

🚀 **Spawned: Review Worker**
- PR: [#422 — feat(client): workspace settings UI for hosted STT engine, cap, key, and usage](https://github.com/jpshackelford/voice-relay/pull/422) (Fixes #412)
- Conversation: [`64a10a2`](https://app.all-hands.dev/conversations/64a10a244c5c44d08a93fb192b647a07)
- Trigger: 5 unresolved 🟡 Suggestion threads from `github-actions` review bot on `useWorkspaceSettings.ts` + `WorkspaceHome.tsx`, all asking to drop `Issue #412:` change-history comments and redundant doc comments. Legitimate per AGENTS.md / global code-quality guideline.
- AC-gate re-run expected to be **unchanged** (comment-only diff, behavior unchanged) → `Fixes #412` trailer stays.

**Current State:**
- Open PRs: [#422](https://github.com/jpshackelford/voice-relay/pull/422) — `oR` green ready 💬5 (now being addressed).
- Ready + actionable issues: #421 (priority:high, awaits impl slot), #410 (in-progress via `fbf942c`), #412 (PR open), #413 (priority:low, awaits impl slot).
- Ready + blocked (on-hold/needs-human): #351, #363, #386.
- Needs-expansion + blocked: #210, #239, #299–#302, #372, #384. **No actionable expansion candidates** this tick.

**Slot summary after this tick:** expansion 0/4, implementation 1/1, review 1/2.

**Action Taken:** 🚀 Spawned 1 review worker for PR #422; reaped expansion worker `0874f34` (Issue #421 → ready). Implementation slot remains held by `fbf942c` on #410 (priority:low); #421 (priority:high) will be dispatched on the next tick after `fbf942c` returns. No INSTRUCTION blocks left to action (the retroactive AC-gate INSTRUCTION at 14:26Z was already `[ACKNOWLEDGED 2026-06-06]` and executed by conversation `cb181e6`).

---

### 2026-06-06 16:09 UTC - Implementation Worker (Issue #410 → PR #423)

✅ **Completed:** Issue #410 — engine selection (Deepgram vs Web Speech) in Kiosk/MobileMode.

- **PR:** [#423 — feat(client): engine selection (Deepgram vs Web Speech) in Kiosk/MobileMode](https://github.com/jpshackelford/voice-relay/pull/423)
- **Branch:** `feat/410-engine-selection-modes` (branched from current `main`; #420 was still open at branch time but touches the message-pipeline layer, not STT hooks — no conflict surface).
- **AC-Gate verdict:** all non-exempt items SATISFIED → `Closes #410`. Re-ran the gate against the final diff after CI green (Step 11 reflection) — verdict unchanged.

| AC item | Status |
|---|---|
| `KioskMode.tsx` / `MobileMode.tsx` select hook based on resolved `stt_engine` without conditional-hook violations | ✅ SATISFIED via `useSttEngine` wrapper that always calls both child hooks |
| Hosted-engine failure → transparent fallback to Web Speech + one-time warning | ✅ SATISFIED — `useSttEngine.handleHostedError` flips `effectiveEngine='web-speech'`, deduped via `useRef<boolean>`, auto-restarts WS if user was listening; 402/503 additionally banner via `onError` |

**Notes:**

- Small additive server change: `GET /api/workspaces/:id/kiosk-config` now also returns `sttEngine`. Anonymous-safe; no migration needed (the column existed since #402's migration 019).
- Per-device override (`device.config.stt_engine`) is documented in the resolution chain for forward-compat but always `undefined` today — exposing it requires UI work that #386 / #402 ruled out-of-scope. No follow-up needed; #412 (workspace-settings UI) is the natural next consumer.
- New hook coverage: 100% lines/funcs/stmts, 97% branches.
- CI: Server Tests / Client Tests / Build Client / E2E Tests / lint-pr-title / enable-orchestrator all green at marking-ready time.
- No follow-ups filed.

---

### 2026-06-06 16:18 UTC - Review Worker (PR #422)

✅ **Completed:** Addressed all 5 unresolved review threads on PR #422 (feat(client): workspace settings UI for hosted STT engine, cap, key, and usage — Fixes #412).

- **Commit:** `4b32b94` — `style(client): trim redundant change-history comments per PR #422 review`
- **Diff:** 4 insertions / 10 deletions across `client/src/hooks/useWorkspaceSettings.ts` (lines 84, 89, 94, 355) and `client/src/pages/WorkspaceHome.tsx` (lines 331, 344, 447). No behavior change.
- **Review threads:** all 5 replied to (referencing the fix commit SHA) and resolved via the `addPullRequestReviewThreadReply` + `resolveReviewThread` GraphQL mutations. All were 🟡 Suggestions from @github-actions about removing `Issue #412:` change-history prefixes and comments that just restate self-documenting code — accepted in full as legitimate per AGENTS.md code-quality guidance.
- **CI:** Server Tests / Client Tests / Build Client / E2E Tests / lint-pr-title all green on `4b32b94`.
- **AC gate re-run: unchanged.** Comment-only diff → verdict remains **PASS — `Fixes #412` retained**. The AC table in the PR description (engine selector, Deepgram key entry/clear, monthly minute-cap input, usage row, owner gating, `WorkspaceHome.test.tsx` coverage) is satisfied by the same code that landed in earlier commits; no AC bullet was touched by the cleanup.
- **PR state:** dropped to draft during fix, returned to `ready` after the closing comment was posted. Closing comment: <https://github.com/jpshackelford/voice-relay/pull/422#issuecomment-4639627002>.

---

### 2026-06-06 16:23 UTC - Orchestrator

🚀 **Spawned: 3 Workers (parallel)** — both prior workers finished, all 3 slot types had work.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `a9fd499` | implementation | Issue #421 - 🚨 Smoke test failure after deployment (priority:high) | **NEW** |
| `49ca8be` | review (merge) | PR #422 - workspace STT settings UI (closes #412) | **NEW** |
| `0544110` | review | PR #423 - engine selection (Deepgram vs Web Speech) (closes #410) | **NEW** |

**Workers Completed Last Cycle:**
- `fbf942c` (implementation, issue #410) → finished — produced PR #423.
- `64a10a2` (review, PR #422) → finished — addressed 5 threads, AC gate re-run unchanged.

**Current State:**
- [PR #422](https://github.com/jpshackelford/voice-relay/pull/422): `oRFc` green ready 💬-- — **all threads resolved, CI green, mergeable: CLEAN** → merge worker dispatched.
- [PR #423](https://github.com/jpshackelford/voice-relay/pull/423): `oR` green ready 💬3 — 1 important race-condition + 2 suggestions → review worker dispatched.
- Issue #421 (priority:high, ci-failure, scope:ci-only) — root-caused (deleted `/api/ai/status` probe, `undefined` skip-guard) → impl worker dispatched.
- Other ready, non-on-hold issues: #413 (docs, priority:low) — left for next cycle.

**Spawned Conversations:**
1. **Merge Worker** — [`49ca8be`](https://app.all-hands.dev/conversations/49ca8beb789b4144b8bf480deecb2861) → [PR #422](https://github.com/jpshackelford/voice-relay/pull/422)
2. **Review Worker** — [`0544110`](https://app.all-hands.dev/conversations/054411040e2f43ed96ae993254556d26) → [PR #423](https://github.com/jpshackelford/voice-relay/pull/423)
3. **Implementation Worker** — [`a9fd499`](https://app.all-hands.dev/conversations/a9fd499abf2642a3bf3d7f55b60b2f8a) → [Issue #421](https://github.com/jpshackelford/voice-relay/issues/421)

**Slot Usage:** expansion 0/4, implementation 1/1, review 2/2 — fully booked.

_This worklog entry was created by an AI agent (OpenHands orchestrator) on behalf of @jpshackelford._

---


### 2026-06-06 16:24 UTC - Merge worker (PR #422 → main)

✅ **Merged.** PR #422 (`feat(client): workspace settings UI for hosted STT engine, cap, key, and usage`) squash-merged to `main` as [`cec97cc`](https://github.com/jpshackelford/voice-relay/commit/cec97cc553f1ef247e75019bbaba3649ebfdbbd9). Auto-deploys to vr.chorecraft.net.

**Pre-merge checks:**
- CI: all 7 checks green (Build Client, Client Tests, Server Tests, E2E Tests, lint-pr-title, enable-orchestrator, pr-review).
- Review threads: 5/5 resolved (all comment-cleanup suggestions addressed by review worker `64a10a2`).
- Mergeable: `CLEAN`. No conflicts.
- Migration check: **N/A — client-only diff.** Files touched: `client/src/hooks/useWorkspaceSettings.{ts,test.ts}`, `client/src/pages/WorkspaceHome.{tsx,test.tsx}`. No server, schema, or migration files. Production SQLite deploy is safe.

**Closing-Trailer AC Gate (Issue #412): PASS.**

Trailer = `Fixes #412`. Walked the 7 non-exempt AC items from #412 against the final diff:

| AC item | Status | Diff anchor |
| --- | --- | --- |
| Workspace settings page shows current month's usage + configured cap | ✅ | `stt-usage-setting` + `stt-cap-setting` rows in `WorkspaceHome.tsx` |
| Engine selector (`web-speech` vs `deepgram`) | ✅ | `stt-engine-setting` radio group |
| Deepgram API key entry / clear control (mirror ElevenLabs) | ✅ | `deepgram-api-key-setting` row + `setDeepgramApiKey` / `removeDeepgramApiKey` |
| Monthly minute-cap input (integer or "no cap") | ✅ | `stt-cap-setting` number input; empty ⇒ `null` |
| Read usage from `GET /api/stt/usage`; hide row when engine is `web-speech` | ✅ | `fetchSttUsage` effect; test asserts `queryByTestId('stt-usage-setting')` is null on web-speech |
| Owner-gated controls | ✅ | All new rows inside existing `{workspace.isOwner && (<section …>)}` wrapper |
| `WorkspaceHome.test.tsx` covering engine flip, cap, key set/clear, usage | ✅ | New file, 8 tests |

Exempt (per #386 / #412 scope notes): per-device override UI, KioskMode/MobileMode streaming hook wiring (tracked separately under #409, #411).

**Post-merge state:**
- Issue #412 auto-closed by GitHub at `2026-06-06T16:24:28Z` via `Fixes` trailer. ✅ Verified.
- No follow-up issues filed (gate passed cleanly).
- vr.chorecraft.net auto-deploy will pick up the change on the next deploy cycle.

_This worklog entry was created by an AI agent (OpenHands merge worker) on behalf of @jpshackelford._

---
