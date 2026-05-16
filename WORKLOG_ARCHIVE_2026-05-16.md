# Voice Relay Worklog Archive - 2026-05-16

Archived entries from WORKLOG.md.

---

### 2026-05-16 00:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `95a754f` | merge | PR #132 - fix: restore AI sender name | **NEW** |

🚀 **Spawned: Merge Worker**

- PR: [#132 - fix: restore AI sender name to '✨ AI' for smoke test compatibility](https://github.com/jpshackelford/voice-relay/pull/132)
- Issue: [#131 - 🚨 Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/131)
- Conversation: [`95a754f`](https://app.all-hands.dev/conversations/95a754fed3ec4c34b5f8307285aee2af)

**Current State:**
- PR #132: ready (not draft), CI green ✅, mergeable state: clean
- No unresolved review threads
- No human reviews yet (only bot comment)
- Issue #131 will auto-close on merge (PR has "Fixes #131")

**Merge criteria met:**
- ✅ CI passing (5 success, 1 skipped)
- ✅ No review threads to address
- ✅ Mergeable state: clean

**Previous Workers (all finished):**
- `f98f320` (implementation #131 ✓), `101768f` (expansion #131 ✓)
- `be21f55` (merge #130 ✓), `20b3fc9` (review #130 ✓)

**Housekeeping:**
- 📦 Archived 1 worklog entry to WORKLOG_ARCHIVE_2026-05-15.md

---
### 2026-05-16 00:05 UTC - Merge Worker (`95a754f`)

✅ **Merged PR #132 → Issue #131 Closed**

- PR: [#132 - fix: restore AI sender name to '✨ AI' for smoke test compatibility](https://github.com/jpshackelford/voice-relay/pull/132)
- Issue: [#131 - 🚨 Smoke test failure after deployment](https://github.com/jpshackelford/voice-relay/issues/131) - **CLOSED** (auto-closed via "Fixes #131")
- Merge type: Squash merge
- Commit: `79273ba`

**What was shipped:**
- Restored AI message sender name from `'AI Assistant'` back to `'✨ AI'`
- Updated server test assertion to match

**Root Cause Fixed:**
The session-centric AI refactor (PRs #123, #124) inadvertently changed the `senderName` for AI messages in `server/src/auto-connect.ts:95`. The smoke test expected `'✨ AI'`, causing CI failures.

**Files changed:**
| File | Change |
|------|--------|
| `server/src/auto-connect.ts` | `senderName: 'AI Assistant'` → `senderName: '✨ AI'` |
| `server/src/auto-connect.test.ts` | Updated test assertion |

**Review summary:**
- Bot review: 🟢 LOW risk - "Sometimes the best code review is recognizing when a change is exactly what it needs to be—nothing more, nothing less."
- All CI checks passed

**Deployment:**
- Auto-deploying to vr.chorecraft.net
- Server-side change - simple string constant fix
- No database/migration impact
- Risk: LOW

**Current State:**
- No open issues 🎉
- No open PRs
- Smoke tests should now pass

---
### 2026-05-16 00:31 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | - | - | - |

✅ **All quiet** - No open issues or PRs

**Current State:**
- No open PRs
- No open issues
- Expansion slot: Idle (nothing to expand)
- PR slot: Idle (nothing to implement)

🎉 **All Issues Complete!**

The last merge (`95a754f` - PR #132 → Issue #131) completed successfully at 00:05 UTC.
All tracked issues have been resolved.

**Previous Workers (all finished):**
- `95a754f` (merge #132 ✓), `f98f320` (implementation #131 ✓)
- `101768f` (expansion #131 ✓), `be21f55` (merge #130 ✓)

**Next check:** ~30 minutes (next cron trigger)

---
### 2026-05-16 01:01 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| (none) | - | - | - |

✅ **All quiet** - No open issues or PRs

**Current State:**
- No open PRs
- No open issues  
- Expansion slot: Idle (nothing to expand)
- PR slot: Idle (nothing to implement)

**Previous Workers (all finished):**
- `95a754f` (merge #132 ✓) - completed 00:05 UTC

**Note:** This is the 2nd consecutive quiet period. If the next check also finds no work, the automation will be disabled.

**Next check:** ~30 minutes (next cron trigger)

---
### 2026-05-16 01:31 UTC - Orchestrator

🔒 **Auto-disabled due to inactivity**

Two consecutive quiet periods detected - no new work to pick up.
Automation has been disabled to prevent unnecessary runs.

**Current State:**
- No open PRs
- No open issues
- Both slots idle

**Previous productive work:**
- `95a754f` (merge #132 ✓) at 00:05 UTC - last PR merged
- All 132 issues resolved 🎉

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
### 2026-05-16 02:18 UTC - Expansion Worker

✅ **Expanded Issue #133**

- Issue: [#133 - Add thinking/waiting indicator to kiosk display](https://github.com/jpshackelford/voice-relay/issues/133)
- Type: Bug (regression from #121)
- Status: **Ready for implementation** ✅
- Label: `ready`

**Root Cause:**
Server never calls `aiSessionManager.setThinkingChangeCallback()` to wire the callback that broadcasts `ai-thinking` messages. Client-side implementation is complete (KioskMode.tsx, useAI.ts, useWebSocket.ts), but server never sends the message.

**Proposed Fix:**
Add callback wiring in `server/src/index.ts` after registry creation:
```typescript
aiSessionManager.setThinkingChangeCallback((sessionId, thinking) => {
  registry.broadcastMessageToSession(sessionId, {
    type: 'ai-thinking',
    sessionId,
    thinking,
  });
});
```

**Files to modify:**
- `server/src/index.ts` - Add thinking callback wiring

**Complexity:** Low - single location change, follows existing patterns

---
### 2026-05-16 02:22 UTC - Expansion Worker (`7e6a480`)

✅ **Expanded Issue #133**

- Issue: [#133 - Add thinking/waiting indicator to kiosk display](https://github.com/jpshackelford/voice-relay/issues/133)
- Type: Bug (regression from #121)
- Status: **Ready for implementation** ✅
- Label: `ready`

**Root Cause:**
Server never calls `aiSessionManager.setThinkingChangeCallback()` to wire the callback that broadcasts `ai-thinking` messages. Client-side implementation is complete (KioskMode.tsx, useAI.ts, useWebSocket.ts), but server never sends the message.

**Proposed Fix:**
Add callback wiring in `server/src/index.ts` after registry creation:
```typescript
aiSessionManager.setThinkingChangeCallback((sessionId, thinking) => {
  registry.broadcastMessageToSession(sessionId, {
    type: 'ai-thinking',
    sessionId,
    thinking,
  });
});
```

**Files to modify:**
- `server/src/index.ts` - Add thinking callback wiring

**Complexity:** Low - single location change, follows existing patterns

---
### 2026-05-16 02:31 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `d033c26` | implementation | Issue #133 - thinking indicator | **NEW** |
| `d10e3cd` | expansion | Issue #134 - markdown image tables | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Implementation Worker**
   - Issue: [#133 - Add thinking/waiting indicator to kiosk display](https://github.com/jpshackelford/voice-relay/issues/133) (priority:high)
   - Conversation: [`d033c26`](https://app.all-hands.dev/conversations/d033c266927e439cb7bfc8977df33d3f)
   - Root cause: Server never wires `aiSessionManager.setThinkingChangeCallback()` to broadcast `ai-thinking` messages

2. **Expansion Worker**
   - Issue: [#134 - Investigate image rendering in markdown tables](https://github.com/jpshackelford/voice-relay/issues/134)
   - Conversation: [`d10e3cd`](https://app.all-hands.dev/conversations/d10e3cdb1ba04d8f8b5c07ed32b1d314)

**Current State:**
- No open PRs (implementation worker will create one)
- Ready issues: #133 (priority:high) - being implemented
- Issues needing expansion: #134 (being expanded), #135, #136, #137, #138, #139
- Expansion slot: Occupied (expansion worker)
- PR slot: Occupied (implementation worker)

**Previous Workers (all finished):**
- `7e6a480` (expansion #133 ✓), `95a754f` (merge #132 ✓)
- `f98f320` (implementation #131 ✓), `101768f` (expansion #131 ✓)

---
### 2026-05-16 02:34 UTC - Expansion Worker

✅ **Expanded Issue #134**

- Issue: [#134 - Investigate image rendering in markdown tables](https://github.com/jpshackelford/voice-relay/issues/134)
- Type: Investigation/Research
- Status: **Ready for implementation** ✅

**Root Cause Identified:**
The custom `parseMarkdown` function in `KioskMode.tsx` has two critical bugs:
1. No table parsing support (GFM tables not handled)
2. Image syntax `![alt](url)` incorrectly parsed as link, leaving `!` prefix

**Recommendation:**
Replace custom parser with `marked` + `DOMPurify` libraries for full GFM support and XSS protection.

**Files Affected:**
- `client/src/components/KioskMode.tsx` - Replace `parseMarkdown` function
- `client/package.json` - Add `marked` and `dompurify` dependencies

---
### 2026-05-16 02:38 UTC - Implementation Worker (`d033c26`)

✅ **PR Created: Issue #133**

- Issue: [#133 - Add thinking/waiting indicator to kiosk display](https://github.com/jpshackelford/voice-relay/issues/133)
- PR: [#140 - feat: wire AI thinking state callback to broadcast messages](https://github.com/jpshackelford/voice-relay/pull/140)
- Status: **Ready for review** ✅

**Implementation Details:**

Added the missing callback wiring in `server/src/index.ts` after registry creation:
```typescript
aiSessionManager.setThinkingChangeCallback((sessionId: string, thinking: boolean) => {
  const message: AIThinkingMessage = {
    type: 'ai-thinking',
    sessionId,
    thinking,
  };
  registry.broadcastMessageToSession(sessionId, message);
});
```

**Files modified:**
- `server/src/index.ts` - Added `AIThinkingMessage` import and callback wiring

**Testing:**
- ✅ All 525 server tests pass
- ✅ TypeScript compilation succeeds
- ✅ Client build succeeds
- ✅ CI green (4/4 checks passing)

**What this enables:**
- Kiosk displays 🤔 with pulsing animation while AI processes user messages
- Indicator returns to ✨ when AI response is received
- Client-side implementation was already complete; this just wires the server-side broadcast

---
### 2026-05-16 03:04 UTC - Expansion Worker

✅ **Expanded Issue #135**

- Issue: [#135 - Investigate ElevenLabs integration for text-to-speech](https://github.com/jpshackelford/voice-relay/issues/135)
- Type: Enhancement (Research/Investigation)
- Status: **Ready for implementation** ✅

**Research Findings:**

| Topic | Finding |
|-------|---------|
| API Approach | ElevenLabs WebSocket API recommended for streaming (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`) |
| Model | `eleven_flash_v2_5` - optimized for low latency |
| Audio Format | `mp3_44100_128` - good quality, reasonable size |
| Pricing | Creator plan ($22/mo) for 100K chars, Flash models are 50% cheaper |

**Key Technical Decisions:**

1. **Server-side TTS** - API key stays secure, audio routing controlled
2. **AI-only speaking** - Filter by `senderName === '✨ AI'`
3. **Kiosk-only playback** - Only send audio to `mode === 'kiosk'` devices
4. **WebSocket streaming** - Lowest latency via chunked audio delivery

**Implementation Phases:**
1. Database & configuration (ElevenLabs API key storage)
2. Server TTS service (`server/src/tts/elevenlabs.ts`)
3. Audio streaming to kiosk (new message types: `audio-chunk`, `audio-end`)
4. Integration & UI (workspace settings for TTS)

---
### 2026-05-16 03:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `8a59d2f` | review | PR #140 - Wire AI thinking callback | **NEW** |
| `61fe432` | expansion | Issue #135 - ElevenLabs TTS | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Review Worker**
   - PR: [#140 - feat: wire AI thinking state callback to broadcast messages](https://github.com/jpshackelford/voice-relay/pull/140)
   - Conversation: [`8a59d2f`](https://app.all-hands.dev/conversations/8a59d2f84c16412196f3f3b6060ca5b3)
   - Status: `oRC green ready 💬1` (1 unresolved thread to address)

2. **Expansion Worker**
   - Issue: [#135 - Investigate ElevenLabs integration for text-to-speech](https://github.com/jpshackelford/voice-relay/issues/135)
   - Conversation: [`61fe432`](https://app.all-hands.dev/conversations/61fe4323929d4a52839fd5a3e8c4c287)

**Current State:**
- PR #140: CI green, ready, 1 unresolved thread → being addressed
- Ready issues: #133 (priority:high - linked to PR #140), #134 (unprioritized)
- Issues needing expansion: #135 (being expanded), #136, #137, #138, #139
- Expansion slot: Occupied (expansion worker)
- PR slot: Occupied (review worker)

**Housekeeping:**
- 📦 Archived 7 worklog entries to WORKLOG_ARCHIVE_2026-05-15.md

**Previous Workers (all finished):**
- `d033c26` (implementation #133 ✓), `d10e3cd` (expansion #134 ✓)
- `95a754f` (merge #132 ✓), `f98f320` (implementation #131 ✓)

---
### 2026-05-16 03:08 UTC - Review Worker (`8a59d2f`)

✅ **Addressed Review Feedback: PR #140**

- PR: [#140 - feat: wire AI thinking state callback to broadcast messages](https://github.com/jpshackelford/voice-relay/pull/140)
- Review feedback: Bot suggested adding integration test for callback wiring
- Status: **Ready for review** ✅

**Changes Made:**

| Commit | Description |
|--------|-------------|
| `b557972` | Added integration test `thinking-callback.integration.test.ts` |

**Integration Test Coverage:**
- Verifies end-to-end flow: thinking state → callback → broadcast
- Tests message format matches client expectations
- Tests session isolation (devices in different sessions don't receive)
- Tests graceful handling of empty sessions

**Testing:**
- ✅ All 529 server tests pass (4 new tests added)
- ✅ CI green (4/4 checks passing)
- ✅ Review thread resolved

**Next Steps:**
- PR ready for final review/merge
- Closes issue #133 on merge
### 2026-05-16 03:31 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `26affde` | merge | PR #140 - wire AI thinking callback | **NEW** |
| `477524c` | expansion | Issue #136 - feedback mechanism for failed images | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Merge Worker**
   - PR: [#140 - feat: wire AI thinking state callback to broadcast messages](https://github.com/jpshackelford/voice-relay/pull/140)
   - Issue: [#133 - Add thinking/waiting indicator to kiosk display](https://github.com/jpshackelford/voice-relay/issues/133) (priority:high)
   - Conversation: [`26affde`](https://app.all-hands.dev/conversations/26affdedfc2242dd810e827a46e760be)
   - Merge criteria: CI green ✅, ready (not draft) ✅, all threads resolved ✅, mergeable ✅

2. **Expansion Worker**
   - Issue: [#136 - Investigate feedback mechanism for failed image displays](https://github.com/jpshackelford/voice-relay/issues/136)
   - Conversation: [`477524c`](https://app.all-hands.dev/conversations/477524cd96fd4e4997b091b75eb8feff)

**Current State:**
- PR #140: `oRCFC green ready --` → being merged
- Ready issues: #133 (linked to PR), #134, #135 (unprioritized)
- Issues needing expansion: #136 (being expanded), #137, #138, #139
- Expansion slot: Occupied (expansion worker)
- PR slot: Occupied (merge worker)

**Previous Workers (all finished):**
- `8a59d2f` (review #140 ✓), `61fe432` (expansion #135 ✓)
- `d033c26` (implementation #133 ✓), `d10e3cd` (expansion #134 ✓)

---
### 2026-05-16 03:34 UTC - Expansion Worker (`477524c`)

✅ **Expanded Issue #136**

- Issue: [#136 - Investigate feedback mechanism for failed image displays](https://github.com/jpshackelford/voice-relay/issues/136)
- Type: Enhancement (Research/Investigation)
- Status: **Ready for implementation** ✅
- Label: `ready`

**Problem Identified:**
When AI displays images via `/api/display`, there's no feedback if the image fails to load on the kiosk. The API returns `{ success: true }` immediately after broadcasting, but the kiosk may fail to render the image (404, CORS, timeout, etc.).

**Root Cause:**
- `KioskMode.tsx` line 430: `<img>` element has no `onError` or `onLoad` handlers
- No WebSocket message type exists for reporting display results back to server

**Proposed Solution:**
Implement client-to-server feedback loop:
1. Add `onError`/`onLoad` handlers to `<img>` element in `KioskMode.tsx`
2. Create new `DisplayResultMessage` type for WebSocket communication
3. Server routes failures to AI session so it can respond appropriately

**Files Affected:**
| File | Changes |
|------|---------|
| `client/src/components/KioskMode.tsx` | Add onLoad/onError handlers, timeout logic |
| `client/src/types.ts` | Add `DisplayResultMessage` interface |
| `client/src/hooks/useWebSocket.ts` | Add `sendDisplayResult` function |
| `server/src/types.ts` | Add `DisplayResultRequest` interface |
| `server/src/index.ts` | Handle `display-result` WebSocket message |
| `server/src/openhands.ts` | Forward failures to AI (optional) |

**Complexity:** Medium (2-3 hours implementation, 1-2 hours testing)

---
### 2026-05-16 03:35 UTC - Merge Worker (`26affde`)

✅ **Merged PR #140 → Issue #133 Closed**

- PR: [#140 - feat: wire AI thinking state callback to broadcast messages](https://github.com/jpshackelford/voice-relay/pull/140)
- Issue: [#133 - Add thinking/waiting indicator to kiosk display](https://github.com/jpshackelford/voice-relay/issues/133) - **CLOSED** (auto-closed via "Fixes #133")
- Merge type: Squash merge
- Commit: `e4750b4`

**What was shipped:**
- Added callback wiring in `server/src/index.ts` to broadcast `ai-thinking` messages
- Added integration test `thinking-callback.integration.test.ts` verifying end-to-end flow

**Root Cause Fixed:**
Server never called `aiSessionManager.setThinkingChangeCallback()` to wire the callback that broadcasts `ai-thinking` messages to clients. The client-side implementation was already complete (KioskMode.tsx, useAI.ts, useWebSocket.ts), but the server-side wiring was missing.

**Behavior Now:**
- When AI starts processing: kiosk shows 🤔 with pulsing animation
- When AI responds: kiosk returns to ✨ (connected/idle)

**Review Evolution:**
- Initial: 9 lines of production code wiring callback
- Bot feedback: Add integration test
- Final: Added 150-line integration test covering callback invocation, message format, session isolation, and graceful empty-session handling

**Risk Assessment:** LOW - Additive-only change connecting two well-tested components. No database changes, no breaking APIs.

**Deployment:**
- Auto-deploying to vr.chorecraft.net
- Server-side change - no database/migration impact

---
### 2026-05-16 04:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0898e70` | implementation | Issue #134 - Image rendering in markdown tables | **NEW** |
| `38d82b0` | expansion | Issue #137 - Apple TV kiosk research | **NEW** |

🚀 **Spawned: 2 Workers (parallel)**

1. **Implementation Worker**
   - Issue: [#134 - Investigate image rendering in markdown tables](https://github.com/jpshackelford/voice-relay/issues/134) (priority:high)
   - Conversation: [`0898e70`](https://app.all-hands.dev/conversations/0898e70d1f9a4b34a08e0c5edf14096a)
   - Root cause: `parseMarkdown` function in KioskMode.tsx has no table parsing and a regex bug that converts `![alt](url)` to `!<a>` instead of `<img>`

2. **Expansion Worker**
   - Issue: [#137 - Apple TV application for kiosk display](https://github.com/jpshackelford/voice-relay/issues/137)
   - Conversation: [`38d82b0`](https://app.all-hands.dev/conversations/38d82b051c884d19aa12e38ab5a182a4)

**Current State:**
- No open PRs (implementation worker will create one)
- Ready issues: #134 (priority:high), #135 (priority:medium), #136 (priority:medium)
- Issues needing expansion: #137 (being expanded), #138, #139, #141, #142
- Expansion slot: Occupied (expansion worker)
- PR slot: Occupied (implementation worker)

**Housekeeping:**
- 📦 Archived 2 worklog entries to WORKLOG_ARCHIVE_2026-05-15.md
- 📊 Assigned priorities: #134 → high, #135 → medium, #136 → medium

**Previous Workers (all finished):**
- `26affde` (merge #140 ✓), `477524c` (expansion #136 ✓)
- `8a59d2f` (review #140 ✓), `61fe432` (expansion #135 ✓)

---
### 2026-05-16 04:05 UTC - Expansion Worker (`38d82b0`)

✅ **Expanded Issue #137 (Research)**

- Issue: [#137 - [Research] Apple TV application for kiosk display](https://github.com/jpshackelford/voice-relay/issues/137)
- Type: Research/Investigation
- Status: **Research complete, ready for decision** ✅
- Label: `ready`

**Research Question:** What would be involved in building an Apple TV application to render the kiosk display?

**Key Findings:**

| Topic | Answer |
|-------|--------|
| WKWebView on tvOS? | ❌ **Not available** - tvOS has no WebView component |
| TVML alternative? | ⚠️ Deprecated in tvOS 18 - not recommended |
| Markdown rendering? | ✅ Native SwiftUI + MarkdownUI library |
| Image display? | ✅ Fully supported with parallax effects |
| WebSocket support? | ✅ URLSessionWebSocketTask available |
| App Store compatible? | ✅ Yes, native SwiftUI app follows guidelines |

**Proposed Solution:**
Build a **native SwiftUI tvOS application** that:
1. Authenticates via device authorization code flow
2. Connects to voice-relay server via WebSocket
3. Renders markdown using SwiftUI + MarkdownUI library
4. Displays QR code for mobile devices to join
5. Navigates entirely via Siri Remote

**Complexity Estimate:**
- Total: 10-13 developer days
- Phase 1 (WebSocket client): 2-3 days
- Phase 2 (Auth): 2-3 days
- Phase 3 (Kiosk UI): 3-4 days
- Phase 4 (Polish/Testing): 2-3 days

**Prerequisites:**
- macOS with Xcode 15+ for tvOS development
- Apple Developer account for App Store submission
- Apple TV (4th gen or later) for device testing

**Next Steps:**
Decision needed: Should we proceed with implementation? If yes, create implementation issues for each phase.

---
### 2026-05-16 04:14 UTC - Implementation Worker (`0898e70`)

✅ **Created PR #144 for Issue #134**

- Issue: [#134 - Investigate image rendering in markdown tables](https://github.com/jpshackelford/voice-relay/issues/134) (priority:high)
- PR: [#144 - fix(client): replace custom markdown parser with marked + DOMPurify](https://github.com/jpshackelford/voice-relay/pull/144)
- Status: **Ready for review** ✅

**Problem Fixed:**
The custom `parseMarkdown` function had two critical bugs:
1. **No table parsing** - GFM table syntax was unsupported
2. **Image syntax bug** - Link regex captured `![alt](url)` incorrectly, leaving `!` prefix

| Input | Expected | Before Fix |
|-------|----------|------------|
| `![img](url)` | `<img src="url">` | `!<a href="url">img</a>` |
| `\| A \| B \|` | `<table>` | Raw text |

**Solution:**
Replaced custom regex parser with:
- `marked` (v18.0.3) - Full GFM support (tables, images, etc.)
- `DOMPurify` (v3.4.3) - XSS protection for `dangerouslySetInnerHTML`

**Files Changed:**
| File | Change |
|------|--------|
| `client/src/components/KioskMode.tsx` | Replace `parseMarkdown` function |
| `client/src/components/KioskMode.test.tsx` | Add 17 new tests |
| `client/package.json` | Add `marked` and `dompurify` deps |
| `tests/markdown-rendering.spec.ts` | Add Playwright E2E tests |

**Test Coverage:**
- 17 new unit tests for parseMarkdown (image, table, XSS, existing features)
- All 200 client tests pass ✅
- All 529 server tests pass ✅
- CI: All checks green ✅

**Bundle Impact:** ~1 MB (marked 449KB + DOMPurify 644KB)

**Next Steps:**
- PR ready for review/merge
- Closes issue #134 on merge