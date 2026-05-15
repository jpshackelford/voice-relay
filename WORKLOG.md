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
