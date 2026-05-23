# OpenHands AgentDriver Adapter

> Status: design draft
> Implements: `AgentDriver` (see `agent-driver-interface.md`)
> Provider: OpenHands SaaS (app server v1 API + agent server WebSocket)

## Purpose

`OpenHandsDriver` is the production adapter that fulfills the `AgentDriver`
contract using the OpenHands SaaS platform. It encapsulates every
OpenHands-specific concept — sandboxes, conversations, the v1 API, the agent
server WebSocket protocol — and the operational machinery we layer on top:
the sandbox warm pool, daily rotation, S3-backed filesystem, out-of-band
index warming, and conversation rotation under a stable session.

Nothing in this module is exported to the rest of the platform. All
provider-shaped types stay behind the `AgentDriver` boundary.

## Architecture

```
            AgentDriver (interface)
                    │
                    ▼
        ┌───────────────────────────┐
        │   OpenHandsDriver         │
        │   (driver.py)             │
        └────────┬───────┬──────────┘
                 │       │
        ┌────────▼──┐   ┌▼───────────────────┐
        │ Workspace │   │ Session            │
        │ Manager   │   │ Manager            │
        │           │   │                    │
        │ - sandbox │   │ - SessionId →      │
        │   pool    │   │   conversation     │
        │ - warm    │   │   binding          │
        │   rotation│   │ - history replay   │
        │ - mount + │   │ - rotation on      │
        │   index   │   │   failure          │
        │   bring-up│   │                    │
        └────┬──────┘   └──┬─────────────────┘
             │             │
             ▼             ▼
        ┌─────────────────────────────┐
        │ OpenHandsClient             │
        │  - app server v1 REST       │
        │  - agent server WebSocket   │
        └─────────────────────────────┘
                 │
                 ▼
        OpenHands SaaS
```

Three internal components:

1. **WorkspaceManager** — owns sandbox lifecycle for a `WorkspaceId`. Maintains
   the active sandbox, optionally a warmed successor, and handles all
   filesystem setup.
2. **SessionManager** — owns the `SessionId → conversation_id` mapping inside
   a workspace. Spawns and rotates conversations as needed.
3. **OpenHandsClient** — thin wrapper over OpenHands platform APIs. The only
   place we touch HTTP / WebSocket primitives. Everything else uses its
   high-level methods.

## OpenHands platform primitives

These are the operations we depend on from the OpenHands SaaS. They are
sketched here as pseudo-methods; actual implementation wraps the v1 REST API
and agent server WebSocket.

```python
class OpenHandsClient:
    """Thin wrapper over OpenHands SaaS APIs. No business logic here."""

    # ---- Sandboxes ----

    async def start_sandbox(
        self, *, image: str, env: Mapping[str, str], tags: Mapping[str, str],
    ) -> SandboxHandle:
        """POST /v1/sandboxes — provision a new sandbox. Returns when the
        sandbox is reachable (but not necessarily fully booted)."""
        ...

    async def stop_sandbox(self, sandbox_id: str) -> None:
        """DELETE /v1/sandboxes/{id} — best-effort teardown."""
        ...

    async def get_sandbox(self, sandbox_id: str) -> SandboxHandle:
        """GET /v1/sandboxes/{id} — current sandbox state."""
        ...

    async def exec_in_sandbox(
        self, sandbox_id: str, command: str,
        *, timeout: float = 60.0, env: Mapping[str, str] | None = None,
    ) -> ExecResult:
        """POST /v1/sandboxes/{id}/exec — run a shell command, return
        stdout/stderr/exit_code. Used for mount + warm setup."""
        ...

    async def write_file_in_sandbox(
        self, sandbox_id: str, path: str, content: bytes,
    ) -> None:
        """Helper for dropping config files (passwd-s3fs, scripts) into
        the sandbox at provisioning time."""
        ...

    # ---- Conversations ----

    async def start_conversation(
        self, sandbox_id: str, *, initial_context: list[ConvMessage] | None = None,
    ) -> ConversationHandle:
        """POST /v1/conversations — start a new agent conversation bound to
        a sandbox. Optionally seed with prior messages for history replay."""
        ...

    async def stop_conversation(self, conversation_id: str) -> None:
        """DELETE /v1/conversations/{id}."""
        ...

    async def get_conversation(self, conversation_id: str) -> ConversationHandle:
        """GET /v1/conversations/{id} — state, including whether it's still
        alive on the platform."""
        ...

    # ---- Agent server WebSocket ----

    @asynccontextmanager
    async def conversation_socket(
        self, conversation_id: str,
    ) -> AsyncIterator[ConversationSocket]:
        """Open a WebSocket to the agent server for streaming events and
        sending user messages. Yields a typed wrapper."""
        ...


class ConversationSocket:
    async def send_user_message(self, content: str | StructuredContent) -> None: ...
    async def cancel(self) -> None: ...
    def events(self) -> AsyncIterator[OpenHandsAgentEvent]: ...
    async def close(self) -> None: ...
```

All of the above are pseudo-methods. Real implementation lives in
`openhands_client.py` and is the only place that knows about HTTP paths,
WebSocket framing, auth headers, retry on 5xx, etc.

## Workspace lifecycle

### Mapping

A `WorkspaceId` (platform-owned, opaque) maps internally to an
**OpenHands sandbox pool** for that workspace, typically of size 1 (`active`)
or 2 (`active`, optional `warm`). The mapping is held in a process-local
table backed by a durable store for restart recovery:

```python
@dataclass
class WorkspaceRuntime:
    workspace_id:      WorkspaceId
    active_sandbox:    SandboxRecord | None
    warm_sandbox:      SandboxRecord | None       # may be None most of the time
    last_promoted_at:  datetime | None
    config:            WorkspaceConfig             # bucket name, env, tags

@dataclass
class SandboxRecord:
    sandbox_id:   str
    created_at:   datetime
    mounted_at:   datetime | None
    warmed_at:    datetime | None      # index built; full ready state
    state:        Literal["building", "ready", "draining", "dead"]
```

### Provisioning a sandbox (cold path)

When `ensure_workspace_ready` is called and no active sandbox exists, the
manager does:

```python
async def provision_sandbox(workspace_id: WorkspaceId) -> SandboxRecord:
    cfg = await load_workspace_config(workspace_id)

    # 1. Start the sandbox.
    sb = await client.start_sandbox(
        image=cfg.image,
        env={
            "S3_BUCKET":     cfg.bucket,
            "S3_REGION":     cfg.region,
            "AWS_ROLE_ARN":  cfg.role_arn,    # or per-workspace credentials
        },
        tags={"workspace_id": workspace_id, "role": "active"},
    )
    record = SandboxRecord(sandbox_id=sb.id, created_at=now(),
                           mounted_at=None, warmed_at=None, state="building")

    # 2. Drop credentials and helper scripts into the sandbox.
    await install_workspace_scripts(sb.id, cfg)

    # 3. Mount the S3 filesystem.
    await mount_s3_filesystem(sb.id, cfg)
    record.mounted_at = now()

    # 4. Kick off out-of-band index warm in the background.
    #    Do NOT block sandbox readiness on this; warm runs concurrently.
    asyncio.create_task(warm_index(sb.id, cfg, on_done=lambda: mark_warmed(record)))

    record.state = "ready"
    return record
```

Steps 2 and 3 run sequentially because mount depends on creds. Step 4 runs
concurrently with the platform's first use of the sandbox; if the agent's
first turn doesn't need an enumeration, it never notices the warm is still in
flight.

### Filesystem setup

Mount and warm are entirely shell operations driven by `exec_in_sandbox`. The
sandbox image is assumed to have `s3fs-fuse`, `awscli`, and `tree` available.

```python
S3FS_FLAGS = " ".join([
    "-o", 'passwd_file=/root/.passwd-s3fs',
    "-o", 'use_cache=""',           # disable local data cache for durability
    "-o", 'max_dirty_data=0',
    "-o", 'sync_on_flush=true',
    "-o", 'stat_cache_expire=900',  # metadata cache OK; no data cache
    "-o", 'readdir_optimize',
    "-o", 'multireq_max=20',
    "-o", 'nocopyapi',
])

async def install_workspace_scripts(sandbox_id: str, cfg: WorkspaceConfig) -> None:
    # Credentials file for s3fs.
    await client.write_file_in_sandbox(
        sandbox_id, "/root/.passwd-s3fs",
        content=f"{cfg.access_key}:{cfg.secret_key}\n".encode(),
    )
    await client.exec_in_sandbox(sandbox_id, "chmod 600 /root/.passwd-s3fs")

    # Mount point and helper scripts.
    await client.exec_in_sandbox(sandbox_id, "mkdir -p /mnt/ws")

async def mount_s3_filesystem(sandbox_id: str, cfg: WorkspaceConfig) -> None:
    cmd = f"s3fs {cfg.bucket} /mnt/ws {S3FS_FLAGS}"
    result = await client.exec_in_sandbox(sandbox_id, cmd, timeout=30.0)
    if result.exit_code != 0:
        raise MountFailed(result.stderr)

    # Quick sanity probe — write+read a sentinel.
    probe = f"echo ok > /mnt/ws/.probe-{uuid4()} && rm /mnt/ws/.probe-*"
    result = await client.exec_in_sandbox(sandbox_id, probe, timeout=10.0)
    if result.exit_code != 0:
        raise MountFailed(f"sentinel probe failed: {result.stderr}")
```

The bucket lifecycle policy (versioning + non-current expiration) is **not**
managed by the driver. It is configured once per bucket by the platform's
provisioning / infrastructure code; the driver assumes it is in place.

### Out-of-band index warm

The warm step is what lets the agent do `tree`, `find`, `grep -l` over the
workspace without slamming s3fs with serial LIST calls. It runs as a single
paginated `aws s3 ls --recursive` (or `aws s3api list-objects-v2`) inside the
sandbox, writing the result to a local file the agent's tools can consult.

```python
async def warm_index(
    sandbox_id: str, cfg: WorkspaceConfig, *, on_done: Callable[[], None]
) -> None:
    script = f"""
        set -e
        IDX=/root/.ws-index.txt
        TMP=$IDX.tmp
        aws s3 ls s3://{cfg.bucket} --recursive --output text > $TMP
        mv $TMP $IDX
        touch /root/.ws-ready
    """
    result = await client.exec_in_sandbox(sandbox_id, script, timeout=600.0)
    if result.exit_code == 0:
        on_done()
    else:
        # Warm failure does NOT take the workspace down — sandbox is still
        # usable for direct path-based I/O. Log and continue.
        log.warning("warm_index failed for %s: %s", sandbox_id, result.stderr)
```

If the bucket is large enough that a single LIST is slow (>50K objects),
the warm script parallelizes by prefix. For very large buckets (>1M objects),
the driver can be configured to consume **S3 Inventory** manifests instead
of live LIST; this is a per-workspace config flag.

### Daily rotation (the 23h handoff)

We do not maintain a persistent warm pool. Warming is triggered lazily, on
activity, by the WorkspaceManager:

```python
async def maybe_prepare_successor(workspace_id: WorkspaceId) -> None:
    """Called opportunistically when the workspace is active. Cheap if the
    active sandbox is young; spawns a warm successor if it's near TTL."""
    rt = await get_runtime(workspace_id)
    if rt.active_sandbox is None:
        return
    age = now() - rt.active_sandbox.created_at
    if age < ROTATE_AFTER:                  # e.g., 23 hours
        return
    if rt.warm_sandbox is not None:
        return                              # already prepared

    rt.warm_sandbox = await provision_sandbox(workspace_id)
    # warm_sandbox is fully provisioned (mount + index warm) before promotion.
```

This is called from `send_message` (start-of-turn) and from a low-frequency
background tick (e.g., once per minute for active workspaces only). It is
**not** called for idle workspaces — they're allowed to time out and pay a
cold-start when the next conversation arrives.

Promotion happens at the next session activity after a warm successor is
ready:

```python
async def promote_successor_if_ready(workspace_id: WorkspaceId) -> None:
    rt = await get_runtime(workspace_id)
    if rt.warm_sandbox is None or rt.warm_sandbox.state != "ready":
        return
    old, new = rt.active_sandbox, rt.warm_sandbox
    rt.active_sandbox = new
    rt.warm_sandbox   = None
    rt.last_promoted_at = now()

    # Existing conversations bound to `old` continue there until they're
    # closed or rotated. We do NOT actively drain — the platform's TTL will
    # reap `old` when it goes idle. Durable state lives in S3, so abandoning
    # `old` is safe.
    await session_mgr.notify_active_rotated(workspace_id, new_sandbox=new.sandbox_id)
```

### Release

```python
async def release_workspace(workspace_id: WorkspaceId) -> None:
    rt = await pop_runtime(workspace_id)
    if rt is None:
        return
    for sb in (rt.active_sandbox, rt.warm_sandbox):
        if sb is not None:
            with suppress(Exception):
                await client.stop_sandbox(sb.sandbox_id)
```

Idempotent; safe on already-released workspaces.

## Session lifecycle

### Session ↔ conversation mapping

Each platform `SessionId` is bound to **at most one live OpenHands
conversation at a time**, on the current active sandbox of the session's
workspace. The binding is held in:

```python
@dataclass
class SessionRuntime:
    session_id:           SessionId
    workspace_id:         WorkspaceId
    conversation_id:      str | None       # None when detached
    bound_sandbox_id:     str | None
    last_message_at:      datetime | None
    pending_idempotency:  set[str]         # in-flight or completed keys
```

The binding is created lazily on the first `send_message`, not on
`open_session`. `open_session` just records the existence of the session so
it can be looked up.

### Resolving a session to a conversation

This is the heart of `send_message`. The first thing every message does:

```python
async def resolve_conversation(
    session_runtime: SessionRuntime,
    *,
    history_provider: Callable[[], AsyncIterable[Message]],
) -> str:
    """Returns a conversation_id ready to receive a user message."""
    ws_rt = await get_runtime(session_runtime.workspace_id)
    if ws_rt.active_sandbox is None or ws_rt.active_sandbox.state != "ready":
        await ensure_workspace_ready_internal(session_runtime.workspace_id)
        ws_rt = await get_runtime(session_runtime.workspace_id)

    target_sandbox = ws_rt.active_sandbox.sandbox_id

    # Fast path: existing conversation on the right sandbox and still alive.
    if (session_runtime.conversation_id is not None
            and session_runtime.bound_sandbox_id == target_sandbox):
        if await is_conversation_alive(session_runtime.conversation_id):
            return session_runtime.conversation_id

    # Slow path: bind to a new conversation. This is invisible to the
    # platform; only StatusEvents leak that it happened.
    history = await collect_history_for_replay(history_provider)
    initial_context = translate_history(history)
    new_conv = await client.start_conversation(
        sandbox_id=target_sandbox,
        initial_context=initial_context,
    )
    session_runtime.conversation_id  = new_conv.id
    session_runtime.bound_sandbox_id = target_sandbox
    return new_conv.id
```

`translate_history` converts platform `Message`s to OpenHands-native message
shapes. For very long histories it summarizes (driver-internal policy; not
visible to the platform).

### send_message loop

```python
async def send_message(
    self,
    session_id:      SessionId,
    message:         Message,
    *,
    idempotency_key: str,
) -> AsyncIterator[AgentEvent]:
    session_rt = await self.sessions.get_or_create(session_id)

    # Idempotency: if we've seen this key, replay or short-circuit.
    if idempotency_key in session_rt.pending_idempotency:
        async for ev in self.idempotency.replay(idempotency_key):
            yield ev
        return
    session_rt.pending_idempotency.add(idempotency_key)

    # Opportunistically warm a successor for the workspace.
    asyncio.create_task(
        self.workspaces.maybe_prepare_successor(session_rt.workspace_id)
    )

    attempts = 0
    while True:
        attempts += 1
        try:
            conv_id = await self.resolve_conversation(
                session_rt,
                history_provider=lambda: self.history.stream(session_id),
            )
            async with self.client.conversation_socket(conv_id) as sock:
                await sock.send_user_message(message.content)
                async for native_ev in sock.events():
                    for ev in translate_event(native_ev, session_id):
                        yield ev
                        if is_terminal(ev):
                            await self.idempotency.record(idempotency_key, ev)
                            return
            return

        except ConversationDied as exc:
            # Transparent rotation: rebind and retry exactly once.
            if attempts >= 2:
                yield ErrorEvent(
                    code=ErrorCode.PROVIDER_UNAVAILABLE,
                    message="conversation rotation exhausted",
                    recoverable=False,
                )
                return
            yield StatusEvent(kind="runtime_switching")
            session_rt.conversation_id  = None
            session_rt.bound_sandbox_id = None
            continue

        except SandboxDied:
            # Active sandbox died mid-turn. Force workspace re-provision
            # then retry, once.
            if attempts >= 2:
                yield ErrorEvent(
                    code=ErrorCode.WORKSPACE_UNAVAILABLE,
                    message="workspace runtime lost",
                    recoverable=False,
                )
                return
            yield StatusEvent(kind="reconnecting")
            await self.workspaces.invalidate_active(session_rt.workspace_id)
            session_rt.conversation_id  = None
            session_rt.bound_sandbox_id = None
            continue

        except RateLimitedError as exc:
            yield ErrorEvent(
                code=ErrorCode.RATE_LIMITED,
                message=str(exc),
                recoverable=False,
            )
            return
```

Notes:

- **At-most-once retry across runtime failures.** Two attempts maximum;
  beyond that we surface an unrecoverable error and let the platform
  decide whether to expose retry UX.
- **Idempotency record stores the terminal event** so a duplicate call
  with the same key can replay the response without re-invoking the agent.
- **The platform sees only translated events.** All OpenHands-native event
  shapes (`AgentStateChangeObservation`, `CmdOutputObservation`, etc.) are
  mapped to the platform-defined `AgentEvent` union by `translate_event`.

### Event translation

`translate_event` is the second-most-important function in the driver
(after `send_message` itself). It is a pure mapping from OpenHands event
types to the platform's `AgentEvent` types. Worth its own file
(`event_translation.py`) and its own test suite. Examples:

```python
def translate_event(native: OpenHandsAgentEvent, session_id: SessionId
                    ) -> Iterable[AgentEvent]:
    match native:
        case TokenObservation(text=t):
            yield TokenEvent(text=t)
        case ActionInvocation(call_id=c, name=n, args=a):
            yield ToolCallEvent(call_id=c, tool=n, args=a)
        case ActionResult(call_id=c, output=o, error=e):
            yield ToolResultEvent(call_id=c, result=o, error=e)
        case AgentMessageComplete(message=m):
            yield MessageCompleteEvent(message=to_platform_message(m, session_id))
        case AgentStateChange(state="thinking"):
            pass   # filtered out; not platform-relevant
        case _:
            log.debug("dropping untranslated native event: %r", native)
```

The driver MUST NOT pass through OpenHands-native events unchanged. Untranslated
events are dropped (with debug logging), never forwarded.

## Configuration

Driver configuration is provider-specific and lives entirely under an
`openhands` key in the platform's config:

```yaml
agent_driver: openhands

openhands:
  api_base_url:     "https://app.all-hands.dev"
  api_key_env:      OPENHANDS_API_KEY
  default_sandbox_image: "openhands/agent:1.x"

  workspace:
    bucket_pattern:  "ws-{workspace_id}"
    region:          "us-east-1"
    rotate_after:    "23h"
    warm_index_timeout: "10m"

  conversation:
    history_replay_limit:   200    # messages; older are summarized
    retry_on_conversation_death: 1
    retry_on_sandbox_death:      1
```

The platform passes this config blob opaquely; only `OpenHandsDriver` parses
it.

## Restart and recovery

When the driver process restarts:

1. Sandbox state is rediscovered by querying OpenHands for sandboxes tagged
   with our workspace IDs. Anything not recognized is left alone (assumed
   to belong to another process or to be already-dying).
2. Session state — the `SessionId → conversation_id` mapping — is reloaded
   from the durable store backing `SessionRuntime`. Conversation liveness
   is verified lazily on next `send_message` (not eagerly on startup).
3. In-flight `send_message` calls do not survive restart; the platform is
   expected to retry with the same idempotency key, which short-circuits if
   the prior attempt completed and otherwise re-runs.

## Observability

Per-call metrics emitted (provider-neutral names so they aggregate across
adapters):

- `agent_driver.send_message.duration_seconds` (histogram)
- `agent_driver.send_message.attempts` (histogram)
- `agent_driver.send_message.terminal_event` (counter, labeled by event type)
- `agent_driver.workspace.cold_start_seconds` (histogram)
- `agent_driver.workspace.warm_hit` (counter, labeled by hit/miss)
- `agent_driver.session.rotations` (counter)

Per-call trace spans include the OpenHands `sandbox_id` and `conversation_id`
as span attributes (debug aid), but never as labels on metrics (cardinality).

## Failure modes and behaviors

| Failure                              | Driver behavior                                      | Platform sees                                |
|--------------------------------------|------------------------------------------------------|----------------------------------------------|
| Sandbox slow to provision            | `ensure_workspace_ready` returns PROVISIONING        | `StatusEvent("workspace_warming")` on next send |
| s3fs mount fails                     | Sandbox marked dead; one retry on new sandbox        | Reconnecting status; eventual error if persistent |
| Index warm fails                     | Sandbox still ready; warm marked failed              | No event; sandbox is usable for path I/O     |
| Conversation dies mid-stream         | One transparent rotation                             | `StatusEvent("runtime_switching")`           |
| Sandbox dies mid-stream              | One transparent re-provision + rotation              | `StatusEvent("reconnecting")`                |
| OpenHands rate limit (429)           | Propagated immediately                               | `ErrorEvent(RATE_LIMITED, recoverable=False)` |
| Idempotency replay (known key)       | Replay recorded terminal event                       | Same final event as the original             |
| Workspace archived mid-session       | Refuse new sends; return INVALID_REQUEST             | `ErrorEvent(INVALID_REQUEST)`                |
| Driver restart                       | Lazy state recovery from OpenHands + own store       | Brief extra latency on next send             |

## Known limitations

- **Long histories.** Above `history_replay_limit`, replay summarizes — fidelity
  is reduced. We accept this tradeoff; the alternative (full replay on every
  rotation) is too slow.
- **Tool-result re-entry.** Currently assumes all tool execution happens
  inside the sandbox (OpenHands-managed). Platform-side tool execution would
  require a `submit_tool_result` driver method, which is not yet defined.
- **Single active workspace per driver instance is not enforced here.**
  Enforced at the platform layer (per the interface doc); the driver will
  happily operate multiple workspaces for one account if asked.
- **No multi-region.** Bucket region is per-workspace config; cross-region
  failover is out of scope.

## Open questions

- Should index warm be replaced by S3 Inventory consumption as the default
  for large workspaces, with live LIST as a fallback for small ones? Cost
  model favors Inventory above ~500K objects.
- How aggressively should `maybe_prepare_successor` warm? Currently triggers
  only on activity past 23h. If platform TTL drops below 24h, we'll need a
  different trigger.
- Conversation history summarization policy currently lives in the driver.
  Arguably it's platform policy (it affects what the agent "remembers"),
  but exposing it would leak provider concepts. Revisit if summarization
  fidelity becomes a user-visible concern.
