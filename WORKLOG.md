### 2026-05-22 05:27 UTC - Merge Worker (PR #274, issue #263)

✅ **Squash-merged [PR #274](https://github.com/jpshackelford/voice-relay/pull/274)** — `feat: migration tooling — CLI, drift detection, advisory locking (#263)`. Merge commit [`adc75e1`](https://github.com/jpshackelford/voice-relay/commit/adc75e12fe54eec034e1c030c8d978b9f6ef4985). Issue [#263](https://github.com/jpshackelford/voice-relay/issues/263) auto-closed via `Fixes #263`.

**Pre-merge verification:**
- `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, all 6 CI checks green (Server Tests, lint-pr-title, enable-orchestrator, pr-review, Build Client, E2E Tests).
- `reviewDecision=CHANGES_REQUESTED` is sticky GitHub UX — the only `github-actions[bot]` review thread (incomplete destructive-migration list) is **resolved** as of [`1d5b02f`](https://github.com/jpshackelford/voice-relay/commit/1d5b02ff367b6815a58efdd1e0665b4f75d8b952); the follow-up bot review rates the PR 🟢 **LOW risk**.
- Re-audited the diff against `main`: only `_migrations` table gains two columns (`duration_ms`, `sql_hash`), added via `PRAGMA table_info`-gated idempotent ALTERs. The `destructive: true` markers on 11 existing migrations live outside the `up`/`down` SQL strings, so `sha256(up_sql)` is unchanged → **no drift warnings will fire** on the live SQLite db at `vr.chorecraft.net` after deploy. No DDL change to production tables; no data migration.

**Production safety:**
- App auto-deploys to `vr.chorecraft.net` on merge to `main` against the existing SQLite db. This PR is **purely additive operational tooling** + new `_migrations` bookkeeping columns; the runner itself didn't change behaviour for `AUTO_MIGRATE=true` (the prod default).
- No new migration files; production schema is unchanged. On first boot post-deploy: idempotent ALTERs add the two forensic columns to `_migrations`, then `backfillHashes()` writes `sql_hash` for all 13 already-applied rows in a single one-shot transaction guarded by `WHERE sql_hash IS NULL`. `_migrations_lock` is created lazily by `SQLiteTableLock` only when a future migration actually runs.
- **No manual post-deploy steps required.**

**PR description updated** to reflect the final 11-migration destructive list (was 8), and to include the post-deploy notes + review evolution.

**Squash commit message** (conventional, mirrors PR scope):
```
feat: migration tooling — CLI, drift detection, advisory locking (#263)

Adds operational tooling for the in-house SQLite migration runner; no
production DDL change in this PR.

* CLI (npm run db:status|migrate|rollback|new)
* Drift detection via sha256(up_sql) stored in _migrations.sql_hash
* AUTO_MIGRATE env var (default true preserves auto-deploy)
* MigrationLock interface + SQLiteTableLock (BEGIN IMMEDIATE, stale TTL)
* destructive: true marker on 11 user-data-table migrations
* Forensic columns duration_ms + sql_hash with one-shot backfill

Fixes #263
```

**Open PRs now (3):** #275 (review pending, refactor: remove unused storage drivers), #272 (`needs-human` — stuck), #221 (draft, `needs-human` — stuck).

This merge entry was created by an AI agent (OpenHands) on behalf of @jpshackelford.

---

### 2026-05-22 05:23 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `b24cfc4` | merge | PR #274 - migration tooling (#263) | **NEW** |
| `4fd59cf` | review | PR #275 - remove unused storage drivers (#261) | **NEW** |

**Workers Completed This Cycle:**
- `6078efe` (implementation, issue #261) → ✅ Opened [PR #275](https://github.com/jpshackelford/voice-relay/pull/275) — refactor(server): remove unused memory/redis/firestore storage drivers
- `18aa19b` (merge, PR #273) → ✅ Merged [PR #273](https://github.com/jpshackelford/voice-relay/pull/273) (squash `8cc09d2`) — agent event timeline hydration; issue #269 auto-closed
- `ef341f4` (review, PR #274) → ✅ Addressed review fix on PR #274 (marked migrations 010/011/013 destructive); CI green; review thread resolved

**Current State:**
- Open PRs (4): #275 (review pending), #274 (merge-ready), #272 (`needs-human` — stuck), #221 (draft, `needs-human` — stuck)
- Ready issues: #261 → PR #275, #263 → PR #274, #265 → PR #272 (stuck). All covered.
- On-hold issues (skipped): #208, #210, #239
- Worklog truncated: archived 4 old entries to `WORKLOG_ARCHIVE_2026-05-21.md` (kept 37 entries spanning >6h productive work)

**Action Taken:**
🚀 **Spawned 2 review-slot workers (parallel)**

1. **Merge Worker** for [PR #274 — feat: migration tooling](https://github.com/jpshackelford/voice-relay/pull/274) (`mergeable=CLEAN`, 6/6 CI green, only review thread resolved)
   - Conversation: [`b24cfc4`](https://app.all-hands.dev/conversations/b24cfc4e26e045ddbbc8219e627a8d4b)

2. **Review Worker** for [PR #275 — refactor: remove unused storage drivers](https://github.com/jpshackelford/voice-relay/pull/275) (2 unresolved 🟡 suggestions from github-actions[bot]: add tests for `isSupportedDriver` rejection + `createStoreFromEnv` error path)
   - Conversation: [`4fd59cf`](https://app.all-hands.dev/conversations/4fd59cf46bcb43ff85377afe369777f6)

**Idle Slots:** expansion 0/4 (no open issues need expansion), implementation 0/1 (every ready issue already has an open PR). Two stuck PRs (#272, #221) deferred awaiting human attention; bypassing them did not unblock any independent ready issues, so no impl work to spawn.

---

### 2026-05-22 05:25 UTC - Review-Response Worker (PR #274, issue #263)

🩹 **Addressed CHANGES_REQUESTED on PR [#274](https://github.com/jpshackelford/voice-relay/pull/274)** — `feat: migration tooling — CLI, drift detection, advisory locking (#263)`. Fix commit [`1d5b02f`](https://github.com/jpshackelford/voice-relay/commit/1d5b02ff367b6815a58efdd1e0665b4f75d8b952): `fix(migrations): mark 010, 011, 013 as destructive`.

**Bot finding (critical, unresolved thread):** The destructive-migration list was missing three entries whose `down`/`up` permanently lose user data and would therefore roll back silently without `--confirm-destructive`.

**Fix:**
- `server/src/storage/migrations/010_display_api_secrets.ts` — `down` does the SQLite recreate-table dance to drop the new `display_api_secret_{encrypted,iv,tag}` columns from `sessions`. Added `destructive: true` with an in-file comment explaining the data loss.
- `server/src/storage/migrations/011_elevenlabs.ts` — `down` recreates `workspace_settings`, permanently dropping the encrypted ElevenLabs API key, voice ID, and TTS-enabled flag. Same treatment.
- `server/src/storage/migrations/013_fk_orphan_cleanup.ts` — `up` deletes orphan rows / nulls orphan FKs; `down` is a documented no-op (`SELECT 1`). Marked destructive so `npm run db:rollback` surfaces the irreversibility to operators instead of letting the no-op happen quietly.
- `docs/runbooks/database-migrations.md` — added the three migrations to the "Currently marked destructive" list with short notes on what each drops; tightened the doc to clarify that the marker applies both when `down` drops user data *and* when `up` is itself non-reversible.

**Verification (local, against a fresh SQLite DB):**
- `npm run db:status` now tags `10_display_api_secrets`, `11_elevenlabs`, and `13_fk_orphan_cleanup` with `[destructive]`.
- `npm run db:rollback --yes` against a freshly-migrated DB exits 2 with `Refusing to roll back destructive migration 13_fk_orphan_cleanup. Pass --confirm-destructive to override.`
- `migrator.test.ts` 'destructive marker' test still passes.

**Workflow steps performed:**
1. Set PR back to draft (`gh pr ready 274 --undo`).
2. Pulled the unresolved review-thread body via GraphQL to confirm the three migrations the bot called out.
3. Audited each migration's `down` block before adding the flag — confirmed each one matches the criteria in the runbook (drops a column/table containing user data, or is otherwise irreversible).
4. Pushed `1d5b02f` to `feat/migration-tooling-263`.
5. Watched CI to green: Server Tests pass (30s), Build Client pass (22s), E2E Tests pass (1m35s), lint-pr-title pass.
6. Posted a reply on the review thread (`PRRC_kwDOSTUWGM7D2_y2`) summarising the fix and resolved the thread (`resolveReviewThread` returned `isResolved: true`).
7. Promoted the PR from draft back to ready-for-review (`gh pr ready 274`).

**Production safety:** SQLite is the production driver and these are flag-only changes — no schema mutation, no migration ordering change. The marker is purely a CLI guardrail (the runner ignores it), so `vr.chorecraft.net`'s auto-deploy on merge will only ever see the same migrations it would have run before; the difference is that a future operator running `npm run db:rollback` will be forced to type `--confirm-destructive` before any of these three can roll back.

**Status:** PR is ready-for-review, CI green, the one critical thread is resolved. Merge handling is a separate conversation per the worker's exit instructions.

_This worklog entry was written by an AI agent (OpenHands) on behalf of @jpshackelford._

---


### 2026-05-22 05:15 UTC - Implementation Worker (issue #261, PR #275)

🛠️ **Opened PR [#275](https://github.com/jpshackelford/voice-relay/pull/275)** — `refactor(server): remove unused memory, redis, firestore storage drivers`. Implements [#261](https://github.com/jpshackelford/voice-relay/issues/261) — dead-code cleanup before the Postgres driver (#263) lands.

**Shipped:**
- Deleted `server/src/storage/{memory,redis,firestore}.ts` and `memory.test.ts` (~400 lines of code that nothing outside the storage directory referenced).
- Narrowed `StoreConfig['driver']` from `'memory' | 'sqlite' | 'redis' | 'firestore'` to the string literal `'sqlite'`; dropped matching config shapes. `MessageStore` interface (including `connect`/`disconnect`) preserved so a Postgres driver can implement the same contract.
- `createStore()` reduced to a single `case 'sqlite'`; default arm throws `Unknown STORE_DRIVER "X". Supported values: sqlite` — stale `.env` files with `STORE_DRIVER=memory` (or `redis`/`firestore`) now fail fast at startup.
- `createStoreFromEnv()` no longer reads `STORE_MAX_MESSAGES`, `REDIS_URL`, or `FIRESTORE_*`; removed the "Default changed from memory to SQLite" transition log message.
- Removed `redis@^4.6.13` from `server/package.json`; regenerated root `package-lock.json` (this is a workspaces repo).
- README cleaned: dropped "Memory" and "Redis" subsections, fixed env-var table to show `STORE_DRIVER` default `sqlite` with only `sqlite` valid, removed `REDIS_URL` and `STORE_MAX_MESSAGES` rows, linked SQLite section to the planned Postgres driver (#263).

**Production safety:** SQLite driver and migrations are untouched. `tests/global-setup.ts`, `.env.example`, `docs/DEPLOYMENT.md` already pin `STORE_DRIVER=sqlite`, so the auto-deploy to `vr.chorecraft.net` is unaffected.

**CI:** Server Tests (797 passing), Build Client, E2E Tests, lint-pr-title (after retitling to use the `server` scope), enable-orchestrator — all green. Promoted from draft to ready-for-review.

**Postgres seam preserved:** `MessageStore` interface unchanged, `createStore({ driver })` switch shape unchanged, `connect`/`disconnect` lifecycle kept. Postgres driver (#263) drops in by extending the union to `'sqlite' | 'postgres'` and adding a `case 'postgres'`. The dead siblings are gone so the contract is unambiguous.

**Follow-up flagged in PR (not in scope):** `memory.test.ts` was the only generic contract test of `MessageStore` (every other test exercises SQLite specifics). When the Postgres driver lands it would be worth extracting the contract into a shared helper that runs against both `SQLiteStore` and `PostgresStore`.

---

### 2026-05-22 05:01 UTC - Merge Worker (PR #273, issue #269)

🚀 **Merged PR [#273](https://github.com/jpshackelford/voice-relay/pull/273)** — `feat(client): hydrate agent event timeline from persisted store (#269)`. Squash commit [`8cc09d2`](https://github.com/jpshackelford/voice-relay/commit/8cc09d291c328eea6c55c493904c0fa57c8a35ea). Issue [#269](https://github.com/jpshackelford/voice-relay/issues/269) auto-closed via `Closes #269`.

**Pre-merge checks:**
- ✅ `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`.
- ✅ All 6 required checks green at HEAD `0263635`: Server Tests, Build Client, E2E Tests, lint-pr-title, pr-review, enable-orchestrator.
- ✅ 1 review thread (github-actions[bot] doc-suggestion on `useAgentActions.ts:17`) addressed in `0263635` and resolved.
- ✅ **Scope verified client-only.** All 13 changed files live under `client/` (`git diff main...HEAD --name-only | grep -v '^client/'` returns empty). No server router, schema, or migration changes. Production currently runs on SQLite (`sqlite.db`) and this PR introduces zero migration risk — auto-deploy to `vr.chorecraft.net` can proceed safely.
- ✅ No `MobileMode.tsx` touch, no `KioskMode.tsx` timeline `useMemo` modification — clean of in-flight PR #272's territory.

**Post-merge actions:**
1. Updated PR description with a "Scope" callout (client-only confirmation) and "Review response" section documenting commit `0263635` and the rationale for accepting the JSDoc fix rather than refactoring `seedActions` to share `mergeAndDedupe` (the two paths have opposite ordering requirements — seed lands *before* existing live, live appends *after* existing seed).
2. Squash-merged via `gh pr merge 273 --squash --subject "feat(client): hydrate agent event timeline from persisted store (#269)" --body-file /tmp/pr273_squash.md`.
3. Verified Issue #269 closed at `2026-05-22T05:01:04Z` with `stateReason=COMPLETED` (auto-closed by `Closes #269` in the PR body — no manual close required).

**Production impact:** zero database/schema risk. Client-only feature: existing kiosks pick up the persisted-history hydration on next deploy; the WebSocket path is unchanged so any device already streaming live events continues unaffected. The new REST call (`GET /api/sessions/:sessionId/agent-events?limit=500`) hits an endpoint that's been live since PR #266 — no new server surface area.

**Coordination with in-flight work:** PR #272 (pair ActionEvent + ObservationEvent cards) targets `KioskMode.tsx` 's timeline `useMemo` block; this PR deliberately added its new props/render at the toggle button instead, so #272 should rebase cleanly. PR #274 (issue #263 migration tooling) is server-only and has no overlap.

**Follow-ups noted in PR but not actioned here:**
- Two-browser Playwright E2E for mid-session join (hook-level merge test covers the mechanics).
- Server-side raw → AgentAction mapping (option B refactor); client normalizer can shrink to a passthrough once that lands.
- `MobileMode.tsx` status banner (mobile doesn't render the agent-events panel).
- Cursor pagination via `after=` (kiosk only renders `MAX_ACTIONS = 50`; TODO comment present in `api/agentEvents.test.ts`).
- WS-reconnect re-hydration (if WS drops past server in-memory buffer and user doesn't refresh, events from the gap are missed — mitigation: route nav re-mounts the hook).

---

### 2026-05-22 04:55 UTC - Orchestrator

⚠️ **Previous cycle's 3 workers all ghosted — re-dispatched**

The 3 workers spawned ~13 minutes ago in the 04:41 UTC cycle (`cd43b83` impl #261, `1cd89bd` merge PR #273, `dfc3f34` review PR #274) all returned `execution_status=error` with `title="Conversation <prefix>"` and `created_at == updated_at` — the same silent spawn-failure signature seen with `f9ebd19` (merge PR #259) on 2026-05-21. None of them did any work. All 3 moved to `completed[]` with `status="ghost"`.

**Active Workers (after re-dispatch):**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `18aa19b` | merge | PR #273 — hydrate agent event timeline (closes #269) | **NEW** running |
| `ef341f4` | review | PR #274 — migration tooling (1 unresolved critical thread) | **NEW** running |
| `6078efe` | implementation | Issue #261 — Remove unused storage drivers | **NEW** running |

**Spawn verification:** All 3 conversations confirmed READY by start-task polling and `execution_status=running` via `/app-conversations?ids=`. Plugin loaded: `github:jpshackelford/.openhands/plugins/voice-relay-workflow@add-voice-relay-workflow-plugin`.

**Current State (unchanged from previous cycle since ghosts did nothing):**
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): draft, `needs-human`, CONFLICTING — STUCK
- [PR #272](https://github.com/jpshackelford/voice-relay/pull/272): `needs-human` (out-of-scope server changes flagged 2026-05-22 03:50) — STUCK
- [PR #273](https://github.com/jpshackelford/voice-relay/pull/273): `oRFC` green, CLEAN, MERGEABLE, 0 unresolved threads → **merge worker dispatched** (`18aa19b`)
- [PR #274](https://github.com/jpshackelford/voice-relay/pull/274): `oR` green, CLEAN, MERGEABLE, `reviewDecision=CHANGES_REQUESTED`, 1 unresolved critical bot thread about missing `destructive: true` on migrations 010_display_api_secrets + 2 others → **review worker dispatched** (`ef341f4`)
- Issue #261: `ready` + `priority:medium` + `audit`, no PR → **impl worker dispatched** (`6078efe`)
- Issues #263, #265, #269: already represented by open PRs (#274, #272, #273)
- Issues #208, #210, #239: `on-hold` — skipped

**Action Taken:**
🚀 **Re-spawned 3 workers** (same targets as ghosted cycle):

1. **Merge Worker** — [PR #273](https://github.com/jpshackelford/voice-relay/pull/273)
   - Conversation: [`18aa19b`](https://app.all-hands.dev/conversations/18aa19b12cdf447da651a21f668367b4)
   - Includes scope-check guardrail (must be client-only or HALT + `needs-human`, matching the rule that correctly caught PR #272 scope creep).

2. **Review Worker** — [PR #274](https://github.com/jpshackelford/voice-relay/pull/274)
   - Conversation: [`ef341f4`](https://app.all-hands.dev/conversations/ef341f4d2b90488b84b6f11cb733954e)
   - Add `destructive: true` to 010_display_api_secrets + 2 other migrations flagged by github-actions reviewer; resolve the thread.

3. **Implementation Worker** — [Issue #261](https://github.com/jpshackelford/voice-relay/issues/261)
   - Conversation: [`6078efe`](https://app.all-hands.dev/conversations/6078efe5f6b94ed2a4a7d10da261615d)
   - Remove `memory`, `redis`, `firestore` storage drivers + `redis` dep; leave clean seam for future Postgres driver (must NOT touch SQLite driver — that's production).

**Slots:** expansion 0/4 idle (no issues need expansion), impl 1/1, review 2/2 full.

**Ghost root cause:** Two ghost events in ~24h (`f9ebd19` + this cycle's 3). Pattern: API returns `{id, status: WORKING}` but the resulting conversation never leaves error state and has no real title. Worth raising with OpenHands platform team if it recurs. Mitigation: this cycle's spawn waited for `execution_status=running` before recording in state — the ghosted cycle did not.

**Next cycle:**
- Check `18aa19b` (merge #273), `ef341f4` (review #274), `6078efe` (impl #261) statuses.
- If `ef341f4` finishes successfully → spawn merge worker for #274.
- If `6078efe` opens a PR → review/CI cycle.
- PR #272 and #221 remain STUCK pending human review.

---

### 2026-05-22 04:41 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `cd43b83` | implementation | Issue #261 — Remove unused storage drivers | **NEW** |
| `1cd89bd` | review (merge) | PR #273 — hydrate agent event timeline | **NEW** |
| `dfc3f34` | review | PR #274 — migration tooling (1 unresolved critical thread) | **NEW** |

**Previous workers finished:** `a4900d9` (impl #263 → opened PR #274) and `4157041` (review PR #273 → CI green, no threads). Both moved to `completed[]` in state file.

**Current State:**
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): `needs-human`, CONFLICTING — deferred to human
- [PR #272](https://github.com/jpshackelford/voice-relay/pull/272): `needs-human` (halted: out-of-scope server changes during merge attempt) — deferred to human. Issue #265 (linked) is on hold pending #272 resolution.
- [PR #273](https://github.com/jpshackelford/voice-relay/pull/273): `oRFC` green ready, 0 unresolved threads → **merge worker dispatched**
- [PR #274](https://github.com/jpshackelford/voice-relay/pull/274): `oR` green ready, 1 unresolved critical thread (github-actions: missing `destructive: true` on migrations 010_display_api_se… plus 2 others) → **review worker dispatched**
- Issue #261: `ready` + `audit`, had no priority → **assessed `priority:medium`** inline (cleanup that unblocks Postgres adoption, low-risk dead-code removal) → **impl worker dispatched**
- Issues #263, #265, #269: ready, already represented by open PRs (#274, #272, #273 respectively).
- Issues #208, #210, #239: `on-hold` — skipped.

**Action Taken:**
🚀 **Spawned 3 workers (parallel)**

1. **Merge Worker** — [PR #273](https://github.com/jpshackelford/voice-relay/pull/273)
   - Conversation: [`1cd89bd`](https://app.all-hands.dev/conversations/1cd89bd6fc90430fbcd6864c57cf40f5)
   - Includes scope-check guardrail (must be client-only or HALT + `needs-human`).

2. **Review Worker** — [PR #274](https://github.com/jpshackelford/voice-relay/pull/274)
   - Conversation: [`dfc3f34`](https://app.all-hands.dev/conversations/dfc3f340cd724894a21acab20a2d6206)
   - Fix destructive-migration annotations on migrations 010 + 2 others called out by github-actions reviewer.

3. **Implementation Worker** — [Issue #261](https://github.com/jpshackelford/voice-relay/issues/261)
   - Conversation: [`cd43b83`](https://app.all-hands.dev/conversations/cd43b83202804d6ca8d0265467ee5cf2)
   - Remove `memory`, `redis`, `firestore` storage drivers and the `redis` dep; leave clean seam for future Postgres driver to plug into `MigrationLock` abstraction landed in PR #266 / #274.

**Slots:** expansion 0/4 idle (no issues need expansion), impl 1/1 full, review 2/2 full. 4 expansion slots idle is expected — all open issues are either implemented in PRs or `on-hold`.

**Worklog housekeeping:** Truncation script ran. Productive entries span 15 hours of continuous work (no 6h+ gap), so nothing met the archive criterion this cycle; WORKLOG.md kept at 37 entries / 1229 lines. Archives from prior days remain on disk.

---

### 2026-05-22 04:15 UTC - Implementation Worker (issue #263, PR #274)

🛠️ **Opened PR [#274](https://github.com/jpshackelford/voice-relay/pull/274)** — `feat: migration tooling — CLI, drift detection, advisory locking (#263)`. Implements issue [#263](https://github.com/jpshackelford/voice-relay/issues/263) end-to-end: six related improvements to the in-house migrator without swapping it out for a library.

**Shipped:**
- `MigrationLock` interface + `SQLiteTableLock` impl (`_migrations_lock` sentinel row, `BEGIN IMMEDIATE`, 5-min stale TTL, owner-check on release).
- `Migrator` gets `sql_hash` + `duration_ms` columns on `_migrations` (idempotent ALTER, sql_hash backfilled for pre-existing rows), `detectDrift()`, optional `destructive: true` field, and `migrateUp/Down/To` now run under the lock.
- `SQLiteStore.connect()` honors `AUTO_MIGRATE` (default `true` to preserve prod auto-deploy behaviour; `false` refuses to start when pending migrations exist) and logs drift warnings on startup.
- New CLI: `server/scripts/db-cli.ts` exposes `npm run db:status | db:migrate | db:rollback | db:new <name>`. Rollback gates `destructive: true` migrations behind `--confirm-destructive` (exit 2 on refusal).
- 8 existing migrations annotated `destructive: true` (001 messages, 002 users, 003 workspaces, 005 devices_sessions, 006 device_token_security, 008 qr_tokens, 009 join_requests, 012 agent_events).
- New runbook: `docs/runbooks/database-migrations.md`.

**Production-safety verification:** simulated a pre-#263 SQLite shape (11 applied migrations, no `sql_hash`/`duration_ms`) — backfill ran on first `db:status`, then `db:migrate` cleanly applied 12 + 13 with no data touched. Ran two concurrent `npm run db:migrate` against the same DB; one applied all 13, the other was a clean no-op — never double-applied. `AUTO_MIGRATE` defaults to `true` so existing `vr.chorecraft.net` deploys keep working without any env-var change; flipping to `false` is a deliberate post-merge follow-up.

**Tests:** 845 server tests pass (was 839 on main; +6 new: lock contention / stale takeover / owner check; migrator drift / backfill / destructive; sqlite `AUTO_MIGRATE` enforcement and startup drift). Build clean. CI on `2d7edf8`: Build Client 25s, Server Tests 30s, E2E Tests 1m46s, lint-pr-title 4s — all green.

**Coordination:** no overlap with PRs #273 (client-only) or #272 (paused on `server/src/openhands.ts`, not touched here). `MigrationLock` is the abstraction #261's Postgres driver will plug into; redis/firestore/memory drivers were untouched so the storage-driver cleanup is unblocked.

**Follow-ups noted (not blocking this PR):**
1. After merge, set `AUTO_MIGRATE=false` in the prod env and add `npm run db:migrate` to the deploy pipeline before the app restart, so schema changes become an explicit deploy step.
2. Postgres `MigrationLock` impl will land with #261 — interface is ready.
3. The CLI prints index.ts wiring instructions on `db:new` rather than editing the file. Revisit if it becomes a friction point.

---

### 2026-05-22 03:55 UTC - Review-Feedback Worker (PR #273, issue #269)

📝 **Addressed review feedback on PR [#273](https://github.com/jpshackelford/voice-relay/pull/273)** — one unresolved review thread from `github-actions[bot]` on `client/src/hooks/useAgentActions.ts:17` flagging a stale JSDoc comment on `mergeAndDedupe`. The comment claimed the helper was used by both `seedActions` and `handleAgentAction`, but `seedActions` actually has its own inline dedupe loop (it requires the opposite ordering — historical seed inserted *before* existing live events — so it can't share the helper).

**Decision:** accept the suggestion and update the doc rather than refactor `seedActions` to use the helper. The two paths have genuinely different ordering requirements; forcing them through one helper would either complicate its signature (e.g. add an `order: 'base-first' | 'incoming-first'` flag) or split the cap-trimming logic across both paths. Doc fix is the smaller, safer change.

**Change (commit `0263635`):** `client/src/hooks/useAgentActions.ts` — rewrote the JSDoc block on `mergeAndDedupe` to (a) state it's only used by `handleAgentAction`, (b) point to `seedActions`' own inline dedupe loop, and (c) explain *why* they don't share (opposite ordering). No behavior change.

**Process:**
1. PR moved to draft (`gh pr ready 273 --undo`).
2. Single focused commit pushed.
3. CI on `0263635`: all 4 required checks green (Build Client 27s, E2E Tests 1m36s, Server Tests 35s, lint-pr-title 3s).
4. Replied to thread `PRRT_kwDOSTUWGM6D_mfo` referencing the commit, then resolved via `resolveReviewThread`.
5. PR moved back to **Ready for review**.

**Learning:** the inline dedupe in `seedActions` exists because of an ordering asymmetry that's easy to miss when skimming. Worth a follow-up to either (a) add a brief unit test that pins down the ordering contract ("seed lands before existing live events when both are non-empty") or (b) revisit if a future refactor can collapse both paths — but only if the helper can express both orderings without becoming a config bag. Not blocking; the existing tests cover the externally-visible behavior. Production impact: zero — client-only documentation change, no runtime effect, no migration concern (PR remains client-only as flagged).

---

### 2026-05-22 03:50 UTC - Orchestrator

🚀 **Spawned 2 workers (parallel)**

**Workers completed since last cycle:**
- `1b68706` (implementation, Issue #269) → finished → opened [PR #273](https://github.com/jpshackelford/voice-relay/pull/273) `feat(client): hydrate agent event timeline from persisted store`; CI green, 1 unresolved github-actions bot review thread.
- `91b977c` (merge, PR #272) → finished → **HALTED, added `needs-human` label**. The merge worker's guardrail caught out-of-scope server changes in `server/src/openhands.ts` (`shouldSkipForKioskTimel...` helper) that were not part of the stated client-only scope for issue #265. Correctly refused to force-merge; PR #272 now awaits human review.

**Active Workers (after this cycle's spawns):**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `a4900d9` | implementation | Issue #263 — Migration tooling improvements (priority:medium) | **NEW** |
| `4157041` | review | PR #273 — hydrate agent event timeline (1 unresolved bot thread) | **NEW** |

**Spawned: 2 Workers**

1. **Review Worker** — [PR #273](https://github.com/jpshackelford/voice-relay/pull/273) `feat(client): hydrate agent event timeline from persisted store`
   - Conversation: https://app.all-hands.dev/conversations/415704184573424eae37f3607e682f84
   - Rationale: CI fully green (Server Tests, Build Client, E2E Tests, lint-pr-title, pr-review), `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, 1 unresolved github-actions bot thread about a stale JSDoc comment on `mergeAndDedupe` (claims `seedActions` calls it when it has its own dedupe logic — looks like a valid clarity fix). Worker will draft→address→reply+resolve thread→ready.

2. **Implementation Worker** — [Issue #263](https://github.com/jpshackelford/voice-relay/issues/263) `Migration tooling improvements: CLI, drift detection, advisory locking` (priority:medium, enhancement)
   - Conversation: https://app.all-hands.dev/conversations/a4900d9a6ebd4e36a34a9061ec6070e4
   - Rationale: Highest-priority `ready` issue with no in-flight PR. #265 owned by stuck PR #272; #269 owned by PR #273; #261 still unprioritized. #263 is server-side (migration runner) — no file overlap with the open client PRs (#272, #273). Prompt includes guardrails: must be additive, must not break the migration runner production depends on, and avoid `server/src/openhands.ts` (which #272 already touched).

**Current State:**
- **Open PRs:**
  - [PR #273](https://github.com/jpshackelford/voice-relay/pull/273) — `oR green ready 💬1` (review worker `4157041` addressing bot thread; fixes #269)
  - [PR #272](https://github.com/jpshackelford/voice-relay/pull/272) — `ocFC green ready` but **`needs-human`** (STUCK; out-of-scope server change flagged by merge guardrail; fixes #265 once resolved)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — draft, `needs-human` (STUCK since 2026-05-18)
- **Ready issues queued (awaiting impl slot):**
  - #261 — `audit`, ready, **no priority label** (needs `/assess-priority` before impl)
- **In progress (impl):** #263 — `a4900d9`
- **In progress (review):** PR #273 — `4157041`
- **On-hold (skipped):** #208, #210, #239 — all carry `on-hold`

**Slot Usage (after spawn):**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues need expansion |
| Implementation | 1 | 1 | #263 — `a4900d9` |
| Review/Merge | 1 | 2 | PR #273 — `4157041`; PR #272 & #221 stuck; 1 review slot free |

**Decision rationale:**
- PR #272 correctly flagged `needs-human` by the previous merge worker — that's a STUCK PR per workflow rules. Continue work on independent items rather than wait.
- PR #273 is the next merge candidate but has 1 unresolved bot thread → review worker (not merge worker) to handle the feedback first.
- Impl slot was freed by `1b68706` finishing → spawn next-priority `ready` issue. #265 and #269 already have PRs in flight; the remaining priority-tagged option is #263. #261 lacks a priority label and is a non-blocking audit cleanup; can be assessed inline next cycle if needed.
- No second review/merge worker spawned: only one PR (#273) is actionable; the other two are stuck pending human review.
- No expansion workers spawned: every non-on-hold open issue already has `ready`.
- Bookkeeping: moved both finished workers (`1b68706`, `91b977c`) into `completed` array; pruned to 28 entries within 24h.

**Next cycle:**
- If `4157041` finishes with bot thread resolved + CI green → spawn merge worker for PR #273.
- If `a4900d9` opens a PR for #263 → review/CI handling next cycle.
- After both clear (and if #261 is still the only remaining ready issue): run `/assess-priority` inline for #261, then dispatch its impl.
- PR #272 and #221 remain STUCK awaiting human review/intervention. They do not block other work.

---

### 2026-05-22 03:40 UTC - Implementation Worker (issue #269, PR #273)

🛠️ **Opened PR [#273](https://github.com/jpshackelford/voice-relay/pull/273)** — `feat(client): hydrate agent event timeline from persisted store`. Implements issue [#269](https://github.com/jpshackelford/voice-relay/issues/269): the kiosk session view now fetches `GET /api/sessions/:sessionId/agent-events?limit=500` on mount, seeds `useAgentActions` state with the persisted history, and dedupes the live WebSocket against the seed by `AgentAction.id`. Devices joining mid-session, refreshing, or reconnecting after a WS drop now see the full historical timeline instead of an empty panel.

**Design choice — option A (client-side normalizer).** The issue's technical comment listed two options for the raw OH event → `AgentAction` projection: server-side mapping (B) vs. client-side (A). The user prompt explicitly scoped this PR to client-only changes (`This issue is client-only — no schema changes expected`), so the projection lives in `client/src/utils/normalizeAgentEvent.ts` and the server router stays unchanged. The normalizer mirrors a compact subset of the server's `extractEventFields` / `extractEffectiveKind` / `formatEventSummary` / `normalizeOhTimestamp` helpers (~300 lines vs. the server's ~600) — enough fidelity for the renderer to dispatch on `kind` and surface displayable fields. Option B can land later as a refactor; the two implementations would then be drop-in equivalents and the client normalizer could shrink to a passthrough.

**Files added:**
- `client/src/utils/normalizeAgentEvent.ts` — raw `RawAgentEvent` → `AgentAction` with `ActionEvent`/`ObservationEvent` unwrapping. Timestamps route through `parseOhTimestamp` to keep historical events sorting correctly in non-UTC browsers (regression guard for issue #264 / PR #268).
- `client/src/api/agentEvents.ts` — typed fetch client. `AgentEventFetchError` preserves HTTP status; `AbortError` re-thrown unchanged so callers can detect cancellation.
- `client/src/hooks/useAgentEventHistory.ts` — owns the network fetch (loading / error / `rehydrationComplete` / `conversationId` / `retry`). `retry()` re-fetches with `rehydrate=force`.
- `client/src/components/AgentHistoryStatus.tsx` — small inline status row (loading / partial / error / no-mapping). Rendered next to the agent-events toggle, **does not touch the timeline `useMemo`** — keeps clear of in-flight PR #272 on the same file.

**Files modified:**
- `client/src/hooks/useAgentActions.ts` — added `seedActions(seed)` for the history-then-live merge. Live events that arrived before hydration win on id-collision (preserves React refs). `handleAgentAction` also now dedupes by `AgentAction.id` so a live message overlapping the seed is a no-op instead of a duplicate render. Trimming to `MAX_ACTIONS = 50` is preserved on both paths.
- `client/src/pages/SessionView.tsx` — wires `useAgentEventHistory` to `agentActions.seedActions` via a single effect, and forwards history-status props down to `KioskMode`.
- `client/src/components/KioskMode.tsx` — additive only: 5 new optional props with safe defaults + render `AgentHistoryStatus` between the toggle button and the timeline. The timeline `useMemo` block (which PR #272 also touches) is **not modified** here.

**Tests added (88 new tests; full suite 635/635 client + 812/812 server):**
- `normalizeAgentEvent.test.ts` — 33 cases covering effective-kind unwrapping, summary truncation/fallbacks, per-kind field extraction (terminal / file / browser / MCP / task tracker / grep / glob / skill / observation linkage), naive-UTC timestamp normalization, synthetic-id UUID generation, and order preservation.
- `api/agentEvents.test.ts` — 16 cases covering URL building, 200 success, partial-rehydration, no-mapping, 401/403/404/5xx error mapping, network failure wrapping, `AbortError` pass-through, signal forwarding, and the `<=500` pagination assertion (TODO comment in source for `after=` follow-up).
- `useAgentEventHistory.test.ts` — 12 cases covering initial fetch, refetch on `sessionId` change, disabled / undefined-session no-fetch, partial rehydration surfacing, `retry()` flipping to `rehydrate=force`, 5xx preserving prior history, 404 / 403 / network error paths, TTL-pruned response, and no-mapping success.
- `useAgentActions.test.ts` — +8 cases: live-dedupe by id, seed-into-empty, empty-seed no-op, live-before-seed merge (live wins), history-then-live (no double-render), seed cap to MAX_ACTIONS, idempotency.
- `AgentHistoryStatus.test.tsx` — 9 cases covering each render branch (loading / error / partial / empty / steady-state / undefined-conversation-id flicker guard / priority of loading > error > partial / retry button presence).

**CI on `737c582` (PR #273):** all 5 required checks green at first push — Server Tests (30s), Build Client (28s), E2E Tests (1m41s), lint-pr-title (3s), enable-orchestrator (2s). `pr-review` skipped during draft phase; will run on the ready-for-review transition. PR moved to **Ready for review**.

**Things intentionally deferred (noted in PR description):**
- Two-browser Playwright E2E for mid-session join. The hook-level test mechanically verifies the merge logic; a full E2E harness is a larger change.
- Server-side raw → `AgentAction` mapping (option B refactor).
- `MobileMode.tsx` status banner (mobile doesn't render the agent-events panel today).
- Cursor pagination via `after=` (kiosk only renders `MAX_ACTIONS = 50` anyway; flagged with TODO).

**Learning:** the OH `ActionEvent` / `ObservationEvent` wrapper convention (with the actual kind nested under `action.kind` / `observation.kind`) is the single most error-prone shape in the OH event model. The client and server both have to remember to unwrap before dispatching on kind (issue #257 is the original bug from this same trap). Centralizing the unwrap in `getEffectiveKind` on each side keeps the renderer dispatch tables simple — but it does mean the dedupe key (`AgentAction.id`) has to be the **outer** event id, not the nested one, which the server is already doing.

---

### 2026-05-22 03:30 UTC - Rebase Worker (PR #272, issue #265)

🔧 **Rebased PR [#272](https://github.com/jpshackelford/voice-relay/pull/272)** onto `main` after PR #268 landed at `0aac2a2e`. Both PRs touch the same `client/src/components/KioskMode.tsx` `timeline` `useMemo`, creating a textual merge conflict — the two concerns are orthogonal so the resolution kept **both** changes.

**Conflict resolution (commit `3602751`):**
- `KioskMode.tsx` imports: kept `parseOhTimestamp` (from #268) **and** `pairAgentEvents` (from #272) side by side.
- `timeline` `useMemo`: call `pairAgentEvents(agentActions)` first, then in the per-pair loop use `parseOhTimestamp(action.timestamp)` (with `?? Date.now()` fallback) to compute the sort key. Order matters: pairing collapses the n-events-per-invocation into one entry, timestamp normalization fixes naive-UTC ordering in non-UTC browsers — they compose cleanly when applied in that order, and the paired entry sorts by the **action's** timestamp so the response stays anchored under its request even if the observation arrives milliseconds later.
- `KioskMode.test.tsx`: kept both `describe` blocks side by side — `timeline interleaving (issue #264)` (3 tests, from #268) and `agent event pairing (issue #265)` (4 tests, from #272). No test was rewritten; the conflict was a pure interleave of two newly-added blocks that happened to land at the same line.

**Verification:**
- `npm run -w client test -- --run pairAgentEvents` → 11/11 ✓
- `npm run -w client test -- --run parseOhTimestamp` → 11/11 ✓
- `npm run -w client test -- --run KioskMode` → 71/71 ✓ (includes both regression suites)
- Full client suite: **577/577 tests passing**
- `npm run -w client build` → clean (`tsc -b` + Vite production bundle)

**CI on rebased SHA `3602751`:** mergeStateStatus `CLEAN`, mergeable `MERGEABLE`. All 4 active required checks green — Server Tests (35s), Build Client (27s), E2E Tests (1m37s), lint-pr-title (4s). (`pr-review`/`enable-orchestrator` will fire on the ready-for-review transition.)

**Issue #265 acceptance criteria — no change.** Pairing is still the user-visible deliverable; the merged timestamp-normalization is a transparent dependency that only affects *sort order* of the paired entries, not their composition. Production-safety unchanged: no DB / migration touched, client-side render + server-side WebSocket-filter only, backwards-compatible with older clients.

**Learning:** when two PRs add new `describe` blocks at the same line in a test file, `git rebase` produces a single noisy `<<<<<<<` blob spanning ~250 lines that *looks* like overlapping content but is actually two adjacent additions that should both be kept. Pattern: scan for the structural braces (`describe(` / closing `});`) on each side of `=======` before merging — usually you want both blocks in series, not one or a hand-merge.

No review threads opened on the rebased SHA. PR moved back to **Ready for review**.

---

### 2026-05-22 03:23 UTC - Orchestrator

🚀 **Spawned 2 workers (parallel)**

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `b8f99f6` | review/rebase | PR #272 - resolve merge conflict from #268 | **NEW** |
| `1b68706` | implementation | Issue #269 - hydrate agent event timeline | **NEW** |

**Workers completed since last run:**
- `20876eb` (implementation, issue #265) → finished, opened PR #272 (now needs rebase)
- `e7848d7` (merge, PR #268) → finished, squash-merged `0aac2a2e`, issue #264 auto-closed

**Current State:**
- [PR #272](https://github.com/jpshackelford/voice-relay/pull/272) (Issue #265): ready, all CI green pre-rebase, **mergeStateStatus=DIRTY** — conflicts with #268 in `KioskMode.tsx` timeline `useMemo`. Review/rebase worker dispatched.
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): draft, 3 days old, no activity — left as-is (intentional draft).
- Issues needing expansion: #208, #210, #239 — **all `on-hold`, skipped per workflow rules**.
- Ready prioritized issues: #263 (priority:medium, migration tooling), #265 (has PR #272), #269 → **picked for impl**.
- 1 ready issue still unprioritized: #261 (Remove unused storage drivers) — defer priority assessment until current PRs resolve.

**Action Taken:**

1. **Review/Rebase Worker** — [`b8f99f6`](https://app.all-hands.dev/conversations/b8f99f69b4d44b74bfc37ddea97cacd9)
   - Target: [PR #272](https://github.com/jpshackelford/voice-relay/pull/272) — pair ActionEvent + ObservationEvent (fixes #265)
   - Reason: Merge conflict introduced by #268 merge in `KioskMode.tsx` timeline `useMemo`. Worker will rebase onto current main, preserve both timestamp normalization (#268) and event pairing (#272), re-run tests, get CI green, mark ready.

2. **Implementation Worker** — [`1b68706`](https://app.all-hands.dev/conversations/1b68706c12b649c4ba794954697c52af)
   - Target: [Issue #269](https://github.com/jpshackelford/voice-relay/issues/269) — hydrate agent event timeline from persisted store (priority:medium, client)
   - Reason: Highest-priority ready issue with no in-flight PR. Server endpoint already exists (PR #266 landed it); client-only work. Scoped to `useAgentActions.ts` + fetch/seed/dedupe — explicitly warned to avoid `KioskMode.tsx` timeline `useMemo` to minimize conflict with #272.

**Slot Usage:** expansion=0/4, implementation=1/1, review=1/2



### 2026-05-22 03:37 UTC - Orchestrator

🚀 **Spawned: Merge Worker for PR #272**

**Workers completed since last cycle:**
- `b8f99f6` (review/rebase, PR #272) → finished → rebase landed; PR #272 now `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, all 6 CI checks green, 0 unresolved review threads.

**Active Workers (after this cycle's spawn):**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `1b68706` | implementation | Issue #269 - hydrate agent event timeline from persisted store | running |
| `91b977c` | merge | PR #272 - pair ActionEvent + ObservationEvent | **NEW** |

**Spawned Worker:**
- **Merge Worker** — [PR #272](https://github.com/jpshackelford/voice-relay/pull/272) `fix(client): pair ActionEvent + ObservationEvent into a single agent event card`
  - Conversation: https://app.all-hands.dev/conversations/91b977ca331345489b28d8cbd459a794
  - Rationale: Every merge criterion is satisfied. The previous rebase worker (`b8f99f6`) cleared the conflicts introduced by PR #268. No human reviewer required (bot-only). Worker will verify the diff is client-only (no surprise server/migration changes), update the PR description to reflect the final state, squash-merge with conventional commit (`fix(client):`), and confirm issue #265 auto-closes via `Fixes #265`.
  - Guardrail: if the diff includes any server/schema changes, the worker is instructed to add `needs-human` and STOP rather than force-merging.

**Current State:**
- **Open PRs:**
  - [PR #272](https://github.com/jpshackelford/voice-relay/pull/272) — `ocFC green ready 💬--` (merge worker `91b977c` taking it over the line; fixes #265)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (STUCK since 2026-05-18, skipped)
- **Ready issues queued (awaiting impl slot):**
  - #263 — `priority:medium` enhancement (migration tooling improvements)
  - #261 — ready, **no priority label** (needs `/assess-priority` before impl)
- **In progress (impl):** #269 — `1b68706` (client hydration of agent event timeline)
- **Closing soon (when PR #272 merges):** #265 (will auto-close via `Fixes #265`)
- **On-hold (skipped):** #208, #210, #239 — all carry the `on-hold` label
- **No issues need expansion** (all open non-on-hold issues already have `ready`)

**Slot Usage (after spawn):**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues to expand (all unexpanded ones are `on-hold`) |
| Implementation | 1 | 1 | #269 — `1b68706` (running) |
| Review/Merge | 1 | 2 | PR #272 merge — `91b977c`; PR #221 stuck; 1 slot free |

**Decision rationale:**
- PR #272 is the clearest possible merge candidate: rebase finished, CI green, no unresolved threads, no human reviewer required. Merge worker chosen over review worker because there is nothing left to address.
- Implementation slot still occupied by `1b68706` on #269 — cannot spawn second impl worker. Once #272 merges, #269's client work will rebase cleanly because the merge worker's commit and #269's branch don't touch the same `KioskMode.tsx` `timeline` `useMemo` (#269 is scoped to `useAgentActions.ts` per its expansion).
- No second review/merge worker spawned: PR #221 is `needs-human` (STUCK), and the only other open PR (#272) is being merged. No new PRs in flight.
- No expansion workers spawned: every non-on-hold open issue already has `ready`.
- `#261` (`Remove unused storage drivers`) still needs `/assess-priority`. Will run inline at next wake-up if impl slot frees and no higher-priority work is ready. Not urgent — it's an audit cleanup, not a blocking dependency.

**Next cycle:**
- If `91b977c` merges PR #272 → #265 auto-closes; impl slot still owned by `1b68706`. No new impl spawn until #269's PR opens (or `1b68706` finishes) to avoid branch pile-up.
- If `1b68706` opens a PR for #269 → review/CI handling next cycle; coordinate with PR #272 merge state.
- After both clear: dispatch impl for #263 (priority:medium, migration tooling). #261 needs `/assess-priority` before it can be picked.

---

### 2026-05-22 03:09 UTC - Merge Worker (PR #268 → main → deploy)

🚀 **Squash-merged PR [#268](https://github.com/jpshackelford/voice-relay/pull/268)** — `fix(client): interleave kiosk timeline by normalizing OH event timestamps`. Merge commit `0aac2a2e` at 2026-05-22T03:09:25Z. Issue [#264](https://github.com/jpshackelford/voice-relay/issues/264) auto-closed at 2026-05-22T03:09:27Z via `Fixes #264`.

**What landed on `main` / `vr.chorecraft.net`:**
- Server: new `server/src/utils/timestamp.ts#normalizeOhTimestamp` — ISO Zulu for any parseable input, `null` for garbage. Applied in `openhands.ts` before stamping `AgentAction.timestamp` and the new `serverTimestamp` arg on the AI-relay callback. `auto-connect.ts` plumbs `serverTimestamp` onto `RelayedTextMessage`. `storage/sqlite.ts` now returns `created_at` as `createdAt` (Zulu); `memory.ts`/`redis.ts` stamp `createdAt` at append for parity.
- Client: new `client/src/utils/parseOhTimestamp.ts` — mirrors server contract (returns `null` for unparseable input, post-review hardening in `f91cb7b`). `KioskMode.tsx` parses `AgentAction.timestamp` before sorting the unified timeline. `SessionView.tsx`/`Workspace.tsx` consume `serverTimestamp`/`createdAt`.
- Types: `RelayedTextMessage` (both server + client) extended with optional `serverTimestamp` / `createdAt`.

**Production safety check (pre-merge):**
- mergeStateStatus `CLEAN`, mergeable `MERGEABLE`, all 6 required CI checks green (Server Tests, Build Client, E2E Tests, lint-pr-title, pr-review, enable-orchestrator).
- All 3 github-actions[bot] review threads (Invalid-Date guard) resolved against commit `f91cb7b` which made the client `parseOhTimestamp` return `null` for unparseable input — single source-of-truth contract.
- **No DB migration touched** (verified by `gh pr diff 268 -- 'server/src/db/migrations/**'` returning empty). New fields (`serverTimestamp`, `createdAt`) are optional → cross-version-deploy safe. Backwards compatible with older clients (ignore new fields, fall back to `new Date()` at receive time).
- 12 server unit tests for `normalizeOhTimestamp` + 11 client unit tests for `parseOhTimestamp` + 3 KioskMode TZ regression tests (verified passing under `TZ=America/New_York`, where the original bug manifested) + updated `sqlite.test.ts` round-trip.

**Cross-issue heads-up:** PR [#272](https://github.com/jpshackelford/voice-relay/pull/272) (Action+Observation pairing, fixes #265) is open and touches the same `KioskMode.tsx` `timeline` `useMemo`. Left a comment on #272 flagging the merge so the worker rebases onto current `main`.

Production auto-deploy triggered by the push to `main`.

---

### 2026-05-22 03:08 UTC - Implementation Worker (PR #272, issue #265)

🛠️ **Opened PR [#272](https://github.com/jpshackelford/voice-relay/pull/272)** — `fix(client): pair ActionEvent + ObservationEvent into a single agent event card` — for issue [#265](https://github.com/jpshackelford/voice-relay/issues/265).

Each tool invocation now renders as **one** collapsible `AgentEventCard` whose expanded view contains both the action (Command/Tool/Args) and the matching observation (Output/Result/exit code), matching the OpenHands cloud UI. Previously every tool call surfaced as two separate cards — the action followed by a bare "📋 Observation" with no title or back-link.

**Implementation:**
- New `client/src/utils/pairAgentEvents.ts` — pure, order-independent pairing pass. Indexes observations by `action_id` back-pointer, emits one `PairedAgentEvent` per action, falls orphans through.
- `TimelineEntry` gains optional `observation` field; `KioskMode.tsx`'s `useMemo` calls `pairAgentEvents` before timestamp-sorting the unified timeline (entry sorts by the **action's** timestamp so the response is anchored under its request).
- `AgentEventCard` accepts optional `observation` prop; title from action, status from observation (or `'pending'` while in flight), expanded body renders both halves under an `**Output:**` header.
- `SuccessIndicator` extended to render explicit badges for all four states: ✓ success, ⏱ timeout, ✗ error (new), ⋯ pending (new, with slow pulse so in-flight ≠ silent success).
- New `shouldSkipForKioskTimeline(event)` in `server/src/openhands.ts` drops `SystemPromptEvent` and `MessageEvent` with `source !== 'agent'` before the WebSocket forwarder turns them into agent cards — they were leaking into the kiosk sidebar as duplicate/infrastructure noise.

**Tests:** 11 unit tests for `pairAgentEvents` (ordered/unordered/missing/orphan + verbatim shape from `test-fixtures/raw-events-real.json`); 4 KioskMode regression tests; 4 new AgentEventCard tests; 8 server tests for `shouldSkipForKioskTimeline`; updated SuccessIndicator tests for the new icons. All **559 client + 808 server tests pass**, `tsc --noEmit` clean, `npm run build` succeeds.

**Coordination note:** PR #268 (issue #264) is still in review and touches the same `useMemo`. Branched off current main; rebase will be a single-conflict merge if #268 lands first (keep `parseOhTimestamp(action.timestamp)` inside the new paired-entries loop).

No DB / migration impact — client-side render + server-side forwarder filter only. All 5 CI checks green (Server Tests, Build Client, E2E Tests, enable-orchestrator, lint-pr-title). PR moved from draft to **Ready for review**.

---

### 2026-05-22 03:08 UTC - Orchestrator

**Workers Completed (this cycle):**
- `be830dd` (review, PR #268) — finished → addressed all 3 github-actions Invalid-Date threads (commit `f91cb7b`); resolved threads via GraphQL; CI green on all 4 required checks; PR back to ready.

**Active Workers (after this cycle's spawn):**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `20876eb` | implementation | Issue #265 — Pair Action+Observation event cards (priority:medium, client) | running |
| `e7848d7` | merge | PR #268 — kiosk timeline TZ fix | **NEW** |

**Spawned: 1 Worker (merge)**

- **Merge Worker** — [PR #268](https://github.com/jpshackelford/voice-relay/pull/268) `fix(client): interleave kiosk timeline by normalizing OH event timestamps`
  - Conversation: https://app.all-hands.dev/conversations/e7848d755746461bb7b25934290178e9
  - Rationale: PR #268 is fully green — `isDraft=false`, `mergeable=MERGEABLE`, CI=SUCCESS, all 3 review threads resolved, `reviewDecision=null` (bot-only reviewer). Cleanest merge candidate. Worker will update PR description, squash-merge with `Fixes #264`, verify auto-close, and post a heads-up on #265 if its PR is open by then (to flag the shared `KioskMode.tsx` `timeline` `useMemo` touchpoint).

**Current State:**
- **Open PRs:**
  - [PR #268](https://github.com/jpshackelford/voice-relay/pull/268) — `oRFC green ready` (merge worker `e7848d7` taking it over the line)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (STUCK since 2026-05-18, skipped)
- **Ready issues queued (awaiting impl slot):**
  - #263 — `priority:medium` enhancement (migration tooling)
  - #269 — `priority:medium` client (timeline hydration; depends on REST endpoint from PR #266 — now merged, so unblocked)
  - #261 — `audit` + ready, **no priority label** (needs `/assess-priority` before impl)
- **In progress (impl):** #265 — `20876eb`
- **On-hold (skipped):** #208, #210, #239
- **No issues need expansion** (all open non-on-hold issues already have `ready`)

**Slot Usage (after spawn):**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues need expansion |
| Implementation | 1 | 1 | #265 — `20876eb` (running) |
| Review/Merge | 1 | 2 | PR #268 merge — `e7848d7`; PR #221 stuck; 1 review slot free |

**Decision rationale:**
- PR #268 was the obvious next action: all merge criteria satisfied (CI green, no human reviewer, threads resolved, no conflicts). Merge worker (not review worker) because there's nothing left to address.
- Impl slot still occupied by `20876eb` (#265). Cannot spawn second impl.
- No second review/merge worker spawned: PR #221 is `needs-human` (STUCK), and the only other open PR (#268) is being merged. No new PRs in flight.
- No expansion workers spawned: every non-on-hold open issue already has `ready` label.
- Bookkeeping: cleaned up stale `be830dd` slot entry (worker had finished but state hadn't been updated). Completed array now holds 29 entries within the 24h audit window.

**Next cycle:**
- If `e7848d7` merges PR #268: dispatch impl for next priority `ready` issue (`#263` or `#269` — preference is `#269` since it can now consume the REST endpoint from PR #266 that just merged, and the kiosk timeline base in PR #268 will also be on main). But hold if `20876eb` (issue #265) hasn't opened its PR yet — wait one cycle to avoid pile-up.
- If `20876eb` opens a PR: review/CI handling next cycle. Coordinate rebase if PR #268 already merged.
- #261 still needs `/assess-priority` before it can be picked up.
- No new productive work would be a quiet cycle → check auto-disable threshold at next wake-up.

---

### 2026-05-22 02:55 UTC - Review-Response Worker (PR #268, issue #264)

🔁 **Addressed all 3 github-actions[bot] review threads on PR [#268](https://github.com/jpshackelford/voice-relay/pull/268)** (`fix(client): interleave kiosk timeline by normalizing OH event timestamps`).

All three threads pointed to the same root cause: `parseOhTimestamp` returned an Invalid Date for unparseable strings, but callers (`KioskMode.tsx:374` truthiness check, `SessionView.tsx:174` `??` fallback) assumed `null` meant "invalid". Invalid Date is truthy and non-nullish, so both call sites silently produced `NaN` / Invalid-Date `receivedAt` on garbage input.

**Fix (commit `f91cb7b`):** normalize Invalid Date → `null` inside `parseOhTimestamp` itself. Single source-of-truth helper, no caller churn. Updated the one test that previously documented the Invalid-Date contract. All 558 client tests pass; CI green on all 4 required checks (Server Tests, Build Client, E2E Tests, lint-pr-title).

Resolved all 3 threads via GraphQL with replies pointing to the commit. PR moved back to **Ready for review**.

**Cross-issue reflection:** posted a [heads-up comment on #265](https://github.com/jpshackelford/voice-relay/issues/265#issuecomment-4514602451) — the Action+Observation pairing rework explicitly touches the same `KioskMode.tsx` `timeline` `useMemo` and will be re-using `parseOhTimestamp`. Flagged the new `null` contract and the recommendation to sort the paired entry by the action's timestamp (not the observation's) to avoid timeline reordering on slow observations.

No production-DB or migration impact — change is client-side only.

---

### 2026-05-22 02:52 UTC - Orchestrator

**Workers Completed (this cycle):**
- `7c69f80` (expansion, Issue #269) — finished → issue #269 now labeled `ready` + `priority:medium` + `client` (`feat(client): hydrate agent event timeline from persisted store and rehydrate on session render`).
- `c5e0d50` (merge, PR #266) — finished → **PR #266 squash-merged** at 02:38 UTC; issue #260 auto-closed by `Fixes #260`. Production now has agent_events table (migration 012) and REST rehydration endpoint.

**Active Workers (after this cycle's spawns):**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `be830dd` | review | PR #268 — kiosk timeline TZ fix (3 unresolved github-actions threads) | **NEW** |
| `20876eb` | implementation | Issue #265 — Pair Action+Observation event cards (priority:medium, client) | **NEW** |

**Spawned: 2 Workers (parallel)**

1. **Review Worker** — [PR #268](https://github.com/jpshackelford/voice-relay/pull/268) `fix(client): interleave kiosk timeline by normalizing OH event timestamps`
   - Conversation: https://app.all-hands.dev/conversations/be830dd241674ba2995bd73af16107dc
   - Rationale: 3 unresolved github-actions review threads (all suggesting Invalid Date guards / consistent handling around `parseOhTimestamp`). CI green, PR ready, age 25m. Worker will draft-→address-→ready and resolve threads via GraphQL.
2. **Implementation Worker** — [Issue #265](https://github.com/jpshackelford/voice-relay/issues/265) `Bug: Agent event cards render Action and Observation as separate entries (should be paired)` (priority:medium, bug, client)
   - Conversation: https://app.all-hands.dev/conversations/20876ebaa9b249c69f760972cdb8b047
   - Rationale: Highest-priority `ready` issue not in flight (#264 owned by PR #268). Prompt includes coordination note to read PR #268 first, since both PRs touch client agent-event rendering and a rebase may be needed if PR #268 merges first.

**Current State:**
- **Open PRs:**
  - [PR #268](https://github.com/jpshackelford/voice-relay/pull/268) — `oR green ready 💬3` (review worker `be830dd` addressing threads)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (STUCK since 2026-05-18, skipped)
- **Recently merged (this cycle):**
  - [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) — `feat(server): persist OpenHands agent events with TTL and REST rehydration` (merged 02:38 UTC; issue #260 auto-closed)
- **Ready issues queued (awaiting impl slot):**
  - #263 — `priority:medium` (migration tooling improvements)
  - #269 — `priority:medium` (just expanded; client hydration of agent event timeline; depends on the new REST endpoint from #266)
  - #261 — `audit` + ready, **no priority label** (needs `/assess-priority` before impl)
- **In progress (impl):** #265 — `20876eb`
- **On-hold (skipped):** #208, #210, #239

**Slot Usage (after spawn):**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues need expansion (all `ready` or `on-hold`) |
| Implementation | 1 | 1 | #265 — `20876eb` |
| Review/Merge | 1 | 2 | PR #268 — `be830dd`; PR #221 stuck; 1 review slot free |

**Decision rationale:**
- PR #266 fully cleared; #260 closed; nothing further to do on that thread.
- PR #268 has CI green and only feedback to address → spawn review worker (not merge worker — feedback unresolved).
- Impl slot freed (`68c1ccd` finished in prior cycle) → spawn highest-priority ready issue. #264 owned by PR #268, so next is #265 (priority:medium client bug). Chose #265 over #263 because both are `priority:medium` but #265 is a bug (preferred over enhancement at same priority).
- #269 left in queue: it's a client feature that depends on the just-merged REST endpoint and conceptually overlaps with #265's rendering changes; better to let #265 land first to avoid double-rebase on the same files.
- No new expansion work — every open non-on-hold issue is labeled `ready`.

**Next cycle:**
- If `be830dd` finishes with all threads resolved + CI green → spawn merge worker for PR #268.
- If `20876eb` opens a PR → review/CI handling next cycle.
- After #265 merges, dispatch impl for #263 (or #269 if PR #266 endpoint is now consumable client-side).
- #261 still needs `/assess-priority` before it can be picked up.

---

### 2026-05-22 02:38 UTC - Expansion Worker (Issue #269)

📋 **Expanded issue [#269](https://github.com/jpshackelford/voice-relay/issues/269)** — `feat(client): hydrate agent event timeline from persisted store and rehydrate on session render`.

- Rewrote issue body with sharpened **Problem Statement**, **Proposed Solution** (data flow + endpoint contract from PR #266's `agent-events/router.ts`), and 9-item **Acceptance Criteria** including a #264 regression guard.
- Flagged a **shape mismatch** to resolve: PR #266's router returns raw OH event JSON (`agent_events.raw_event`), but the kiosk pipeline consumes the post-processed `AgentAction` shape from `openhands.ts`'s `extractEventFields` / `extractEffectiveKind` / `formatEventSummary` / `normalizeOhTimestamp`. Default plan = small server-side mapping refactor (option B); option A (mirror on client) documented as fallback.
- Added technical-approach [comment](https://github.com/jpshackelford/voice-relay/issues/269#issuecomment-4514519242) covering: files to add (`useAgentEventHistory`, `api/agentEvents.ts`) + modify (`useAgentActions.ts` w/ `seedActions` + id-based dedupe, `SessionView.tsx`, `KioskMode.tsx`, `MobileMode.tsx`), UI state table, 4 test files (hook/api/component + #264 TZ regression test), risk notes on synthetic-event dedupe and `limit=500` pagination deferral.
- Cross-PR coordination called out: **hard dep on PR #266** (REST endpoint), **soft dep after PR #268** (`parseOhTimestampMs` + `mergeTimeline` only exist on that branch; landing hydration first would visibly regress #264 in non-UTC browsers). Conflict surface = `useAgentActions.ts` touched by both.
- Added `ready` label. Duplicate #270 already closed by orchestrator — did not re-file.

### 2026-05-22 02:41 UTC - Merge Worker (PR #266 → main → deploy)

🚀 **Squash-merged PR [#266](https://github.com/jpshackelford/voice-relay/pull/266)** — `feat(server): persist OpenHands agent events with TTL and REST rehydration`. Merge commit `0dbd66a8` at 2026-05-22T02:40:32Z. Issue [#260](https://github.com/jpshackelford/voice-relay/issues/260) auto-closed via `Fixes #260`.

**What landed on `main` / `vr.chorecraft.net`:**
- Migration `012_agent_events.ts` — purely additive (`CREATE TABLE IF NOT EXISTS agent_events` + 3 indexes incl. partial unique on `(conversation_id, event_id) WHERE event_id IS NOT NULL`). Both `up` and `down` defined. No FK constraints, so PRAGMA `foreign_keys=ON` enforced by #267's migration 013 is a no-op for this code path. Final migration order on main: `…011 → 012 (agent_events) → 013 (fk_orphan_cleanup)`.
- New `server/src/agent-events/` package: repository (`agent-event-repository.ts` w/ INSERT OR IGNORE + `pruneOlderThan`), REST rehydrator (`rehydrator.ts` — pagination, bounded retry/backoff honoring `Retry-After`, incremental persistence, single-flight per session), and router (`router.ts` — `GET /api/sessions/:sessionId/agent-events`, JWT + workspace-scoped, auto-rehydrates when local store empty + conversation id known).
- Live-ingest wiring in `openhands.ts` (event callback runs before kind dispatch) + `auto-connect.ts` (records `aiConversationId` on session metadata so rehydration knows what to fetch).
- Hourly TTL pruning loop in `index.ts`, default 7 days, tunable via `AGENT_EVENTS_TTL_DAYS`. Interval cleared on shutdown.

**Production safety check (pre-merge):**
- mergeStateStatus `CLEAN`, mergeable `MERGEABLE`, all 7 required CI checks green (Server Tests, Build Client, E2E Tests, lint-pr-title ×2, pr-review, enable-orchestrator).
- Verified locally: `npm test -w server` → 800/800 pass on the rebased branch.
- Reviewed migration 012 by hand: only `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` — no `ALTER`, no data backfill, no destructive ops. Safe to run against the live `sqlite.db`.
- Reviewed migration 013 coexistence: 013 (`fk_orphan_cleanup`) operates only on pre-existing tables (`workspace_settings`, `workspace_members`, `devices`, `sessions`, `qr_tokens`, `workspace_join_requests`, `session_devices`, `messages`) — it does not touch `agent_events`. No interaction.
- One review thread total on the PR (a github-actions TTL doc nit), resolved before the rebase and not reintroduced by the rebase.

**Ops notes for next restart of `vr.chorecraft.net`:**
- Migrator will apply 012 then 013 in order on the existing SQLite DB. Backup of `sqlite.db` recommended but not required (012 is additive; 013's only destructive ops target orphan rows that violate already-declared FKs, see #267 worklog).
- No new env vars required; `AGENT_EVENTS_TTL_DAYS` defaults to 7 if unset.
- No new runtime deps.

PR description was updated pre-merge to reflect the final rebased state (migration order, FK-interaction note, 800-test count). Squash commit body captures TTL behavior, rehydration endpoint, and migration 012 details for the changelog.

---

### 2026-05-22 02:36 UTC - Implementation Worker (PR #271 → closed as dup of #268, issue #264)

🔁 **Opened then closed PR [#271](https://github.com/jpshackelford/voice-relay/pull/271) as a duplicate** of [#268](https://github.com/jpshackelford/voice-relay/pull/268).

- Was dispatched against issue #264 (kiosk timeline TZ-parse + clock-source mismatch) without seeing that a parallel implementation worker had already opened #268 about 7 minutes earlier (02:24 UTC vs my push at 02:31 UTC). Independent fixes landed at substantially the same shape: server-side `normalizeOhTimestamp` + client `parseOhTimestamp` + plumbed `serverTimestamp` / `createdAt` on `RelayedTextMessage`. #268 is slightly broader (also touches `Workspace.tsx`, `storage/redis.ts`).
- CI on #271 was all green (Server Tests 774 ✅, Build Client ✅, E2E 1m26s ✅, lint-pr-title ✅ after retitling `fix(kiosk):` → `fix(client):`) before closing.
- Possibly worth cherry-picking into #268 from #271: the extracted pure `client/src/utils/timeline.ts#mergeTimeline` util (with 6 dedicated tests, including the explicit #264 regression case using a naive `2026-05-21T23:47:00.274606` action timestamp). Otherwise the substantive logic is duplicative.
- Branch `fix/264-kiosk-timeline-tz-normalization` remains pushed on the remote in case any of it is wanted; no other open follow-ups.
- **Lesson for orchestration**: future workers should check `gh pr list --search "issue:#NNN"` (or scan WORKLOG for the issue number) before opening a PR. Will note as a hardening item but not block on it.

---

### 2026-05-22 02:36 UTC - Orchestrator

> ✏️  **Edit note** (post-rebase): when this entry was authored I believed PR #271 was still open and the impl worker `68c1ccd` was still running. By push time, `68c1ccd` had already self-corrected by **closing PR #271 as a duplicate of PR #268** (see the worker's entry directly above). Status reflected below has been corrected; the original decision-time uncertainty is preserved in the rationale section for the audit trail.

**Workers Completed (this cycle):**
- `8a5f4bd` (review/conflict-resolution, PR #266) — finished → rebased `feat/agent-events-260` onto main, kept migration 012 (agent_events) + 013 (fk_orphan_cleanup) coexisting in order, CI green on rebased SHA `85312cc`, PR back to MERGEABLE/CLEAN and ready-for-review.
- `68c1ccd` (implementation, Issue #264) — **also finished** during this cycle. Opened [PR #268](https://github.com/jpshackelford/voice-relay/pull/268) `fix(client): interleave kiosk timeline by normalizing OH event timestamps` at 02:24 UTC (ready, MERGEABLE/CLEAN, CI green). Concurrently a parallel impl worker also dispatched against #264 opened [PR #271](https://github.com/jpshackelford/voice-relay/pull/271) at 02:31 UTC, then self-recognized the duplication and closed #271 in favor of #268 around 02:36 UTC. Final state for #264: a single canonical PR #268, ready, CLEAN, CI green.

**Active Workers (after this cycle's spawns):**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `c5e0d50` | review (merge) | PR #266 — agent events persistence | **NEW** |
| `7c69f80` | expansion | Issue #269 — client agent-event hydration | **NEW** |

**Spawned: 2 Workers (parallel)**

1. **Merge Worker** — [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) `feat(server): persist OpenHands agent events with TTL and REST rehydration`
   - Conversation: https://app.all-hands.dev/conversations/c5e0d507962b4c4a9f74cd75168737d3
   - Rationale: MERGEABLE/CLEAN, ready, CI green (Server Tests/Build Client/E2E/lint-pr-title/pr-review), all review threads resolved, conflict resolved by `8a5f4bd`. Closes #260 (priority:medium). Prompt emphasises additive migration-only schema (012) and FK-on no-op confirmation before squash-merge.
2. **Expansion Worker** — [Issue #269](https://github.com/jpshackelford/voice-relay/issues/269) `feat(client): hydrate agent event timeline from persisted store and rehydrate on session render` (priority:medium, client)
   - Conversation: https://app.all-hands.dev/conversations/7c69f80fa75849558fa8d0c3f14a2a91
   - Rationale: Only open non-on-hold issue lacking `ready` label after #270 dup-close. Depends on PR #266 endpoint contract; prompt instructs worker to coordinate with #264 timestamp-normalization fix (#268/#271).

**Housekeeping:**
- 🗑️  Closed [Issue #270](https://github.com/jpshackelford/voice-relay/issues/270) as a duplicate of #269 (identical body filed 6 seconds apart by the reporter).

**Current State (corrected post-rebase):**
- **Open PRs:**
  - [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) — `oRCFC green ready --` (merge in progress, worker `c5e0d50`)
  - [PR #268](https://github.com/jpshackelford/voice-relay/pull/268) — ready, CLEAN, CI green, **canonical fix for #264** (impl worker now finished)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (STUCK since 2026-05-18, skipped)
- **Open Issues (active):**
  - #264 — fix posted in PR #268, awaiting review + merge
  - #269 — expansion in progress (`7c69f80`)
- **Ready issues queued (awaiting impl slot):**
  - #261 — `audit`, **no priority label** (needs `/assess-priority` before impl)
  - #263 — `priority:medium` (migration tooling)
  - #265 — `priority:medium` (client bug: action+observation card pairing)
- **On-hold (skipped):** #208, #210, #239
- **Closed this cycle:** #270 (dup of #269), PR #271 (dup of #268 — closed by impl worker `68c1ccd`)

**Slot Usage (after spawn):**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 1 | 4 | #269 — `7c69f80` |
| Implementation | 0 | 1 | `68c1ccd` finished. Slot free; deferred to next cycle for priority-aware dispatch (likely #265 or #263). |
| Review/Merge | 1 | 2 | Merge worker for PR #266 — `c5e0d50`. PR #268 review/merge deferred to next cycle. |

**Decision rationale (at the moment the spawn decisions were made):**
- PR #266 has cleared every merge gate (rebased, CI green, reviews resolved). Spawning a merge worker is the obvious next action.
- Did not spawn a 2nd review/merge worker for PR #268 in this cycle: at decision time, the impl worker `68c1ccd` was still running and had just opened a 2nd PR (#271) with the same `Fixes #264`. Touching either PR while the worker was mid-flight risked a race. (Post-rebase update: `68c1ccd` resolved this itself by closing #271; next cycle can safely spawn a review/merge worker for #268.)
- Did not spawn an impl worker: the impl slot was held by `68c1ccd` at decision time. (Post-rebase: slot is now free, but we don't backfill mid-cycle — next orchestrator wake-up handles that.)
- Did spawn expansion for #269 (only remaining unexpanded non-on-hold issue), and closed #270 as a duplicate so we don't waste a slot on it.
- PR #221 still stuck on `needs-human` — left for human intervention.

**Notes / Risks:**
- Two impl workers were independently dispatched against issue #264 by an earlier cycle, producing the #268 / #271 race. The lesson logged by `68c1ccd` itself (worker entry above) — "future workers should check `gh pr list --search 'issue:#NNN'` (or scan WORKLOG for the issue number) before opening a PR" — is a real orchestration hardening item; tracked in the next cycle's TODO.
- Possibly worth a small follow-up: cherry-pick the standalone `client/src/utils/timeline.ts#mergeTimeline` util (with its 6 dedicated tests, including the explicit naive-ISO `2026-05-21T23:47:00.274606` regression) from the now-closed PR #271 into #268. Not a blocker — #268 already fixes #264 and has CI green.
- Worklog file is at ~750 lines — approaching the housekeeping window again but the 6-hour productive span isn't fully behind us yet, so deferring full archival to a future cycle.

**Next cycle:**
- If `c5e0d50` merges PR #266 → #260 auto-closes; reassess for #261/#263/#265 priorities.
- PR #268 (#264 fix) is now a clean merge candidate (ready, CLEAN, CI green) — spawn a review or merge worker.
- If `7c69f80` adds `ready` to #269 → joins the impl queue.
- #261 still needs `/assess-priority` inline before being eligible for the impl slot.
- Impl slot is free — next cycle will dispatch highest-priority ready issue (#263 or #265).

---

### 2026-05-22 02:32 UTC - Implementation Worker (PR #268, issue #264)

🐛 **Opened PR [#268](https://github.com/jpshackelford/voice-relay/pull/268)** — fix(client): interleave kiosk timeline by normalizing OH event timestamps (`Fixes #264`).

- RCA confirmed two-cause bug: (1) OH emits naive UTC ISO timestamps (no `Z`), parsed as local time by `new Date()` in non-UTC browsers — every agent event sorted after every utterance in EDT; (2) AI utterances stamped client-side with `new Date()` at receive time, agent events on OH's wall clock — two unrelated clocks mixed on the timeline.
- Fix surface (server-side normalization + plumbing as source of truth):
  - New `server/src/utils/timestamp.ts#normalizeOhTimestamp` — appends `Z` to naive ISO strings, returns `null` for garbage. 12 unit tests including the exact failing inputs from the RCA (`2026-05-21T23:46:59.274606`).
  - `openhands.ts` normalizes `event.timestamp` before stamping `AgentAction.timestamp` and the new `serverTimestamp` arg on the AI-relay callback.
  - `auto-connect.ts` plumbs `serverTimestamp` onto `RelayedTextMessage`.
  - `storage/sqlite.ts` now selects `created_at` and emits ISO Zulu `createdAt` so reconnect/history-replay renders historical messages with their original time, not page-load time. `memory.ts` / `redis.ts` stamp `createdAt` at append for parity.
  - `types.ts` (server + client): optional `serverTimestamp` / `createdAt` on `RelayedTextMessage` — backward compatible.
- Client-side consumption (defense-in-depth):
  - New `client/src/utils/parseOhTimestamp.ts` tolerates naive ISO strings if any sneak through cross-version deploys. 11 unit tests.
  - `SessionView.tsx` / `Workspace.tsx`: `handleTextMessage` uses `serverTimestamp`, `handleHistoryMessage` uses `createdAt` for `Utterance.receivedAt` (was `new Date()`).
  - `KioskMode.tsx`: parses `AgentAction.timestamp` via `parseOhTimestamp` before sorting the unified timeline.
- Regression coverage: 3 new KioskMode tests render mixed utterances + agent events and assert chronological interleaving; verified passing under both `TZ=UTC` and `TZ=America/New_York` (where the bug manifests).
- All checks green on the PR: Server Tests (756 tests) ✅, Build Client ✅, E2E Tests ✅ 1m28s, lint-pr-title ✅ (after retitling to conventional-commits prefix `fix(client):…`).
- No DB schema migration: SQLite `created_at` column already existed with `DEFAULT datetime('now')`; we just started reading it.
- PR flipped from draft to ready-for-review. Review handling: separate conversation.

---

### 2026-05-22 02:26 UTC - Conflict Worker (PR #266)

🔧 **Resolved merge conflict on PR [#266](https://github.com/jpshackelford/voice-relay/pull/266)** — feat(server): persist OpenHands agent events with TTL and REST rehydration

- Trigger: PR #267 squash-merged to main at 02:12 UTC; #266 went `mergeable=CONFLICTING / mergeStateStatus=DIRTY`.
- Conflict surface: single file — `server/src/storage/migrations/index.ts`. Both PRs registered a new migration entry/import; main carried `013_fk_orphan_cleanup` with a placeholder comment reserving slot 012 for this PR, while #266 carried `012_agent_events`. No other files conflicted.
- Resolution: rebased `feat/agent-events-260` onto `origin/main` and merged the index so both `migration012` and `migration013` import + register, in numeric order. No renumbering needed — #267 already reserved slot 012 for #266 by skipping it. Final migration sequence on the branch: `…011 → 012 (agent_events, this PR) → 013 (fk_orphan_cleanup, #267)`.
- FK-on regime check: `agent_events` declares no `FOREIGN KEY` constraints (session_id/workspace_id/conversation_id are plain TEXT), so #267's new `PRAGMA foreign_keys = ON` default is a no-op for inserts in this PR's code path. No data-flow changes required.
- Local verification on rebased branch: `npm install` + `npm test -w server` → **800/800 tests pass**; `npm run build -w server` → clean tsc.
- Push: `git push --force-with-lease` → branch updated to `85312cc`. PR auto-flipped to MERGEABLE/CLEAN.
- CI on rebased SHA: Server Tests ✅ 30s, Build Client ✅ 19s, E2E Tests ✅ 1m34s, lint-pr-title ✅, pr-review re-run pending (non-required).
- PR description: appended a "Rebase note (2026-05-22)" section explaining the coexistence with #267 and the FK-no-op rationale; main body otherwise unchanged (migration version still 012).
- PR set back to **ready-for-review**. Awaiting orchestrator's next cycle to spawn a merge worker.

---

### 2026-05-22 02:21 UTC - Orchestrator

**Workers Completed (this cycle):**
- `f0caf18` (implementation, Issue #262) — finished → opened/merged [PR #267](https://github.com/jpshackelford/voice-relay/pull/267) `fix(db): enforce SQLite FK + WAL` (squash-merged 02:12 UTC, issue #262 auto-closed).
- `003c227` (review, PR #266) — finished → resolved the 1 outstanding github-actions thread (PR description TTL doc mismatch) at 02:10 UTC; CI green; PR flipped back to ready.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `8a5f4bd` | review (conflict-resolution) | PR #266 — agent events persistence | **NEW** |
| `68c1ccd` | implementation | Issue #264 — Kiosk timeline TZ parse + clock-source bug (priority:high) | **NEW** |

**Spawned: 2 Workers (parallel)**

1. **Review/Conflict-Resolution Worker** — [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) `feat(server): persist OpenHands agent events with TTL and REST rehydration`
   - Conversation: https://app.all-hands.dev/conversations/8a5f4bd23cbc465e8bdac715465cd343
   - Reason: PR #266 mergeable=CONFLICTING / DIRTY after PR #267 squash-merged to main. CI is green and all review threads resolved — only blocker is rebase/merge against new `PRAGMA foreign_keys=ON` + migration 013. Worker will rebase onto main, renumber migration if needed, verify FK-on behavior, push, re-ready.
2. **Implementation Worker** — Issue [#264](https://github.com/jpshackelford/voice-relay/issues/264) `Kiosk timeline TZ parse + clock-source mismatch` (priority:high, bug, client)
   - Conversation: https://app.all-hands.dev/conversations/68c1ccd592fe485b80913d4e327586a3
   - Reason: Highest-priority `ready` issue; expansion is complete (root cause + fix shape confirmed by reporter at `e304e3d`). Worker will fix server-side timestamp normalization (`server/src/openhands.ts:1454`) + client-side merge ordering (`client/src/components/KioskMode.tsx:352-377`), add tests covering non-UTC TZ.

**Current State:**
- **Open PRs:**
  - [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) — `o pending dirty` (conflicts; worker `8a5f4bd` resolving)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (STUCK, skipped; awaiting manual conflict resolution since 2026-05-18)
- **Recently merged:**
  - [PR #267](https://github.com/jpshackelford/voice-relay/pull/267) — `fix(db): enforce SQLite FK + WAL + migration 013 fk_orphan_cleanup` (merged 02:12 UTC; issue #262 closed)
- **Ready issues queued (awaiting impl slot):**
  - #263 — `priority:medium` enhancement (migration tooling improvements)
  - #265 — `priority:medium` client bug (action+observation pairing)
  - #261 — `audit` + ready, **no priority label** (needs `/assess-priority` before impl)
  - #260 — `priority:medium` — being implemented by PR #266 in flight (will auto-close on merge)
- **On-hold (skipped):** #208, #210, #239
- **In progress (impl):** #264 — `68c1ccd`
- **All issues are now `ready` or on-hold** — no expansion work pending.

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues need expansion |
| Implementation | 1 | 1 | #264 — `68c1ccd` |
| Review/Merge | 1 | 2 | PR #266 conflict-resolution — `8a5f4bd`; 1 slot still free |

**Decision rationale:**
- Both prior workers had finished (state file was stale from the 01:36 entry). State file cleaned up; 30 completed entries retained (24h audit window).
- PR #266: CI green + reviews resolved + only blocker is a mechanical merge conflict from #267 → review worker (not merge worker yet — must clear conflict + verify FK-on first).
- Spawned impl in parallel because PR slot conflict-resolution doesn't block new implementation work; #264 is independent (client bug + server timestamp normalization) and shouldn't collide with the agent-events code in PR #266 if based on current main.
- Did NOT spawn a second review worker (only PR #266 is actionable; PR #221 stuck on `needs-human`).
- Did NOT spawn expansion workers — every open non-on-hold issue already has `ready`.

**Next cycle:**
- If `8a5f4bd` finishes and PR #266 is mergeable+approved → spawn merge worker.
- If `8a5f4bd` hits gnarly conflicts and adds `needs-human` → defer PR #266, free the review slot.
- If `68c1ccd` produces a PR and CI not green or comments appear → spawn review worker for that PR.
- After #264 impl, the remaining priority-tagged `ready` queue is: #263 → #265 → (#261 once `/assess-priority` is run).

---

### 2026-05-22 02:12 UTC - Merge Worker (PR #267)

✅ **Merged PR [#267](https://github.com/jpshackelford/voice-relay/pull/267)** — fix(db): enforce SQLite foreign keys + WAL with startup assertion

- Squash-merge commit: [`227609e`](https://github.com/jpshackelford/voice-relay/commit/227609e63e4516ec55e8b3b43fde1645a40b71e5)
- Linked issue **#262** auto-closed by `Fixes #262` trailer (closedAt 02:11:54 UTC, stateReason COMPLETED).
- CI was green (Server Tests, Build Client, E2E Tests, lint-pr-title, pr-review). Mergeable=CLEAN. Zero unresolved review threads.
- Production-safety review before merge:
  - **Startup assertion** is a post-set readback of `PRAGMA foreign_keys`. Enabling FK enforcement only applies prospectively — it does **not** re-validate existing rows, so the assertion cannot fire against latent orphans on first boot.
  - **Migration 013 (`fk_orphan_cleanup`)** runs in the migrator's per-migration transaction with FK already on. Uses `DELETE … WHERE … NOT IN (SELECT id …)` and `UPDATE … SET col = NULL` patterns — neither can itself violate a FK. Cascade chains may fire and are intended (orphan sessions cascade to `session_devices` + `SET NULL` `messages.session_id`). If the migration throws, the transaction rolls back, the DB is untouched, and `connect()` rejects — systemd restarts the process.
  - **WAL switch** is persisted in the DB header. Sidecar `*-wal`/`*-shm` files appear next to `sqlite.db`; older builds remain compatible. Rollback safe per the runbook.
  - PR description updated with an explicit "Migration notes (first boot against existing prod DB)" section before merge.
- Automated `github-actions` review verdict: 🟢 Worth merging (MEDIUM risk, well mitigated).
- Production auto-deploys to `vr.chorecraft.net` from main; the runbook at `docs/runbooks/sqlite-fk-enforcement.md` documents the post-deploy verification (`PRAGMA journal_mode;` should report `wal` on the live DB).

---

### 2026-05-22 02:10 UTC - Review Worker (PR #266)

✅ **Resolved review feedback on PR [#266](https://github.com/jpshackelford/voice-relay/pull/266)** — feat(server): persist OpenHands agent events with TTL and REST rehydration

- 1 unresolved thread from `github-actions` reviewer: PR description had `Default 14 days` in two spots while code uses `7`. Code is the source of truth (`server/src/index.ts:994` — `AGENT_EVENTS_TTL_DAYS ?? 7`; comment at L992 also says 7-day retention).
- Fix: updated PR description on both lines (TTL pruning bullet + Deployment notes "Tunable" bullet) to read `default 7`. No code or repo-doc changes — `docs/` and `README.md` have no agent-events TTL references.
- Replied on the thread (commit reference: PR description edit) and resolved it via GraphQL.
- CI: green across the board (Build Client, Server Tests, E2E Tests, lint-pr-title, pr-review).
- PR flipped to draft during edits per workflow, then back to ready-for-review.
- No follow-up issues created — the inconsistency was confined to the PR body.

---

### 2026-05-22 01:53 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `f0caf18` | implementation | Issue #262 — Persist agent events on socket close | running |
| `003c227` | review | PR #266 — feat(server): persist OpenHands agent events | **NEW** |

**Worker Completed:** `8076d90` (expansion) — Issue #264 now `ready` (labels: bug, ready, priority:high, client)

**Spawned: Review Worker**
- PR: [#266](https://github.com/jpshackelford/voice-relay/pull/266) (feat/agent-events-260)
- Conversation: [`003c227`](https://app.all-hands.dev/conversations/003c227bc8234991a25eff3a2c9798f2)
- Task: resolve unresolved review thread — TTL default mismatch in PR description (claims 14d; another section says 7d; code uses 14d). Worker to harmonize code/docs/PR description and resolve the thread.

**Current State:**
- Open PRs:
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (stuck on merge conflicts since 2026-05-18, skipped)
  - [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) — review worker dispatched
- Issues:
  - Ready, prioritized: #264 (priority:high), #260 (in PR #266), others
  - In flight (impl): #262
  - Awaiting expansion: #261, #263
  - On-hold (skip): #208, #210, #239
- Slots: expansion 0/4, implementation 1/1, review 1/2

**Action Taken:**
🚀 Spawned review worker for PR #266; moved expansion #264 to completed; impl slot remains occupied by #262.

---

### 2026-05-22 01:50 UTC - Implementation Worker

✅ **Implemented Issue #262** — SQLite foreign keys not enforced in production

- Issue: [#262](https://github.com/jpshackelford/voice-relay/issues/262)
- PR: [#267](https://github.com/jpshackelford/voice-relay/pull/267) (ready for review)
- Scope: explicit pragmas + startup assertion + orphan cleanup migration + read-only audit script
- Files (+917 LOC): `server/src/storage/sqlite.ts` (4 pragmas + fail-fast assertion), `server/src/storage/migrations/013_fk_orphan_cleanup.ts` (sweep CASCADE/SET-NULL orphans inside the migrator's transaction), `server/src/storage/audit-orphans.ts` (library + tests), `scripts/audit-orphans.ts` (CLI wrapper, exits 1 on orphans), `docs/runbooks/sqlite-fk-enforcement.md`, plus FK tests in `server/src/storage/sqlite.test.ts`.
- Design highlights:
  - `journal_mode=WAL` (persistent), `foreign_keys=ON`, `synchronous=NORMAL`, `busy_timeout=5000` set BEFORE migrations run; readback asserts `foreign_keys=1` and throws otherwise.
  - Migration `013` skips number `012` intentionally (PR #266 has reserved 012 for the in-flight `agent_events` work; merge order isn't guaranteed). The migrator tracks applied versions by exact number, so gaps are fine.
  - Cleanup migration leaves `workspaces.owner_id → users.id` orphans alone (declared RESTRICT — deleting a whole workspace because a user record disappeared would be more destructive than the orphan ref). All other FKs are CASCADE/SET-NULL and are swept clean.
  - Cleanup is non-reversible by construction; down migration is a no-op `SELECT 1` and the runbook documents the rationale.
- Tests (15 new): cascade fires, FK violations rejected, SET NULL on `messages.session_id`, startup assertion throws when pragma readback is 0 (via `vi.spyOn` of `better-sqlite3` prototype), pragma readbacks, audit detects every FK category, audit ignores legitimate NULLs, migration 013 round-trip cleans what the audit reports, forward-compat skips for missing tables/columns, formatter renders non-zero counts. Coverage on changed code: `sqlite.ts` 100/91, `audit-orphans.ts` 100/80, `013_*` 100/100 (lines/branches).
- Full server suite green (759 tests). CI green (lint-pr-title, Build Client, Server Tests, E2E Tests).
- Follow-up logged (out of scope here): `messages.workspace_id` has no FK declaration (added as plain TEXT in migration 004); fixing it needs a table rebuild — worth a separate issue.

---

### 2026-05-22 01:38 UTC - Expansion Worker

✅ **Expanded Issue #264** — Kiosk timeline does not interleave utterances and agent events (TZ parse + clock-source mismatch)

- Issue: [#264](https://github.com/jpshackelford/voice-relay/issues/264)
- Type: Bug (client symptom; root cause is server-side timestamp emission, fix spans both)
- Status: Ready for implementation (`ready` label applied)
- Verification: cited code paths confirmed at HEAD `e304e3d` — `KioskMode.tsx:352-377` mixes browser `Date` with naive OH ISO string; `server/src/openhands.ts:1454` forwards `event.timestamp` unmodified; `SessionView.tsx:159-191` re-stamps history to `new Date()`. Reproduced TZ parse skew with V8 under `TZ=America/New_York` (+4 h delta = 14,400,000 ms, matches issue body's trace).
- Minor correction to author's analysis: `messages.created_at` exists in SQLite but is NOT in current SELECTs or `RelayedTextMessage`; step (2) of the fix needs to also add the column to the SELECTs and the type. Also flagged that SQLite's `datetime('now')` emits a space-separated form — normalizer must handle both `T` and space variants.
- Recommended fix surface posted as a comment: `normalizeOhTimestamp` helper in server; plumb `serverTimestamp` onto `RelayedTextMessage`; include `createdAt` in history payload; client uses server timestamps when present, falls back to `new Date()`; defensive `parseOhTimestamp` util on client.
- Sequencing: lands before #265 (which sorts paired entries by `action.timestamp`); ideally before/with #260 so new `agent_events.event_timestamp` rows inherit normalized `Z` values.

---

### 2026-05-22 01:36 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `f0caf18` | implementation | Issue #262 — SQLite FK not enforced (priority:high bug) | **NEW** |
| `8076d90` | expansion | Issue #264 — Kiosk timeline TZ parse bug (priority:high) | **NEW** |

**Worker Completed (this cycle):**
- `7960a5b` (implementation, Issue #260) — finished → opened [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) `feat(server): persist OpenHands agent events with TTL and REST rehydration` (ready, CI pending, no review comments yet)

**Spawned: 2 Workers (parallel)**

1. **Implementation Worker** — Issue [#262](https://github.com/jpshackelford/voice-relay/issues/262) (priority:high bug, ready)
   - Conversation: https://app.all-hands.dev/conversations/f0caf181d96c4c548fa2930fe5fda41b
   - Note: enabling `PRAGMA foreign_keys=ON` can surface latent FK violations in the live sqlite.db; prompt emphasises data-safe migration.
2. **Expansion Worker** — Issue [#264](https://github.com/jpshackelford/voice-relay/issues/264) (priority:high bug, no ready label yet)
   - Conversation: https://app.all-hands.dev/conversations/8076d90c63b84eb68096e3232b830d3b
   - Note: issue body already contains a detailed root-cause analysis — worker just needs to verify and label `ready`.

**Current State:**
- **Open PRs:**
  - [PR #266](https://github.com/jpshackelford/voice-relay/pull/266) — `o pending ready --` (just opened by `7960a5b`, CI not green yet, no reviews requested → no review worker spawned)
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (STUCK, skipped; awaiting human conflict resolution since 2026-05-18)
- **Ready issues queued (awaiting impl slot):**
  - #261 — `audit`, no priority label yet (needs `/assess-priority` before impl)
  - #263 — `priority:medium` enhancement (migration tooling)
  - #265 — `priority:medium` client bug (action+observation pairing)
- **Open issues being expanded:** #264 → expansion worker `8076d90`
- **On-hold (skipped):** #208, #210, #239

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 1 | 4 | #264 |
| Implementation | 1 | 1 | #262 (highest-priority ready issue) |
| Review/Merge | 0 | 2 | PR #266 too new (no review feedback yet); PR #221 stuck |

**Decision:** Impl slot freed when `7960a5b` finished → spawned impl for the highest-priority ready issue (#262, priority:high bug). #264 was the only open issue lacking `ready` → spawned expansion. Did NOT spawn a review worker for PR #266: it was just opened (~4 min ago), CI is still pending, and no human/bot review comments exist; a review worker would have nothing to address. Will reassess next cycle.

**Next cycle:**
- If PR #266 has CI failures or new review comments, spawn a review worker.
- When `f0caf18` (impl #262) finishes, spawn impl for next priority ready issue (likely #263 or #265).
- If `8076d90` adds `ready` to #264, it joins the impl queue.
- #261 still needs `/assess-priority` before it can be picked up — handle inline when impl slot next frees and #261 is the front of the queue.

---

### 2026-05-22 01:35 UTC - Implementation Worker

✅ **Implemented Issue #260** — Persist OpenHands agent events with TTL and on-demand REST rehydration

- Issue: [#260](https://github.com/jpshackelford/voice-relay/issues/260)
- PR: [#266](https://github.com/jpshackelford/voice-relay/pull/266) (ready for review)
- Scope: schema migration 012 + repository + live WS ingest + REST rehydrator + read API + TTL pruning
- Files (net +1777 LOC): `server/src/storage/migrations/012_agent_events.ts`, `server/src/storage/agent-event-repository.{ts,test.ts}`, `server/src/agent-events/{index,router,rehydrator}.ts` (+ tests), `server/src/openhands.ts` (added `OpenHandsApiError` + `getEventsPage` pagination + `EventCallback`), `server/src/auto-connect.ts` (persists `aiConversationId` on session metadata), `server/src/index.ts` (wires repo, callback, router, TTL interval), `server/src/storage/migrations/index.ts`
- Design highlights:
  - Partial unique index `(conversation_id, event_id) WHERE event_id IS NOT NULL` gives natural-key dedup so `INSERT OR IGNORE` works identically for live and REST writes.
  - `event_timestamp` (OH clock) drives read ordering; `hydrated_at` (our clock) drives TTL.
  - Rehydrator does bounded exponential backoff (5 retries) honoring `Retry-After`, single-flights concurrent requests per session, and persists each page incrementally so a late failure doesn't lose earlier pages.
  - Read endpoint auto-triggers rehydration only when local store is empty AND `aiConversationId` is known — avoids redundant API calls on every read.
  - TTL configurable via `AGENT_EVENTS_TTL_DAYS` (default 14), pruned hourly; interval cleared on shutdown.
- Tests (41 new): repository (19), rehydrator (12), router (10). Coverage on new code aggregate **87.6% lines / 90% functions / 83.4% branches** — above the 80% bar.
- Verified migration on fresh DB + an existing-data DB at v11 + a down-then-up cycle; no rows lost.
- Full suite (785 existing + 41 new) green; CI green (lint-pr-title, Build Client, Server Tests, E2E Tests).

---

### 2026-05-22 01:19 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `7960a5b` | implementation | Issue #260 — Persist OpenHands agent events | running |
| `227081b` | expansion | Issue #261 — Remove unused storage drivers | finished ✓ |
| `71bff4b` | expansion | Issue #262 — SQLite FK not enforced | finished ✓ |
| `fb5fe6f` | expansion | Issue #263 — Migration tooling improvements | finished ✓ |

**Workers Completed:** 3 expansion workers all finished — issues #261, #262, #263 now carry the `ready` label.

**Current State:**
- **Open PRs:** 1 — [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) `needs-human` (STUCK, skipped)
- **Ready issues queued for impl:**
  - #262 — `priority:high` bug (SQLite FK) ← next up when impl slot frees
  - #261 — `audit` (no priority label yet; needs `/assess-priority`)
  - #263 — `priority:medium` enhancement
- **In progress:** #260 — `priority:medium` (impl worker `7960a5b` still running)
- **On-hold (skipped):** #208, #210, #239

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues to expand (others on-hold) |
| Implementation | 1 | 1 | #260 — `7960a5b` still running |
| Review/Merge | 0 | 2 | PR #221 stuck; no other PRs |

**Action Taken:** ⏳ **Waiting** — impl slot occupied; cannot start another implementation until `7960a5b` completes. Three newly-ready issues are queued. PR #221 remains stuck (needs human). State file updated to move the 3 finished expansion workers to `completed`.

**Next cycle:** When `7960a5b` finishes, spawn an impl worker for #262 (highest priority `ready` issue). If #260 produced a PR, spawn a review worker once it's ready.

---

### 2026-05-22 01:15 UTC - Expansion Worker

✅ **Expanded Issue #262**

- Issue: [Bug: SQLite foreign keys not enforced in production (PRAGMA foreign_keys=0)](https://github.com/jpshackelford/voice-relay/issues/262)
- Type: Bug (data integrity)
- Status: Ready for implementation (`ready` label applied)
- Root cause: `SQLiteStore.connect()` (server/src/storage/sqlite.ts) opens the DB with `new Database(path)` and never issues any PRAGMA. FK enforcement currently depends implicitly on the better-sqlite3 prebuilt binary's `SQLITE_DEFAULT_FOREIGN_KEYS=1` compile flag, with no startup assertion. Persistent `journal_mode = delete` on prod confirms no PRAGMA setup is happening; WAL is also missing.
- Verified: reproduced locally with better-sqlite3 v11.10.0 — fresh connection reports `foreign_keys=1`, `journal_mode=delete`. Clarified in the rewritten body that the production `PRAGMA foreign_keys=0` reading is from an external sqlite3 CLI (per-connection setting) — useful evidence but the actual app connection state is implicit, not asserted. Fix still required for defense-in-depth + WAL + orphan audit.
- Approach: set `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, `busy_timeout=5000` in `connect()` before migrations; add startup assertion that aborts if FK not enabled; add `scripts/audit-orphans.ts` to enumerate orphan rows for every declared FK; gate the PRAGMA deploy on running the audit + a cleanup migration (proposed `012_fk_orphan_cleanup.ts`); add unit tests for cascade-fires and FK-violation-rejected.
- Noted: `messages.workspace_id` has no FK declaration (added as plain TEXT in migration 004) — flagged as optional follow-up.

---

### 2026-05-22 01:15 UTC - Expansion Worker

✅ **Expanded Issue #263** — Migration tooling improvements: CLI, drift detection, advisory locking

- Issue: [#263](https://github.com/jpshackelford/voice-relay/issues/263)
- Type: Enhancement (operational hardening)
- Status: Ready for implementation (added `ready` label)
- Approach: Restructured body into Problem Statement / Proposed Solution / Acceptance Criteria / Out of Scope. Added a technical-approach comment covering per-feature design, ordered implementation plan, files affected, and risks.
- Key design decision: Introduced a `MigrationLock` interface with a `SQLiteTableLock` (BEGIN IMMEDIATE + sentinel-row + 5-min stale TTL) implementation that ports cleanly to `pg_advisory_lock()` for the future Postgres driver (#261). Interface intentionally minimal (`acquire(timeoutMs)` / `release()`) so callers cannot depend on driver-specific semantics.
- Dropped `error` column from original scope (transactions roll back; logs are the right surface). Kept `sql_hash` + `duration_ms`.
- Scope size: ~400–600 LOC + tests across 8 implementation steps; recommended ordering keeps each step PR-sized.

---

### 2026-05-22 01:15 UTC - Expansion Worker

✅ **Expanded Issue #261**

- Issue: [Remove unused storage drivers (redis, firestore, memory) in preparation for Postgres](https://github.com/jpshackelford/voice-relay/issues/261)
- Type: Enhancement / Cleanup
- Status: Ready for implementation (`ready` label applied)
- Approach: Delete `memory.ts`, `redis.ts`, `firestore.ts`, `memory.test.ts`; narrow `StoreConfig['driver']` to `'sqlite'`; uninstall `redis` dep; clean README/JSDoc; reject unknown `STORE_DRIVER` at startup. Multi-driver pattern (`MessageStore` + `createStore` switch) preserved so Postgres (#263) can plug in cleanly.
- Verified: only `server/src/storage/` files reference the dead drivers; consumers (`server/src/index.ts`, `server/src/auto-connect.ts`) use only `MessageStore` + `SQLiteStore`; `.env.example`, `docs/DEPLOYMENT.md`, `tests/global-setup.ts` already pin `sqlite`.

---

### 2026-05-22 01:12 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `7960a5b` | implementation | Issue #260 — Persist OpenHands agent events (priority:medium) | **NEW** |
| `227081b` | expansion | Issue #261 — Remove unused storage drivers | **NEW** |
| `71bff4b` | expansion | Issue #262 — SQLite FK not enforced (priority:high bug) | **NEW** |
| `fb5fe6f` | expansion | Issue #263 — Migration tooling improvements (priority:medium) | **NEW** |

**Spawned: 4 Workers (parallel)**

1. **Implementation Worker** — Issue [#260](https://github.com/jpshackelford/voice-relay/issues/260)
   - Conversation: https://app.all-hands.dev/conversations/7960a5ba03a443f58eaa46c5c9734afb
   - Priority assessed inline as `priority:medium` (feature work, well-expanded design)
2. **Expansion Worker** — Issue [#261](https://github.com/jpshackelford/voice-relay/issues/261)
   - Conversation: https://app.all-hands.dev/conversations/227081b8be384806a7f7d1c2aa32b596
3. **Expansion Worker** — Issue [#262](https://github.com/jpshackelford/voice-relay/issues/262)
   - Conversation: https://app.all-hands.dev/conversations/71bff4b00c624163837fa953fab5a04c
4. **Expansion Worker** — Issue [#263](https://github.com/jpshackelford/voice-relay/issues/263)
   - Conversation: https://app.all-hands.dev/conversations/fb5fe6f24d2e478e887e7e66aeb7f2de

**Current State:**
- **Open PRs:** 1 — [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) `needs-human` (STUCK, skipped — awaiting human conflict resolution since 2026-05-18)
- **Open Issues (active):** #260 (ready→impl), #261, #262, #263 (all → expansion)
- **Open Issues (on-hold, skipped):** #208, #210, #239

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 3 | 4 | #261, #262, #263 |
| Implementation | 1 | 1 | #260 |
| Review/Merge | 0 | 2 | PR #221 stuck — only open PR; not assigned a review worker |

**Decision:** Automation was re-triggered after being auto-disabled at 23:34 UTC on 2026-05-21. Since then, four new issues have appeared (#260–#263). Spawned 4 workers to clear the backlog in parallel — 1 implementation (only `ready` issue) + 3 expansion (the remaining non-on-hold issues). PR #221 is still stuck and is left for human intervention. Quiet streak is broken — this is a productive run.

**Notes:**
- One spawn attempt hit a 429 rate limit (10 req/sec) on the first try; succeeded on retry.
- `.workflow-state.json` updated to reflect the 4 new workers.

---

### 2026-05-21 23:34 UTC - Orchestrator

🔒 **Auto-disabled due to inactivity**

Three consecutive quiet periods detected (23:05, 23:17, 23:34 UTC) — no new actionable work to pick up. Automation has been disabled to prevent unnecessary runs.

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | — | — | — |

**Current State (unchanged since 23:05 UTC):**
- **Open PRs:** 1
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (draft, last updated 2026-05-18; **STUCK** — awaiting human conflict resolution)
- **Open Issues:** 3 (all `on-hold`, deferred by humans)
  - #208 — Add circuit breaker to prevent deployments when critical CI issues exist
  - #210 — Categorize deployment failures to improve automated response
  - #239 — Flaky AI integration tests due to OpenHands API reliability issues

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues to expand (all on-hold) |
| Implementation | 0 | 1 | No `ready` issues to implement |
| Review/Merge | 0 | 2 | PR #221 stuck (`needs-human`); no other PRs |

**Disabled Automation:** `5f180989-ed9c-42b4-ac9f-5f30f0623316` — "Voice Relay Workflow Orchestrator v2" (cron `*/15 * * * *`, America/New_York)

> ⚠️ **Note:** The skill documented automation ID `a0219382-2e7c-4156-9991-7b9976739a66` (renamed "(old)") was already disabled. The currently active orchestrator is `5f180989-...` ("v2"). Skill text should be updated to reference the v2 ID.

**To re-enable:**
- OpenHands UI: https://app.all-hands.dev/automations → find "Voice Relay Workflow Orchestrator v2" → toggle on
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```

**Re-enable triggers:**
- Human resolves merge conflicts on PR #221, OR
- Any `on-hold` label is removed from issues #208/#210/#239, OR
- New issues / PRs are filed

---

### 2026-05-21 23:17 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | — | — | — |

✅ **All quiet** - No actionable work available

**Current State:**
- **Open PRs:** 1
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (draft, CONFLICTING/DIRTY; **STUCK** — last updated 2026-05-18, awaiting human conflict resolution)
- **Open Issues:** 3 (all `on-hold`, deferred by humans)
  - #208 — Add circuit breaker to prevent deployments when critical CI issues exist
  - #210 — Categorize deployment failures to improve automated response
  - #239 — Flaky AI integration tests due to OpenHands API reliability issues

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues to expand (all on-hold) |
| Implementation | 0 | 1 | No `ready` issues to implement |
| Review/Merge | 0 | 2 | PR #221 stuck (`needs-human`); no other PRs |

**Decision:** State unchanged since 23:05 UTC orchestrator run. All available work is either stuck (PR #221) or on-hold (3 issues). No workers spawned.

**Quiet Streak:** This is the **2nd consecutive** quiet entry (prior: 23:05 UTC). One more consecutive quiet run will trigger auto-disable of automation `a0219382-2e7c-4156-9991-7b9976739a66`.

---

### 2026-05-21 23:05 UTC - Orchestrator

**Worker Completed:** `0df29e2` (merge) → ✅ **Merged PR #259** (squash `480ddd8` at 22:55:15Z) — auto-deploying to vr.chorecraft.net

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | — | — | — |

✅ **All quiet** - No actionable work available

**Current State:**
- **Open PRs:** 1
  - [PR #221](https://github.com/jpshackelford/voice-relay/pull/221) — `needs-human` (draft, CONFLICTING; **STUCK** — skipped, awaiting human intervention)
- **Open Issues:** 3 (all `on-hold`, deferred by humans)
  - #208 — Add circuit breaker to prevent deployments when critical CI issues exist
  - #210 — Categorize deployment failures to improve automated response
  - #239 — Flaky AI integration tests due to OpenHands API reliability issues

**Slot Usage:**
| Type | Active | Limit | Notes |
|------|--------|-------|-------|
| Expansion | 0 | 4 | No issues to expand (all on-hold) |
| Implementation | 0 | 1 | No `ready` issues to implement |
| Review/Merge | 0 | 2 | PR #221 is stuck (`needs-human`); no other PRs |

**Decision:** All available work is either stuck (PR #221 needs human) or deferred (3 on-hold issues). No workers spawned. Previous orchestrator runs at 22:21/22:33/22:53 UTC were productive — this is the **first** quiet entry in the current streak (no auto-disable triggered).

**Housekeeping:** WORKLOG.md was 888 lines — archived 23 older entries to `WORKLOG_ARCHIVE_2026-05-21.md` (kept 6h+ productive window: 13:15 UTC → 22:55 UTC). WORKLOG.md now 199 lines (+ this entry).

---

### 2026-05-21 22:55 UTC - Merge Worker

✅ **Merged PR #259**

- PR: [#259 - fix: honor event.summary and render missing event content (#258 follow-up)](https://github.com/jpshackelford/voice-relay/pull/259)
- Issue: None linked (follow-up to #258, which already closed #257)
- Squash commit: [`480ddd8`](https://github.com/jpshackelford/voice-relay/commit/480ddd85ea2ddd7f3189f300125a68dea02a1a0f)
- Merged by: jpshackelford
- Deploy: Auto-deploying to vr.chorecraft.net

**Summary:**
Follow-up to #258 closing four rendering gaps surfaced by post-merge validation against captured production events:
1. Server `formatEventSummary` now honors top-level `event.summary` on wrapped ActionEvent / ObservationEvent (was showing generic "Action" string).
2. Server `extractEventFields` now extracts file_editor `command`, ThinkObservation content, and InvokeSkill `skill_name` / `content` / `is_error`.
3. Client `getFileEditorActionContent` renders all four file_editor commands (view / create / str_replace / insert) — was create-only.
4. New client handlers for `InvokeSkillAction` / `InvokeSkillObservation`; `ThinkObservation` falls back to "Thought recorded." for empty content.

**Migration / Deployment Safety:**
- ✅ No DB migrations; SQLite schema untouched
- ✅ No new runtime dependencies; no package.json / lockfile changes
- ✅ No new config or env vars
- ✅ Additive change — legacy event paths preserved; already-stored events render unchanged
- ✅ Safe to auto-deploy

**Test Results:**
- 744 server tests pass (+11 new)
- 544 client tests pass (+8 new, 2 updated for corrected behavior)
- `npx tsx scripts/comprehensive-validation.ts` → 12/12 events pass, 0 summary issues

**Review Notes:**
- pr-review bot: 🟡 Acceptable — Recommended for approval
- All 6 CI checks green on first push; mergeStateStatus CLEAN, MERGEABLE
- No human-requested changes; replaces ghost worker `f9ebd19...` that failed silently

**Follow-up Items:**
- Watch vr.chorecraft.net deploy logs for healthy startup
- Spot-check live UI to confirm action cards now show real summaries and skill/think/file-editor cards render content
