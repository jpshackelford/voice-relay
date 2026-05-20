# Voice Relay Workflow Log

This file tracks orchestrator activity and human instructions for the voice-relay project.

## Workflow

The orchestrator works through **GitHub Issues** filed against this repository, one at a time:

1. Pick the next open issue (lowest number first)
2. Implement, test, create PR
3. Address reviews until merged
4. Move to next issue
5. Repeat until all issues are complete

## How to Use

**Human instructions:** Add an entry like this and the orchestrator will follow it:
```markdown
## INSTRUCTION: Your instruction here
```

The orchestrator will acknowledge with `[ACKNOWLEDGED]` once processed.

---

## Log

### 2026-05-20 04:33 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | - | - | - |

🔒 **Auto-disabled due to inactivity**

Multiple consecutive quiet periods detected (6+ since last productive work) - no new work to pick up.
Automation (v2) has been disabled to prevent unnecessary runs.

**Current State:**
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): Draft, `needs-human` label (stuck - requires human intervention; linked issue #220 already closed)
- Open issues: #208, #210, #239 (all `on-hold`)
- No `ready` issues to implement
- No issues needing expansion (all on-hold)

**Automation Status:** Disabled (`5f180989...` - Voice Relay Workflow Orchestrator v2)

**To re-enable:**
- OpenHands UI: https://app.all-hands.dev/automations → Find "Voice Relay Workflow Orchestrator v2" → Toggle enable
- Or via API:
  ```bash
  curl -X PATCH "https://app.all-hands.dev/api/automation/v1/5f180989-ed9c-42b4-ac9f-5f30f0623316" \\
    -H "Authorization: Bearer \${OPENHANDS_API_KEY}" \\
    -H "Content-Type: application/json" \\
    -d '{"enabled": true}'
  ```

**To resume work:**
1. File new issues or remove `on-hold` labels from existing ones (#208, #210, #239)
2. Close or address PR #221 (linked issue #220 already closed, consider closing this draft PR)
3. Re-enable automation when ready

---
### 2026-05-20 11:32 UTC - Expansion Worker

✅ **Expanded Issue #246**

- Issue: [bug: QR code dismissed without user interaction](https://github.com/jpshackelford/voice-relay/issues/246)
- Type: Bug
- Status: Ready for implementation
- Root cause: Display area rendering logic in `KioskMode.tsx` prioritizes `displayContent` over QR code state. When AI auto-connects and sends greeting display message, it overwrites QR code before user can scan it.
- Approach: Queue display content client-side when QR code is in initial state (no mobile device joined AND not dismissed), then show queued content when QR is resolved

---
### 2026-05-20 11:32 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `033ea38` | expansion | Issue #245 - duplicate device added | **NEW** |
| `8530b64` | expansion | Issue #246 - QR code dismissed | **NEW** |
| `e28bbe1` | expansion | Issue #247 - agent event layout | **NEW** |

🚀 **Spawned: 3 Expansion Workers (parallel)**

**New Issues Discovered:**
3 new issues were filed that need expansion before implementation:

1. **Expansion Worker for Issue #245**
   - Issue: [#245 - bug: duplicate device added](https://github.com/jpshackelford/voice-relay/issues/245)
   - Conversation: [`033ea38`](https://app.all-hands.dev/conversations/033ea386...)

2. **Expansion Worker for Issue #246**
   - Issue: [#246 - bug: QR code dismissed without user interaction](https://github.com/jpshackelford/voice-relay/issues/246)
   - Conversation: [`8530b64`](https://app.all-hands.dev/conversations/8530b64d...)

3. **Expansion Worker for Issue #247**
   - Issue: [#247 - bug: agent event layout does not follow design guidance](https://github.com/jpshackelford/voice-relay/issues/247)
   - Conversation: [`e28bbe1`](https://app.all-hands.dev/conversations/e28bbe10...)

**Current State:**
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): Draft, `needs-human` label (stuck - merge conflicts)
- On-hold issues: #208, #210, #239
- Issues needing expansion: #245 (now expanding), #246 (now expanding), #247 (now expanding)
- Ready issues: 0 (pending expansion completion)

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 3 | 1 | 4 |
| Implementation | 0 | 1 | 1 |
| Review/Merge | 0 | 2 | 2 |

---
### 2026-05-20 11:34 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `033ea38` | expansion | Issue #245 - duplicate device added | running |
| `8530b64` | expansion | Issue #246 - QR code dismissed | running |
| `e28bbe1` | expansion | Issue #247 - agent event layout | running |

⏳ **Waiting** - All 3 expansion workers already active (spawned at 11:32 UTC)

**Current State:**
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): Draft, `needs-human` label (stuck)
- Issues being expanded: #245, #246, #247
- On-hold issues: #208, #210, #239
- Ready issues: 0 (pending expansion)

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 3 | 1 | 4 |
| Implementation | 0 | 1 | 1 |
| Review/Merge | 0 | 2 | 2 |

**Action Taken:** None - expansion workers already running, no additional action needed.

---
### 2026-05-20 11:38 UTC - Expansion Worker

✅ **Expanded Issue #245**

- Issue: [bug: duplicate device added](https://github.com/jpshackelford/voice-relay/issues/245)
- Type: Bug
- Status: Ready for implementation
- Root cause: `clearDeviceToken()` removes entire localStorage entry including deviceId when token expires, causing new deviceId generation on next visit

**Technical Summary:**
- When device token expires (90 day TTL), `validateDeviceToken()` returns 401
- `clearDeviceToken()` removes the full `StoredDeviceInfo` from localStorage
- This clears both `deviceToken` AND `deviceId` bundled together
- On reconnect, `getOrCreateDeviceId()` generates new UUID → new device record → duplicate

**Proposed Fix:**
Preserve deviceId in separate localStorage key when clearing expired token, update `getOrCreateDeviceId()` to check preserved ID.

**Files to modify:**
- `client/src/utils/deviceToken.ts`
- `client/src/hooks/useDeviceRestoration.ts`
- `client/src/utils/deviceToken.test.ts`

---
### 2026-05-20 11:40 UTC - Expansion Worker

✅ **Expanded Issue #247**

- Issue: [bug: agent event layout does not follow design guidance](https://github.com/jpshackelford/voice-relay/issues/247)
- Type: Bug
- Status: Ready for implementation
- Root cause: `AgentEventCard.tsx` expanded section displays raw event kind and timestamp instead of actual content (commands, output)

**Technical Summary:**
- Current expanded view shows: `action.kind` (e.g., "CmdRunAction") and formatted timestamp
- Design guidance (issue #242) specifies: Show actual content - commands, file paths, output text
- Quote from requirements: "We do not need to see event type, timestamps, etc. We need to be focused on the content of those events."
- The `summary` field IS being generated correctly with good content on the server

**Proposed Fix:**
Phase 1 (UI-only): Remove kind/timestamp display, show summary in code block when expanded
Phase 2 (full): Extend AgentAction type to carry command/path/content fields from server

**Files to modify:**
- `client/src/components/AgentEventCard.tsx` (lines 62-68)
- `client/src/App.css` (`.agent-event-details` styling)
- (Phase 2) `server/src/openhands.ts`, `server/src/types.ts`, `client/src/types.ts`

---
### 2026-05-20 11:48 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4fa0e32` | implementation | Issue #246 - QR code dismissed | **NEW** |

**Workers Completed:**
- `033ea38` (expansion) - Issue #245 ✓
- `8530b64` (expansion) - Issue #246 ✓
- `e28bbe1` (expansion) - Issue #247 ✓

**Priority Assessment:**
- Issue #246 → `priority:high` (blocks basic user flow - mobile joining)
- Issue #245 → `priority:medium` (duplicate device after token expiry)
- Issue #247 → `on-hold` (skipped)

**Action Taken:**
🚀 **Spawned implementation worker** for Issue #246
- Issue: [#246 - bug: QR code dismissed without user interaction](https://github.com/jpshackelford/voice-relay/issues/246)
- Conversation: [`4fa0e32`](https://app.all-hands.dev/conversations/4fa0e328982249cfae2542b17f336ca1)
- Priority: high

**Current State:**
- No PRs needing review (PR #221 is draft, on hold)
- Ready issues: #245 (medium), #246 (high, in progress)
- Issues on hold: #247, #208, #210, #239

---
### 2026-05-20 12:07 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `4461c0c` | implementation | Issue #246 - QR code dismissed bug | **NEW** |

**Previous Worker Failed:**
- `4fa0e32` (implementation) - Spawn failed, conversation ID not found in API

**Action Taken:**
🚀 **Spawned: Implementation Worker** for [Issue #246](https://github.com/jpshackelford/voice-relay/issues/246)
- Task: Fix QR code being dismissed when AI sends greeting display message
- Approach: Client-side display queueing - defer display content when QR is in initial state
- Priority: high
- Conversation: [`4461c0c`](https://app.all-hands.dev/conversations/4461c0c6197941e3a3a175a941677696)

**Current State:**
- [PR #221](https://github.com/jpshackelford/voice-relay/pull/221): Draft, `needs-human` label (stuck)
- Ready issues: #245 (priority:medium), #247 (no priority)
- Issues on hold: #208, #210, #239

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 0 | 4 | 4 |
| Implementation | 1 | 0 | 1 |
| Review/Merge | 0 | 2 | 2 |

