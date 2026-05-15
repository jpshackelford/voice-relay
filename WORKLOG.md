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

### 2026-05-10 22:31 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | - | - | - |

🔒 **Auto-disabled due to inactivity**

Three consecutive quiet periods detected - no new work to pick up.
Automation has been disabled to prevent unnecessary runs.

**Current State:**
- No open PRs
- No open issues
- All work completed

**To re-enable:**
- OpenHands UI: https://app.all-hands.dev/automations → Find "Voice Relay Workflow Orchestrator" → Toggle enable
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/a0219382-2e7c-4156-9991-7b9976739a66" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```

---
### 2026-05-15 01:45 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `6fe0138` | expansion | Issue #119 - Session-centric AI infrastructure | **NEW** |

🚀 **Spawned: Expansion Worker**

- Issue: [#119 - feat: Session-centric AI infrastructure (foundation for auto-connect)](https://github.com/jpshackelford/voice-relay/issues/119)
- Conversation: [`6fe0138`](https://app.all-hands.dev/conversations/6fe0138bf83741818469ee2a5941720a)

**Current State:**
- No open PRs
- Issues needing expansion: #119 (now being expanded), #120, #121, #122
- Ready issues: None
- PR slot: Available (no ready issues to implement yet)
- Expansion slot: Occupied (expansion worker)

**Note:** Workflow was re-enabled after being auto-disabled on 2026-05-10. Four new issues (#119-#122) have been filed since then.

---
### 2026-05-15 01:52 UTC - Expansion Worker (`6fe0138`)

✅ **Expanded Issue #119**

- Issue: [#119 - feat: Session-centric AI infrastructure (foundation for auto-connect)](https://github.com/jpshackelford/voice-relay/issues/119)
- Type: Enhancement
- Status: **Ready for implementation** ✅

**Summary:**
This issue refactors `AISessionManager` to support session-centric AI management alongside existing device-centric code. It enables sharing a single AI conversation across all devices in a VR session.

**Key Technical Changes:**
1. Add `sessionId → AISession` map alongside existing `deviceId` map
2. Add session-centric methods: `getOrCreateForSession()`, `hasSessionAI()`, `getSessionAI()`, `endSessionAI()`
3. Add WebSocket message types: `AIThinkingMessage`, `SessionAIStatusMessage`
4. Track thinking state with `isThinking`, `pendingMessageId`, `lastMessageSentAt` fields

**Files Affected:**
- `server/src/openhands.ts` - Add session-centric methods and thinking state
- `server/src/types.ts` - Add new WebSocket message types
- `server/src/openhands.test.ts` - Add tests for new methods

**Complexity:** Medium

**Notes:**
- Non-breaking change - existing device-centric code continues to work
- Foundation for #120 (auto-connect), #121 (UI indicators), #122 (cleanup)
- Issue body updated with proper acceptance criteria checkboxes
- Added supplementary implementation notes with code references

---
### 2026-05-15 02:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `00a4651` | expansion | Issue #120 - Auto-connect AI | **NEW** |
| `d4eeeb3` | implementation | Issue #119 - Session-centric AI | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Expansion Worker**
   - Issue: [#120 - feat: Auto-connect AI when first device joins session](https://github.com/jpshackelford/voice-relay/issues/120)
   - Conversation: [`00a4651`](https://app.all-hands.dev/conversations/00a46510b13b47f5b3fbc7155905639e)

2. **Implementation Worker**
   - Issue: [#119 - feat: Session-centric AI infrastructure](https://github.com/jpshackelford/voice-relay/issues/119) (ready)
   - Conversation: [`d4eeeb3`](https://app.all-hands.dev/conversations/d4eeeb3810694867a7889c4b3567e0d2)

**Current State:**
- No open PRs (implementation worker will create one)
- Issues needing expansion: #120 (now being expanded), #121, #122
- Ready issues: #119 (now being implemented)
- Both worker slots: Occupied

**Previous Worker:** `6fe0138` (expansion for #119) - finished ✓

---
### 2026-05-15 02:10 UTC - Expansion Worker (`00a4651`)

✅ **Expanded Issue #120**

- Issue: [#120 - feat: Auto-connect AI when first device joins session](https://github.com/jpshackelford/voice-relay/issues/120)
- Type: Enhancement
- Status: **Ready for implementation** ✅
- Dependency: #119 (must be implemented first)

**Summary:**
Auto-connect AI when the first device joins a session, eliminating the manual ✨ button click. Updates system prompt to emphasize display-first communication.

**Key Technical Changes:**
1. Add auto-connect trigger in WebSocket registration handler (`index.ts`)
2. Check if first device via `sessionRepository.getDevices(sessionId).length === 1`
3. Call `aiSessionManager.getOrCreateForSession()` (from #119)
4. Add `broadcastToSession()` method to registry
5. Handle 409 sandbox pause errors with auto-resume
6. Update system prompt with display-first greeting instructions

**Files Affected:**
- `server/src/index.ts` - Add auto-connect logic after device registration
- `server/src/registry.ts` - Add `broadcastToSession()` method
- `server/src/openhands.ts` - Add 409 resume handling
- `server/prompts/system-prompt.md` - Add display-first section
- `tests/session-management.spec.ts` - Add E2E test

**Complexity:** Medium

**Notes:**
- Depends on #119 being implemented first
- Uses lazy initialization (AI created on first device join, not session creation)
- AI greeting displayed immediately confirms connection to user

---
### 2026-05-15 02:13 UTC - Implementation Worker (`d4eeeb3`)

✅ **Completed Issue #119**

- Issue: [#119 - feat: Session-centric AI infrastructure](https://github.com/jpshackelford/voice-relay/issues/119)
- PR: [#123](https://github.com/jpshackelford/voice-relay/pull/123) - Ready for review
- Type: Enhancement
- Status: **PR Created & CI Green** ✅

**Implementation Summary:**

Added session-centric AI management foundation:

1. **AISession Interface Updates:**
   - Added `sessionId` field (deviceId now optional/deprecated)
   - Added thinking state: `isThinking`, `pendingMessageId`, `lastMessageSentAt`

2. **New Session-Centric Methods:**
   - `hasSessionAI(sessionId)` - check if session has active AI
   - `getSessionAI(sessionId)` - get AI session for VR session
   - `getOrCreateForSession()` - get/create AI for session
   - `sendSessionMessage()` - send with thinking state tracking
   - `endSessionAI()` - cleanup session AI
   - `setThinkingChangeCallback()` - for thinking state broadcasts

3. **New WebSocket Message Types:**
   - `AIThinkingMessage` - broadcast AI processing state
   - `SessionAIStatusMessage` - session-level AI status

4. **Backward Compatibility:**
   - All legacy device-centric methods preserved
   - Internal map renamed `sessions` → `deviceSessions`
   - Methods marked `@deprecated` with pointers to alternatives

**Test Coverage:**
- 18 new tests added
- All 499 tests passing

**Files Changed:**
- `server/src/openhands.ts` (+350 lines)
- `server/src/types.ts` (+27 lines)
- `server/src/openhands.test.ts` (+179 lines)


---
### 2026-05-15 02:34 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `061a463` | expansion | Issue #121 - UI indicators | **NEW** |

🚀 **Spawned: Expansion Worker**
- Issue: [#121 - UI indicators for thinking states](https://github.com/jpshackelford/voice-relay/issues/121)
- Conversation: [`061a463`](https://app.all-hands.dev/conversations/061a463b36ea42be8217ecbea1e8b763)

**Current State:**
- [PR #123](https://github.com/jpshackelford/voice-relay/pull/123): `o red ready 💬--` (CI: tests ✅, pr-review ❌ timed out)
  - Implements Issue #119 (Session-centric AI infrastructure)
  - Awaiting review (bot failed, needs human review or retry)
- Issues needing expansion: #121 (now being expanded), #122
- Ready issues: #119 (being implemented via PR #123), #120 (depends on #119)

**PR Slot:** Waiting - PR #123 exists but no review comments yet. Review bot workflow failed (timeout). Needs human review or workflow retry.

**Expansion Slot:** Filled - expanding Issue #121

---
### 2026-05-15 02:35 UTC - Expansion Worker (`061a463`)

✅ **Expanded Issue #121**

- Issue: [#121 - feat: UI indicators - distinguish connecting vs thinking states](https://github.com/jpshackelford/voice-relay/issues/121)
- Type: Enhancement
- Status: **Ready for implementation** ✅
- Dependencies: #119 (message types), #120 (broadcasts messages)

**Summary:**
Add distinct visual indicators to the UI to distinguish between AI "connecting" (sandbox boot, 30-60s) and "thinking" (processing message, 2-15s) states.

**Key Technical Changes:**
1. Add `AIThinkingMessage` and `SessionAIStatusMessage` types to client
2. Handle new message types in `useWebSocket.ts`
3. Add `thinking` state to `useAI.ts` hook
4. Update KioskMode and MobileMode with distinct indicators:
   - 🔗 (pulse animation) for connecting
   - 🤔 (pulsing glow) for thinking
   - ✨ (subtle shimmer) for connected/idle
5. Update CSS animations for each state

**Files Affected:**
- `client/src/types.ts` - Add new message types
- `client/src/hooks/useWebSocket.ts` - Handle new messages
- `client/src/hooks/useAI.ts` - Add thinking state
- `client/src/components/KioskMode.tsx` - Update indicators
- `client/src/components/MobileMode.tsx` - Update indicators
- `client/src/App.css` - New animations

**Complexity:** Medium

**Notes:**
- Issue body was already well-structured, added technical implementation comment
- Can begin client-side work once #119 is merged (defines server types)
- Full functionality requires #120 (broadcasts the messages)

### 2026-05-15 03:34 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `2476742` | expansion | Issue #122 - Remove legacy AI code | **NEW** |

**Previous workers completed:**
- `00a4651` (expansion) - finished
- `061a463` (expansion) - finished  
- `6fe0138` (expansion) - finished
- `d4eeeb3` (implementation) - finished

🚀 **Spawned: Expansion Worker**
- Issue: [#122 - chore: Remove legacy device-centric AI code](https://github.com/jpshackelford/voice-relay/issues/122)
- Conversation: [`2476742`](https://app.all-hands.dev/conversations/2476742c6c384321a39bfc8b948a4889)

**PR Slot Action:**
- [PR #123](https://github.com/jpshackelford/voice-relay/pull/123): `o red ready 💬--`
- CI: tests ✅, pr-review ❌ (timed out)
- ✅ Triggered rerun of failed pr-review workflow (run ID: 25896488692)
- Waiting for review bot to post feedback

**Current State:**
- Issues needing expansion: #122 (now being expanded)
- Ready issues: #119 (linked to PR #123), #120, #121
- No priority labels assigned to ready issues

---

### 2026-05-15 03:38 UTC - Expansion Worker (`2476742`)

✅ **Expanded Issue #122: Remove legacy device-centric AI code**

- Issue: [#122 - chore: Remove legacy device-centric AI code](https://github.com/jpshackelford/voice-relay/issues/122)
- Type: Chore/Cleanup
- Status: **Ready for implementation** ✅
- Label: `ready`

**Technical Analysis Completed:**

Identified **~350 lines** of legacy device-centric AI code to remove across 7 files:

| Category | Files | Lines |
|----------|-------|-------|
| Server endpoints | `server/src/index.ts` | ~150 |
| AISessionManager | `server/src/openhands.ts` | ~100 |
| Client hook | `client/src/hooks/useAI.ts` | ~60 |
| UI components | `KioskMode.tsx`, `MobileMode.tsx` | ~40 |
| Tests | Multiple | Update required |

**Dependencies (BLOCKING):**
- Issue #119 (PR #123) - Session-centric AI infrastructure - **OPEN**
- Issue #120 - Auto-connect AI - **OPEN**
- Issue #121 - UI indicators - **OPEN**

All three must be merged and validated in production before this cleanup can proceed.

**Risk Assessment:** Medium complexity, Low risk (simple deletions once deps are working)

---

---
### 2026-05-15 04:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `5c27fea` | merge | PR #123 - Session-centric AI | **NEW** |

🚀 **Spawned: Merge Worker**
- PR: [#123 - feat: session-centric AI infrastructure](https://github.com/jpshackelford/voice-relay/pull/123)
- Issue: #119
- Conversation: [`5c27fea`](https://app.all-hands.dev/conversations/5c27fea0153c4ba5826db4600b26040a)

**Current State:**
- [PR #123](https://github.com/jpshackelford/voice-relay/pull/123) ready for merge:
  - CI: All green ✅
  - Review: Bot says "✅ Worth merging" (no human review required)
  - No unresolved inline threads
- Issues awaiting implementation after #119 is merged: #120, #121, #122 (all ready, no priority labels)
- No issues need expansion

**Previous Workers Completed:**
- `6fe0138` (expansion #119), `00a4651` (expansion #120), `d4eeeb3` (impl #119), `061a463` (expansion #121), `2476742` (expansion #122)

**Action Taken:**
PR #123 meets merge criteria - spawning merge worker to squash-merge and close Issue #119.


### 2026-05-15 04:08 UTC - Merge Worker (`5c27fea`)

✅ **Merged PR #123 → Issue #119 Closed**

- PR: [#123 - feat: session-centric AI infrastructure](https://github.com/jpshackelford/voice-relay/pull/123)
- Issue: [#119](https://github.com/jpshackelford/voice-relay/issues/119) - **CLOSED** (auto-closed via "Fixes #119")
- Merge type: Squash merge

**What was shipped:**
- Session-centric AI infrastructure for sharing conversations across all devices in a VR session
- New `AISessionManager` methods: `getOrCreateForSession`, `hasSessionAI`, `getSessionAI`, `sendSessionMessage`, `endSessionAI`
- New WebSocket message types: `AIThinkingMessage`, `SessionAIStatusMessage`
- Thinking state tracking with callback for broadcasting
- Full backward compatibility - legacy device-centric code preserved

**Migration status:**
- ✅ Issue #119 (foundation infrastructure) - **MERGED**
- 🔜 Issue #120 (auto-connect AI when first device joins) - Ready
- 🔜 Issue #121 (UI indicators for thinking/connecting) - Ready
- 🔜 Issue #122 (remove legacy device-centric code) - Ready, blocked on #120+#121

**Deployment:**
- Auto-deploying to vr.chorecraft.net
- No database changes - safe for production
- No breaking changes to existing functionality


---
### 2026-05-15 09:34 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `e597152` | implementation | Issue #120 - Auto-connect AI | **NEW** |

🚀 **Spawned: Implementation Worker**

- Issue: [#120 - feat: Auto-connect AI when first device joins session](https://github.com/jpshackelford/voice-relay/issues/120)
- Priority: `priority:high`
- Conversation: [`e597152`](https://app.all-hands.dev/conversations/e597152721f9466b8598ca6a10db9033)

**Priority Assessment Completed:**
- Issue #120: `priority:high` - Enables auto-connect, needed for #122
- Issue #121: `priority:medium` - UI indicators, needed for #122  
- Issue #122: `priority:low` - Cleanup, blocked on #120 and #121

**Current State:**
- No open PRs (implementation worker will create one)
- All issues expanded and ready
- Expansion slot: Idle (nothing to expand)
- PR slot: Occupied (implementation worker)

**Previous Workers (all finished):**
- `5c27fea` (merge #123), `2476742` (expansion #122), `061a463` (expansion #121)
- `d4eeeb3` (implementation #119), `00a4651` (expansion #120), `6fe0138` (expansion #119)

---
### 2026-05-15 09:45 UTC - Implementation Worker (`e597152`)

✅ **PR Created: Issue #120**

- Issue: [#120 - feat: Auto-connect AI when first device joins session](https://github.com/jpshackelford/voice-relay/issues/120)
- PR: [#124 - feat: auto-connect AI when first device joins session](https://github.com/jpshackelford/voice-relay/pull/124)
- Status: **Ready for review** ✅

**Changes Implemented:**
1. Auto-connect logic in `server/src/index.ts`:
   - Added `autoConnectAI()` helper function
   - Triggers when first device joins session (lazy initialization)
   - Broadcasts `session-ai-status` messages to all devices
   
2. Registry enhancement in `server/src/registry.ts`:
   - Added `broadcastMessageToSession()` for any server message type
   
3. System prompt updates in `server/prompts/system-prompt.md`:
   - Added Display-First Communication model
   - AI instructed to send greeting immediately on connect
   - Updated guidelines with DO/DON'T best practices

**Acceptance Criteria Status:**
- [x] First device joining triggers AI creation
- [x] All devices see AI status (connecting → connected)
- [x] System prompt updated with display-first model
- [x] AI instructed to send greeting on connect
- [ ] E2E test (requires live OpenHands API - deferred to smoke tests)

**CI Status:** All checks passed ✅

---
