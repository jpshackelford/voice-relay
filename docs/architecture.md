# Voice Relay — Future-State Architecture

> Status: **design reference**. Describes the target architecture for Voice Relay's AI session, persistence, and state machine layers. Phased implementation is tracked as GitHub issues; this doc is the picture they're collectively converging on. Read in conjunction with [`openhands-platform.md`](./openhands-platform.md), which is the verified reference on what OpenHands actually does.

## Goals

1. **Persist user workspace state across sandbox death.** A kiosk should not lose its agent's working files when OpenHands reaps the underlying sandbox (which can happen at any time, with no warning).
2. **Provider-portable boundary.** The platform (sessions, devices, WS, history, UI) talks to an `AgentDriver` interface. The OpenHands-specific code lives behind it. If we ever swap providers, only the adapter changes.
3. **Coherent session state on the wire.** The kiosk's "is the AI ready / thinking / reconnecting" indicators are derived from a single state value, not from a fan of independent booleans, and they survive reconnects.
4. **Recovery is normal, not exceptional.** Reaped sandboxes are a routine event; recovery is automatic and bounded; the user sees a brief "reconnecting" indicator at worst.

## Layered model

```
┌─────────────────────────────────────────────────────────────────────┐
│  L1   Browser  ↔  Voice Relay server                                │
│       device WebSocket, register/history/text/audio/session-state   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  L2   Voice Relay session                                            │
│       SessionRepository row + sessionId is the platform PK           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │   AgentDriver interface     │   <-- provider-neutral
                └──────────────┬──────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │ OpenHandsAgentDriver (adapter) │
              │  + PersistenceStrategy         │
              └──┬──────────────┬──────────────┘
                 │              │
                 ▼              ▼
       ┌────────────────┐  ┌────────────────────┐
       │ OpenHands SaaS │  │ External S3 bucket │
       │ (sandboxes,    │  │ (per-VR-workspace  │
       │ conversations) │  │  persistent state) │
       └────────────────┘  └────────────────────┘
```

- **L1** is the existing client↔server WebSocket protocol (`server/src/index.ts` register/text/etc.). Changes here are additive: a new `session-state` message and an auto-reconnecting client.
- **L2** is unchanged in shape: a Voice Relay `Session` row in SQLite, with a stable `aiConversationId` in metadata. What changes is that nothing outside the driver knows about OpenHands.
- The driver is the seam. The OH adapter encapsulates: conversation lifecycle, sandbox lifecycle (hidden), recovery on death, persistence to S3.

## AgentDriver interface

Five methods. TypeScript, in-process. Lives at `server/src/agent-driver/types.ts`.

```ts
export type AgentSessionState =
  | 'absent'        // no driver-side binding for this session
  | 'starting'      // provisioning sandbox / starting conversation
  | 'ready'         // ready to accept a message
  | 'thinking'      // agent is running
  | 'reconnecting'  // sandbox missing; rebind in progress
  | 'degraded';     // unrecoverable in current attempt; user action needed

export interface AgentSessionStatus {
  sessionId: string;
  state: AgentSessionState;
  conversationId: string | null;
  error: string | null;
  thinkingSince: string | null;    // ISO timestamp; drives "thinking" indicator
  startingSince: string | null;    // ISO timestamp; drives "connecting" indicator
  startupPhase?: string;           // e.g. 'WAITING_FOR_SANDBOX'; granular UX
}

export type AgentEvent =
  | { kind: 'message'; text: string; serverTimestamp?: string }
  | { kind: 'action';  action: AgentAction }
  | { kind: 'status';  status: AgentSessionStatus }
  | { kind: 'error';   message: string; recoverable: boolean };

export interface AgentDriver {
  /** Register a VR session with the driver. Idempotent. */
  openSession(sessionId: string, opts: OpenSessionOpts): Promise<AgentSessionStatus>;

  /** Send one user message; stream events back; auto-recover from MISSING sandboxes. */
  sendMessage(sessionId: string, utteranceId: string, text: string): AsyncIterable<AgentEvent>;

  /** Force a fresh sandbox/conversation rebind. Backs the "Restart agent" button. */
  restartSession(sessionId: string): Promise<AgentSessionStatus>;

  /** Read current status; cheap. */
  getSessionStatus(sessionId: string): Promise<AgentSessionStatus>;

  /** Tear down driver-side state for this session. Idempotent. */
  closeSession(sessionId: string): Promise<void>;
}

export interface OpenSessionOpts {
  workspaceId: string;
  displayLines?: number;
  apiKey?: string;
  displayApiSecret?: string;
}
```

### Why this shape

- **No `Workspace` lifecycle method.** Voice Relay's `Workspace` is a platform concept (a user-owned environment containing sessions); it's not a driver concept. The driver gets the workspace id as part of `openSession`'s opts and uses it internally for persistence partitioning.
- **No `ensureWorkspaceReady`, no `release_workspace`.** No caller, no method. If a future use case needs it, add it then.
- **No `WarmHint`, no streaming `StatusEvent` taxonomy beyond `status`.** `AgentSessionStatus` is the unified surface; granular sub-states (sandbox starting, repo preparing, etc.) live in `startupPhase`.
- **`utteranceId` is the idempotency key.** Voice Relay already mints this in the client; reuse it. A repeat `sendMessage` call with the same `utteranceId` returns the same result; the driver doesn't double-post.
- **`sendMessage` returns `AsyncIterable<AgentEvent>`, not single response.** Streams token-by-token text, action cards, status changes. Terminates on a final `message` or an `error` with `recoverable=false`.
- **`AgentDriver` has no idea what a sandbox is.** That word should not appear anywhere outside the OpenHands adapter.

### FakeDriver

A test double that implements `AgentDriver` with scripted event sequences and fault injection. Lives at `server/src/agent-driver/fake.ts`. The platform's tests pass against it without an OH API key. The litmus test for the boundary's correctness: any test outside `server/src/agent-driver/openhands/**` can use `FakeDriver` and never see provider-specific names.

## OpenHands adapter

`server/src/agent-driver/openhands/` — implements `AgentDriver` against the OH SaaS, using everything in [`openhands-platform.md`](./openhands-platform.md).

### Identity model

| Voice Relay | OpenHands |
|---|---|
| `Session.id` | (used as the stable string key driver-side) |
| `Session.metadata.aiConversationId` | `AppConversation.id` — stable across sandbox death via rebind |
| (driver-internal cache) | `agent_server_url`, `session_api_key`, `sandbox_id` for the current live binding |

A VR session has one and only one `aiConversationId` for its life. When the sandbox dies, the adapter rebinds via `POST /api/v1/app-conversations { conversation_id }` — the conversation id does not change.

### Recovery flow (the centerpiece)

```
sendMessage(sessionId, utteranceId, text)
│
├── 1. Resolve current binding from driver cache:
│        {conversationId, sandboxId, agentServerUrl, sessionApiKey}
│
├── 2. Send via POST {appServer}/api/v1/app-conversations/{conv}/send-message
│
├── 3a. HTTP 200 + sandbox_status=RUNNING
│        → connect agent-server WS (re-reading session_api_key on each connect)
│        → stream events; translate to AgentEvent; yield to caller
│
├── 3b. HTTP 409 sandbox_status=PAUSED
│        → POST /api/v1/sandboxes/{id}/resume
│        → poll to RUNNING (~19 s)
│        → re-fetch session_api_key (it rotated!)
│        → retry send-message
│        → continue at step 3a
│
├── 3c. HTTP 404 "Sandbox not found"  (the MISSING case)
│        → yield AgentEvent { status: state='reconnecting', startingSince=now }
│        → call resolveConversation():
│              ├── POST /api/v1/app-conversations { conversation_id: <existing> }
│              ├── poll start-task through WAITING_FOR_SANDBOX → ... → READY
│              ├── on each phase change, yield status with startupPhase=<phase>
│              ├── re-fetch app_conversation_id, sandbox_id, agent_server_url, session_api_key
│              ├── PersistenceStrategy.restore(workspaceId, sandboxId)   ← S3 sync from bucket to /workspace
│              ├── Optionally: seed memory via system_message_suffix from condense or replay
│              └── return new binding
│        → retry send-message
│        → continue at step 3a
│
└── 3d. HTTP 500 / other unrecoverable
         → yield AgentEvent { error: ..., recoverable: false }
         → caller decides whether to surface "Restart agent" button
```

The retry budget is 2 attempts total (matches the existing `openhands-driver.md` policy). `utteranceId`-based idempotency ensures the actual user message is delivered at most once.

### Session state mapping

Driver `AgentSessionState` is derived from OH's `ConversationExecutionStatus` plus the adapter's own recovery flag:

| Source | OH value | Driver state |
|---|---|---|
| OH execution_status | `idle`, `finished` | `ready` |
| OH execution_status | `running` | `thinking` |
| OH execution_status | `stuck` | `degraded` (with error="agent appears stuck") |
| OH execution_status | `error` | `degraded` (with OH error message) |
| OH execution_status | `paused` | `ready` (we treat conversation-paused as "ready to resume") |
| OH execution_status | `deleting` | `absent` |
| OH sandbox_status | `MISSING` | `reconnecting` (during in-flight recovery) or `degraded` (if recovery failed) |
| OH start-task | `WORKING`/`WAITING_FOR_SANDBOX`/`PREPARING_REPOSITORY`/... | `starting` (with `startupPhase` = the value) |
| No binding | — | `absent` |

This kills the 5-minute "thinking deadline" heuristic from `SESSION_STATE.md#6`: we read `stuck` off the API instead of computing it.

### session_api_key rotation handling

The adapter caches `session_api_key` for the current binding, but **re-reads it from the app server**:

1. After every `resume` (the key rotates).
2. After every `MISSING`-triggered rebind (entirely new sandbox).
3. After any 401 from the agent server (defensive — should be covered by 1+2, but cheap and prevents stuck zombies).

The cache is invalidated, never trusted across a known-rotation event.

## Persistence layer

`server/src/agent-driver/openhands/persistence/` — the strategy seam.

### Interface

```ts
export interface PersistenceStrategy {
  /** Called after a fresh sandbox is up, before the agent does any work. */
  restore(workspaceId: string, sandboxId: string, agent: AgentServerClient): Promise<void>;

  /** Called whenever the driver decides to snapshot — typically on agent idle, plus periodically. */
  snapshot(workspaceId: string, sandboxId: string, agent: AgentServerClient): Promise<void>;
}
```

### `S3SyncStrategy` — the v1 implementation

Pre-conditions:

- AWS credentials live as user-level OH custom secrets (`POST /api/v1/secrets`), present in every sandbox automatically:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_DEFAULT_REGION`
  - `VR_WORKSPACE_BUCKET` (could also be a fixed VR-side config)
- The agent-server bash endpoint is the execution surface.

Layout in S3:

```
s3://<bucket>/<vr_workspace_id>/...
```

One prefix per Voice Relay Workspace. All Voice Relay Sessions in that workspace share the same prefix (consistent with the VR data model where Workspace owns persistent state and Session is a conversation thread).

`restore(workspaceId, sandboxId, agent)`:

```bash
mkdir -p /workspace
aws s3 sync --delete s3://${VR_WORKSPACE_BUCKET}/${VR_WORKSPACE_ID}/ /workspace/
```

`snapshot(workspaceId, sandboxId, agent)`:

```bash
aws s3 sync --delete /workspace/ s3://${VR_WORKSPACE_BUCKET}/${VR_WORKSPACE_ID}/
```

Driven by the OH adapter at these trigger points:

- `restore` — once, on first sandbox provisioning OR on MISSING-triggered rebind, before the first user message is sent.
- `snapshot` — on every `execution_status: idle/finished` event (i.e., agent finished a turn). Concurrency-safe via a single-flight lock per session.
- `snapshot` — as a 60-second backstop timer if the agent has been idle and the last snapshot was more than 60 s ago. Bounds durability lag in the abnormal case where idle events are missed.

### `FuseMountStrategy` — placeholder for future

If OH later exposes `/dev/fuse` to sandboxes, swap the strategy:

```bash
s3fs ${VR_WORKSPACE_BUCKET}:/${VR_WORKSPACE_ID} /workspace -o passwd_file=... -o sync_on_flush=true -o max_dirty_data=0 ...
```

Same `PersistenceStrategy` interface; agent never knows. JuiceFS would be a likely better default than s3fs here for POSIX correctness, but neither is reachable in current OH SaaS. **This branch is not built today.** Documented for the contract.

### Trade-offs (sync strategy)

| Aspect | S3SyncStrategy |
|---|---|
| Cold-start cost on new sandbox | ~9 s install awscli + sync time (sync time scales with workspace size; <2 s for tested 3.4 MB) |
| Per-turn cost | ~600 ms walk + S3 PUT time for changed files |
| Durability lag on unannounced reap | Bounded by snapshot frequency (~ per agent turn, ≤60 s backstop) |
| Working set ceiling | 25 GB (PVC limit) |
| Agent transparency | Agent doesn't know about S3; works in `/workspace` |
| Failure modes | Sync command stderr surfaced as `degraded` with diagnostic; user can retry |

## Wire protocol

### Existing messages (kept)

- `register`, `registered`, `history`, `text`, `device-list`, `session-tts-settings-changed`, `agent-action`, `audio-chunk`, `audio-end`, ...

### New: `session-state` (replaces `session-ai-status` + `ai-thinking`)

Server → client. Sent on every L2/L3 state transition AND once immediately after `register`.

```ts
type SessionStateMessage = {
  type: 'session-state';
  sessionId: string;
  ai: AgentSessionStatus;       // exactly the driver's type, no translation
};
```

`useAI` becomes a `useReducer` over this single message. Derived booleans:

```ts
connected  = ['ready', 'thinking'].includes(ai.state)
thinking   = ai.state === 'thinking'
connecting = ai.state === 'starting' || ai.state === 'reconnecting'
```

It is *not possible* to construct an incoherent combination like `thinking && !connected` — the wire schema doesn't admit it.

### Back-compat

For one release, server emits both `session-state` AND the legacy `session-ai-status` + `ai-thinking`. Client prefers `session-state` when present. A follow-on release removes the legacy messages.

## Key end-to-end sequences

### A. First message, warm pool available

```
Browser → VR: text { utteranceId, text }
VR → driver.sendMessage(sessionId, utteranceId, text)
  driver: no binding yet
  driver: POST /v1/app-conversations { initial_message }       ~1 s start-task → READY (warm pool)
  driver: persistence.restore(workspaceId, sandboxId)           empty bucket on first session; no-op
  driver: bind to (conv, sandbox, agentServer, key)
  driver: send-message → agent processes → events stream back
  driver yields AgentEvent { kind:'message', text:'...' }
VR → Browser: session-state { state: 'thinking' } → 'ready'
VR → Browser: text { senderId:'ai', ... }
```

### B. User sends message after sandbox auto-paused

```
Browser → VR: text { utteranceId, text }
VR → driver.sendMessage(...)
  driver: send-message → HTTP 409 (sandbox PAUSED)
  driver: yields session-state { state:'reconnecting', startingSince: t0 }
  driver: POST /sandboxes/{id}/resume   → poll RUNNING (~19 s)
  driver: re-read session_api_key
  driver: persistence.restore is a no-op (state preserved across pause)
  driver: retry send-message → 200 → events stream
  driver yields session-state { state:'thinking' } → 'ready'
```

### C. Sandbox missing (sysadmin reap mid-conversation)

```
Browser → VR: text { utteranceId, text }
VR → driver.sendMessage(...)
  driver: send-message → HTTP 404 "Sandbox not found"
  driver: yields session-state { state:'reconnecting' }
  driver: POST /v1/app-conversations { conversation_id: <existing> }   → poll READY
  driver: yields session-state { state:'starting', startupPhase:'WAITING_FOR_SANDBOX' } → ... → 'starting/RUNNING_SETUP_SCRIPT' → ...
  driver: re-read agentServerUrl, session_api_key, sandbox_id
  driver: persistence.restore(workspaceId, newSandboxId)
            → bash: aws s3 sync s3://bucket/<workspaceId>/ /workspace/   (~ size-dependent)
  driver: (optional) seed memory via system_message_suffix derived from condense + recent N events
  driver: retry send-message
  driver: events stream resumes
```

User experience: a few seconds of "reconnecting" with informative status, then normal. Bounded by sandbox start + restore time.

### D. User clicks Restart Agent

```
Browser → VR: POST /api/sessions/{sessionId}/ai/restart
VR → driver.restartSession(sessionId)
  driver: optionally DELETE the current sandbox to free resources
  driver: bind via fork (parent_conversation_id) IF current sandbox alive
          OR via conversation_id rebind IF current sandbox dead
  driver: yields starting → ready
```

Restart preserves audit history (via parent or via reused conversation_id) but is a deliberate context reset for the agent.

## Session FSM (canonical)

```
                       openSession(sessionId)
                              │
                              ▼
                          ┌─────────┐
                  ┌──────►│ absent  │◄──────closeSession─────┐
                  │       └────┬────┘                         │
                  │            │                              │
                  │     openSession or first sendMessage      │
                  │            │                              │
                  │            ▼                              │
                  │       ┌─────────┐                         │
                  │       │starting │                         │
                  │       └────┬────┘                         │
                  │            │ ready                        │
                  │            ▼                              │
                  │       ┌─────────┐                         │
                  │  ┌───►│  ready  │────closeSession─────────┤
                  │  │    └────┬────┘                         │
                  │  │ idle/finished                          │
                  │  │         │ user sendMessage             │
                  │  │         ▼                              │
                  │  │    ┌──────────┐                        │
                  │  │    │ thinking │────closeSession────────┤
                  │  │    └────┬─────┘                        │
                  │  │  idle/finished                         │
                  │  └─────────┤                              │
                  │            │  HTTP 404 / 409 / WS death   │
                  │            ▼                              │
                  │       ┌─────────────┐                     │
                  │       │reconnecting │─────timeout─────┐   │
                  │       └────┬────────┘                 │   │
                  │       success                         │   │
                  │            │                          ▼   │
                  └────────────┘                     ┌─────────┐
                                                    │degraded │
                                                    └────┬────┘
                                                         │ restartSession
                                                         ▼
                                                    (back to starting)
```

## Mapping back to SESSION_STATE.md

The original `SESSION_STATE.md` checklist remains the operational checklist; how each item is implemented changes given the OH knowledge:

| SESSION_STATE item | Implementation given OH knowledge |
|---|---|
| #1 client WS auto-reconnect | Unchanged. Pure L1. |
| #2 keepalive heartbeat | Unchanged. Pure L1. |
| #3 resync on register | `driver.getSessionStatus(sessionId)` → send `session-state` message to the registering ws. |
| #4 reattach instead of restart | Becomes "use `conversation_id` rebind in `resolveConversation`." Specifically NOT "use the same OH conversation if it's still alive" (that's a degenerate case — rebind covers it via fast path). |
| #5 single-flight start | `sessionAIStarting: Map<sessionId, Promise<binding>>` inside the adapter. |
| #6 `degraded` state + "Restart agent" | `degraded` is a real `AgentSessionState`; OH's `execution_status: stuck` and the `MISSING` path both flow into it. "Restart agent" calls `driver.restartSession`. The 5-minute thinking deadline heuristic is **deleted** in favor of reading `execution_status` from OH. |
| #7 unify wire state + reduce client | The `session-state` message + `useAI` reducer in this doc are exactly that. |

## Out of scope

- Anonymous sessions (`ANONYMOUS_SESSION_ID`). Short-circuit unchanged; no driver applies.
- Multi-process Voice Relay. `aiSessionManager` and the new driver are process-local. Sharding would require an external store for both.
- Provider port (Claude direct, self-hosted OH, etc.). The interface is shaped to accept one; we won't build one until there's a concrete reason.
- TTS / transcription / audio streaming. Untouched.
- Display content state. Orthogonal; handled by `display-api`.
