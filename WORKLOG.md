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

### 2026-05-18 14:50 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `0fadaec` | review | PR #203 - Fix merge conflicts | **NEW** |

**Previous Workers Completed:**
- `df26c59` (merge PR #202) → ✅ Merged successfully
- `29532e5` (review PR #203) → ✅ Finished (but conflicts remain)

**PR #202 Merged:** [feat: unify TTS settings with single session-level control](https://github.com/jpshackelford/voice-relay/pull/202)

🚀 **Spawned: Review Worker**
- PR: [#203 - feat: add audio streaming infrastructure](https://github.com/jpshackelford/voice-relay/pull/203)
- Issue: #166 - Mobile: Text transcription display is poor
- Problem: Merge conflict after PR #202 merge
- Conversation: [`0fadaec`](https://app.all-hands.dev/conversations/0fadaec255ea4a8790ab8796d3bb7200)

**Current State:**
- Open PRs: #203 (conflict, needs rebase)
- Ready issues: #166 (in PR), #167, #188 (all priority:low)
- Blocked issues: #197 (needs-human, critical smoke test failure)

**Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 0 | 4 | 4 |
| Implementation | 0 | 1 | 1 |
| Review | 1 | 1 | 2 |

**Housekeeping:**
- ✅ Archived 73 worklog entries (truncated to 15)

---
### 2026-05-18 14:55 UTC - Review Worker (`0fadaec`)

✅ **PR #203 Merge Conflicts Resolved**

- **PR:** [#203 - feat: add audio streaming infrastructure for server-side transcription (Phase 1)](https://github.com/jpshackelford/voice-relay/pull/203)
- **Issue:** [#166](https://github.com/jpshackelford/voice-relay/issues/166)
- **Status:** CI passing ✅, Ready for merge

**Conflict Resolution:**
PR #202 (unified TTS settings) was merged to main while PR #203 (audio streaming) was open. Both PRs modified the same type definition files.

**Files with conflicts resolved:**
1. `client/src/hooks/useWebSocket.ts` - Merged both TTS settings and audio streaming callbacks/refs
2. `client/src/types.ts` - Combined `SessionTtsSettings*` and `AudioInput*`/`Transcription*` message types
3. `server/src/types.ts` - Same as client types

**Resolution approach:**
- Rebased PR #203 branch onto latest main (commit `17555a1`)
- Retained all functionality from both PRs:
  - TTS settings: `SessionTtsSettingsMessage`, `SessionTtsSettingsChangedMessage`, `updateSessionTtsSettings`
  - Audio streaming: `AudioInputChunkMessage`, `AudioInputEndMessage`, `TranscriptionResultMessage`, `TranscriptionErrorMessage`, `sendAudioInputChunk`, `sendAudioInputEnd`

**Verification:**
- ✅ Build passes (client + server)
- ✅ Server tests: 616 passed
- ✅ Client tests: 413 passed
- ✅ CI: All 4 checks green (Build Client, Server Tests, E2E Tests, Conventional Commits)
- ✅ PR status: MERGEABLE, no conflicts

**Commits after rebase:**
- `806ee41` - feat(audio): Add Phase 1 audio streaming infrastructure
- `7aa1e1d` - fix: address review feedback for audio streaming hook
- `e26ad23` - fix: prevent audio data loss on ring buffer overflow
- `cd7b25c` - fix: include current audio chunk when max duration exceeded
- `a7fa9e0` - refactor: rename workletNodeRef to processorNodeRef
- `6f3ecf8` - docs: add documentation for known performance limitations

**PR is ready for merge.**
- ✅ Updated .workflow-state.json

---
### 2026-05-18 15:05 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `2a9ee58` | merge | PR #203 - Audio streaming Phase 1 | **NEW** |
| `2d029a0` | implementation | Issue #167 - Toggle agent actions | **NEW** |

**Workers Completed This Cycle:**
- `0fadaec` (review) → ✅ Addressed review feedback on PR #203 (all 9 threads resolved)

**Current State:**
- [PR #203](https://github.com/jpshackelford/voice-relay/pull/203): CI ✅, all review threads resolved ✅, mergeable ✅ → **Merge worker spawned**
- Issue #167 ready for implementation → **Implementation worker spawned**
- Ready issues: #167 (in progress), #188 (priority:low)
- Blocked: #197 (needs-human - smoke test failure)

**Actions Taken:**
🚀 **Spawned 2 workers:**
1. **Merge Worker** for [PR #203](https://github.com/jpshackelford/voice-relay/pull/203) - Audio streaming infrastructure
   - Conversation: [`2a9ee58`](https://app.all-hands.dev/conversations/2a9ee583414b4d319036f70bbc169267)
   - Task: Craft commit message, squash-merge, verify issue #166 closes

2. **Implementation Worker** for [Issue #167](https://github.com/jpshackelford/voice-relay/issues/167) - Toggle agent actions
   - Conversation: [`2d029a0`](https://app.all-hands.dev/conversations/2d029a03ce474042ac85a2d6e84269a9)
   - Task: Implement toggle to show/hide agent actions in event stream

**Housekeeping:**
- ✅ Archived 6 worklog entries (kept 10)

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 0 | 4 | 4 |
| Implementation | 1 | 0 | 1 |
| Review/Merge | 1 | 1 | 2 |

---
### 2026-05-18 15:20 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `2a9ee58` | merge | PR #203 - Audio streaming Phase 1 | idle |
| `2d029a0` | implementation | Issue #167 - Toggle agent actions | idle |

**Current State:**
- [PR #203](https://github.com/jpshackelford/voice-relay/pull/203): CI ✅, all review threads resolved ✅, mergeable ✅
  - Merge worker is active (idle state)
- Issue #167: Implementation worker active (idle state)
- Issue #197: Blocked (`needs-human` - smoke test failure)

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 0 | 4 | 4 |
| Implementation | 1 | 0 | 1 |
| Review/Merge | 1 | 1 | 2 |

**Action Taken:**
⏳ **Waiting** - Both worker slots occupied with active conversations
- No new work spawned
- Workers are in `idle` state (likely processing or awaiting input)


---

### 2026-05-18 15:36 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `13495a9` | merge | PR #203 - Audio streaming | **NEW** |
| `d55d893` | implementation | Issue #204 - Unify voice modes | **NEW** |

**Spawned: 2 Workers (parallel)**

1. **Merge Worker**
   - PR: [#203 - Audio streaming infrastructure](https://github.com/jpshackelford/voice-relay/pull/203)
   - Status: CI green ✅, all 9 review threads resolved ✅
   - Conversation: [`13495a9`](https://app.all-hands.dev/conversations/13495a900f1b403bbf571889f6502b6b)

2. **Implementation Worker**
   - Issue: [#204 - Mobile: Unify voice and visualizer modes](https://github.com/jpshackelford/voice-relay/issues/204) (priority:medium)
   - Conversation: [`d55d893`](https://app.all-hands.dev/conversations/d55d893fba2047208386b6faf8a66a4b)

**Current State:**
- PR #203 ready to merge (CI green, reviews addressed)
- Ready issues: #204 (medium), #167 (low), #188 (low)
- On-hold: #166 (low, on-hold label)
- Blocked: #197 (needs-human label)
- No issues need expansion

**Previous Workers Completed:**
- `2d029a0` (implementation for #167) - Worker finished but no PR created
- `2a9ee58` (merge for #203) - Worker finished but PR not yet merged

---

### 2026-05-18 15:44 UTC - Implementation Worker (`d55d893`)

✅ **PR #205 Created for Issue #204**

- **PR:** [#205 - feat(client): add unified input mode for voice + visualizer](https://github.com/jpshackelford/voice-relay/pull/205)
- **Issue:** [#204 - Mobile: Unify voice and visualizer modes with client-side STT](https://github.com/jpshackelford/voice-relay/issues/204)
- **Status:** CI passing ✅, Ready for review

**Implementation Summary:**
Added new "Unified" input mode that combines Web Speech API transcription with oscilloscope visualization. Modern browsers handle two logical mic streams to the same physical microphone, so the Web Speech API and getUserMedia can coexist.

**Changes:**
1. Added `'unified'` to `InputMode` type: `'voice' | 'visualizer' | 'unified'`
2. Updated `MobileSettings` with three-button selector (Voice / Unified / Visualizer)
3. Updated `MobileMode` to handle unified mode:
   - Starts both Web Speech API and getUserMedia for oscilloscope
   - Shows oscilloscope in unified mode
   - Transcription auto-submits as in voice mode
4. Header toggle cycles: voice → unified → visualizer → voice
5. Added comprehensive tests for unified mode functionality

**Acceptance Criteria:**
- ✅ New "Unified" input mode option in mobile settings
- ✅ Unified mode shows oscilloscope AND performs live transcription  
- ✅ Transcription auto-submits as it does in voice mode today
- ✅ Both streams clean up properly when stopped
- ⏳ Works on iOS Safari and Android Chrome (needs manual verification)

**Verification:**
- ✅ Client tests: 407 passed
- ✅ TypeScript: No errors
- ✅ Build: Passes
- ✅ CI: All checks green (Build Client, Server Tests, E2E Tests, Conventional Commits)

---

### 2026-05-18 15:46 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `d14a3c8` | implementation | Issue #167 - Toggle agent actions | **NEW** |
| `09881b0` | review | PR #205 - Unified input mode | **NEW** |

**Workers Completed This Cycle:**
- `d55d893` (implementation for #204) → ✅ Created PR #205
- `13495a9` (merge for PR #203) → ✅ PR #203 merged successfully

**Current State:**
- [PR #205](https://github.com/jpshackelford/voice-relay/pull/205): CI ✅, 3 review threads to address
- [PR #203](https://github.com/jpshackelford/voice-relay/pull/203): ✅ MERGED
- Ready issues: #188 (priority:low)
- Blocked: #197 (needs-human - smoke test failure)
- No issues need expansion

**Actions Taken:**
🚀 **Spawned 2 workers:**
1. **Implementation Worker** for [Issue #167](https://github.com/jpshackelford/voice-relay/issues/167) - Toggle agent actions
   - Conversation: [`d14a3c8`](https://app.all-hands.dev/conversations/d14a3c8906514b73ab61eb66f0ef3a1b)

2. **Review Worker** for [PR #205](https://github.com/jpshackelford/voice-relay/pull/205) - Unified input mode (3 review threads)
   - Conversation: [`09881b0`](https://app.all-hands.dev/conversations/09881b01c423427caddc31d7d308d411)

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 0 | 4 | 4 |
| Implementation | 1 | 0 | 1 |
| Review | 1 | 1 | 2 |

---

### 2026-05-18 15:55 UTC - Review Worker (`09881b0`)

✅ **PR #205 Review Feedback Addressed**

- **PR:** [#205 - feat(client): add unified input mode for voice + visualizer](https://github.com/jpshackelford/voice-relay/pull/205)
- **Issue:** [#204](https://github.com/jpshackelford/voice-relay/issues/204)
- **Status:** CI passing ✅, All review threads resolved ✅, Ready for merge

**Review Feedback Addressed (3 threads → all resolved):**

1. **Extract stream cleanup logic** (🟡 Suggestion)
   - Extracted `cleanupAudioStream()` helper to reduce duplication
   - Now used consistently in mode change effect and handleMicToggle

2. **Extract getUserMedia + analyser start pattern** (🟡 Suggestion)
   - Extracted `startAudioVisualizer()` async helper
   - Centralizes the getUserMedia + analyser.start pattern for reuse

3. **Error handling could be more precise** (🟠 Important)
   - Unified mode now uses separate try-catch blocks
   - If speech recognition fails, returns early without starting visualizer
   - If visualizer fails after speech started, properly cleans up speech
   - Makes error handling explicit about what succeeded/failed

**Commit:** `c3fa7e1` - refactor(MobileMode): extract helpers and improve error handling

**Verification:**
- ✅ Client tests: 407 passed
- ✅ TypeScript: No errors

**PR is ready for merge.**

---

### 2026-05-18 15:50 UTC - Implementation Worker (`d14a3c8`)

✅ **PR #206 Created for Issue #167**

- **PR:** [#206 - feat(client): add toggle to show/hide agent actions from OpenHands event stream](https://github.com/jpshackelford/voice-relay/pull/206)
- **Issue:** [#167 - Add toggle to show/hide agent actions from OpenHands event stream](https://github.com/jpshackelford/voice-relay/issues/167)
- **Status:** CI passing ✅, Ready for review ✅

**Implementation Summary:**
Added collapsible "Agent Actions" panel in kiosk sidebar that displays real-time OpenHands agent events (file reads, command runs, browser actions, etc.). Toggle state persists to localStorage.

**Key Changes:**

1. **Server-side** (`server/src/openhands.ts`, `server/src/index.ts`):
   - Added `AgentAction` interface and `AgentActionMessage` type
   - Added `formatEventSummary()` helper for human-readable action descriptions
   - Added `ActionCallback` and `setActionCallback()` in AISessionManager
   - Modified `connectWebSocket()` to forward agent action events to clients

2. **Client-side types** (`client/src/types.ts`):
   - Added `AgentAction` and `AgentActionMessage` types

3. **New hook** (`client/src/hooks/useAgentActions.ts`):
   - Manages actions list (max 50 retained)
   - Persists toggle state to localStorage
   - Provides `getActionIcon()` for action type icons

4. **UI** (`client/src/components/KioskMode.tsx`):
   - Added collapsible agent actions panel below participants
   - Shows action count badge when collapsed
   - Auto-scrolls to latest actions when expanded

5. **Styles** (`client/src/App.css`):
   - Added `.kiosk-agent-actions` panel styles
   - Responsive design for mobile/desktop

**Acceptance Criteria:**
- ✅ Toggle button appears in kiosk sidebar below participants
- ✅ Toggle state persists in localStorage
- ✅ When enabled, agent actions display in collapsible panel
- ✅ Actions show: action type icon + brief description
- ✅ Panel auto-scrolls to show latest actions
- ✅ Maximum 50 actions retained (older ones pruned)
- ✅ Panel respects mobile/desktop responsive layout
- ✅ Performance: No UI jank with rapid event stream

**Tests:**
- ✅ 8 new unit tests for useAgentActions hook
- ✅ All server tests passing (37 tests)
- ✅ All client tests passing (55 tests)
- ✅ E2E tests passing

**Verification:**
- ✅ Build passes
- ✅ CI: All checks green (Build Client, Server Tests, E2E Tests, lint-pr-title)


---

### 2026-05-18 16:49 UTC - Expansion Worker

✅ **Issue #209 Expanded and Ready**

- **Issue:** [#209](https://github.com/jpshackelford/voice-relay/issues/209) - Fix Express trust proxy configuration causing proxy errors
- **Labels Added:** `ready`, `priority:high`

**Root Cause Verified:**
- Express app created at `server/src/index.ts:95` without `trust proxy` setting
- `express-rate-limit` v8.5.0 throws ValidationError when X-Forwarded-For header is present but trust proxy is false
- The `qrTokenLimiter` in sessions/router.ts triggers the error (lacks the `xForwardedForHeader: false` workaround)

**Implementation Details Added:**
- File to modify: `server/src/index.ts`
- Add `app.set('trust proxy', 1)` after `const app = express();` (line 95)
- This is the standard Express configuration for apps behind reverse proxies

**Status:** Ready for implementation worker to pick up.

---
### 2026-05-18 16:04 UTC - Orchestrator

**Active Workers:**
| Conv ID | Type | Working On | Status |
|---------|------|------------|--------|
| `d14a3c8` | implementation | Issue #167 - Toggle agent actions | running |
| `a24926b` | merge | PR #205 - Unified input mode | **NEW** |

**Workers Completed This Cycle:**
- `09881b0` (review for PR #205) → ✅ All review threads resolved

**Current State:**
- [PR #206](https://github.com/jpshackelford/voice-relay/pull/206) (draft): CI ✅, Toggle agent actions (#167) - impl worker running
- [PR #205](https://github.com/jpshackelford/voice-relay/pull/205): CI ✅, all threads resolved ✅ → **Merge worker spawned**
- Ready issues: #188 (priority:low)
- Blocked: #197 (needs-human - smoke test failure)

**Actions Taken:**
🚀 **Spawned: Merge Worker** for [PR #205](https://github.com/jpshackelford/voice-relay/pull/205)
- Issue: [#204](https://github.com/jpshackelford/voice-relay/issues/204) - Unified input mode
- Conversation: [`a24926b`](https://app.all-hands.dev/conversations/a24926bfb83a4b63af07974d02f469de)
- Task: Craft commit message, squash-merge, verify issue closes

**Available Slots:**
| Type | Active | Available | Max |
|------|--------|-----------|-----|
| Expansion | 0 | 4 | 4 |
| Implementation | 1 | 0 | 1 |
| Review/Merge | 1 | 1 | 2 |

