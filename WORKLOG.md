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

### 2026-05-18 03:00 UTC - Implementation Worker (`2bf4dd9`)

✅ **PR #201 Ready for Review - Issue #169 (Simplify Kiosk Connection Indicator)**

- Issue: [#169 - UI: Simplify kiosk mode connection indicator - replace icon with solid dot](https://github.com/jpshackelford/voice-relay/issues/169)
- PR: [#201 - feat(client): simplify kiosk connection indicator to minimal solid dot](https://github.com/jpshackelford/voice-relay/pull/201)
- Status: **Ready for review** ✅

**Problem:**
Kiosk connection indicator used a plug emoji (🔌) with colored border, creating visual clutter and competing with the AI status indicator (both bottom-right).

**Solution:**
- Replaced plug emoji with minimal solid-colored dot
- Green (#00c853) when connected, red (#ff4444) when disconnected
- Moved to bottom-left corner for balanced layout (AI status stays bottom-right)
- Reduced size from 2.5rem to 0.75rem (0.625rem on mobile)
- Maintained pulse animation for disconnected visibility
- Preserved hover tooltip for accessibility

**Files Modified:**
- `client/src/components/KioskMode.tsx` - Removed emoji, updated comments
- `client/src/App.css` - Simplified styling, repositioned to left

**CI Status:** All checks passing ✅ (Build, Server Tests, E2E, Conventional Commits)

**Risk:** 🟢 LOW - CSS-only visual change, no functionality affected

_This update was created by an AI agent (OpenHands) on behalf of the repository maintainer._

---
### 2026-05-18 03:00 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `b944711` | merge | PR #200 - Allow dismissing QR code screen | **NEW** |
| `a0171c7` | review | PR #201 - Simplify kiosk connection indicator | **NEW** |
| `9f461ef` | implementation | Issue #191 - Unify TTS settings | **NEW** |

**Workers Completed This Cycle:**
- `2bf4dd9` (implementation) → Created PR #201 for Issue #169
- `3b88999` (merge) → Completed work on PR #198
- `fe49084` (review) → Completed work on PR #200

**Current State:**
- [PR #200](https://github.com/jpshackelford/voice-relay/pull/200): CI green, positive review → Merge worker spawned
- [PR #201](https://github.com/jpshackelford/voice-relay/pull/201): CI green, 1 unresolved thread (needs screenshots) → Review worker spawned
- Ready issues: #166, #167, #169 (priority:low), #186 (priority:medium), #188 (priority:low), #191 (priority:medium)
- Issue #197 has `needs-human` label - skipped

**Actions Taken:**
🚀 **Spawned 3 workers:**
1. **Merge Worker** for [PR #200](https://github.com/jpshackelford/voice-relay/pull/200) - [`b944711`](https://app.all-hands.dev/conversations/b9447115c87d4ea8931197c7fd33e65f)
2. **Review Worker** for [PR #201](https://github.com/jpshackelford/voice-relay/pull/201) - [`a0171c7`](https://app.all-hands.dev/conversations/a0171c7b2ef04c53bf5f72989b93f35b)
3. **Implementation Worker** for [Issue #191](https://github.com/jpshackelford/voice-relay/issues/191) - [`9f461ef`](https://app.all-hands.dev/conversations/9f461efb04f744a4b51c8cf2e72b0e65)

**Also:** Added `priority:medium` label to Issue #191

---
### 2026-05-18 03:10 UTC - Merge Worker

**PR #200 Merged** ✅

- **PR:** [#200 - feat: allow dismissing QR code screen on display device without mobile scan](https://github.com/jpshackelford/voice-relay/pull/200)
- **Issue:** [#186](https://github.com/jpshackelford/voice-relay/issues/186) (auto-closed)
- **Commit:** `feat: add Skip button to dismiss QR code screen on kiosk display`

**Summary:**
Added "Skip →" button to kiosk QR code screen allowing users to proceed without mobile device scan. Useful for solo kiosk usage, development/testing, and quick demos.

**Review Status:**
- 2 automated reviews: both 🟢 LOW risk, "Worth merging"
- All CI checks passed (5/5)

**Migration Check:** ✅ No database changes - pure frontend feature (CSS + React state)

**Deployed:** Auto-deploying to vr.chorecraft.net

---
### 2026-05-18 03:13 UTC - PR Review Worker

**PR #201 Review Addressed** ✅

- **PR:** [#201 - feat(client): simplify kiosk connection indicator to minimal solid dot](https://github.com/jpshackelford/voice-relay/pull/201)
- **Issue:** [#169](https://github.com/jpshackelford/voice-relay/issues/169)
- **Status:** Ready for review (all feedback addressed)

**Review Feedback:**
- Automated review requested screenshots showing the visual change
- Added `docs/screenshots/kiosk-connection-indicator.png` - full layout view with both states
- Added `docs/screenshots/connection-indicator-closeup.png` - closeup of the dot indicators
- Updated PR description to embed screenshots

**Commits:**
1. Original implementation (8db5cc2) - CSS & component changes
2. Screenshot addition (f06d989) - Visual documentation for reviewers

**CI Status:** All 4 checks passing ✅

---
### 2026-05-18 03:15 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `9f461ef` | implementation | Issue #191 - Unify TTS settings | running |
| `26258e9` | merge | PR #201 - Simplify kiosk indicator | **NEW** |

**Workers Completed This Cycle:**
- `b944711` (merge) → PR #200 merged ✓
- `a0171c7` (review) → PR #201 reviewed ✓

**Current State:**
- [PR #201](https://github.com/jpshackelford/voice-relay/pull/201): CI green, review positive, no unresolved threads → **Merge worker spawned**
- Issue #191: Implementation in progress (worker `9f461ef`)
- Ready issues (no PR yet): #166, #167, #188 (all priority:low)
- Issue #197: `needs-human` - smoke test failure (skipped)

**Actions Taken:**
🚀 **Spawned merge worker** for [PR #201](https://github.com/jpshackelford/voice-relay/pull/201) - [`26258e9`](https://app.all-hands.dev/conversations/26258e9120bb4fd5bbb757386f801925)

**Next Cycle:**
- Implementation slot occupied (wait for #191 PR)
- 1 review slot still available
- Expansion slots idle (all issues have `ready` label)

### 2026-05-18 03:34 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0c3d2ee` | review | PR #202 - Unify TTS settings | **NEW** |
| `a434159` | implementation | Issue #166 - Mobile transcription display | **NEW** |

**Workers Completed This Cycle:**
- `9f461ef` (implementation) → Created PR #202 for Issue #191 ✓
- `26258e9` (merge) → Merged PR #201 (kiosk connection indicator) ✓

**Current State:**
- [PR #202](https://github.com/jpshackelford/voice-relay/pull/202): Open, CI green, 1 unresolved critical review thread → **Review worker spawned**
- Ready issues (no PR yet): #166 (impl started), #167, #188 (all priority:low)
- Issue #197 has `needs-human` label - smoke test failure (skipped)

**Actions Taken:**
🚀 **Spawned 2 workers:**
1. **Review Worker** for [PR #202](https://github.com/jpshackelford/voice-relay/pull/202) - [`0c3d2ee`](https://app.all-hands.dev/conversations/0c3d2ee486fc4e18aa145ed8db232bac)
   - Critical bug: Server/client TTS default mismatch must be fixed
2. **Implementation Worker** for [Issue #166](https://github.com/jpshackelford/voice-relay/issues/166) - [`a434159`](https://app.all-hands.dev/conversations/a4341599a1b3474bba2252cda8675c94)
   - Mobile text transcription display improvement

**Available Slots:**
- Expansion: 4 (no issues need expansion)
- Implementation: 0 (occupied)
- Review: 1 (1 of 2 occupied)

---
### 2026-05-18 03:18 UTC - Merge Worker

**PR #201 Merged** ✅

- **PR:** [#201 - feat(client): simplify kiosk connection indicator to minimal solid dot](https://github.com/jpshackelford/voice-relay/pull/201)
- **Issue:** [#169](https://github.com/jpshackelford/voice-relay/issues/169) (auto-closed)
- **Commit:** `feat(client): simplify kiosk mode connection indicator to solid dot`

**Summary:**
Replaced plug emoji (🔌) connection indicator with minimal solid colored dot:
- Green (#00c853) when connected, red (#ff4444) when disconnected
- Moved to bottom-left corner for balanced layout (AI status stays bottom-right)
- Pure CSS solution eliminates emoji dependency for cross-platform consistency

**Review Evolution:**
1. Initial review: CSS simplification approved, requested screenshots
2. Feedback addressed: Added screenshots to `docs/screenshots/`
3. Final review: "Worth merging" with LOW risk assessment

**Deployed:** Auto-deploying to vr.chorecraft.net

---
### 2026-05-18 03:27 UTC - Implementation Worker

**PR #202 Created** 🔄

- **PR:** [#202 - feat: unify TTS settings with single session-level control and device selection](https://github.com/jpshackelford/voice-relay/pull/202)
- **Issue:** [#191](https://github.com/jpshackelford/voice-relay/issues/191) (Fixes)
- **Status:** Ready for review ✅

**Summary:**
Unified 3 separate unsynced TTS settings into single session-level control with real-time sync:

**Changes:**
- Added `SessionTtsSettings` interface (enabled + outputDeviceId) to session metadata
- Added WebSocket messages for real-time TTS settings sync across all devices
- Updated `registry.broadcastAudioToKiosks()` to support device targeting
- KioskMode & MobileSettings: Replaced local state with session-level TTS toggle + device dropdown
- Deprecated browser-based TTS in favor of server-side ElevenLabs TTS

**Acceptance Criteria (all met):**
- [x] Single unified TTS toggle visible on both kiosk and mobile
- [x] TTS setting changes sync in real-time across all devices
- [x] Device dropdown allows selecting which device plays audio
- [x] Audio only plays on selected device (or all kiosks if none selected)
- [x] TTS setting persists in session metadata
- [x] Workspace-level ElevenLabs API key config unchanged
- [x] Browser-local TTS deprecated/removed

**CI Status:** All checks passing ✅

---
### 2026-05-18 13:45 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `ee2137c` | review | PR #202 - Unified TTS settings | **NEW** |
| `6b82f0b` | implementation | Issue #166 - Mobile oscilloscope transcription | **NEW** |

**Current State:**
- [PR #202](https://github.com/jpshackelford/voice-relay/pull/202): Open, CI green, 1 unresolved review thread (critical TTS default behavior issue)
- Issue #197: Blocked - smoke test failure due to npm cache corruption (needs-human label)

**Ready Issues (no PR yet):**
- #166 (priority:low) - Mobile oscilloscope transcription - **implementation started**
- #167 (priority:low) - Toggle agent actions display
- #188 (priority:low) - ElevenLabs settings info

**Action Taken:**
🚀 **Spawned 2 Workers (parallel):**

1. **Review Worker** for [PR #202](https://github.com/jpshackelford/voice-relay/pull/202) - Unified TTS settings
   - Conversation: [`ee2137c`](https://app.all-hands.dev/conversations/ee2137c796fe4fadabf8c02476460eb1)
   - Task: Address critical review feedback about TTS default behavior

2. **Implementation Worker** for [Issue #166](https://github.com/jpshackelford/voice-relay/issues/166) - Mobile oscilloscope transcription
   - Conversation: [`6b82f0b`](https://app.all-hands.dev/conversations/6b82f0bf0aba4df1a1027ffc4f0b8bcd)
   - Task: Implement server-side speech recognition for unified oscilloscope+transcription mode

**Slot Usage:**
- Expansion: 0/4 (all issues already have `ready` label)
- Implementation: 1/1
- Review: 1/2

**Note:** Issue #197 (smoke test failure) has `needs-human` label - requires manual SSH to clear npm cache on production server.

---
### 2026-05-18 13:55 UTC - Review Worker (`ee2137c`)

✅ **PR #202 Review Feedback Addressed**

- **PR:** [#202 - feat: unify TTS settings with single session-level control and device selection](https://github.com/jpshackelford/voice-relay/pull/202)
- **Issue:** Critical TTS default behavior inconsistency
- **Status:** Ready for review ✅

**Problem:**
Server proceeded with TTS when `sessionTtsSettings` was undefined, but client defaults to disabled (`sessionTtsSettings?.enabled ?? false`). This caused unexpected audio playback on new sessions where UI showed TTS OFF.

**Fix Applied (commits 297c5df, 74b6094):**
- Changed `server/src/tts/index.ts` check from `if (sessionTtsSettings && !sessionTtsSettings.enabled)` to `if (!sessionTtsSettings?.enabled)` - now defaults to disabled when undefined
- Updated tests to properly exercise both session-level and workspace-level TTS checks
- Added explicit tests for new default-disabled behavior

**CI Status:** All checks passing ✅
**Review Thread:** Resolved ✅


### 2026-05-18 14:19 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `57d2254` | review | PR #202 - unify TTS settings | **NEW** |
| `edae91f` | review | PR #203 - audio streaming infrastructure | **NEW** |

**Previous Workers Completed:**
- `6b82f0b` (implementation) → ✅ Created PR #203 for Issue #166
- `ee2137c` (review) → ✅ Addressed feedback on PR #202

**Spawned: 2 Review Workers (parallel)**

1. **Review Worker** for [PR #202 - feat: unify TTS settings](https://github.com/jpshackelford/voice-relay/pull/202)
   - 2 unresolved review threads (device validation suggestions)
   - Conversation: [`57d2254`](https://app.all-hands.dev/conversations/57d22544534e49f493296143bc12e00f)

2. **Review Worker** for [PR #203 - feat: audio streaming infrastructure](https://github.com/jpshackelford/voice-relay/pull/203)
   - 4 unresolved review threads (stale closure bug, memory allocation, etc.)
   - Conversation: [`edae91f`](https://app.all-hands.dev/conversations/edae91fb3d734d16b05cbb7613ff68e2)

**Current State:**
- 2 open PRs (both CI green, both have unresolved review threads)
- 4 ready issues: #166 (PR exists), #191 (PR exists), #167 (priority:low), #188 (priority:low)
- 1 issue with `needs-human`: #197 (smoke test failure - skipped)
- Implementation slot available (will proceed after reviews addressed)

---
### 2026-05-18 14:02 UTC - Implementation Worker

**Issue #166 - Mobile: Text transcription display is poor in oscilloscope view**

Implemented **Phase 1** of the audio streaming infrastructure for server-side transcription.

**PR Created:** [#203 - feat: add audio streaming infrastructure for server-side transcription (Phase 1)](https://github.com/jpshackelford/voice-relay/pull/203)

**What's included:**
- New `useAudioStreaming` hook for client-side audio capture and streaming
- New `AudioBufferManager` for server-side audio chunk accumulation
- New message types for audio streaming (`audio-input-chunk`, `audio-input-end`)
- New transcription response types (`transcription-result`, `transcription-error`)
- Comprehensive unit tests for all new components

**CI Status:** ✅ All checks passing

**Next Steps (Phases 2-4):**
- Phase 2: Implement transcription callback using Whisper/Rev.ai API
- Phase 3: Add 'unified' InputMode in MobileMode.tsx
- Phase 4: Polish (silence detection, reconnection handling, settings UI)

---
### 2026-05-18 14:27 UTC - Review Worker (`edae91f`)

✅ **PR #203 Review Feedback Addressed**

- **PR:** [#203 - feat: add audio streaming infrastructure for server-side transcription (Phase 1)](https://github.com/jpshackelford/voice-relay/pull/203)
- **Issue:** [#166](https://github.com/jpshackelford/voice-relay/issues/166)
- **Status:** Ready for review ✅

**Review Threads Addressed (commit 143a4ed):**

1. ✅ **Critical: Stale closure bug (line 164)** - Added `isStreamingRef` to track streaming state in callbacks. The `onaudioprocess` callback now checks `isStreamingRef.current` instead of the state variable which was captured at callback creation time.

2. ✅ **Important: Memory allocation (line 173)** - Implemented ring buffer pattern with pre-allocated Float32Array (~60 seconds capacity). The callback now writes directly to ring buffer indices instead of creating new arrays on every event, eliminating GC pressure during audio processing.

3. ✅ **Important: samplesPerChunk stale closure (line 68)** - Added `samplesPerChunkRef` with useEffect that updates when sampleRate/chunkDurationMs change. processAudioBuffer reads from ref to ensure current values.

4. ❌ **Declined: AudioWorklet suggestion (line 161)** - Declined as it would significantly expand Phase 1 scope. AudioWorklet requires separate worker module, async registration, and MessagePort communication. ScriptProcessorNode is deprecated but functional. Code already has comment acknowledging this technical debt for Phase 4.

**CI Status:** All checks passing ✅
**Review Threads:** 4/4 resolved

---
### 2026-05-18 14:27 UTC - Review Worker (`57d2254`)

✅ **PR #202 Second Round Review Feedback Addressed**

- **PR:** [#202 - feat: unify TTS settings with single session-level control and device selection](https://github.com/jpshackelford/voice-relay/pull/202)
- **Issue:** Device selection validation on disconnect
- **Status:** Ready for review ✅

**Problem:**
When a user selects a specific kiosk for TTS output and that kiosk disconnects, the device dropdown would show an invalid value. TTS audio would silently fail to play.

**Fix Applied (commit 0ffa71b):**
- Added device existence validation in both KioskMode.tsx and MobileSettings.tsx
- Select now gracefully falls back to "all" when selected device is no longer connected
- Fixed test type errors by adding required `outputDeviceId` to SessionTtsSettings test objects

**CI Status:** All checks passing ✅
**Review Threads:** All resolved (3/3) ✅

**PR is ready for merge.** All review feedback addressed across both review rounds.

---
### 2026-05-18 14:31 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `df26c59` | merge | PR #202 - TTS Settings | **NEW** |
| `29532e5` | review | PR #203 - Audio Streaming (5 threads) | **NEW** |

**Current State:**
- [PR #202](https://github.com/jpshackelford/voice-relay/pull/202): ✅ CI green, 0 unresolved threads → Ready to merge
- [PR #203](https://github.com/jpshackelford/voice-relay/pull/203): ✅ CI green, 5 unresolved threads → Needs review feedback addressed

**Ready Issues:**
- #166 (priority:low) - Mobile text display (PR #203 fixes this)
- #167 (priority:low) - Toggle agent actions
- #188 (priority:low) - API permissions info
- #191 (priority:medium) - TTS settings (PR #202 fixes this)

**Issues needing expansion:**
- #197 - CI failure (`needs-human` label) - Skipped

**Action Taken:**
🚀 **Spawned 2 workers:**
1. **Merge Worker** for [PR #202](https://github.com/jpshackelford/voice-relay/pull/202) - TTS Settings
   - Conversation: [`df26c59`](https://app.all-hands.dev/conversations/df26c59409f445debb235052d3bb3c75)
   - Task: Verify migrations, craft commit message, squash-merge

2. **Review Worker** for [PR #203](https://github.com/jpshackelford/voice-relay/pull/203) - Audio Streaming  
   - Conversation: [`29532e5`](https://app.all-hands.dev/conversations/29532e5516ce42838c88059c72813dd3)
   - Task: Address 5 unresolved review threads

**Implementation slot:** Available after merges (next issue: #167 or #188)

---
### 2026-05-18 14:37 UTC - Merge Worker (`df26c59`)

✅ **PR #202 Merged** - Unified TTS Settings

- **PR:** [#202 - feat: unify TTS settings with single session-level control and device selection](https://github.com/jpshackelford/voice-relay/pull/202)
- **Issue:** [#191](https://github.com/jpshackelford/voice-relay/issues/191) - Auto-closed ✅
- **Merge Commit:** `c654197`

**What Was Merged:**
- Unified session-level TTS settings that sync across all devices in real-time
- `SessionTtsSettings` interface (enabled + outputDeviceId) stored in session metadata
- Device targeting for audio output (specific kiosk or all kiosks)
- WebSocket messages for TTS settings sync
- Browser-based TTS deprecated (AI responses now use ElevenLabs server-side TTS exclusively)

**Key Review Decisions:**
1. TTS defaults to **disabled** when undefined (fixed critical inconsistency)
2. Device dropdown gracefully falls back to "all" when selected device disconnects
3. No database migration needed - uses existing JSON metadata column

**Deployment Notes:**
- Auto-deploying to vr.chorecraft.net
- Safe for production: No schema changes, backward compatible
- Existing sessions will have TTS disabled by default

**Files Changed:** 16 files (+560/-116)

---
### 2026-05-18 14:45 UTC - Review Worker (`29532e5`)

✅ **PR #203 Second Round Review Feedback Addressed**

- **PR:** [#203 - feat: add audio streaming infrastructure for server-side transcription (Phase 1)](https://github.com/jpshackelford/voice-relay/pull/203)
- **Issue:** [#166](https://github.com/jpshackelford/voice-relay/issues/166)
- **Status:** Ready for review ✅

**Review Threads Addressed (4 commits):**

1. ✅ **Critical: Ring buffer overflow (line 207)** - Fixed in `eb8eb54`
   - Added pre-write overflow check
   - Now process buffered audio before writing when near capacity
   - Prevents silent data loss when buffer is full

2. ✅ **Critical: Server audio chunk loss (line 101)** - Fixed in `8568479`
   - Include current chunk before processing when max duration exceeded
   - Accept slight overflow to ensure no audio data is lost

3. ✅ **Suggestion: Variable name (line 60)** - Fixed in `7f4b89d`
   - Renamed `workletNodeRef` to `processorNodeRef` with proper `ScriptProcessorNode` type
   - Removed confusing type cast

4. ✅ **Important: Synchronous processing (line 210)** - Documented in `369be97`
   - Added comment explaining this is a known limitation of ScriptProcessorNode
   - Will be resolved with AudioWorklet migration in Phase 4

5. ✅ **Suggestion: Server performance (line 780)** - Documented in `369be97`
   - Added TODO comment for Phase 2 optimization consideration
   - Worker threads for base64 decoding if multi-device streaming becomes bottleneck

**CI Status:** All checks passing ✅
**Review Threads:** All 5 resolved (including 4 new threads from second review round)

**PR is ready for another review pass.**
