# Voice Relay Worklog

## Log

### 2026-06-09 23:47 UTC - Orchestrator (manual /orchestrate)

🔒 **Auto-disabled (re-disable) due to continued inactivity** — 3rd consecutive quiet tick.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none)  | -    | -          | -      |

**Wake-up context:** manual `/orchestrate` invocation by @jpshackelford. The previous tick (22:33Z) had already auto-disabled automation `5f180989-ed9c-42b4-ac9f-5f30f0623316` after 2 consecutive quiet ticks. Between then and this tick, @jpshackelford opened **draft PR #467** (`fix(client): iOS Safari STT — addpipe-pattern restart loop on the same recognition instance`), which triggered the repo's `enable-orchestrator.yml` workflow and re-enabled the automation (verified via API: `enabled: true` at wake-up). However, PR #467 is `isDraft: true` and human-authored — **not orchestrator-actionable** (orchestrator review/merge workers only pick up non-draft PRs). No state changed materially from the 22:33Z snapshot.

**Current State:**
- Open PRs (both human-authored drafts — not actionable):
  - [PR #467](https://github.com/jpshackelford/voice-relay/pull/467) — `fix(client): iOS Safari STT — addpipe-pattern restart loop on the same recognition instance` — `isDraft: true`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, no labels. Author @jpshackelford.
  - [PR #465](https://github.com/jpshackelford/voice-relay/pull/465) — `docs(tvos): per-file issue drafts for tvOS backend gaps` — `isDraft: true`, `mergeable: MERGEABLE`, `mergeStateStatus: UNSTABLE`, no labels. Author @jpshackelford.
- Issues needing expansion: **0**.
- Ready+unblocked issues: **0**.
- All 8 open issues are non-actionable: same partition as 22:33Z (prose-only `on-hold`: #210, #239, #386; S3-freeze `on-hold`: #299, #300, #301, #302; `needs-human`: #372).

**Unblock pass:** ran; **0 issues lifted**.

| Issue | Blockers (state)       | Mechanical lift? | Policy override |
| ----: | ---------------------- | ---------------- | --------------- |
|  #299 | #298=CLOSED            | yes              | **AGENTS.md S3 design freeze (lines 71–106)** holds — no `## INSTRUCTION:` block has signaled the lift. |
|  #301 | #295=CLOSED            | yes              | Same S3 freeze override. |
|  #300 | #298=CLOSED, #299=OPEN | no               | Machine-blocked; plus S3 freeze. |
|  #302 | #300=OPEN              | no               | Machine-blocked; plus S3 freeze. |
|  #210, #239, #386 | (prose-only on-hold) | n/a | Policy holds — untouched. |
|  #372 | (n/a — `needs-human`)  | n/a              | Untouched. |

**Action Taken:**
🔒 Re-disabled automation `5f180989-ed9c-42b4-ac9f-5f30f0623316` via `PATCH /api/automation/v1/{id}` — confirmed `enabled: false` in response. Quiet-tick counter advanced `2 → 3` (third consecutive quiet tick; auto-disable threshold remains satisfied).

**Anti-stall note:** decision table walked exhaustively. PR #467 carries no `on-hold`/`needs-human`/`blocked` labels but is a human-authored draft — orchestrator review/merge workers do not pick up drafts. PR #465 same. All `on-hold` issues are codified gates (S3 freeze in AGENTS.md, prose-only policy holds, `needs-human`) per the "Anti-Stall: Decision Table is Exhaustive" section. No `## INSTRUCTION:` override block in WORKLOG.md.

**Quiet-tick counter:** `2 → 3` (quiet — auto-disable re-applied).

**To re-enable:**
- OpenHands UI: https://app.all-hands.dev/automations → Find "Voice Relay Workflow Orchestrator v2" → Toggle enable
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```
- Or mark a draft PR `ready_for_review` / open a new issue — `enable-orchestrator.yml` will PATCH the automation back to `enabled: true`. Note that the re-enable will be a no-op against the current backlog until either (a) PR #467 / PR #465 is marked ready, (b) the S3 freeze conditions in AGENTS.md are met and an `## INSTRUCTION:` lifts #299/#301, (c) #372 is unblocked by a human, or (d) new issues are filed.

_This entry was created by an AI agent (OpenHands orchestrator, manual /orchestrate) on behalf of @jpshackelford._

---
### 2026-06-10 12:14 UTC - Orchestrator (manual /orchestrate)

✅ **Promoted PR #467 to ready (inline, no worker spawned)**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | - | - | - |

**Action Taken:**
✅ `gh pr ready 467` — promoted [PR #467 — fix(client): iOS Safari STT — addpipe-pattern restart loop on the same recognition instance](https://github.com/jpshackelford/voice-relay/pull/467) from draft to ready.

**Why inline promotion (per decision-tree review-slot row):**
- `isDraft: true` (was) → now `false`.
- No `on-hold`/`needs-human`/`blocked`/`needs-info` label.
- CI: 7/7 SUCCESS (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, enable-orchestrator; pr-review SKIPPED while draft, will fire on next webhook now that the PR is ready).
- `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`.
- AI-authored body (PR #467 was opened by an OpenHands impl-worker conversation on behalf of @jpshackelford and left in draft) — exactly the "impl worker exited before flipping to ready" case the decision tree calls out. Single `gh pr ready 467` call, no review slot consumed.

**Current State:**
- Open PRs: 2
  - **[PR #467](https://github.com/jpshackelford/voice-relay/pull/467)** — _just promoted_; pr-review bot will run on next webhook tick. Next orchestrator tick can dispatch a review worker if `💬 > 0`, or a merge worker if approved & green.
  - [PR #465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` (tvOS per-file issue drafts, human-authored). Skipped per decision-tree "STUCK PR" row; orchestrator does not auto-promote drafts carrying `on-hold`.
- Open issues: 8 — every one still `on-hold` or `needs-human` (same backlog as 2026-06-09 23:47Z tick).
  - `needs-human`: #372.
  - `on-hold`: #386, #302, #301, #300, #299, #239, #210.
- `ready`+unblocked+prioritized: 0.
- Issues needing expansion: 0.

**Unblock pass (mechanical `Blocked by #N` only):**

| Issue | Blockers (state)       | Mechanical lift? | Policy override |
| ----: | ---------------------- | ---------------- | --------------- |
|  #299 | #298=CLOSED            | yes              | **AGENTS.md S3 design freeze (lines 71–106)** still in force: production `VR_WORKSPACE_BUCKET`, four AWS creds, and `docs/runbooks/s3-bucket-provisioning.md` smoke test not verifiable from the orchestrator sandbox; no `## INSTRUCTION:` block has signaled the lift. Skipped per the documented override pattern. |
|  #301 | #295=CLOSED            | yes              | Same S3 freeze override. |
|  #300 | #298=CLOSED, #299=OPEN | no               | Machine-blocked; plus S3 freeze. |
|  #302 | #300=OPEN              | no               | Machine-blocked; plus S3 freeze. |
|  #386, #239, #210 | (prose-only on-hold) | n/a    | Policy holds — orchestrator does not touch. |
|  #372 | (n/a — `needs-human`)  | n/a              | Untouched. Only a human can lift. |

Mechanical zero-policy lifts this tick: **0**.

**Quiet-tick counter:** `3 → 0` (productive — promotion is a state change the next tick will act on).

**Anti-stall note:** decision table walked exhaustively. PR #467 was caught and routed via the documented inline-promotion path (a productive action that does not consume a review slot). The remaining backlog remains gated by codified policies (S3 freeze in AGENTS.md, prose-only `on-hold` policy holds, `needs-human`) per the "Anti-Stall: Decision Table is Exhaustive" section. No `## INSTRUCTION:` override needed.

**Next tick:** if PR #467 picks up review comments from pr-review or a human, the review-slot row will dispatch a review worker; if it reaches approved + green, the merge worker takes over.

_This entry was created by an AI agent (OpenHands orchestrator, manual /orchestrate) on behalf of @jpshackelford._

---
### 2026-06-10 12:21 UTC - Orchestrator (manual /orchestrate)

🚀 **Spawned: Review Worker for PR #467** — pr-review bot posted 1 unresolved review thread after the 12:14Z draft→ready promotion.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `48e872e` | review | [PR #467](https://github.com/jpshackelford/voice-relay/pull/467) — iOS Safari STT restart loop | **NEW** |

**Spawned: Review Worker**
- PR: [PR #467 — `fix(client): iOS Safari STT — addpipe-pattern restart loop on the same recognition instance`](https://github.com/jpshackelford/voice-relay/pull/467)
- Conversation: [`48e872e`](https://app.all-hands.dev/conversations/48e872ef0f984c6e99f9d872792c4b47)
- Trigger: 1 unresolved review thread from `github-actions` (pr-review bot) on `client/src/hooks/useSpeechRecognition.ts:170` — flagged the `setTimeout` retry callback for 4-level indentation (exceeds the project's "3 levels max" complexity guideline). Suggestion: extract the retry/setTimeout body into a small named helper so the `catch` body stays flat.

**Decision-tree row applied:** review slot `REVIEW_AVAILABLE > 0 + PR needs review (💬 > 0)` → spawn review worker. PR #467 satisfies all preconditions (not draft, no `on-hold`/`needs-human`/`blocked`/`needs-info` labels, CI 7/7 SUCCESS green, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`).

**Current State:**
- Open PRs: 2
  - **[PR #467](https://github.com/jpshackelford/voice-relay/pull/467)** — review worker `48e872e` now driving (💬 1, CI green, ready). Worker will drop to draft, fix the complexity nit, re-run AC gate, push, return to ready.
  - [PR #465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` (human-authored, tvOS per-file issue drafts). Skipped per decision-tree STUCK PR row.
- Open issues: 8 — every one still `on-hold` or `needs-human` (same partition as 12:14Z tick).
  - `needs-human`: #372.
  - `on-hold` (mechanically unblockable but policy-held): #299, #301.
  - `on-hold` (machine-blocked): #300, #302.
  - `on-hold` (prose-only policy): #386, #239, #210.
- `ready`+unblocked+prioritized: 0.
- Issues needing expansion: 0.

**Unblock pass (mechanical `Blocked by #N` only):** ran; **0 issues lifted**.

| Issue | Blockers (state)       | Mechanical lift? | Policy override |
| ----: | ---------------------- | ---------------- | --------------- |
|  #299 | #298=CLOSED            | yes              | **AGENTS.md S3 design freeze (lines 71–106)** still in force — no `## INSTRUCTION:` block has signaled the lift. |
|  #301 | #295=CLOSED            | yes              | Same S3 freeze override. |
|  #300 | #298=CLOSED, #299=OPEN | no               | Machine-blocked; plus S3 freeze. |
|  #302 | #300=OPEN              | no               | Machine-blocked; plus S3 freeze. |
|  #386, #239, #210 | (prose-only on-hold) | n/a    | Policy holds — orchestrator does not touch. |
|  #372 | (n/a — `needs-human`)  | n/a              | Untouched. |

**Slot capacity after spawn:**
- Expansion: 0/4 used → 4 free.
- Implementation: 0/1 used → 1 free (no actionable ready issues to dispatch).
- Review: **1/2 used** → 1 free.

**Quiet-tick counter:** `0` (productive — review worker dispatched).

**Anti-stall note:** decision table walked exhaustively. PR #467 routed to the review slot per the documented row; remaining backlog gated by codified policies (AGENTS.md S3 freeze, prose-only `on-hold` policy holds, `needs-human`) per the "Anti-Stall: Decision Table is Exhaustive" section. PR #465 carries `on-hold` so it is excluded from inline draft-promotion per the documented opt-out mechanism.

_This entry was created by an AI agent (OpenHands orchestrator, manual /orchestrate) on behalf of @jpshackelford._

### 2026-06-10 12:34 UTC - Review worker (PR #467)

✅ **Round closed — 1 thread addressed, PR back to ready.**

| Thread | Action | Commit |
| --- | --- | --- |
| pr-review bot: `tryRestart` setTimeout callback nesting (4 levels > 3 max) in `client/src/hooks/useSpeechRecognition.ts` ~L170 | **Accepted.** Extracted retry body into a named `performRestartRetry` `useCallback`; `tryRestart`'s `catch` is now `setTimeout(performRestartRetry, 100)`. Nesting back to 3 levels, retry path independently readable. | `80b6e8f` |

- CI: all-green (Build Client / Client Tests / Server Tests / E2E Tests / lint-pr-title).
- Tests: 28/28 `useSpeechRecognition` tests pass; `tsc -b --noEmit` clean.
- Thread `PRRT_kwDOSTUWGM6IeXnj` resolved with reply pointing to `80b6e8f`.
- PR moved back to ready (`gh pr ready 467`).

**AC gate re-run: unchanged.** Linked issue #457 (CLOSED) — refactor is purely structural, no behavior change. All five acceptance criteria (onstart-before-onerror, sticky `isListening`/`sendListeningState`, no `aborted` ClientErrors on happy path, regression test, no SE 3 regression) remain satisfied by the addpipe restart loop already shipped in this PR. No follow-up issues filed; PR trailer and `## Deferred to follow-ups` unchanged.

_This entry was created by an AI agent (OpenHands review worker) on behalf of @jpshackelford._

---
### 2026-06-10 12:53 UTC - Orchestrator (manual /orchestrate)

🚀 **Spawned: Merge Worker for PR #467** — review round closed, all merge preconditions met.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0594df4` | merge | [PR #467](https://github.com/jpshackelford/voice-relay/pull/467) — iOS Safari STT restart loop | **NEW** |

**Spawned: Merge Worker**
- PR: [PR #467 — `fix(client): iOS Safari STT — addpipe-pattern restart loop on the same recognition instance`](https://github.com/jpshackelford/voice-relay/pull/467)
- Conversation: [`0594df4`](https://app.all-hands.dev/conversations/0594df4)
- Head SHA: `80b6e8f555b5f36107f79d10b7771ea2eff06a96`

**Decision-tree row applied:** review slot `REVIEW_AVAILABLE > 0 + PR ready to merge` → spawn merge worker.

**PR #467 merge-readiness checklist:**
- Not draft ✓
- All 7/7 CI checks SUCCESS (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, enable-orchestrator, pr-review) ✓
- `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN` ✓
- Single review thread (`PRRT_kwDOSTUWGM6IeXnj`, pr-review bot complexity nit) resolved by review worker `48e872e` in commit `80b6e8f` ✓
- pr-review bot's latest summary review (2026-06-10 12:37:50Z, after the fix push): **✅ Worth merging** — 🟡 Acceptable taste rating, 🟡 MEDIUM risk with documented mitigations, no new threads filed ✓
- No `on-hold` / `needs-human` / `blocked` / `needs-info` labels ✓
- `reviewDecision: null` — consistent with PR #466 which was merged in the same state on 2026-06-09 22:10Z; the pr-review bot serves as the automated reviewer per project convention ✓

**Current State:**
- Open PRs: 2
  - **[PR #467](https://github.com/jpshackelford/voice-relay/pull/467)** — merge worker `0594df4` now driving (will run AC gate against linked issue, squash-merge, auto-close on `Fixes #N`).
  - [PR #465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` (human-authored, tvOS per-file issue drafts). Skipped per decision-tree STUCK PR row.
- Open issues: 8 — every one still `on-hold` or `needs-human` (same partition as 12:21Z tick).
  - `needs-human`: #372.
  - `on-hold` (mechanically unblockable but policy-held): #299, #301.
  - `on-hold` (machine-blocked): #300, #302.
  - `on-hold` (prose-only policy): #386, #239, #210.
- `ready`+unblocked+prioritized: 0.
- Issues needing expansion: 0.

**Unblock pass (mechanical `Blocked by #N` only):** ran; **0 issues lifted**.

| Issue | Blockers (state)       | Mechanical lift? | Policy override |
| ----: | ---------------------- | ---------------- | --------------- |
|  #299 | #298=CLOSED            | yes              | **AGENTS.md S3 design freeze (lines 71–106)** still in force — no `## INSTRUCTION:` block has signaled the lift. |
|  #301 | #295=CLOSED            | yes              | Same S3 freeze override. |
|  #300 | #298=CLOSED, #299=OPEN | no               | Machine-blocked; plus S3 freeze. |
|  #302 | #300=OPEN              | no               | Machine-blocked; plus S3 freeze. |
|  #386, #239, #210 | (prose-only on-hold) | n/a    | Policy holds — orchestrator does not touch. |
|  #372 | (n/a — `needs-human`)  | n/a              | Untouched. |

**Slot capacity after spawn:**
- Expansion: 0/4 used → 4 free.
- Implementation: 0/1 used → 1 free (no actionable ready issues to dispatch).
- Review: **1/2 used** (merge worker) → 1 free.

**Quiet-tick counter:** `1 → 0` (productive — merge worker dispatched).

**Anti-stall note:** decision table walked exhaustively. PR #467 routed to the merge worker per the documented "PR ready to merge" row; remaining backlog gated by codified policies (AGENTS.md S3 freeze, prose-only `on-hold` policy holds, `needs-human`) per the "Anti-Stall: Decision Table is Exhaustive" section. PR #465 carries `on-hold` so it is excluded.

**Next tick:** if merge worker succeeds, PR #467 will be merged and the linked issue auto-closed; backlog will return to 0 actionable items and next tick will be quiet. If AC gate fails, the worker will drop the PR back to draft and the next tick will re-route per the decision table.

_This entry was created by an AI agent (OpenHands orchestrator, manual /orchestrate) on behalf of @jpshackelford._

---
### 2026-06-10 13:05 UTC - Orchestrator (manual /orchestrate)

🚀 **Respawned: Merge Worker for PR #467** — prior worker `0594df4` was a phantom (never started); replaced with `083deca`.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `083deca` | merge | [PR #467](https://github.com/jpshackelford/voice-relay/pull/467) — iOS Safari STT restart loop | **NEW (running, 120k tokens)** |

**Phantom worker detected:**

The merge worker `0594df4` spawned at 12:51:51Z by the previous tick (12:53Z entry) never actually started running. Diagnosis at wake-up (13:00–13:04Z):

| Signal | Healthy worker (e.g. `48e872e`, `083deca`) | Dead `0594df4` |
| --- | --- | --- |
| `execution_status` | `running` (or eventually `finished`) | `idle` |
| `metrics.accumulated_token_usage.prompt_tokens` | > 0 within seconds | **0** after 13+ min |
| `updated_at` | advances past `created_at` | **equals `created_at`** (12:51:51Z) |
| `sandbox_status` | `RUNNING` | `RUNNING` (sandbox alive but agent never engaged) |

The orchestrate skill's `check_conv_status` only distinguishes `running` / `finished` / `error` / `stuck`. The bare `idle` execution status falls through to the "not running" branch, so a strict reading would treat the phantom as `finished` and silently leave PR #467 mergeable-but-unmerged. The phantom signature (0 tokens, `updated_at == created_at`, sandbox RUNNING) is a stronger signal than the bare status; this tick moved `0594df4` to `completed[]` with `status: "stuck"` and respawned.

**Respawn:**
- New conversation ID: `083decab22954681b31c578600eadb4b` (short: `083deca`)
- Start task: `9de4b16a391e42bd90d5a2fa25b85f74` — reached `READY` after one `SETTING_UP_SKILLS` poll
- Verified at 13:04:46Z: `execution_status: running`, `prompt_tokens: 120768`, `sandbox_status: RUNNING` — engaged the system prompt + initial message, real work in flight.
- Title: `[Merge] PR #467 - iOS Safari STT addpipe restart loop`
- Plugin ref: `github:jpshackelford/.openhands/plugins/voice-relay-workflow@add-voice-relay-workflow-plugin`
- Initial message: full merge-worker procedure including phantom context, AC gate hard-gate, client-only migration check, and the requirement to update WORKLOG.md on main with the merge outcome.

**PR #467 merge-readiness re-verified at 13:00Z:**
- `state: OPEN`, `isDraft: false`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`
- All 7/7 CI checks SUCCESS (Server Tests, Client Tests, Build Client, E2E Tests, lint-pr-title, enable-orchestrator, pr-review)
- No `on-hold` / `needs-human` / `blocked` / `needs-info` labels
- Head SHA still `80b6e8f555b5f36107f79d10b7771ea2eff06a96` (unchanged since 12:34Z review-worker push)
- Single pr-review thread already resolved by `48e872e` in `80b6e8f`

**Current State:**
- Open PRs: 2
  - **[PR #467](https://github.com/jpshackelford/voice-relay/pull/467)** — merge worker `083deca` now driving (will run AC gate against linked issue, squash-merge, auto-close on `Fixes #N`).
  - [PR #465](https://github.com/jpshackelford/voice-relay/pull/465) — draft + `on-hold` (human-authored, tvOS per-file issue drafts). Skipped per decision-tree STUCK PR row.
- Open issues: 8 — every one still `on-hold` or `needs-human` (same partition as 12:53Z tick).
  - `needs-human`: #372.
  - `on-hold` (mechanically unblockable but policy-held): #299, #301.
  - `on-hold` (machine-blocked): #300, #302.
  - `on-hold` (prose-only policy): #386, #239, #210.
- `ready`+unblocked+prioritized: 0.
- Issues needing expansion: 0.

**Unblock pass (mechanical `Blocked by #N` only):** ran; **0 issues lifted**.

| Issue | Blockers (state)       | Mechanical lift? | Policy override |
| ----: | ---------------------- | ---------------- | --------------- |
|  #299 | #298=CLOSED            | yes              | **AGENTS.md S3 design freeze (lines 71–106)** still in force — no `## INSTRUCTION:` block has signaled the lift. |
|  #301 | #295=CLOSED            | yes              | Same S3 freeze override. |
|  #300 | #298=CLOSED, #299=OPEN | no               | Machine-blocked; plus S3 freeze. |
|  #302 | #300=OPEN              | no               | Machine-blocked; plus S3 freeze. |
|  #386, #239, #210 | (prose-only on-hold) | n/a    | Policy holds — orchestrator does not touch. |
|  #372 | (n/a — `needs-human`)  | n/a              | Untouched. |

**Slot capacity after respawn:**
- Expansion: 0/4 used → 4 free.
- Implementation: 0/1 used → 1 free (no actionable ready issues to dispatch).
- Review: **1/2 used** (merge worker `083deca`) → 1 free.

**Quiet-tick counter:** `0 → 0` (productive — phantom-worker detection + respawn is a state change the next tick will act on).

**Anti-stall note:** decision table walked exhaustively. The 12:53Z dispatch row ("PR ready to merge → spawn merge worker") was re-applied this tick because the prior dispatch produced a phantom conversation rather than a working agent. Without this respawn, PR #467 would remain in a "merge-ready, no worker" limbo and the next tick would either spawn a duplicate (slot still occupied per state) or move the dead worker to `completed` and only then respawn — a two-tick delay. Detecting the phantom signature here saves one tick.

**Next tick:** if merge worker `083deca` succeeds, PR #467 will be merged and the linked issue auto-closed; backlog will return to 0 actionable items and next tick will be quiet. If AC gate fails, the worker will drop the PR back to draft and the next tick will re-route per the decision table. If `083deca` also goes phantom, escalate to `needs-human` (add label to PR #467 and stop respawning).

_This entry was created by an AI agent (OpenHands orchestrator, manual /orchestrate) on behalf of @jpshackelford._
