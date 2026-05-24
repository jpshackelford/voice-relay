# Voice Relay Worklog

## Log

### 2026-05-24 05:38 UTC - Persistence design freeze: Path B selected; operator-side work begins

✅ **Design decision made.** Path B (VR proxies S3) selected over Paths A and C. Users will have **zero AWS surface area**: no IAM identity, no credentials, no authorization step. The VR backend holds a single AWS credential and exposes restore/snapshot as authenticated HTTP endpoints; sandboxes call those endpoints via `curl` + `tar`.

**Architecture rewritten in [PR #319](https://github.com/jpshackelford/voice-relay/pull/319)**:

- `docs/architecture.md` § Persistence layer fully respecified. `S3SyncStrategy` → `VrProxiedS3Strategy`. New section "Sandbox-to-VR auth model" documents three candidate bearer mechanisms with the choice deferred to the implementation issue.
- AGENTS.md `## Active design freeze` updated: freeze remains, but cause shifted from "design decision pending" to "operator-side bucket + creds pending."

**Path A code closed:**

- [PR #313](https://github.com/jpshackelford/voice-relay/pull/313) closed as superseded with explanation. Code quality was fine; substrate was wrong (assumed an operator-mediated onboarding flow that SaaS doesn't have).

**Issues re-scoped:**

| Issue | Change |
|---|---|
| [#298](https://github.com/jpshackelford/voice-relay/issues/298) | Title + body rewrite. New title: *"Add VR backend persistence endpoints (/api/internal/workspaces/:id/restore + /snapshot)"*. Scope is now pure server-side (VR backend additions + operator runbook). |
| [#299](https://github.com/jpshackelford/voice-relay/issues/299) | Title unchanged. Body updated: bash command now `curl ... \| tar -xz`, no AWS creds in sandbox. |
| [#300](https://github.com/jpshackelford/voice-relay/issues/300) | Title unchanged. Body updated: bash command now `tar -czf - \| curl`, no AWS creds in sandbox. |
| #301, #302 | No changes — they were agnostic to Path A vs B. Still `on-hold` transitively. |

**Status of the freeze:** still `on-hold`. The remaining gate is operator-side. @jpshackelford is provisioning:

1. The S3 bucket
2. The single IAM credential scoped to `s3:Get/Put/Delete/List` on `arn:aws:s3:::<bucket>/*`
3. Adding the four env vars to `/var/www/vr.chorecraft.net/app/.env` on the production server (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `VR_WORKSPACE_BUCKET`)

When those are in place, removing `on-hold` from #298 unblocks the implementation chain.

**Other findings from this work session that affect deployment understanding:**

- [PR #318](https://github.com/jpshackelford/voice-relay/pull/318) corrected `docs/DEPLOYMENT.md` — SSH inspection confirmed `chorecraft.net` and `app.no-hands.dev` are DNS aliases for the same Ubuntu server, not a "legacy / new infrastructure" pair as the doc previously claimed. Same Apache, same single Node process, same `.env`.
- [PR #317](https://github.com/jpshackelford/voice-relay/pull/317) introduced `AGENTS.md` capturing the orchestrator-managed-files policy (WORKLOG.md and `.workflow-state.json` must change on main only, not via PR) and the lint-pr-title scope vocabulary. This prevents future agents from making the same mistake I made in the closed PR #315.

**Open work that remains independent of the persistence freeze:** issue #303 (client coverage uplift, impl worker dispatched 04:53 UTC, in flight) and the `#289 → #297` chain unblocked by #311 merge.

_This worklog entry was authored by an AI agent (OpenHands) on behalf of @jpshackelford._

---
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

