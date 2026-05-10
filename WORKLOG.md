# Voice Relay Workflow Log

This file tracks orchestrator activity and human instructions for the voice-relay project.

## Workflow

The orchestrator works through **GitHub Issues** filed against this repository, one at a time:

1. Pick the next open issue (lowest number first)
2. Implement, test, create PR
3. Address reviews until merged
4. Move to next issue
5. Repeat until all issues are complete

**Current backlog:**
- [#9 - F1: Scope messages to sessions](https://github.com/jpshackelford/voice-relay/issues/9)
- [#10 - F2: Replace Dashboard with Workspace Home](https://github.com/jpshackelford/voice-relay/issues/10)
- [#11 - F3: Session View (remove setup, auto-detect mode, QR idle state)](https://github.com/jpshackelford/voice-relay/issues/11)
- [#12 - F4: Join session via QR code](https://github.com/jpshackelford/voice-relay/issues/12)

## How to Use

**Human instructions:** Add an entry like this and the orchestrator will follow it:
```markdown
## INSTRUCTION: Your instruction here
```

The orchestrator will acknowledge with `[ACKNOWLEDGED]` once processed.

---

## Log

### 2026-05-08 14:31 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | - | - | - |

🔒 **Auto-disabled due to extended waiting period**

**Housekeeping:**
- ✅ Closed #81 as duplicate of #74 (same root cause)

**Current State:**
- No open PRs
- Open issues: #74 (critical, infrastructure)
- Ready issues: None
- 5+ consecutive "Waiting" entries for infrastructure issue

**Reason for Disable:**
The only open issue (#74) requires **manual SSH intervention** to fix:
- Node.js version upgrade (20.18.3 → 20.19+)
- Corrupted node_modules cleanup

This is NOT a code bug - CI tests pass successfully. Automation cannot help until server is manually fixed.

**To re-enable after fixing the server:**
1. SSH to vr.chorecraft.net and run the fix commands from #74
2. Verify the app is healthy: `curl -s http://localhost:3000/api/health`
3. Close issue #74
4. Re-enable automation:
   - OpenHands UI: https://app.all-hands.dev/automations → "Voice Relay Workflow Orchestrator" → Enable
   - Or via API:
     ```bash
     curl -X PATCH "https://app.all-hands.dev/api/automation/v1/a0219382-2e7c-4156-9991-7b9976739a66" \
       -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
       -H "Content-Type: application/json" \
       -d '{"enabled": true}'
     ```

---
### 2026-05-10 00:43 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (this) | implementation | Issue #82 - AI toggle visibility | in-progress |

🚀 **Created: PR #83**
- PR: [#83 - fix(tests): open drawer before clicking AI toggle button](https://github.com/jpshackelford/voice-relay/pull/83)
- Issue: [#82 - Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/82)

**Root Cause Analysis:**
- The `.ai-toggle` button is inside the kiosk drawer
- Per F3 requirement, the drawer starts **collapsed** by default
- Tests tried to click the button without opening the drawer first
- PR #68's CSS fix works, but only when the drawer is open

**Fix Applied:**
- Added `ensureDrawerOpen()` helper to open the collapsed drawer
- Updated `waitForAIAvailabilityCheck()` to call `ensureDrawerOpen()` first
- Updated AI Unavailable test to also open drawer before checking

**CI Status:**
- Build Client: ✅ Pass
- Server Tests: ✅ Pass
- E2E Tests: ✅ Pass  
- PR Title Lint: ✅ Pass

**PR Status:** Ready for review

**Housekeeping:**
- ✅ Added root cause analysis comment to Issue #82
- ✅ Added `ready` and `priority:high` labels to Issue #82
- ✅ Archived 8 worklog entries from 2026-05-08

**Current State:**
- PR #83: CI green ✅, ready for review
- Open issues: #82 (linked to PR #83)
- Automation was re-enabled (manually by this orchestrator run)

---
### 2026-05-10 01:05 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `d67d968` | review | PR #83 - AI toggle visibility | **NEW** |
| `988fb15` | expansion | Issue #84 - commit hash feature | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Review Worker**
   - PR: [#83 - fix(tests): open drawer before clicking AI toggle button](https://github.com/jpshackelford/voice-relay/pull/83)
   - Issue: [#82 - Smoke test failure](https://github.com/jpshackelford/voice-relay/issues/82)
   - Conversation: [`d67d968`](https://app.all-hands.dev/conversations/d67d968b8a6f41a8ac4d3d256e03764b)
   - Review thread: Use `ensureDrawerOpen()` helper instead of duplicated logic

2. **Expansion Worker**
   - Issue: [#84 - feat: Display deployed commit hash in health endpoint and UI footer](https://github.com/jpshackelford/voice-relay/issues/84)
   - Conversation: [`988fb15`](https://app.all-hands.dev/conversations/988fb15581684299b700f84192b59234)

**Housekeeping:**
- ✅ Truncated WORKLOG.md: archived 15 entries to WORKLOG_ARCHIVE_2026-05-08.md

**Current State:**
- [PR #83](https://github.com/jpshackelford/voice-relay/pull/83): `oR green ready 💬1` → review in progress
- Ready issues: #82 (linked to PR #83)
- Issues needing expansion: #84, #85, #86, #87, #88, #89 (6 total, #84 being expanded)
- PR slot: Occupied (review worker)
- Expansion slot: Occupied (expansion worker)

---
### 2026-05-10 01:10 UTC - Expansion Worker (`988fb15`)

✅ **Expanded Issue #84**

- Issue: [#84 - feat: Display deployed commit hash in health endpoint and UI footer](https://github.com/jpshackelford/voice-relay/issues/84)
- Type: Enhancement
- Status: **Ready for implementation**
- Approach: Generate `version.json` at deploy time, read in server, expose via `/health`, display in UI footer

**Files affected:**
- `.gitignore` - Add version.json
- `.github/workflows/deploy.yml` - Generate version.json in deploy and rollback
- `server/src/index.ts` - Read version.json, update /health endpoint
- `client/src/pages/WorkspaceHome.tsx` - Add version footer
- `client/src/App.css` - Footer styling

**Complexity:** Low

---
### 2026-05-10 01:15 UTC - Review Worker (PR #83)

✅ **Addressed Review Feedback**

- PR: [#83 - fix(tests): open drawer before clicking AI toggle button](https://github.com/jpshackelford/voice-relay/pull/83)
- Review Thread: Code duplication in drawer-opening logic

**Changes Made:**
- Moved `ensureDrawerOpen()` helper from inner `Kiosk AI Features` scope to outer `AI Assistant Integration` scope
- Updated `AI Unavailable Scenarios` test to use the shared helper instead of duplicated code
- Net result: -4 lines (removed duplicate logic, added 1 helper call)

**CI Status:** ✅ All checks passed (Build, Server Tests, E2E Tests, PR Lint)

**PR Status:** Ready for review → Review feedback addressed → Ready for merge

---
### 2026-05-10 01:35 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `969608b` | merge | PR #83 - AI toggle visibility fix | **NEW** |
| `7c6a3d9` | expansion | Issue #85 - Device name reset bug | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Merge Worker**
   - PR: [#83 - fix(tests): open drawer before clicking AI toggle button](https://github.com/jpshackelford/voice-relay/pull/83)
   - Issue: [#82 - Smoke test failure](https://github.com/jpshackelford/voice-relay/issues/82)
   - Conversation: [`969608b`](https://app.all-hands.dev/conversations/969608b0dc2e4dbbb1249a8e7df639e6)
   - All review threads resolved, CI green, mergeable

2. **Expansion Worker**
   - Issue: [#85 - bug: Device name resets to random name after visiting kiosk view](https://github.com/jpshackelford/voice-relay/issues/85)
   - Conversation: [`7c6a3d9`](https://app.all-hands.dev/conversations/7c6a3d9ca0ea4d82a6c0152a520cd407)

**Current State:**
- [PR #83](https://github.com/jpshackelford/voice-relay/pull/83): `oRFC green ready` → merge worker merging
- Ready issues: #82 (linked to PR), #84 (commit hash feature)
- Issues needing expansion: #85 (now being expanded), #86, #87, #88, #89, #90, #91 + more
- PR slot: Occupied (merge worker)
- Expansion slot: Occupied (expansion worker)


---
### 2026-05-10 01:35 UTC - Merge Agent

**PR #83 Merged Successfully** ✅

| PR | Issue | Status |
|-----|-------|--------|
| [#83](https://github.com/jpshackelford/voice-relay/pull/83) | [#82](https://github.com/jpshackelford/voice-relay/issues/82) | ✅ Squash-merged |

**Summary:**
- Fixed smoke test failure caused by AI toggle button not being visible
- Root cause: kiosk drawer starts collapsed (F3 requirement), but tests didn't open it first
- Solution: Added `ensureDrawerOpen()` helper function at outer test scope
- No production code changes - test-only fix
- No database migrations

**Review Evolution:**
1. Initial fix accepted with code duplication noted
2. Refactored to move helper to outer scope for reuse

**Commit:** `7467b37` - fix(tests): open drawer before clicking AI toggle button

**Auto-deploy:** App will deploy to vr.chorecraft.net on merge to main.

---
### 2026-05-10 01:35 UTC - Expansion Worker (`7c6a3d9`)

✅ **Expanded Issue #85**

- Issue: [#85 - bug: Device name resets to random name after visiting kiosk view](https://github.com/jpshackelford/voice-relay/issues/85)
- Type: Bug
- Status: **Ready for implementation**

**Root Cause:**
- `useDeviceRestoration` reads device name from sessionStorage/localStorage (stale)
- When `validateDeviceToken()` returns the correct server-side name, the hook ignores `validatedDevice.name`
- It updates mode but not name, leaving the stale cached name in use

**Proposed Fix:**
Update `client/src/hooks/useDeviceRestoration.ts` to sync name from server validation response:
```typescript
if (validatedDevice.name) {
  setDisplayName(validatedDevice.name);
  sessionStorage.setItem('displayName', validatedDevice.name);
  // Update localStorage device token with correct name
}
```

**Files to modify:**
- `client/src/hooks/useDeviceRestoration.ts` - Use server name from validate response

**Complexity:** Low
### 2026-05-10 02:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `92f0f3b` | expansion | Issue #86 - Kiosk canvas not updating | **NEW** |

🚀 **Spawned: Expansion Worker**
- Issue: [#86 - bug: Kiosk canvas does not update when AI sends image to display](https://github.com/jpshackelford/voice-relay/issues/86)
- Conversation: [`92f0f3b`](https://app.all-hands.dev/conversations/92f0f3bc1940421b89a66e13f5e2b308)

**Housekeeping:**
- ✅ Moved PR #105 from draft to ready (impl worker `da0c98b` completed, CI green)
- ✅ Previous workers completed: `969608b` (merge), `7c6a3d9` (expansion)

**Current State:**
- [PR #105](https://github.com/jpshackelford/voice-relay/pull/105): CI green ✅, ready for review (Fixes #104)
- Ready issues: #84 (commit hash feature), #85 (device name bug)
- Issues needing expansion: #86 (now being expanded), #87, #88, #89, #90, #91, #93, #95, #98, #103
- PR slot: Waiting for review (PR #105)
- Expansion slot: Occupied (expansion worker for #86)

---
