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

