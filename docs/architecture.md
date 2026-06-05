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
              │  + /api/internal/workspaces/*  │  ← S3-proxying endpoints
              └──┬──────────────┬──────────────┘
                 │              │
                 ▼              ▼
       ┌────────────────┐  ┌────────────────────┐
       │ OpenHands SaaS │  │ External S3 bucket │
       │ (sandboxes,    │  │ (per-VR-workspace  │
       │ conversations) │  │  persistent state) │
       └────────────────┘  └────────────────────┘
              ▲                       ▲
              │ sandbox → VR          │ VR is the only
              │ via curl              │ S3 client
              └───────────────────────┘
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
│              ├── PersistenceStrategy.restore(workspaceId, sandboxId)   ← fetch tarball from VR (which reads S3) into /workspace
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

### `VrProxiedS3Strategy` — the v1 implementation

**Design choice: VR proxies S3; the sandbox never sees AWS.** Voice Relay holds
the only AWS credential in the system, and exposes restore / snapshot as
authenticated HTTP endpoints on its own backend. The sandbox talks to VR;
VR talks to S3. This is the only credential model compatible with VR's SaaS
posture (no human operator in the user-onboarding loop, users do not need to
hold any AWS material).

#### Pre-conditions

**On the VR backend** (single set, lives in `/var/www/vr.chorecraft.net/app/.env`,
see [DEPLOYMENT.md](DEPLOYMENT.md)):

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_DEFAULT_REGION`
- `VR_WORKSPACE_BUCKET`

The VR backend's IAM principal has `s3:GetObject` / `s3:PutObject` /
`s3:DeleteObject` / `s3:ListBucket` scoped to `arn:aws:s3:::<bucket>/*`. It does
not need any IAM-write permission, STS, or per-user identities.

**In every sandbox** (injected via OH user secrets — these are VR-internal,
not AWS, so leaking them never grants S3 access):

- `VR_BASE_URL` — e.g. `https://app.no-hands.dev`
- `VR_WORKSPACE_ID` — identifies which Voice Relay workspace this sandbox is
  bound to (used by VR to route to the right S3 prefix and authorize access)
- `VR_PERSISTENCE_TOKEN` — bearer credential the sandbox presents on every
  call. See [Sandbox-to-VR auth model](#sandbox-to-vr-auth-model) below.

#### S3 layout

```
s3://<bucket>/<vr_workspace_id>/snapshot.tar.gz
```

One object per Voice Relay Workspace. All Voice Relay Sessions in that
workspace share the same object (consistent with the VR data model: Workspace
owns persistent state, Session is a conversation thread).

A single tarball per snapshot (rather than file-per-object as `aws s3 sync`
would do) is the simplest correct design for v1 — it's atomic from S3's
perspective (one `PutObject` is one snapshot), no orphaned half-deleted files,
no per-file diff machinery in either VR or the sandbox. Bandwidth cost is
"full workspace per snapshot" rather than "changed files only"; for the
small-workspace scale we're targeting (tested 3.4 MB, expected to stay under
~50 MB for typical chore-management use cases) this is well under one second
of upload. If workspace sizes grow materially, switching to file-tree
replication is a clean evolution (the strategy seam doesn't change).

#### `restore(workspaceId, sandboxId, agent)`

The OH adapter calls the agent-server bash endpoint with:

```bash
mkdir -p /workspace
curl -sS -f --fail-with-body \
  -H "Authorization: Bearer $VR_PERSISTENCE_TOKEN" \
  "$VR_BASE_URL/api/internal/workspaces/$VR_WORKSPACE_ID/restore" \
  | tar -xz -C /workspace
```

On the VR side (`GET /api/internal/workspaces/:id/restore`):

1. Validate the bearer; resolve to a user; verify the user owns workspace `:id`.
2. Stream `s3:GetObject` for `<bucket>/<id>/snapshot.tar.gz` to the response body.
3. If the object does not exist (first restore for a brand-new workspace),
   return `204 No Content` and the sandbox-side `tar -xz` becomes a no-op
   (curl sees empty body, exits 0; tar of empty input exits 0).

##### Error handling

Restore runs before the agent processes any user input, so partial-state risk
is the dominant concern: a half-extracted tarball is worse than no restore at
all. The adapter treats restore as fail-closed:

| Condition | Behavior |
|---|---|
| `204 No Content` (object missing) | No-op; proceed with empty `/workspace`. First-restore-on-new-workspace case. |
| `200` with valid tarball | Extract into `/workspace`; proceed. |
| Connection refused (VR down) | Fail-closed: abort sandbox start and surface `degraded` to the user. Sandbox is *not* reused; no user input is accepted until VR is reachable. |
| `5xx` (S3 timeout, transient VR error) | Retry up to 3 times with exponential backoff (1 s, 2 s, 4 s). On final failure, fail-closed as above. |
| `401` / `403` (bearer rejected) | Fail-closed; do not retry. Logged as an auth-config bug, not a transient fault. |
| Tarball corrupted (`tar` exits non-zero) | Fail-closed. The on-disk `/workspace` is unlinked-and-recreated before the failure surfaces, so the next attempt starts clean. |

Fail-closed is the right default for v1: it's louder, and silently starting
with an empty workspace would let an agent overwrite a snapshot it never read.

#### `snapshot(workspaceId, sandboxId, agent)`

```bash
tar -czf - -C /workspace . \
  | curl -sS -f --fail-with-body \
      -H "Authorization: Bearer $VR_PERSISTENCE_TOKEN" \
      -H "Content-Type: application/gzip" \
      --data-binary @- \
      "$VR_BASE_URL/api/internal/workspaces/$VR_WORKSPACE_ID/snapshot"
```

On the VR side (`POST /api/internal/workspaces/:id/snapshot`):

1. Validate the bearer + workspace ownership (same as restore).
2. Stream the request body through to `s3:PutObject` at
   `<bucket>/<id>/snapshot.tar.gz`. S3 `PutObject` is atomic per key, so a
   concurrent restore either sees the prior snapshot in full or the new one in
   full — never a partial.
3. Return `204 No Content` on success.

##### Error handling

Snapshot is post-turn and best-effort: a failed snapshot increases durability
lag but must never crash the agent process or fail the user-visible turn.
The agent has already produced output by the time snapshot fires.

| Condition | Behavior |
|---|---|
| `204 No Content` | Success; reset durability-lag counter. |
| `5xx` from VR (S3 timeout, transient error) | Retry up to 3 times with exponential backoff (1 s, 2 s, 4 s) in-band. On final failure, log and continue — the 60 s backstop timer will attempt again. |
| Connection refused (VR briefly unreachable) | Log + continue; rely on the backstop timer. Do not block the agent or transition session state. |
| `401` / `403` | Log loudly as a config bug; surface as a metric. Do not retry. |
| `tar` produces a corrupt stream | Log + skip this snapshot; do not retry until the next trigger fires. |
| Sandbox terminated before snapshot completed | Acceptable — durability lag is acceptable; **session-loss is not.** Snapshot failures never propagate as session-fatal errors. |

The asymmetry with restore is intentional: restore guards against starting
a session on stale or empty state; snapshot guards only against falling too
far behind on durability. The 60 s backstop and per-turn cadence together
keep worst-case lag bounded even when individual snapshots fail.

#### Trigger points (unchanged from prior spec)

The OH adapter drives both operations:

- `restore` — once, on first sandbox provisioning OR on MISSING-triggered rebind, before the first user message is sent.
- `snapshot` — on every `execution_status: idle/finished` event (i.e., agent finished a turn). Concurrency-safe via a single-flight lock per session.
- `snapshot` — as a 60-second backstop timer if the agent has been idle and the last snapshot was more than 60 s ago. Bounds durability lag in the abnormal case where idle events are missed.

#### Sandbox-to-VR auth model

The bearer `VR_PERSISTENCE_TOKEN` proves to VR that the calling sandbox is
authorized to read/write a particular workspace's S3 prefix. Implementation
options for v1 (the chosen mechanism is a v1 implementation issue, not an
architecture commitment):

1. **Per-session minted token.** VR generates a fresh random token per OH
   conversation at conversation-start, stores `{token → user_id, workspace_id,
   expires_at}` in its own DB, and propagates the token into the sandbox via
   OH user secrets at the same moment it propagates `VR_BASE_URL`. Token
   lifetime = sandbox lifetime; revoked on session end. Strongest hygiene.
   Requires OH to accept per-conversation custom secret writes (open question).
2. **Long-lived per-user token.** VR mints one token per VR user, refreshed
   on rotation, stored as a single OH user secret. Same level of access risk
   as Path A's AWS keys had, but the blast radius is "this user's workspace"
   not "this user's AWS account."
3. **OH conversation-id proof.** No token at all; the sandbox sends its OH
   `conversation_id` (already known to the agent) and VR cross-references its
   own `{conversation_id → user_id}` mapping. No secret material to leak;
   exploitable only by someone who already has a valid conversation_id, which
   is itself sensitive. Egress-IP allow-listing on the VR endpoint
   (`api/internal/*`) restricted to OpenHands' published egress range tightens
   this further.

Option (3) is the cleanest if it works in practice; (1) is the most defensible
in security review; (2) is a fallback.

**Selection deferred to the v1 implementation issue.** The choice depends on
two facts that we'd rather verify than assume:

- What OH actually exposes for per-conversation custom-secret writes (gates
  option 1).
- Whether OH publishes a stable egress IP range that VR can allow-list
  (sharpens option 3 materially; without it, option 3 leans on `conversation_id`
  alone).

Rough decision criteria for the implementation issue:

- Pick (1) if OH supports per-conversation secret writes and the team wants the
  tightest blast-radius (token lifetime = sandbox lifetime, easy revocation).
- Pick (3) if OH egress IPs are stable and a no-secret model is acceptable
  given that `conversation_id` is already a sensitive identifier the sandbox
  holds.
- Pick (2) only if both (1) and (3) are ruled out — it's the simplest to ship
  but has the largest token half-life.

Whichever is chosen, the VR endpoint contract above does not change; only the
`Authorization` header's contents and the VR-side validator do.

The endpoint path prefix `/api/internal/` is a marker that these endpoints are
not part of VR's public API surface and may be locked down by Apache (IP allow
list) and/or by VR's auth middleware to refuse requests bearing a normal user
JWT — only the persistence bearer is accepted.

### `FuseMountStrategy` — placeholder for future

If OH later exposes `/dev/fuse` to sandboxes, swap the strategy:

```bash
# Mount a per-workspace virtual filesystem at /workspace; VR backs it.
# Concrete implementation TBD (s3fs against VR-issued presigned URLs, a small
# FUSE shim talking to the existing /api/internal/workspaces endpoints, or
# JuiceFS against a VR-managed metadata service).
```

Same `PersistenceStrategy` interface; agent never knows. **This branch is not
built today.** Documented for the contract.

### Trade-offs (VrProxiedS3Strategy)

| Aspect | Value |
|---|---|
| Cold-start cost on new sandbox | ~50 ms install (none — curl + tar are stock); restore time scales with workspace size (<1 s for tested 3.4 MB) |
| Per-turn cost | tar + upload through VR ≈ ~250 ms for the tested 3.4 MB workspace; full workspace per snapshot (not just changed files — see [S3 layout](#s3-layout)) |
| Durability lag on unannounced reap | Bounded by snapshot frequency (≈ per agent turn, ≤60 s backstop) |
| Working set ceiling | 25 GB (sandbox PVC limit); tarball-per-snapshot may make ≥1 GB workspaces costly — switch to file-tree replication before that point |
| Agent transparency | Agent doesn't know about S3 or AWS; works in `/workspace`. The only "outside" thing the sandbox knows is the VR HTTP endpoint, which it'd talk to for other reasons anyway. |
| User-visible AWS surface | **None.** Users never see AWS credentials, never authorize anything AWS-related, never have an IAM identity. |
| AWS credential lifecycle | One static credential on the VR backend. Operator rotates it on the usual cadence. No per-user IAM lifecycle. |
| Security blast radius | All AWS privilege is concentrated in a single VR backend credential. **If that credential leaks, the blast radius is every user's workspace tarball** (read/write/delete on the entire bucket). Mitigations: (a) an IAM permissions boundary scoping the principal to `s3:{Get,Put,Delete,List}Object` on `arn:aws:s3:::<bucket>/*` only — no IAM, STS, or other S3 buckets; (b) credential rotation on the standard cadence; (c) secret-scanning the deploy pipeline and `.env` distribution path; (d) CloudTrail alarms on access patterns inconsistent with VR's traffic profile (e.g. bulk list, downloads from unexpected source IPs). Compared to Path A (which would have leaked one user's AWS keys at most), Path B trades many small blast radii for one big one — acceptable because the credential never leaves the VR backend, never crosses a user-controlled boundary, and the backend already holds material of equivalent sensitivity (the SQLite DB). |
| Bandwidth on VR backend | Every restore + snapshot streams through VR. Negligible at current workspace sizes; if it becomes a bottleneck, evolution path is to issue presigned S3 URLs from the same endpoints so bytes move sandbox↔S3 directly (VR remains the policy point). |
| Auditability | VR's own request log captures `{user_id, workspace_id, operation, bytes, timestamp}` for every restore/snapshot. AWS CloudTrail sees only the VR principal — useful for AWS-side ops, less useful than VR's log for product-level audit. |
| Single point of failure | VR backend availability is a precondition for sandbox restore. Already true: if VR is down, the user can't use the product. |

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
            → bash: curl $VR_BASE_URL/api/internal/workspaces/<workspaceId>/restore | tar -xz -C /workspace   (~ size-dependent)
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

## Speech-to-text engines

Voice Relay supports two STT engines, selectable per workspace
(`workspace_settings.stt_engine`) and overridable per device
(`devices.config.stt_engine`):

| Engine        | Where it runs       | Diarization | Cost             |
|---------------|---------------------|-------------|------------------|
| `web-speech`  | Browser (default)   | No          | Free             |
| `deepgram`    | Deepgram cloud      | Yes (`S1`/`S2`/…) | Per-minute |

The hosted-STT pipeline (#386) is deliberately **broker-only** — the
server never sees raw audio. The flow is:

1. Workspace owner stores a long-lived Deepgram API key via
   `PUT /api/workspaces/:id/settings/deepgram-api-key`. The key is
   encrypted at rest with AES-256-GCM (same helper used for
   ElevenLabs / OpenHands keys).
2. The kiosk calls `POST /api/stt/token` to get a short-lived
   (≤60 s) Deepgram key, then opens a Deepgram WebSocket directly
   for streaming transcription.
3. As partial / final transcripts arrive, the kiosk emits the
   existing `text` WS message with the new optional
   `engineSpeakerLabel` field set to Deepgram's per-speaker
   identifier (`S1`, `S2`, …). The server passes the label through
   to other devices and, when a `(session, device, label)` mapping
   exists in `session_engine_speakers`, swaps it for a
   workspace-scoped `speakers.id` (#383) on `RelayedTextMessage`.
4. On session end, the kiosk reports minute usage via
   `POST /api/stt/usage`, which increments
   `workspace_stt_usage(workspace_id, month)`. The token broker
   refuses with HTTP 402 once `stt_monthly_minute_cap` is reached.

Module: `server/src/transcription/` —
[`deepgram-token.ts`](../server/src/transcription/deepgram-token.ts) is the
side-effect-free broker (testable with an injected `fetch`),
[`router.ts`](../server/src/transcription/router.ts) is the Express
surface, and the two repositories live alongside.

## Out of scope

- Anonymous sessions (`ANONYMOUS_SESSION_ID`). Short-circuit unchanged; no driver applies.
- Multi-process Voice Relay. `aiSessionManager` and the new driver are process-local. Sharding would require an external store for both.
- Provider port (Claude direct, self-hosted OH, etc.). The interface is shaped to accept one; we won't build one until there's a concrete reason.
- TTS / transcription / audio streaming. Untouched.
- Display content state. Orthogonal; handled by `display-api`.
