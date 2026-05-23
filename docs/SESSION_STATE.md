# Session State — Analysis & Proposed State Machines

> Status: **proposal / design doc**. Code changes will land in follow-up PRs that each implement one numbered item from the [Fix Checklist](#fix-checklist) below.

> _This doc was drafted by an AI agent (OpenHands) on behalf of @jpshackelford in response to bug reports about the kiosk connection indicator and AI assistant state going stale. See [Symptoms](#symptoms) for the user-observed behavior that motivated it._

## TL;DR

Voice Relay has **three independent "session" lifecycles** stacked on top of each other, and **none of them is reconciled against the others when anything goes wrong**:

1. **L1 — Browser ↔ VR server WebSocket** (the green/red dot)
2. **L2 — VR Session** (your `sessions` table + the `aiConversationId` in `metadata`)
3. **L3 — OpenHands conversation** (the upstream agent on `app.all-hands.dev`)

Each is driven by its own external events and tracked by its own ad-hoc booleans. When one drifts, the UI tells the user a coherent lie — because the *client's* booleans are stale, not because the agent is actually broken.

This doc explains the drift, proposes two explicit finite state machines (one for L1, one for L2+L3), defines a `session-state` WebSocket message as the single source of truth on the wire, and lists six minimal patches that can each ship as an independent PR.

---

## Symptoms

Observed behavior on the kiosk display, in the user's words:

| # | Observation |
|---|-------------|
| 1 | Kiosk starts up nicely; small **green** dot in corner. After a few minutes the dot turns **red**. Interacting with the kiosk doesn't bring it back to green. |
| 2 | After a **browser refresh**, my messages and agent messages all come back fine. The OpenHands conversation is still attached and I can interact with it, **but the "AI thinking" emoji and the ✨ AI symbol are no longer showing.** |
| 3 | Sometimes a session **starts a different OpenHands conversation in the same VR session** rather than using the one we'd been using. |
| 4 | OpenHands conversations **time out** after a while and have to be started up again. **Start-up can take 2 minutes.** |

Each maps cleanly to one or more of the three layers being out of sync. See [Symptom-by-symptom analysis](#symptom-by-symptom-analysis).

---

## The three layers

| Layer | Lifetime | Where state lives | Who controls it |
|---|---|---|---|
| **L1 — Device WebSocket** to VR server (`/ws`) | per browser tab / per `useWebSocket` effect | `wsRef`, React `connected` state, `registeredRef` (client); `DeviceRegistry` map keyed by `deviceId` (server) | Browser & server WS handshake |
| **L2 — VR Session** | persisted in SQLite (`sessions` table) until `status != 'active'` | `SessionRepository` row + `session.metadata.aiConversationId`; `sessionAI: Map<sessionId, AISession>` in-memory in `AISessionManager` | HTTP routes + `auto-connect.ts` |
| **L3 — OpenHands conversation** | OH-side TTL (minutes of idle) | `AISession.{conversationId,taskId,ws,sessionApiKey}`, OH cloud | OH cloud + `connectWebSocket` reconnect loop |

L1's lifetime is **shorter than** L2's, which is **shorter than** L3's (conceptually — though L3 can be reaped by OH idle TTL while L2 is still active in our DB). All three need to stay reconciled but currently aren't.

---

## Symptom-by-symptom analysis

### 1. "Green dot turns red after a few minutes; interacting doesn't bring it back"

Purely **L1**. From `client/src/hooks/useWebSocket.ts`:

```ts
ws.onclose = (event) => {
  console.log('[WS] Disconnected', event.code, event.reason);
  setConnected(false);
  registeredRef.current = false;
  setCurrentSession(null);
};
```

That's the **entire** close handler. The connect effect only re-runs when one of `[deviceId, displayName, workspaceId, sessionId]` changes — none of which change just because the socket died. There's no heartbeat / `ping`-`pong` / keepalive on either side. So:

- Proxy idle timeout (Apache in front of the server commonly defaults to ~60 s of WS idle), TCP RST on a Wi-Fi blip, server restart, laptop sleep → socket closes silently.
- `connected` flips to `false` ⇒ red dot.
- Nothing ever opens a new socket. Subsequent `sendText` calls silently no-op because `wsRef.current?.readyState !== OPEN`, so user input feels swallowed.
- The only way back is a React-effect-deps change (mode flip, navigating to a different session) or a manual page refresh.

### 2. "After refresh, messages come back but the ✨ / 🤔 indicators are gone"

**L1 ↔ L2 state-resync gap.**

After refresh, the new socket goes through the `register` flow in `server/src/index.ts`. The server:

- creates the `DeviceRegistry` entry,
- broadcasts the device list,
- sends `history` (this is why text comes back),
- sends current `session-tts-settings-changed` if any,
- runs `shouldAutoConnect`.

But `shouldAutoConnect` returns `false` because `aiSessionManager.hasSessionAI(sessionId)` is `true` (the AI session is still alive in-memory). So `autoConnectAI` is **not** invoked. And `autoConnectAI` is the **only** place that broadcasts `session-ai-status`:

```ts
// auto-connect.ts
const connectedStatus: SessionAIStatusMessage = {
  type: 'session-ai-status',
  sessionId,
  connecting: false,
  connected: true,
  conversationId: aiSession.conversationId,
};
registry.broadcastMessageToSession(sessionId, connectedStatus);
```

Likewise `ai-thinking` is only broadcast on **transitions** in `AISessionManager` (when `isThinking` flips). Nothing pushes the *current* values to a freshly-registered device.

So the new `useAI` hook starts at `{connected:false, connecting:false, thinking:false, conversationId:null}`. The handlers (`handleSessionAIStatus` / `handleAIThinking`) exist, but no message ever arrives, so those values stay at their defaults forever — exactly the "AI icons are gone" you see.

Agent action cards (the timeline) **do** come back because there's a separate REST rehydration path (`useAgentEventHistory` + `agent-events/rehydrator.ts`), keyed on `session.metadata.aiConversationId`, decoupled from the live status. Status is the only thing not rehydrated on register.

### 3. "Sometimes a different OpenHands conversation in the same VR session"

**L2 ↔ L3 drift**, in two distinct ways:

**(a) Server restart wipes the in-memory map.** `aiSessionManager.sessionAI` is just a `Map` in process memory. The persisted SQLite session has `metadata.aiConversationId` from the original auto-connect — but `getOrCreateForSession` *never reads it back*. On the next device join after restart:

```ts
const existing = this.sessionAI.get(sessionId);  // undefined
if (existing) return existing;
// ...
const startResponse = await client.startConversation(...);  // ← brand new OH conversation
```

A new OH conversation is created, then `auto-connect.ts` overwrites `metadata.aiConversationId` with the new one. The old conversation is orphaned, and the previously rehydrated event history (keyed on the old conv id) becomes inconsistent with the new live stream. **This is the most likely cause of "a different OpenHands conversation in the same VR session".**

**(b) Cross-device race.** Two devices joining the same session concurrently can both pass `shouldAutoConnect`'s "first device" check before either has populated `sessionAI`:

```ts
// shouldAutoConnect: race window between getDevices() and hasSessionAI() check
const isFirstDevice = devicesInSession.length === 1;
return isFirstDevice && !aiSessionManager.hasSessionAI(sessionId);
```

The comment in `auto-connect.ts` claims "`getOrCreateForSession()` deduplicates" — but it doesn't, really. The dedup is a synchronous `Map.get` *at the start* of `getOrCreateForSession`, but `startConversation` is `await`'d, so two concurrent callers can both observe an empty map and both call `client.startConversation`. The second `sessionAI.set` wins. Two OH conversations now exist; one of them gets persisted as `aiConversationId`; the other is the one whose WS is held in the map — these can disagree.

### 4. "Conversations time out; start-up takes 2 minutes"

**L3 timing + lack of cleanup.**

- `pollUntilReady(taskId, 120000, 2000)` — 120 s is the configured **worst-case ceiling** for upstream startup. Two minutes is the budget, not a bug per se.
- On idle, OH closes its WS. The `connectWebSocket` close handler attempts reconnect with exponential backoff up to 5 tries (cap 30 s ⇒ ~60 s total). If the OH conversation itself has been reaped, all 5 reconnects fail.

After max retries, **the code does nothing else**:

```ts
if (sessionExists && session.reconnectAttempts < session.maxReconnectAttempts) {
  ...
}
// no else — the session stays in the map with ws=undefined forever
```

Consequences:

- `hasSessionAI(sessionId)` still returns `true` → `shouldAutoConnect` returns `false` → no replacement is created.
- `sendSessionMessage` throws `"WebSocket not connected"` (caught and logged, no recovery).
- `isThinking` was set to `true` when the user sent the message that triggered this, and nothing ever resets it → the 🤔 emoji *would* be stuck on (if the broadcast had reached the client; usually the L1 WS is also dead by then).

This is the **zombie AI session** state. The only way out is a server restart — which then triggers symptom 3a.

### 5. (Implicit from the bug report) "Refresh recovers the conversation; I can interact even though icons are gone"

Consistent with the above. After refresh, **L1 is fresh and healthy** (green dot), the device re-registers, `history` is replayed (text shows). **L3 is still alive on the server** (because the server process never restarted), `hasSessionAI` returns true, and `sendSessionMessage` works because `session.ws.readyState === OPEN`. Messages flow to OH and responses come back via `onMessage`. **L2 status was never re-pushed to the client** → no ✨, no 🤔. The agent is working; the UI just doesn't know.

---

## Why this needs a state machine, not more booleans

The current code is a tangle of independent flags:

- **Client:** `connected` + AI: `connecting`, `connected`, `thinking`, `conversationId`, `error` — six independent variables with no enforced transitions.
- **Server:** `AISession.isThinking`, `reconnectAttempts`, `ws | undefined`, plus implicit "is in `sessionAI` map" — no single source of truth for "what state is this AI in?"
- **Persisted DB:** `session.status`, `session.metadata.aiConversationId` — fully decoupled from in-memory state.

That's why the UI shows incoherent combinations: WS up but no AI status; AI alive but `connected=false` on client; conversation in DB metadata that doesn't match the one being driven; `isThinking=true` with WS dead.

The right answer is two explicit FSMs — one per logical entity — plus a small set of reconciliations between them.

### A. Device socket FSM (client + server view of L1)

```
       ┌──────────┐    create   ┌─────────────┐  open   ┌────────────┐
init→  │ idle     │────────────►│ connecting  │────────►│ registering│
       └──────────┘             └─────────────┘         └──────┬─────┘
            ▲ retry timer            ▲                         │ registered
            │                        │ close                   ▼
       ┌────┴─────┐                  │                  ┌────────────┐
       │ backoff  │◄─────────────────┴──────────────────│ connected  │
       └──────────┘                                     └────────────┘
                                                              │ remove / delete
                                                              ▼
                                                          terminated
```

Key invariants enforced by the FSM:

- Only `connected` permits `sendText` / `sendDisplayResult`. Today they silently no-op when the socket is closed.
- `close` always goes through `backoff` (with cap + jitter), **never** to a terminal "red dot" unless the state is `terminated` (workspace-deleted / device-removed). Fixes **symptom 1**.
- The server treats a `register` from a `deviceId` already in `DeviceRegistry` as an **explicit "reconcile"** step (which it half does today — `existing.ws = ws`) and is responsible for **pushing all current per-session state** to the new socket. Fixes **symptom 2**.

### B. AI session FSM (server's view of L2 + L3)

```
       ┌───────────┐   first device joins   ┌──────────────────┐
       │  absent   │ ─────────────────────► │ starting (poll)  │  ← single-flight
       └───────────┘                        └────────┬─────────┘
            ▲                                        │ ready
            │ end / unrecoverable                    ▼
            │                                ┌──────────────┐ user msg ┌──────────┐
            │                                │ ready (idle) │ ───────► │ thinking │
            │                                └──┬───────────┘          └────┬─────┘
            │                          ws close│                            │ agent msg / timeout
            │                                  ▼                            ▼
            │                          ┌────────────┐  reconnect ok   ┌──────────────┐
            │                          │reconnecting│ ──────────────► │ ready (idle) │
            │                          └────┬───────┘                 └──────────────┘
            │                               │ max retries / 4xx from OH
            │                               ▼
            │                          ┌────────────┐
            └──────────────────────────│ degraded   │  ← waits for explicit user
                                       └────────────┘    "Restart agent" action
```

What this buys us:

1. **Single-flight `starting`.** `getOrCreateForSession` sets state to `starting` **synchronously** before awaiting; concurrent callers `await` the same in-flight promise. Fixes **3b**.
2. **Reattach from persisted `aiConversationId`.** Before entering `starting`, look up `metadata.aiConversationId`. If present, call `getConversation(id)` on OH — if the conv still exists, jump straight to `ready` and `connectWebSocket`. Only fall through to `startConversation` if the persisted conv is `404`/expired. Fixes **3a** and cuts the 2-minute cold start to near-zero on most recoveries.
3. **`degraded` → "Restart agent".** After max reconnects, transition to `degraded`, broadcast `session-state` with `error: 'AI agent unreachable'`, and wait for an explicit user action. Today we sit in zombie mode (symptom 4). Auto-restart was rejected because it silently changes the conversation context without consent — which is exactly the problem in symptom 3a.
4. **`isThinking` belongs only to `thinking` state.** Today it's a side flag. If we only set it via `ready → thinking` and only clear via `thinking → ready` (on agent message OR on `thinkingDeadline` timeout OR on ws close), the 🤔 can't get stuck.
5. **Every state transition is the broadcast trigger.** The "current state on demand" problem (symptom 2) vanishes if every device `register` simply receives the current FSM state for the session as part of (or immediately after) the registration response. One handler, one broadcast, no special cases.

---

## Wire protocol: add `session-state`

Today the server emits two separate messages (`session-ai-status` and `ai-thinking`) that together describe what is conceptually a single state. Add a unified message:

```ts
type SessionStateMessage = {
  type: 'session-state',
  sessionId: string,
  ai: {
    state: 'absent' | 'starting' | 'ready' | 'thinking' | 'reconnecting' | 'degraded',
    conversationId: string | null,
    error: string | null,
    thinkingSince: string | null,    // ISO timestamp; drives the 🤔 emoji
    startingSince: string | null,    // ISO timestamp; drives "🔗 connecting…"
  },
};
```

Sent:
- on every L2/L3 state transition (replaces today's `session-ai-status` + `ai-thinking` broadcasts), **and**
- in direct response to every `register`.

Client `useAI` becomes a thin reducer over `SessionStateMessage` — derive `connected = state === 'ready' || state === 'thinking'`, `thinking = state === 'thinking'`, etc. — and is impossible to put into an incoherent combination.

**Backward compatibility:** keep emitting the legacy `session-ai-status` / `ai-thinking` messages for one release. Client prefers `session-state` when present. Remove the legacy messages in a follow-up after all deployed clients are on the new build.

---

## Fix checklist

Each item is intended to ship as its own PR, smallest first. The first two alone resolve most of the day-to-day weirdness; #3 is the highest-value behavioral fix.

- [ ] **1. Client WS auto-reconnect** — `client/src/hooks/useWebSocket.ts`
  - On `ws.onclose`, schedule reconnect with exponential backoff + jitter (250 ms → 30 s; reset on `onopen`).
  - Suppress reconnect when state is `terminated` (device-removed / workspace-deleted).
  - **Acceptance:** kill the server for 10 s; client reconnects automatically within ≤ 30 s; green dot returns without page refresh. Solves **symptom 1**.

- [ ] **2. Keepalive heartbeat** — both sides
  - Client sends `{type:'ping'}` every 25 s; server replies `{type:'pong'}`. Server-side, use the `ws` library's `clientTracking` / `WebSocket.OPEN` poll at 30 s and `terminate()` peers that haven't pong'd in 60 s.
  - **Acceptance:** with a proxy `ProxyTimeout` of 60 s in front, an idle WS survives indefinitely. (Tune ping interval down if the actual prod timeout is shorter — see [Open questions](#open-questions).)

- [ ] **3. Resync on register** — `server/src/index.ts`
  - Inside the `register` case, after `broadcastDeviceList` and `history`, if `aiSessionManager.hasSessionAI(sessionId)`, send the current `session-state` (and, for back-compat, `session-ai-status` + `ai-thinking`) directly to **this** `ws` (not a broadcast).
  - **Acceptance:** mid-conversation refresh restores ✨ and (if applicable) 🤔 without user interaction. Solves **symptom 2**.

- [ ] **4. Reattach instead of restart** — `server/src/openhands.ts`, top of `getOrCreateForSession`
  - Before calling `startConversation`, read `metadata.aiConversationId` from `sessionRepository`. If present, call `client.getConversation(id)`. If it returns a live conv with a valid `session_api_key`, skip `startConversation` / `pollUntilReady`; go straight to `connectWebSocket`. Only fall through to a fresh `startConversation` if the persisted conv is `404`/expired/unreachable.
  - **Acceptance:** restart the server while an AI session is active; reload the kiosk; the existing OH conversation is reused (no new `app_conversation_id`), and live events resume on the same conv. Solves **symptom 3a** and most of the 2-minute startup pain in **symptom 4**.

- [ ] **5. Single-flight start** — `server/src/openhands.ts`
  - In `AISessionManager`, cache the in-flight `Promise<AISession>` (e.g. `sessionAIStarting: Map<sessionId, Promise>`). Concurrent callers `await` the same promise.
  - **Acceptance:** two devices joining the same session concurrently produce **exactly one** OH `startConversation` call. Solves **symptom 3b**.

- [ ] **6. Remove dead sessions + `degraded` state** — `server/src/openhands.ts` (`connectWebSocket`'s `ws.on('close')`)
  - When `reconnectAttempts >= maxReconnectAttempts`, transition the FSM to `degraded`, broadcast `session-state` with `error: 'AI agent unreachable'`, **and** delete the entry from `sessionAI` so future device joins re-trigger `shouldAutoConnect`. Clear `isThinking`.
  - Also: add a `thinkingDeadline` (e.g. `lastMessageSentAt + 5 min`). A periodic poll (or the keepalive timer) clears `isThinking` and broadcasts when exceeded — defends against dropped agent-finish events.
  - Surface a **"Restart agent"** button in the kiosk sidebar (next to the connection dot) and in the mobile settings menu. Clicking it calls a new `POST /api/sessions/:id/ai/restart` that forces a fresh `startConversation` and updates `metadata.aiConversationId`.
  - **Acceptance:** when OH reaps a conversation, kiosk shows ⚠️ "AI agent unreachable" with a "Restart agent" button; clicking it brings the agent back; 🤔 never gets stuck for more than 5 minutes. Solves the zombie part of **symptom 4**.

- [ ] **7. (Optional follow-up) Introduce explicit FSMs in code**
  - Client: refactor `useAI` to a `useReducer` over `SessionStateMessage` events with the state enum from the wire protocol. Delete `connecting`/`connected`/`thinking`/`error` as independent state, derive them.
  - Server: extract `SessionAIState = 'absent'|'starting'|'ready'|'thinking'|'reconnecting'|'degraded'` and an explicit transition function from `AISessionManager`'s scattered booleans. Every transition emits exactly one `session-state` broadcast.
  - **Acceptance:** can't construct an incoherent state (e.g. `connected=false && thinking=true`) by combining inputs in tests.

---

## Open questions

These are flagged inline in the fix descriptions; tracking here for visibility.

1. **OpenHands reattach semantics.** Does `GET /app-conversations?ids=<id>` always return a usable `session_api_key` for a live conversation, even after some idle? If `session_api_key` rotates or expires independently of the conversation, fix #4 needs to handle "conv exists but API key dead" as a "fall back to `startConversation`" case rather than a hard failure.
2. **Proxy idle timeout.** Default ping interval (#2) is set for a 60 s proxy `ProxyTimeout`. If `vr.chorecraft.net`'s Apache config is tighter, drop the ping interval accordingly.
3. **"Restart agent" UX details.** Button placement (kiosk sidebar + mobile settings menu) and copy ("Restart agent" vs "Reconnect AI" vs "New agent session") are placeholders — defer to a designer pass before #6 ships.
4. **Migration of `agent_events` on a restart-induced new conv.** When #4 reattaches successfully, the existing `agent_events` rows (keyed on the old conv id) are still valid — no migration needed. When #4 falls back to `startConversation` because the old conv is dead, the old rows become orphans. Out of scope for this doc; the existing `audit-orphans` script already covers this.

---

## Out of scope

- Anonymous sessions (the `ANONYMOUS_SESSION_ID` path) — already short-circuited by `shouldAutoConnect`, no FSM applied.
- Multi-region / multi-process VR servers — `AISessionManager` is process-local. If we ever shard the server, the FSM needs an external store. Not relevant today.
- Display-content state machine — orthogonal to AI/device state; handled separately by `display-api`.
- TTS playback state — separately tracked via `useAudioPlayback`; not affected by these changes.
