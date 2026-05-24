# OpenHands Platform — Reference for Voice Relay

> Status: **reference document** (not a design). This is the consolidated, verified picture of how the OpenHands SaaS works as we integrate against it. Last updated 2026-05-23 after a probe pass against `https://app.all-hands.dev` using the `OPENHANDS_API_KEY` of an OpenHands employee account.
>
> Anything marked "verified" was confirmed by an API call or a code read against `OpenHands/runtime-api`, `OpenHands/OpenHands`, `OpenHands/OpenHands-Cloud`, or `All-Hands-AI/deploy`. Anything marked "assumed" is a working assumption pending future verification.

## Two servers, two auth schemes

OpenHands splits responsibility between two distinct HTTP services. Voice Relay talks to both.

| Server | Base | Auth header | What lives here |
|---|---|---|---|
| **App server** | `https://app.all-hands.dev` | `Authorization: Bearer <OPENHANDS_API_KEY>` | sandboxes, conversations (start/list/delete), event search, secrets, settings, billing |
| **Agent server** | one per sandbox, e.g. `https://<sandbox-subdomain>.prod-runtime.all-hands.dev` | `X-Session-API-Key: <session_api_key>` | bash exec, file upload/download, agent events, condense, fork, conversation-scoped operations |

The agent server URL and its session API key come from the app server's conversation/sandbox response — see [Identity and keys](#identity-and-keys).

## Identity and keys

| Identifier | Scope | Stability |
|---|---|---|
| `OPENHANDS_API_KEY` | account / org | long-lived; rotated via `/api/keys` |
| `sandbox_id` | sandbox | lives until sandbox is deleted or reaped |
| `session_api_key` | **sandbox** (not conversation) | **rotates on every resume** ⚠️ |
| `agent_server_url` | sandbox | **stable across pause/resume** (same subdomain) |
| `app_conversation_id` | conversation | **stable across sandbox death and rebind** |

The `session_api_key` rotation is the operational footgun. Any code that caches the key past a pause/resume cycle will start getting 401s. Always re-read from `GET /api/v1/app-conversations?ids=...` or `GET /api/v1/sandboxes?id=...` on every reconnect attempt.

## Sandbox lifecycle

### States

`SandboxStatus = STARTING | RUNNING | PAUSED | ERROR | MISSING`

- `STARTING` — provisioning. Agent server endpoints not yet reachable.
- `RUNNING` — ready. `exposed_urls` populated with `AGENT_SERVER`, `VSCODE`, `WORKER_1`, `WORKER_2`.
- `PAUSED` — k8s Deployment scaled to 0; PVC retained (may be snapshotted and deleted by cleanup cron after ~1h paused, then restored on resume).
- `ERROR` — terminal.
- `MISSING` — sandbox is gone. The conversation row in the app server persists as a tombstone; see [Death and recovery](#death-and-recovery).

### Verified timings (against prod, warm pool path)

| Transition | Measured |
|---|---|
| `POST /api/v1/sandboxes?sandbox_spec_id=...` → `RUNNING` | **~1 s** (warm pool of 10 maintained in prod) |
| `POST /api/v1/sandboxes/{id}/pause` → `PAUSED` | ~600 ms |
| `POST /api/v1/sandboxes/{id}/resume` → `RUNNING` | **~19 s** (most of it in `STARTING`) |
| Cold path (warm pool exhausted) | bounded by `pollUntilReady` 120 s ceiling; not separately measured |

### Pause/resume preserves filesystem state

Verified end-to-end:

1. Wrote 226 files / 3.4 MB to `/workspace`.
2. Paused. State unchanged on the (now scaled-to-0) PVC.
3. Resumed. Same files, same contents, same sizes.
4. `session_api_key` rotated; `agent_server_url` did not.

The mechanism (per `OpenHands/runtime-api/cleanup.py`) is: idle sandboxes get paused → PVCs snapshotted + deleted after a configurable threshold → on resume, snapshot is restored to a fresh PVC. Transparent to the caller as long as you re-read `session_api_key`.

### Production cleanup constants (per `OpenHands-runtime-api/deploy/envs/production/values.yaml`)

| | Value | What it controls |
|---|---|---|
| `cleanup.idle_seconds` (chart default) | 1200 (20 min) | Idle before auto-pause |
| `cleanup.dead_seconds` (prod override) | 1209600 (14 days) | Absolute deployment TTL — pod hard-deleted at this age |
| `cleanup.max_session_seconds` (chart default) | 43200 (12 h) | Cap on a single running session before forced pause |
| `PAUSE_BEFORE_SNAPSHOT_SECONDS` (chart default) | 3600 (1 h) | Pause→snapshot+PVC delete threshold |
| `warmRuntimes.count` (prod override) | 10 | Prewarmed pool size |
| `RUNTIME_CLASS` | `sysbox-runc` | container runtime (relevant for capabilities) |
| `PERSISTENT_STORAGE_SIZE` | 25 Gi | per-sandbox PVC size |

> **These are SaaS-internal settings, not customer contracts.** SREs can and do force-clean older sandboxes when capacity is tight. The system must assume the sandbox can vanish at any time.

## Sandbox capabilities (verified inside a live sandbox)

Sandbox image is `ghcr.io/openhands/agent-server:1.22.1-python` (currently the only published `sandbox_spec` available to customers).

| Capability | Status | Notes |
|---|---|---|
| User | `openhands` (uid 10001), in `sudo` group | |
| Passwordless `sudo` | ✅ | `sudo -n id` → uid=0 |
| `apt-get update` + `apt-get install` | ✅ | full Debian trixie repos accessible |
| `awscli`, `rsync` installable | ✅ | ~9 s to install both from cold apt cache |
| Network egress (HTTPS) | ✅ | ~100 ms RTT to `s3.amazonaws.com` |
| `/dev/fuse` | ❌ **Not exposed** | also `mknod c 10 229` → `Operation not permitted` |
| FUSE-based filesystems (s3fs, JuiceFS, mountpoint-s3, goofys, rclone-mount) | ❌ | All blocked at the container layer. Requires OH-side sandbox spec change to enable. |
| Sysbox `sysboxfs` mounts on `/proc`, `/sys/...` | ✅ | already present (sysbox-internal) |
| `/dev/loop*`, block devices | ❌ | not exposed |
| Working directory | `/workspace` (or `/workspace/project` per spec; depends on entry point) | |

### Persistence implication

OH provides no cross-sandbox filesystem story:
- Within a sandbox's lifetime, the PVC persists across pause/resume cycles (and across PVC-snapshot-and-restore cycles).
- Across sandbox death (DELETE or sysadmin reap), **filesystem state is gone**.
- FUSE-based external mounts (s3fs/JuiceFS/...) cannot bridge this — they need `/dev/fuse`, which the sandbox spec doesn't expose.

The viable path is application-level S3, using the agent server's bash endpoint to drive `aws s3 sync` at controlled sync points. See `docs/architecture.md`.

## Agent server API surface

The agent server (one per sandbox) exposes 65 endpoints under `/api/...`. The ones relevant to Voice Relay:

### Bash

```
POST /api/bash/execute_bash_command
  body: {"command": "...", "timeout": <seconds>}
  → {"id", "timestamp", "command_id", "order", "exit_code", "stdout", "stderr", "kind": "BashOutput"}
```

### File transfer (path is a **query parameter**, not in URL)

```
POST /api/file/upload?path=<absolute_path>
  body: multipart form, field "file"
  → {"success": true}

GET /api/file/download?path=<absolute_path>
  → raw bytes
```

The skill docs that say `/api/file/upload/<path>` are wrong; that path 404s. Use `?path=...`.

### Conversation operations

```
POST /api/conversations/{conversation_id}/condense
  → {"success": true}     # fire-and-forget; produces a server-side summary
POST /api/conversations/{conversation_id}/fork
  → forks the conversation (requires parent's sandbox alive)
POST /api/conversations/{conversation_id}/pause
POST /api/conversations/{conversation_id}/run
GET  /api/conversations/{conversation_id}/events/search
GET  /api/conversations/{conversation_id}/workspace
GET  /api/conversations/{conversation_id}/workspace/{file_path}
POST /api/conversations/{conversation_id}/secrets       # per-conversation secret CRUD
```

### Live events

`wss://<agent_server>/sockets/events/<conversation_id>?session_api_key=...&resend_all=...`

Same WebSocket protocol that Voice Relay's `server/src/openhands.ts` already uses. **There is no customer-facing webhook subscription mechanism**: the `/api/v1/webhooks/*` endpoints on the app server are receiver endpoints (agent → app), not subscription endpoints (OH → us).

## Conversation status

`ConversationExecutionStatus` (returned on `AppConversation`, observable in `ConversationStateUpdateEvent`):

| Value | What it means |
|---|---|
| `idle` | Agent loop not running; ready for next message |
| `running` | Agent currently working |
| `paused` | Conversation explicitly paused (different from sandbox PAUSED) |
| `waiting_for_confirmation` | Confirmation policy required user OK before proceeding |
| `finished` | Agent ended turn cleanly |
| `error` | Recoverable error state |
| `stuck` | **Agent detected as stuck**. This is the API-native version of "🤔 emoji that never goes away" — read this rather than computing it from a timeout heuristic. |
| `deleting` | Conversation being torn down |

`AppConversationStartTaskStatus` (returned on the async start task):

```
WORKING → WAITING_FOR_SANDBOX → PREPARING_REPOSITORY → RUNNING_SETUP_SCRIPT
       → SETTING_UP_GIT_HOOKS → SETTING_UP_SKILLS → STARTING_CONVERSATION → READY (or ERROR)
```

Surface these directly in the kiosk UX during the rare cold-start instead of an opaque "AI connecting" spinner.

## Death and recovery

**Verified end-to-end via probe.** A sandbox can vanish at any time (explicit DELETE, idle reap, sysadmin force-clean, ERROR state, etc.). When it does:

### What persists

| | After sandbox death |
|---|---|
| `AppConversation` row on app server | ✅ Persists indefinitely as tombstone |
| `sandbox_status` field | becomes `MISSING` |
| `execution_status` field | becomes `null` |
| `session_api_key`, `conversation_url` | become `null` |
| `GET /api/v1/conversation/{id}/events/search` | ✅ Returns full event log |
| `GET {agent_server}/api/conversations/{id}/events/search` | ❌ Agent server is gone with the sandbox |

### What's lost

- Sandbox filesystem (`/workspace/...` contents).
- Live WebSocket connections (close with no warning).
- The agent's working context window. **Crucially, even after rebinding the conversation to a new sandbox (below), the agent on the new sandbox starts with a fresh system prompt + new initial message only. It does not remember prior turns.** Verified — the agent explicitly said "I don't have access to any prior conversation history" after a rebind.

### What works on a dead conversation

| Operation | Result |
|---|---|
| `POST /api/v1/app-conversations/{id}/send-message` | **HTTP 404** `Sandbox not found for conversation X` |
| `POST /api/v1/app-conversations` with `parent_conversation_id: <dead>` | **HTTP 500** `Sandbox not found: <sandbox_id>` — fork requires parent's sandbox alive |
| `POST /api/v1/app-conversations` with `conversation_id: <dead>` | ✅ **HTTP 200** — **resurrection**: provisions new sandbox, reuses same `conversation_id`, appends to existing event log |

### The recovery primitive

```http
POST /api/v1/app-conversations
Authorization: Bearer <key>
Content-Type: application/json

{
  "conversation_id": "<dead_conv_id>",
  "initial_message": { "role": "user", "content": [...], "run": true },
  "system_message_suffix": "<replay/condense summary>",
  "secrets": { ... }
}
```

After polling the start task to `READY`, the conversation continues at the same id, on a brand-new sandbox, with a fresh agent context. **Voice Relay (or its driver) is responsible for restoring filesystem state from S3 and seeding agent memory via `system_message_suffix`.** OH does neither.

### Rebind on a dead conversation

The recovery primitive above is one HTTP call. The *policy* around that call — how aggressively to retry, how often to allow it per conversation, and how to surface failure to the rest of the system — lives in Voice Relay's agent driver: `server/src/agent-driver/rebind.ts`.

The driver invokes `rebindConversation(client, conversationId)` whenever it observes either:

- `sandbox_status: MISSING` on a `GET /api/v1/app-conversations` poll, or
- a non-resumable WebSocket close on the agent-server WS that survives a single reconnect attempt.

Behaviour, as currently implemented:

| Concern | Policy |
|---|---|
| Total wall-clock budget per rebind | `REBIND_BUDGET_MS = 30_000` ms |
| Backoff between attempts (transient 5xx / 429 / network 0) | `1s, 2s, 4s, 8s, 16s` (5 backoffs ⇒ up to 6 attempts) |
| Per-conversation rate cap | `MAX_REBINDS_PER_WINDOW = 3` successful rebinds in any `REBIND_WINDOW_MS = 5 * 60_000` ms window |
| Response on `403` | Fail fast with `RebindForbidden` — cached `openhands_api_key` is invalid; retry will never succeed |
| Response on `404` | Fail fast with `RebindConversationGone` — conversation row is gone, not just the sandbox |
| Response on malformed body | Treated as transient (`OpenHandsApiError(0, ...)`) — the start task may still be filling in `session_api_key` / `conversation_url` |

The three typed errors form a small taxonomy the agent driver pattern-matches on to decide between *retry on the next event*, *transition to `degraded` and prompt the user to restart* (`RebindBudgetExhausted` / `RebindForbidden`), or *tear down the session entirely* (`RebindConversationGone`).

On success the driver receives a `RebindResult`:

```ts
{
  conversationId,            // unchanged
  agentServerUrl,            // new subdomain
  sessionApiKey,             // freshly minted, do not cache past this
  sandboxStatus: 'RUNNING',
}
```

`agentServerUrl` is normalised to a bare origin (the trailing `/api/...` segment is stripped) because the WS layer wants the origin.

### What rebind does *not* do

- It does **not** restore filesystem state. The sandbox PVC was destroyed with the previous pod; `/workspace/...` is empty. Filesystem restore from S3 is the driver's responsibility (see issues #298–#301).
- It does **not** restore agent memory. The new agent starts with a fresh system prompt. Memory replay via `system_message_suffix` is issue #297.
- It does **not** retry forever. Once `RebindBudgetExhausted` fires, the user-facing session moves to `degraded` and only an explicit user-initiated restart will trigger another attempt. This is intentional: sandbox death that immediately recurs after a rebind is almost always an upstream incident, and silent thrash would mask it.

## Secrets

Three layers, additive at conversation start:

1. **User-level custom secrets** — `POST /api/v1/secrets`, `GET /api/v1/secrets/search`. Persist across sandboxes/conversations. Right place for credentials that span many sessions (AWS keys, etc.).
2. **Sandbox-level** — `GET /api/v1/sandboxes/{sandbox_id}/settings/secrets[/{name}]` is read-only (resolution); writes go through user-level or per-conversation paths.
3. **Per-conversation** — `secrets` field on `POST /api/v1/app-conversations`. Merged with user-level on top of those.

Inside the sandbox, the agent's `LookupSecret` tool resolves names against the merged set.

## Sandbox specs (image catalog)

```
GET /api/v1/sandbox-specs/search
```

Production currently returns **one spec**: `ghcr.io/openhands/agent-server:1.22.1-python`. Customer cannot register their own spec (no `POST` endpoint). Any change to sandbox capabilities (e.g., enabling `/dev/fuse`) requires an OH-side spec change.

## Event taxonomy on agent server WebSocket

What Voice Relay currently dispatches on, mapped to what the agent emits:

| Wire `kind` | Source | Meaning | Voice Relay treatment today |
|---|---|---|---|
| `MessageEvent` (source=user) | user echo | persisted via callback |
| `MessageEvent` (source=agent) | agent reply text | persisted + broadcast as `ai` utterance |
| `SystemPromptEvent` | agent | OH's own system prompt | dropped from kiosk timeline (issue #265) |
| `ConversationStateUpdateEvent` | environment | `key` ∈ {`execution_status`, `full_state`, ...} | currently logged; **should drive session-state FSM** (see architecture.md) |
| `ActionEvent` | agent | tool call (terminal, file, etc.) | rendered as action card |
| `ObservationEvent` | environment | tool result | rendered as action card |
| `ConversationErrorEvent`, `ServerErrorEvent` | various | terminal errors | logged |

`ActionEvent.tool_call_id == ObservationEvent.tool_call_id` links action↔result pairs. UUIDs, not monotonic.

## Webhook architecture (for the record)

The agent server **emits** webhooks to whatever URLs are configured at its boot time (env var `OH_WEBHOOKS_0_BASE_URL`, currently hard-coded to `https://app.all-hands.dev/api/v1/webhooks` in `All-Hands-AI-deploy/runtime-api-config/warm-runtimes.yaml`). That's how the app server gets its event stream from sandboxes.

**Customers (us) cannot register additional webhook URLs.** Two consequences:

- Voice Relay must continue to receive live events via the agent-server WebSocket (the existing path).
- Polling `GET /api/v1/conversation/{id}/events/search` works as a fallback when the WS is unhealthy.

## Useful endpoints that aren't on Voice Relay's radar yet

- `POST /api/v1/conversations/{conversation_id}/pending-messages` — queue a message *before* the conversation is `READY`. Voice Relay could enqueue the first user utterance here while the start-task is still walking through `WAITING_FOR_SANDBOX` etc., so the agent sees it the moment it's ready. Eliminates the "first turn was lost during startup" failure mode.
- `POST /api/v1/app-conversations/{id}/switch_profile` — change LLM/agent profile mid-conversation.
- `GET /api/v1/app-conversations/{id}/download` — full trajectory zip (for offline debug / audit).
- `PATCH /api/v1/app-conversations/{id}` — update title and a few metadata fields. Voice Relay should set title from the VR session name for portal-side debuggability.

## Code references in OH repos

For agents picking up follow-on work, the on-disk locations of the things this doc summarizes:

| Topic | Repo | Path |
|---|---|---|
| Runtime (sandbox) cleanup constants and logic | `OpenHands/runtime-api` | `cleanup.py`, `runtimes.py`, `k8s.py` |
| Sandbox k8s pod spec & security context | `OpenHands/runtime-api` | `k8s_resources.py` (`RUNTIME_PODS_PRIVILEGED`, `RUNTIME_CLASS`) |
| Production runtime-api values | `OpenHands/runtime-api` | `deploy/envs/production/values.yaml` |
| Warm-pool config (image, env, command, idle timeout) | `All-Hands-AI/deploy` | `runtime-api-config/warm-runtimes.yaml` |
| App-server v1 conversation routes | `OpenHands/OpenHands` | `openhands/app_server/app_conversation/app_conversation_router.py` |
| App-server v1 conversation models | `OpenHands/OpenHands` | `openhands/app_server/app_conversation/app_conversation_models.py` |
| Cloud helm chart (self-hosted; **not** what SaaS prod uses) | `OpenHands/OpenHands-Cloud` | `charts/runtime-api/`, `charts/openhands/` |
| Deploy workflows + env value overlays | `All-Hands-AI/deploy` | `.github/workflows/deploy.yaml`, `openhands/envs/{production,staging,...}/values.yaml` |

The Cloud helm charts in `OpenHands-OpenHands-Cloud/charts/runtime-api/` are for self-hosted / Replicated installs. Production SaaS uses the chart that lives in the runtime-api repo itself (`OpenHands-runtime-api/deploy/chart/`) plus the per-env values in `OpenHands-runtime-api/deploy/envs/<env>/values.yaml`, with the warm-pool overlay from the deploy repo.

## Things we still don't have hard data on

These don't block design work — the architecture is correct for the worst case — but worth knowing if/when they're asked:

- Exact rate limits on `POST /v1/app-conversations`, `POST /v1/sandboxes`, REST send-message.
- Whether `condense` output is surfaced via a specific event kind or just folded into the agent's prompt on its next turn.
- Whether the start-task ever rejects a request that specifies `conversation_id` of an *existing live* conversation (vs. our verified case of a dead one).
- Concrete cost model (per sandbox-RUNNING-hour, per sandbox-PAUSED-hour, per LLM-token, etc.).
- Snapshot lifetime when the deployment itself is hard-deleted at `RUNTIME_DEAD_SECONDS`.
- Webhook delivery guarantees (relevant only if OH later exposes customer-facing webhooks).
