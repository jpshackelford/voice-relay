# Issue drafts — Session state machine + AgentDriver phased rollout

> These are drafts intended to be filed as individual GitHub issues. Each follows the agreed structure:
>
> - **Context** — where this fits in the broader plan (≤4 sentences, links to docs)
> - **Problem statement** — what is wrong or missing today
> - **Proposed solution** — what we're doing about it (the contract, not the implementation)
> - **Test criteria** — explicit, agent-verifiable acceptance checks
>
> Implementation detail (file lists, code sketches, exact diffs) belongs in a follow-on comment on the issue once it's open, not in the issue body.
>
> Labels referenced are from this repo's existing label set: `enhancement`, `bug`, `client`, `documentation`, `priority:high`, `priority:medium`, `priority:low`, `ready`. No new labels are invented.

## Dependency graph

```
Phase 1 (independent)
  1.1 ─┐
  1.2 ─┘

Phase 2 (foundation)
  2.1 ── 2.2 ── 2.3
                │
Phase 3 (SESSION_STATE fixes as driver methods)
                ├── 3.1
                ├── 3.2  (← also fixes a newly discovered bug)
                ├── 3.3
                ├── 3.4 ── 3.5
                └── 3.6

Phase 4 (recovery on reap)
                                3.4 ─── 4.1 ─── 4.2

Phase 5 (persistence MVP)
                                        4.1 ─── 5.1 ─── 5.2 ─── 5.3

Phase 6 (polish; do only if measurement says they matter)
                                                6.1
                                                6.2
```

Phase 1 issues can ship in any order against `main` independently. Everything from Phase 2 onward depends on the driver interface being in place.

---

## Phase 1 — WebSocket reliability

### 1.1  Client WebSocket auto-reconnect

**Labels:** `enhancement`, `client`, `priority:high`, `ready`
**Depends on:** none
**Estimated size:** ~40 LOC + 1 test

#### Context

Voice Relay's client WebSocket (`client/src/hooks/useWebSocket.ts`) closes silently on proxy idle timeouts, network blips, and laptop sleep. Per `docs/SESSION_STATE.md` symptom 1, this manifests as a green dot turning red with no recovery short of a full page refresh. This is the single most user-visible reliability problem and the cheapest to fix. Lands independently against `main`; not on the driver path. See `docs/architecture.md` § "Wire protocol" for context on where this fits.

#### Problem statement

`ws.onclose` sets `connected=false` and never reopens the socket. The effect dependency list (`[deviceId, displayName, workspaceId, sessionId]`) doesn't change on socket death, so the connect effect never re-runs. `sendText` silently no-ops because `wsRef.current?.readyState !== OPEN`, swallowing user input.

#### Proposed solution

On `ws.onclose` (when reason is not a deliberate close caused by device-removed / workspace-deleted / sign-out), schedule reconnection with exponential backoff and jitter:

- Initial delay: 250 ms.
- Backoff factor: 2×.
- Maximum delay: 30 s.
- Jitter: ±25%.
- Reset to initial delay on successful `onopen` followed by successful `register`/`registered` round-trip.
- Suppress reconnect when the close was triggered by a `terminated`-class event (`device-removed`, `workspace-deleted`, explicit sign-out).
- Preserve `lastKnownDevicesRef` across reconnects so the UI doesn't flicker (already in place — verify it still works under the new flow).

The reconnect loop is internal to `useWebSocket`; no API change to consumers.

#### Test criteria

All must pass:

1. **New Playwright test** under `tests/` that:
   - Launches the kiosk client against the dev server.
   - Waits for `connected === true` (green dot visible).
   - Kills the server WS connection for the device (server-side handler closes the ws with code 1011 or similar; an existing test helper or a new one). Asserts `connected === false`.
   - Within 30 s of the kill, asserts `connected === true` again **without** a page reload.
   - Asserts that `currentSession` and `devices` state are restored after reconnect.
2. **Unit test** in `useWebSocket.test.ts` that uses a fake WebSocket and verifies:
   - Backoff sequence is monotonic with jitter (within ±25%) up to the 30 s cap.
   - Backoff resets after a successful open+register cycle.
   - No reconnect is scheduled when `wasRemoved === true` or when the close was caused by a `workspace-deleted` server message.
3. The existing test suite (`npm test`) passes unchanged.
4. **Manual check**: with the dev server running, restart it (`pkill -f 'tsx watch'` then restart). The client reconnects within 30 s, the green dot returns, and the previously-typed message buffer (if any) sends without manual intervention.

---

### 1.2  WebSocket keepalive heartbeat

**Labels:** `enhancement`, `priority:high`, `ready`
**Depends on:** 1.1 (handler shares the same effect; orderable but easier to do after)
**Estimated size:** ~60 LOC + 2 tests

#### Context

Even with auto-reconnect (#1.1), the **first** close due to proxy idle timeout still costs the user a 1–30 s gap. A keepalive prevents the close from happening at all when the connection is idle but live. See `docs/SESSION_STATE.md` § fix #2 and `docs/architecture.md` § "Wire protocol".

#### Problem statement

There is no `ping`/`pong` on either side of the device WebSocket. Apache `ProxyTimeout` and similar middleboxes close WS connections after ~60 s of idle. This is the root cause of "the green dot turned red after a few minutes" in the documented symptom #1.

The exact production proxy timeout has not been measured. The default heartbeat interval below assumes 60 s; revise if measurement comes back tighter.

#### Proposed solution

- **Client (`useWebSocket.ts`):** every 25 s of WS idle (no messages sent or received), send `{ type: 'ping' }`. If no `pong` (or any message) is received within 10 s of the ping, consider the connection dead and trigger close → reconnect (per #1.1).
- **Server (`server/src/index.ts`):** on `ping`, reply immediately with `{ type: 'pong' }`. Additionally, every 30 s, check the WS readyState for each registered device; if a client hasn't pong'd in 60 s, call `ws.terminate()`. Use the `ws` library's native ping/pong frames *or* the JSON-level messages above (pick one — JSON is simpler to test).
- Heartbeat applies to authenticated WS only; not to other transports.

#### Test criteria

All must pass:

1. **New Playwright test** that simulates a 90 s idle period by suspending JS execution on a worker tab (or by waiting in real time on a CI runner with `test.slow()`); asserts the connection stays `connected === true` throughout.
2. **Unit test** in `useWebSocket.test.ts`:
   - With a fake WS and a controlled clock, advances 25 s; asserts a `ping` is sent.
   - Receives a `pong` within 10 s; asserts no close is triggered.
   - Advances 10 s without a `pong`; asserts the WS is closed and reconnect is scheduled.
3. **Server-side test** in `registry.test.ts` (or new `keepalive.test.ts`) verifies that idle devices without recent pong are terminated within 60 s of the configured `ws` library tick.
4. **Manual:** observe the kiosk in a tab in the background for 5 minutes. Connection stays green throughout; no reconnects logged in the server.

---

## Phase 2 — Driver interface foundation (no behavior change)

### 2.1  Define AgentDriver TypeScript interface and FakeDriver

**Labels:** `enhancement`, `documentation`, `priority:high`
**Depends on:** none (but blocks 2.2+)
**Estimated size:** ~150 LOC types + ~250 LOC FakeDriver + tests

#### Context

The whole architecture defined in `docs/architecture.md` rests on a provider-neutral `AgentDriver` interface. This issue introduces only the interface and a fake implementation; no platform code switches over to using it yet. That switch is #2.2 + #2.3. Splitting the work this way keeps each PR small and reviewable.

#### Problem statement

`server/src/openhands.ts` is the only AI-session abstraction today. Its types, methods, and concepts (sandboxes, conversations, session_api_key, agent_server_url) leak into `index.ts`, `auto-connect.ts`, and into the database via `metadata.aiConversationId`. There is no seam at which a different agent provider could be substituted, no surface for unit tests that don't need OH, and no single status type — multiple booleans (`connected`, `connecting`, `thinking`, `error`) encode what should be one enum.

#### Proposed solution

Add the following, with **no callers using them yet**:

- `server/src/agent-driver/types.ts` — exports `AgentDriver`, `AgentSessionStatus`, `AgentSessionState`, `AgentEvent`, `OpenSessionOpts`, and supporting types per `docs/architecture.md` § "AgentDriver interface".
- `server/src/agent-driver/fake.ts` — exports `FakeDriver` implementing `AgentDriver` with in-memory state and a scripted-event-sequence DSL for use in tests. Supports fault injection: `simulateMissing()`, `simulateStuck()`, `simulateError(code)`.
- `server/src/agent-driver/index.ts` — barrel export.
- `server/src/agent-driver/fake.test.ts` — exercises the fake's protocol invariants:
  - `openSession` is idempotent and converges to `state: 'ready'`.
  - `sendMessage` returns an async iterable that yields at least one `kind: 'message'` terminal event under normal scripting.
  - After `simulateMissing()`, `sendMessage` yields a `status` event with `state: 'reconnecting'` followed by either resolution or an `error` event with `recoverable: false`.
  - `restartSession` transitions from `degraded`/`ready`/`thinking` back to `starting → ready`.
  - `getSessionStatus` is cheap and side-effect-free.

Do **not** modify `openhands.ts`, `auto-connect.ts`, `index.ts`, or any existing test in this issue.

#### Test criteria

1. `npm test` (including the new `fake.test.ts`) passes.
2. `grep -r 'OpenHands\|session_api_key\|sandbox_id\|conversation_id\|agent_server_url' server/src/agent-driver/types.ts server/src/agent-driver/fake.ts` returns **zero matches**. The interface and the fake are provider-neutral by inspection.
3. `tsc --noEmit -p server/tsconfig.json` compiles cleanly with the new types in place.
4. The new files have no production callers (verified by `grep -r 'agent-driver' server/src/ --exclude-dir=agent-driver | wc -l` returning 0).

---

### 2.2  Wrap AISessionManager as OpenHandsAgentDriver adapter

**Labels:** `enhancement`, `priority:high`
**Depends on:** 2.1
**Estimated size:** ~400 LOC + adapter test

#### Context

Step 2 of 3 introducing the driver layer. We're wrapping today's `AISessionManager` behind the `AgentDriver` interface as a thin adapter, **without changing any callers yet**. Behavior is unchanged. Caller migration is #2.3. See `docs/architecture.md` § "OpenHands adapter".

#### Problem statement

The current `AISessionManager` (in `server/src/openhands.ts`) exposes a provider-shaped API: `getOrCreateForSession`, `sendSessionMessage`, `hasSessionAI`, `endSessionAI`, plus callbacks (`setThinkingChangeCallback`, `setActionCallback`, `setEventCallback`). Platform code calls these directly. We need an adapter that presents the `AgentDriver` interface on the outside while delegating to `AISessionManager` on the inside, so #2.3 can swap callers one by one without a flag day.

#### Proposed solution

- Add `server/src/agent-driver/openhands/driver.ts` exporting `class OpenHandsAgentDriver implements AgentDriver`.
- The class **wraps** the existing `aiSessionManager` singleton — does not replace it.
- Method mapping:
  - `openSession(sessionId, opts)` → idempotent: returns current `getSessionStatus`. Does NOT call `getOrCreateForSession`; lazy provisioning is the new model. If a binding already exists in `aiSessionManager`, derive status from it.
  - `sendMessage(sessionId, utteranceId, text)` → call `aiSessionManager.getOrCreateForSession` if no binding, then `sendSessionMessage`. Return an `AsyncIterable<AgentEvent>` driven by:
    - Translating `onMessage` callback invocations to `{ kind: 'message' }`.
    - Translating `onAction` callback invocations to `{ kind: 'action' }`.
    - Translating `onThinkingChange` callback invocations to `{ kind: 'status' }` with appropriate `state`.
    - Terminating when execution_status reaches `idle` or `finished`.
  - `restartSession(sessionId)` → call `endSessionAI` then `getOrCreateForSession`. This is the v0 implementation; the real rebind logic lands in #4.1.
  - `getSessionStatus(sessionId)` → synthesize from `aiSessionManager.getSessionAI(sessionId)` (booleans → state enum per the mapping in `docs/architecture.md`).
  - `closeSession(sessionId)` → delegate to `endSessionAI`.
- Add `server/src/agent-driver/openhands/driver.test.ts` that constructs an adapter against a mocked `aiSessionManager` and verifies the method mapping above.
- The singleton stays `aiSessionManager` (in `openhands.ts`); a new singleton `agentDriver: AgentDriver = new OpenHandsAgentDriver(aiSessionManager)` is exported from `server/src/agent-driver/index.ts`.

Explicitly out of scope for this issue:

- Changing any callers of `aiSessionManager` in `index.ts` or `auto-connect.ts`.
- Implementing real MISSING-rebind, persistence, condense, or `session_api_key` re-read.

#### Test criteria

1. `npm test` passes, including new `driver.test.ts`.
2. All existing `openhands.test.ts`, `auto-connect.test.ts`, `thinking-callback.integration.test.ts` still pass with no modifications.
3. `tsc --noEmit -p server/tsconfig.json` compiles cleanly.
4. A new Playwright smoke run (using the existing AI smoke fixture if any, or a minimal new one) confirms an AI session can still be auto-connected and a message exchanged end-to-end. The adapter must produce **bit-identical** observable behavior to the unwrapped code path.
5. `grep -r 'OpenHandsAgentDriver\|agentDriver' server/src/index.ts server/src/auto-connect.ts` returns zero matches (no callers yet; that's #2.3).

---

### 2.3  Route platform code through AgentDriver interface

**Labels:** `enhancement`, `priority:high`
**Depends on:** 2.2
**Estimated size:** ~300 LOC delta in `index.ts` and `auto-connect.ts`

#### Context

Step 3 of 3 introducing the driver layer. After this, `server/src/index.ts` and `server/src/auto-connect.ts` import only from `server/src/agent-driver/` — never from `server/src/openhands.ts`. The driver wraps the legacy code; behavior is unchanged. The seam is then real, and future work (Phase 3+) modifies driver internals only. See `docs/architecture.md` § "Layered model".

#### Problem statement

Today `index.ts` imports `aiSessionManager` directly (for `shouldAutoConnect`, status broadcasts, and `endSessionAI` on device-leave). `auto-connect.ts` imports it as a type. This is the leakage that the driver interface exists to eliminate.

#### Proposed solution

- Replace all imports of `aiSessionManager` (and any `AISessionManager` type) in `server/src/index.ts`, `server/src/auto-connect.ts`, and any callers under `server/src/sessions/`, `server/src/agent-events/`, `server/src/workspaces/` with the equivalent `AgentDriver` interface method calls from `server/src/agent-driver/`.
- `shouldAutoConnect(sessionId, ...)` → driver method `getSessionStatus(sessionId)` returns state; auto-connect logic checks `state === 'absent'` instead of `hasSessionAI`.
- `autoConnectAI` → calls `driver.openSession`. The first `sendMessage` provisions lazily, consistent with the architecture.
- The thinking/action callbacks (`setThinkingChangeCallback`, etc.) become consumers of `AsyncIterable<AgentEvent>` from `sendMessage`. The legacy callback registration stays on `aiSessionManager` internally for the adapter's use, but platform code does not subscribe to them.
- Update `server/src/agent-events/` to consume `AgentEvent` events emitted by the driver layer rather than reaching into `aiSessionManager.setEventCallback`.
- The `aiSessionManager` singleton remains *only* as an implementation detail of the OH adapter and is no longer exported for direct consumption.

#### Test criteria

1. `grep -rn "from '.*openhands'" server/src --include='*.ts' | grep -v 'agent-driver/openhands' | grep -v openhands.test.ts | grep -v openhands.ts` returns **zero matches**.
2. `grep -rn 'aiSessionManager' server/src --include='*.ts' | grep -v 'agent-driver/openhands' | grep -v openhands.ts | grep -v openhands.test.ts | grep -v thinking-callback.integration.test.ts` returns **zero matches**.
3. `npm test` passes. All existing tests still apply; some may need to swap `aiSessionManager` imports for `agentDriver` imports if they're integration tests of platform behavior (not OH unit tests).
4. `tsc --noEmit` clean.
5. **Manual end-to-end**: dev server up, kiosk client connects, sends a message, agent replies, action cards render, agent finishes. No regression vs. the pre-#2.3 behavior.
6. **Driver substitution check**: in a test file under `server/src/`, swap `agentDriver` for `new FakeDriver()` and assert at least one platform-level test (e.g. an auto-connect test) runs end-to-end against the fake. If this is feasible without changes to production code, the seam is real.

---

## Phase 3 — SESSION_STATE fixes as driver methods

These issues collectively resolve `docs/SESSION_STATE.md` items #3–#7 and one newly-discovered bug. Each lands behind the AgentDriver interface.

### 3.1  Resync session state on register

**Labels:** `enhancement`, `bug`, `priority:high`
**Depends on:** 2.3
**Estimated size:** ~80 LOC + 1 test

#### Context

Per `docs/SESSION_STATE.md` symptom #2 ("After a browser refresh, my messages and agent messages all come back fine ... but the ✨ AI symbol is no longer showing"). With the driver in place, the fix is to push current status to the freshly-registered device via the existing `session-ai-status` message (and, after #3.6, via `session-state`). See `docs/architecture.md` § "Sequence A".

#### Problem statement

In `server/src/index.ts`, the `register` case sends `history` and current `session-tts-settings-changed` but does **not** send the current AI session status to the device. Status is only broadcast on *transitions* (in `AISessionManager`). A device that joins mid-conversation never learns the ✨ / 🤔 state and stays at the default `{connected:false, thinking:false}` forever.

#### Proposed solution

In the `register` case in `server/src/index.ts`, after `history` and TTS-settings are sent, call `driver.getSessionStatus(sessionId)`. If `state !== 'absent'`, send the corresponding `session-ai-status` and (if `state === 'thinking'`) `ai-thinking` message to **this ws only** — not a broadcast. Until #3.6 lands, use the legacy message shapes.

#### Test criteria

1. **New integration test** (under `server/src/` or `tests/`):
   - Set up a session with an AI session that has been bound and is `ready` (mock the driver to return that status).
   - Connect a fresh client WS and send `register`.
   - Assert that, after `history` and before any subsequent server-initiated messages, this WS receives a `session-ai-status` message with `connected: true, conversationId: '<expected>'`.
   - Repeat with the driver returning `thinking`; assert an additional `ai-thinking` message with `thinking: true`.
2. `npm test` passes.
3. **Playwright regression**: kiosk in a session with a running agent → refresh the page → ✨ icon is visible within 2 s of WS open. (Acceptance criterion from `SESSION_STATE.md` #3.)

---

### 3.2  Re-fetch session_api_key on every reconnect

**Labels:** `bug`, `priority:high`
**Depends on:** 2.3 (lands inside the OH adapter; needs driver seam)
**Estimated size:** ~50 LOC + 1 test

#### Context

A bug discovered during Track A probing (not in `SESSION_STATE.md`). The OpenHands `session_api_key` is **sandbox-scoped and rotates on every sandbox resume**. The current `AISessionManager` caches it on `AISession` from the initial `getConversation` call and never re-reads it. After the first 20-minute idle pause (which OH does automatically by default), the cached key becomes invalid and the agent WS gets a 401 on reconnect. See `docs/openhands-platform.md` § "Identity and keys".

#### Problem statement

`server/src/openhands.ts` connectWebSocket uses `session.sessionApiKey` from the cached `AISession` for the WS query parameter `session_api_key=...`. If the underlying OH sandbox has been paused and resumed (a routine SaaS-side event), the cached key is stale and the WS connection will fail authentication — silently in current code, since `ws.on('error')` only logs.

This is a likely root cause of the persistent "WebSocket not connected" zombie session described in `SESSION_STATE.md` symptom #4. Worth fixing on its own, separate from the larger MISSING-recovery work in #4.1.

#### Proposed solution

Inside the OH adapter (`server/src/agent-driver/openhands/`), wherever the code reconnects the agent-server WebSocket — including the existing exponential-backoff reconnect loop in `connectWebSocket` — re-read the conversation via `GET /api/v1/app-conversations?ids=<conv_id>` (or `GET /api/v1/sandboxes?id=<sb_id>`) **before** constructing the WS URL. Update the cached `sessionApiKey` with the freshly-read value. If the new value is null (sandbox MISSING), do not retry the WS; defer to #4.1's MISSING handler.

#### Test criteria

1. **Unit test** with mocked HTTP fetch:
   - Initial connect uses key `K1`.
   - Simulate a WS close.
   - Mock `getConversation` to return key `K2`.
   - Assert the next WS connect URL contains `session_api_key=K2`, not `K1`.
2. **Unit test** that confirms an HTTP 404 from `getConversation` on reconnect skips the WS attempt and instead transitions the driver session to `degraded` (which is the in-flight contract until #4.1).
3. `npm test` passes.
4. **Manual** (requires probe-style test against a real OH sandbox): start an AI session, leave it idle for >20 min so OH auto-pauses the sandbox, then send a new message. The driver must successfully reconnect with the rotated key and deliver the message.

---

### 3.3  Single-flight conversation start

**Labels:** `enhancement`, `bug`, `priority:medium`
**Depends on:** 2.3
**Estimated size:** ~40 LOC + 1 test

#### Context

Per `SESSION_STATE.md` symptom #3b ("cross-device race"): two devices joining the same VR session concurrently can both pass `shouldAutoConnect`'s "first device" check and both call `getOrCreateForSession`. The dedup in `AISessionManager` is a synchronous `Map.get` at function entry, but `startConversation` is awaited, so both calls race to create a fresh OH conversation. The second `sessionAI.set` wins, the first one's conversation is orphaned.

#### Problem statement

`getOrCreateForSession`'s dedup is not concurrency-safe. Under cross-device race, two OH conversations get created, one is orphaned, and the user sees inconsistent state because the event history rehydration (keyed on `metadata.aiConversationId`) may reference whichever conversation lost the race.

#### Proposed solution

Inside the OH adapter, maintain `sessionAIStarting: Map<sessionId, Promise<AgentSessionStatus>>`. On `sendMessage` (or any path that would call `getOrCreateForSession`):

- If `sessionAIStarting.has(sessionId)`, `await` the existing promise instead of starting a new conversation.
- If not, create the promise, store it, await it, then delete the entry on settle (success or failure).

Concurrent callers `await` the same promise. Exactly one upstream `startConversation` happens per (sessionId, generation).

#### Test criteria

1. **Unit test** that fires 5 concurrent `sendMessage` calls on the same `sessionId` with no prior binding. Assert that the mocked `startConversation` is called **exactly once**, and all 5 callers' iterables yield events keyed to the same conversation_id.
2. Existing `openhands.test.ts` / adapter tests pass.
3. The fix has no effect when calls are serial (no overhead in the common path).

---

### 3.4  Map ConversationExecutionStatus to driver session state

**Labels:** `enhancement`, `priority:high`
**Depends on:** 2.3
**Estimated size:** ~120 LOC + 2 tests

#### Context

The OH agent server emits a documented `ConversationExecutionStatus` (`idle|running|paused|stuck|finished|error|deleting|waiting_for_confirmation`) via `ConversationStateUpdateEvent` on the events WebSocket and as a field on the app server's `AppConversation`. Today the driver guesses thinking state from "agent sent a message" heuristics. Reading the actual status is more reliable and **removes the need for the 5-minute thinking-deadline timer** in `SESSION_STATE.md` #6. See `docs/openhands-platform.md` § "Conversation status" and `docs/architecture.md` § "Session state mapping".

#### Problem statement

`AISessionManager` has `isThinking: boolean` set when sending a message, cleared when an agent message arrives. If the agent finishes a turn without emitting a message (tool-only turn), or if the WS drops between "agent finished" and the message arriving on the wire, `isThinking` is stuck. The proposed mitigation in `SESSION_STATE.md` was a 5-minute timeout heuristic. We can do better: OH literally tells us the state.

#### Proposed solution

- Inside the OH adapter, parse `ConversationStateUpdateEvent` with `key === 'execution_status'` from the agent-server WS. Update an internal `executionStatus` field on the session binding.
- Map to driver `AgentSessionState` per the table in `docs/architecture.md`:
  - `idle`, `finished`, `paused`, `waiting_for_confirmation` → `ready`
  - `running` → `thinking`
  - `stuck` → `degraded` (error: "Agent appears stuck")
  - `error` → `degraded` (error from the event's value)
  - `deleting` → `absent`
- Drive the driver's status surface from this mapping instead of from message-arrival heuristics. Remove `isThinking` boolean entirely (or keep it as a derived getter for compatibility during the transition).
- Delete the 5-minute thinking-deadline timer plan from #6 (no longer needed).

#### Test criteria

1. **Unit test** that feeds each of the eight `execution_status` values into the adapter and asserts the resulting `getSessionStatus().state`.
2. **Unit test** that confirms an agent turn that finishes without an agent `MessageEvent` (e.g., a turn that only invokes tools) still transitions back to `ready` once `execution_status: idle` is received.
3. **Integration test** that uses `FakeDriver` to simulate `stuck`; the kiosk shows the degraded indicator and offers the Restart Agent button (which is wired in #3.5).
4. `npm test` passes.

---

### 3.5  Restart Agent endpoint + UI affordance

**Labels:** `enhancement`, `client`, `priority:medium`
**Depends on:** 3.4
**Estimated size:** ~150 LOC server + ~80 LOC client + 2 tests

#### Context

Per `SESSION_STATE.md` #6, when the AI session reaches `degraded` (stuck, unrecoverable error, max reconnect attempts exhausted), the user needs an explicit way to force a fresh start. The driver method `restartSession` exists; this issue wires up the REST endpoint and the kiosk button. See `docs/architecture.md` § "Sequence D".

#### Problem statement

Today the user's only recourse when the AI is unrecoverable is reloading the page (which still re-uses the same OH conversation) or asking the workspace owner to do something server-side. There is no in-product "try again" affordance for the AI session.

#### Proposed solution

**Server:**
- `POST /api/sessions/:sessionId/ai/restart` — authenticated, requires the requester to be in the session (same auth as other session endpoints). Calls `driver.restartSession(sessionId)`. Returns the new `AgentSessionStatus`.
- The router lives in `server/src/sessions/router.ts` or a new `server/src/sessions/ai-router.ts`.

**Client:**
- A "Restart agent" button in the kiosk sidebar AI status panel, visible when `aiState === 'degraded'` (or when explicitly enabled by a dev affordance for debugging).
- Mobile: same button in the settings menu.
- On click: `POST` to the new endpoint, optimistically transition local state to `starting`. Server will push `session-state` updates as the restart progresses.

**Copy:** "Restart agent" (concise, action-oriented; defer "Reconnect AI" / "New agent session" wording to a designer pass if one happens).

#### Test criteria

1. **Server test** in `sessions/router.test.ts` (or new) verifies:
   - Endpoint responds 200 for an authenticated session member.
   - Endpoint responds 401/403 for unauthenticated or non-member requests.
   - Endpoint calls `driver.restartSession` with the correct sessionId.
2. **Client unit test** (jest/vitest under `client/src/`):
   - Button is rendered when `aiState === 'degraded'`.
   - Click triggers POST and transitions local state.
3. **Playwright test**:
   - Force the FakeDriver into `degraded` via a test-only fixture.
   - Verify the Restart button appears.
   - Click it.
   - Verify the kiosk shows `starting` then `ready` again.
4. The button does not appear in normal `ready`/`thinking` states (no accidental UX regression).

---

### 3.6  Unified `session-state` wire message; useAI as reducer

**Labels:** `enhancement`, `client`, `priority:medium`
**Depends on:** 3.1, 3.4
**Estimated size:** ~200 LOC + tests

#### Context

Last of the Phase 3 batch. Replaces the parallel `session-ai-status` + `ai-thinking` messages with a single unified `session-state` carrying the full `AgentSessionStatus`. The client's `useAI` hook becomes a `useReducer` over this message; impossible-state combinations are eliminated by the wire schema. See `docs/architecture.md` § "Wire protocol".

#### Problem statement

`useAI` (`client/src/hooks/useAI.ts`) holds 5 independent state variables (`connected`, `connecting`, `thinking`, `conversationId`, `error`) updated by two separate message handlers (`handleSessionAIStatus`, `handleAIThinking`). It's possible to compose incoherent combinations (e.g., `thinking: true && connected: false`) by reordering inputs, and the UI has to guard against each one. Adding `reconnecting` and `degraded` states would multiply the surface further. The driver already produces a single `AgentSessionStatus`; the wire protocol should mirror that.

#### Proposed solution

**Wire schema** (server → client):

```ts
type SessionStateMessage = {
  type: 'session-state';
  sessionId: string;
  ai: AgentSessionStatus;  // same shape as the driver type
};
```

**Server changes** (`server/src/index.ts`, `server/src/auto-connect.ts`):
- Wherever `session-ai-status` or `ai-thinking` is sent today, also send `session-state` with the full status.
- Continue sending the legacy messages for one release for back-compat.

**Client changes** (`client/src/hooks/useAI.ts`):
- Replace the 5 useState calls with a single `useReducer` over `AgentSessionStatus`.
- Add `handleSessionState(msg: SessionStateMessage)` handler.
- Keep `handleSessionAIStatus` and `handleAIThinking` as legacy fallbacks: they update only the fields they carry, AND only if no `session-state` has arrived this connection.
- Derive booleans (`connected`, `thinking`, `connecting`) from `state`.
- Add helper for `degraded` so the UI can render the "Restart agent" CTA from #3.5.

**Migration:** in the same release, ensure all kiosk UI consumes from the derived booleans; no consumer reads `state` directly except where it needs to render a distinct UI (e.g., the degraded panel).

#### Test criteria

1. **Unit test** for the new reducer in `useAI.test.ts`:
   - Initial state is `absent` with all booleans false.
   - Receiving a `session-state` with `state: 'thinking'` makes `thinking: true, connected: true`.
   - Receiving a legacy `ai-thinking` with `thinking: true` updates only the thinking flag (when no `session-state` has arrived).
   - Receiving a `session-state` after a legacy message takes precedence.
2. **Server test** in `auto-connect.test.ts` verifies both messages are emitted on a status change.
3. **Playwright test** asserts the kiosk's status indicators render correctly across the full state matrix using a `FakeDriver`-backed fixture.
4. After this issue: `grep -n 'connected: true,' client/src/hooks/useAI.ts client/src/components/` shows useAI no longer assembles its own state from individual booleans.

---

## Phase 4 — Recovery on sandbox death

### 4.1  Detect MISSING sandbox and rebind via conversation_id

**Labels:** `enhancement`, `priority:high`
**Depends on:** 3.4 (needs the state machine in place to surface `reconnecting`)
**Estimated size:** ~250 LOC + 3 tests

#### Context

The OpenHands SaaS reaps sandboxes at any time (sysadmin force-cleanup is allowed below the 14-day TTL when capacity is tight). On reap, the conversation row becomes a tombstone with `sandbox_status: MISSING`; sends return HTTP 404 "Sandbox not found". The recovery primitive is documented: `POST /api/v1/app-conversations { conversation_id: <existing> }` provisions a new sandbox and reuses the same conversation id. **Agent memory is NOT preserved** by this mechanism — that's #4.2. See `docs/openhands-platform.md` § "Death and recovery" and `docs/architecture.md` § "Sequence C".

#### Problem statement

When the OH sandbox underneath a VR session disappears, today's code has no recovery path. `sendSessionMessage` throws "WebSocket not connected" (caught + logged); the in-memory `AISession` entry stays in the map with `ws=undefined` indefinitely; `hasSessionAI` keeps returning `true`, so `autoConnectAI` is never re-triggered; the user is stuck until a server restart. This is the "zombie AI session" diagnosed in `SESSION_STATE.md` #4.

#### Proposed solution

Inside the OH adapter:

1. Wrap every send attempt (REST send-message or WS send) with detection of HTTP 404 with detail `Sandbox not found for conversation X` and of WS close-code patterns associated with sandbox death.
2. On detection:
   - Yield `AgentEvent { kind: 'status', status: { state: 'reconnecting', startingSince: now() } }`.
   - Call `resolveConversation(sessionId)`:
     - `POST /api/v1/app-conversations` with `{ conversation_id: <existing>, initial_message: null, ...workspace seeds }`.
     - Poll the start-task to `READY`, yielding `starting` status updates with `startupPhase` set from `AppConversationStartTaskStatus` on each transition.
     - Re-fetch `app_conversation_id`, `sandbox_id`, `agent_server_url`, `session_api_key` from the resulting `AppConversation`.
     - (Persistence restore — #5.2.)
   - Retry the original send.
3. If recovery itself fails (start-task ERROR, or second send also 404s), yield `AgentEvent { kind: 'error', recoverable: false }` and transition to `degraded`.

Retry budget: 2 attempts total per `sendMessage` call. Idempotency on `utteranceId` ensures the user's message isn't double-posted across retries.

#### Test criteria

1. **Integration test** with a controllable HTTP mock simulating the MISSING flow:
   - First `send-message` returns 404 with the documented detail.
   - Subsequent `POST /app-conversations` with `conversation_id` returns a fresh sandbox.
   - Second `send-message` succeeds.
   - The driver yields the expected event sequence: `status(reconnecting)` → `status(starting + phases)` → `status(ready)` → `message`.
2. **Unit test** verifying the retry budget (2 attempts max; a third sandbox-MISSING produces `error` event with `recoverable: false`).
3. **Unit test** verifying that `utteranceId` idempotency holds — replaying the same `utteranceId` after a successful recovery returns the cached terminal event, not a second upstream send.
4. **Manual end-to-end probe** (requires OH API key; only runnable by a privileged developer):
   - Start an AI session, send a message, agent replies.
   - `curl -X DELETE` the underlying sandbox via the OH app-server API.
   - Send another message via the kiosk.
   - The kiosk shows "Reconnecting agent…" with phase indicator, then ready, and the second message is delivered to the agent on a fresh sandbox.

---

### 4.2  Replay agent memory across rebind via condense + system_message_suffix

**Labels:** `enhancement`, `priority:medium`
**Depends on:** 4.1
**Estimated size:** ~200 LOC + 2 tests

#### Context

The rebind in #4.1 preserves the conversation **id and event log** but the agent on the new sandbox boots with a fresh context window and does not remember prior turns. Voice Relay needs to seed memory across the rebind. OH provides `POST {agent_server}/api/conversations/{id}/condense` (returns success; produces a server-side summary) and `system_message_suffix` on conversation start. See `docs/openhands-platform.md` § "What's lost" and `docs/architecture.md` § "Recovery flow".

#### Problem statement

After a MISSING-driven rebind, the kiosk continues working from the user's perspective — same conversation id, same event log on disk — but the agent has amnesia. It will not remember "the user's name is Alex" from three turns ago. For long-running kiosk sessions this is a poor UX.

#### Proposed solution

In `resolveConversation` (inside the OH adapter):

1. Before calling `POST /app-conversations { conversation_id }`, fetch the last N events for the conversation from `GET /api/v1/conversation/{id}/events/search` (N to be tuned; start with 50 most recent).
2. Try `POST {agent_server}/api/conversations/{id}/condense` on the *old* agent server first if it's still reachable — if it returns success, use the condensed summary as `system_message_suffix`. (If the old agent server is dead, skip this step.)
3. Otherwise, build a fallback summary client-side from the fetched events: extract the user `MessageEvent`s and agent `MessageEvent`s, render them as a short transcript, and pass that as `system_message_suffix` (capped at a reasonable size, e.g., 4–8 KB).
4. On the new sandbox, the agent's first interaction sees this suffix and resumes context.

Define an explicit cap on suffix size; if the natural summary exceeds the cap, prefer the most-recent N turns over older ones.

#### Test criteria

1. **Integration test** in the OH adapter:
   - Set up a conversation with 10 prior message events on a soon-to-die sandbox.
   - Trigger MISSING; rebind.
   - Verify `POST /app-conversations` body includes `system_message_suffix` containing recognizable fragments of the prior conversation.
2. **Unit test** for the suffix builder: input is an array of event objects; output is a string under the cap, containing the most recent turns.
3. **Manual probe** (privileged developer): kiosk has 5 user/agent turns; reap the sandbox; ask the agent "What was my second message?" — agent reproduces it (or a substantively correct summary).
4. The condense-then-suffix path is preferred when the old agent server is still reachable; the fallback path is used when it isn't. Unit tests cover both.

---

## Phase 5 — Persistence MVP (S3 sync)

### 5.1  AWS credentials as OH user-level custom secrets

**Labels:** `enhancement`, `priority:high`
**Depends on:** none (can be done in parallel with Phase 2/3)
**Estimated size:** ~120 LOC + admin documentation

#### Context

Voice Relay's persistence strategy is `aws s3 sync` driven from the agent-server bash endpoint (see `docs/architecture.md` § "Persistence layer"). For this to work in any sandbox without per-conversation injection, AWS credentials must be present in the OH user-level custom-secrets store, which OH automatically exposes inside every sandbox via `LookupSecret`. See `docs/openhands-platform.md` § "Secrets".

#### Problem statement

There is no AWS credential plumbing anywhere in Voice Relay today. The agent doesn't have S3 access; sync can't happen. We need a one-time-per-deployment provisioning step that creates the right OH custom secrets, plus documentation for how to rotate them.

#### Proposed solution

- A new admin script `scripts/provision-oh-secrets.ts` that, given an OH API key and AWS credentials, creates or updates the following OH custom secrets on the operator's OH account:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_DEFAULT_REGION`
  - `VR_WORKSPACE_BUCKET`
- The script is idempotent (uses `PUT /api/v1/secrets/{secret_id}` if the named secret already exists).
- Operator documentation under `docs/runbooks/persistence.md` describing:
  - The S3 bucket setup (one bucket per Voice Relay deployment, lifecycle policy for old objects, encryption settings).
  - The IAM policy required on the access key (list/get/put/delete restricted to `arn:aws:s3:::<bucket>/*`).
  - The credential rotation procedure.

Out of scope for this issue: any sandbox-side use of the credentials. That's #5.2 and #5.3.

#### Test criteria

1. **Unit test** for the script's idempotency: running twice with the same inputs produces the same end state and does not error.
2. **Manual smoke**: run the script against the OH staging API key; verify via `GET /api/v1/secrets/search` that the four secrets are present.
3. **Manual smoke**: start a fresh sandbox manually; confirm `LookupSecret` inside the sandbox can read `AWS_ACCESS_KEY_ID` and the agent can run `aws s3 ls s3://${VR_WORKSPACE_BUCKET}/` successfully.
4. Documentation review: the runbook is complete enough for an operator unfamiliar with the system to provision a new deployment end-to-end.

---

### 5.2  Restore /workspace from S3 on sandbox provisioning

**Labels:** `enhancement`, `priority:high`
**Depends on:** 4.1, 5.1
**Estimated size:** ~200 LOC + 2 tests

#### Context

When the OH adapter provisions a sandbox (either initial or post-MISSING rebind), it must restore the VR workspace's persistent state from S3 before any agent message is sent. This is the implementation of `PersistenceStrategy.restore` for `S3SyncStrategy`. See `docs/architecture.md` § "Persistence layer".

#### Problem statement

The rebind path in #4.1 gives us a fresh, empty `/workspace`. Without a restore step, the agent has no continuity of working files; each rebind is effectively a "lose all your files" event. Combined with #4.2 (memory replay), this is the second half of "agent feels persistent across sandbox death."

#### Proposed solution

A new module `server/src/agent-driver/openhands/persistence/s3-sync.ts` exporting `class S3SyncStrategy implements PersistenceStrategy`.

`restore(workspaceId, sandboxId, agent)`:

1. Via the agent-server bash endpoint, ensure `awscli` is installed: `which aws || sudo apt-get update -qq && sudo apt-get install -y -qq awscli` (one-time cost on a fresh sandbox; ~9 s). Time and log.
2. Run `aws s3 sync --delete s3://${VR_WORKSPACE_BUCKET}/${VR_WORKSPACE_ID}/ /workspace/` via bash endpoint. Capture stdout/stderr/exit_code.
3. If exit_code != 0, log the stderr and surface a `degraded` status on the driver session (the user will see "Could not restore your workspace files. Retry?").
4. If exit_code == 0 and the source prefix didn't exist (first session in this VR workspace), proceed normally — empty workspace is the expected state.

Hook the call into the OH adapter's sandbox-provisioning code path: invoked immediately after `AppConversationStartTaskStatus: READY` and before the first user message is delivered. Single-flight per `(workspaceId, sandboxId)` pair.

#### Test criteria

1. **Integration test** with mocked bash endpoint:
   - First call to `restore` runs `apt-get install awscli` then `aws s3 sync ...` and succeeds.
   - Second call (same sandbox) skips the install (`which aws` returns 0) and runs sync directly.
   - On non-zero `aws s3 sync` exit, the driver transitions to `degraded` with diagnostic from stderr.
2. **Unit test** that confirms restore is called exactly once per sandbox provisioning event, even under concurrent `sendMessage` calls.
3. **Manual probe** (privileged developer):
   - Pre-populate `s3://<bucket>/<workspace>/` with a few known files.
   - Start a new VR session in that workspace.
   - Confirm via the agent (e.g., "list /workspace") that the files are present before the first agent turn.

---

### 5.3  Snapshot /workspace to S3 on agent idle

**Labels:** `enhancement`, `priority:high`
**Depends on:** 5.2, 3.4
**Estimated size:** ~150 LOC + 2 tests

#### Context

Restore is meaningless without snapshot — without periodic snapshotting, the S3 bucket never contains the agent's latest state, so a rebind restores stale or empty data. Trigger snapshots on agent turn completion (cheap, well-timed) plus a 60-second backstop timer. See `docs/architecture.md` § "Persistence layer".

#### Problem statement

We need to push `/workspace` contents to S3 frequently enough that an unannounced reap costs the user at most one turn's worth of work, but rarely enough to keep cost and latency reasonable. The natural trigger is the agent transitioning to idle (i.e., the same `execution_status: idle` events that #3.4 wires up).

#### Proposed solution

Implement `S3SyncStrategy.snapshot(workspaceId, sandboxId, agent)`:

1. Via bash endpoint: `aws s3 sync --delete /workspace/ s3://${VR_WORKSPACE_BUCKET}/${VR_WORKSPACE_ID}/`. Capture and log timing.
2. Single-flight per sessionId: if a snapshot is already in flight for this session, skip (don't queue); a subsequent idle event will trigger another sync.

Triggers:

- Inside the OH adapter, on every `ConversationStateUpdateEvent { execution_status: idle | finished }` event from the agent-server WS.
- A 60-second backstop timer per session: if no idle event has fired and a snapshot is older than 60 s, fire one anyway.
- On explicit `closeSession` (best-effort, fire-and-forget; bounded by a short timeout).

Snapshot failures (non-zero exit) log a warning but do not surface to the user as `degraded` — durability lag is bounded and the next snapshot may succeed. Repeated failures (>3 consecutive) escalate to a `degraded` status with a clear diagnostic.

#### Test criteria

1. **Unit test** verifying:
   - One snapshot per `idle` event.
   - Concurrent `idle` events while one snapshot is in-flight do not start a second.
   - Backstop timer fires after 60 s of inactivity.
2. **Integration test** with `FakeDriver`-style fixture that asserts the snapshot bash invocation happens with the right arguments.
3. **Manual probe** (privileged developer):
   - Agent creates a file in `/workspace/test.txt`.
   - Wait for the next turn to complete.
   - Verify `aws s3 ls s3://<bucket>/<workspace>/test.txt` returns the file.
   - Reap the sandbox.
   - Trigger a new turn; verify after `restore` the file is present in the new sandbox.

---

## Phase 6 — Polish (do only if measurement justifies)

### 6.1  Granular startup status UX

**Labels:** `enhancement`, `client`, `priority:low`
**Depends on:** 3.6, 4.1
**Estimated size:** ~100 LOC

#### Context

When the OH warm pool is exhausted (rare in normal use; happens at e.g. workspace-creation surges), cold start can be slow — up to 2 minutes. The OH start-task API exposes granular phases (`WAITING_FOR_SANDBOX`, `PREPARING_REPOSITORY`, `RUNNING_SETUP_SCRIPT`, etc.). Surfacing these as kiosk messages turns a mysterious wait into an informative one. See `docs/openhands-platform.md` § "Conversation status".

#### Problem statement

Today the kiosk shows a generic "AI connecting…" spinner for the entire start phase. When that phase is 90 s, the user has no idea whether progress is being made.

#### Proposed solution

When the driver yields `status` events with `startupPhase` set (already produced by #4.1's start-task polling), the kiosk renders the phase as friendly text:

| Phase | Kiosk text |
|---|---|
| `WAITING_FOR_SANDBOX` | "Starting workspace…" |
| `PREPARING_REPOSITORY` | "Preparing files…" |
| `RUNNING_SETUP_SCRIPT` | "Running setup…" |
| `SETTING_UP_GIT_HOOKS` | "Configuring tools…" |
| `SETTING_UP_SKILLS` | "Loading skills…" |
| `STARTING_CONVERSATION` | "Connecting agent…" |

#### Test criteria

1. **Component test** that renders each phase and snapshots the kiosk status panel.
2. **Manual** during a cold start: phases visibly tick through.
3. Does not appear during warm-path starts (which complete in <2 s, faster than the panel would render meaningfully).

---

### 6.2  Pause sandbox after VR workspace idle

**Labels:** `enhancement`, `priority:low`
**Depends on:** 5.3
**Estimated size:** ~100 LOC + 1 test

#### Context

OH auto-pauses sandboxes after `RUNTIME_IDLE_SECONDS` (20 min in prod) of inactivity. Voice Relay could proactively pause when no kiosk in a workspace has been active for, say, 5 minutes — saving cost (paused sandboxes are cheaper than running) and pre-snapshotting before the SaaS-side pause. Only worth doing if measurement shows the pause-resume latency is acceptable to users on resume.

#### Problem statement

VR-workspace idle is observable to Voice Relay (no devices connected). Today we leave the OH sandbox running until OH itself decides to pause it. We could pause sooner; OH-side cost goes down; resume latency (#5 above) is bounded and the user already experiences it on the SaaS-driven pause path.

#### Proposed solution

In the OH adapter, track per-workspace device-connection count (already in `DeviceRegistry`). When count drops to 0 and stays there for a configurable threshold (default 5 minutes), call `POST /api/v1/sandboxes/{id}/pause` for the workspace's sandbox. Before pause, force a synchronous snapshot (#5.3) to bound the durability lag to near zero.

On the next device connect, `getOrCreateForSession`'s slow path now includes a `resume` step (~19 s). Display "Resuming workspace…" status during this window.

#### Test criteria

1. **Unit test** verifies pause is triggered after the configurable threshold and not before.
2. **Unit test** verifies snapshot precedes pause.
3. **Manual**: connect to a workspace; disconnect all devices; wait 5 minutes; verify the sandbox status transitions to `PAUSED` via the OH API. Reconnect; verify resume happens and the workspace files are intact.

---

## Open questions to resolve before filing

- Do we want all 14 issues filed at once (giving an agent a clear long list to pick from), or filed in waves as prior phases close (avoiding stale issues if priorities shift)?
- Are we OK keeping Phase 6 as draft-only for now, since both items depend on real measurement of Phase 5's behavior in production?
- Should Phase 4's #4.2 (memory replay via condense) be downgraded to optional if user feedback on bare #4.1 indicates the missing memory isn't a serious UX problem?
- Phase 5 issues assume one S3 bucket per Voice Relay deployment, with object-prefix partitioning per VR workspace. Confirm this matches infra/operations expectations.
