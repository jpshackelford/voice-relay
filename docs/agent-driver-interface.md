# AgentDriver Interface

> Status: design draft
> Audience: platform engineers building against the driver, and adapter authors implementing it.

## Purpose

`AgentDriver` is the abstraction the platform uses to run AI agent
conversations. It hides everything about *how* an agent runtime is provisioned,
how its filesystem is materialized, and how individual agent conversations are
started, rotated, or recovered. The platform talks only to this interface; all
provider-specific concepts (sandboxes, mounts, websocket protocols, conversation
IDs) live inside individual adapters.

The driver exists so that:

1. The platform's business logic — accounts, workspaces, sessions, chat
   history, billing, UI — depends on **no provider-specific types or APIs**.
2. Provider behavior (sandbox lifecycle, conversation rotation, warm pools,
   filesystem mounting) can evolve independently of the platform.
3. A second adapter (test fake, future provider, on-prem variant) can be
   substituted with zero changes outside the adapter directory.

## Design principles

**Small surface.** The interface is intentionally narrow (~6 methods). Every
method added is a contract every adapter must implement. Provider-specific
conveniences belong inside the adapter.

**Resource model is platform-owned.** `WorkspaceId`, `SessionId`, and
`MessageId` are platform primary keys. Adapters maintain their own internal
mappings to provider concepts; those mappings are never exposed.

**Conversations are not a resource.** What the user mental-models as "a
conversation" is the platform's `Session`. The fact that an adapter may rotate
through multiple provider-side agent conversations under one session is an
implementation detail.

**Streaming-first.** The primary operation (`send_message`) returns an
asynchronous stream of events, not a single response. This accommodates token
streaming, tool calls, status updates, and transparent retry across runtime
failures.

**Idempotency at the message level.** Every `send_message` call carries an
idempotency key. Adapters use this to deduplicate work and to retry transparently
across runtime failures without double-posting.

**Errors are normalized.** Adapters map provider errors into a platform-defined
`ErrorCode` enum. The platform never branches on provider-specific error
strings or codes.

**Lifecycle is best-effort and eventually consistent.** Workspace readiness,
warming, and teardown are async and may take seconds to minutes. The interface
exposes status, not synchronous guarantees.

## Resources and types

### Identifiers

```python
WorkspaceId = NewType("WorkspaceId", str)
SessionId   = NewType("SessionId", str)
MessageId   = NewType("MessageId", str)
```

All IDs are opaque strings minted by the platform. Adapters do not parse them.

### Message

The unit of session history. Adapter-agnostic.

```python
class MessageRole(str, Enum):
    HUMAN  = "human"
    AGENT  = "agent"
    SYSTEM = "system"
    TOOL   = "tool"

@dataclass(frozen=True)
class Message:
    id:         MessageId
    session_id: SessionId
    role:       MessageRole
    content:    str | StructuredContent     # text or structured payload
    created_at: datetime
    metadata:   Mapping[str, str] = field(default_factory=dict)
```

`StructuredContent` is a small union covering tool calls, tool results, and
multimodal parts. It is platform-defined and provider-neutral; adapters
translate to/from provider-native shapes.

### Status types

```python
class WorkspaceReadiness(str, Enum):
    UNKNOWN       = "unknown"
    PROVISIONING  = "provisioning"   # mount + warm in progress
    READY         = "ready"          # fully warm, fast path available
    DEGRADED      = "degraded"       # usable but cold (no warm cache)
    UNAVAILABLE   = "unavailable"    # transient failure; retry later
    ARCHIVED      = "archived"       # permanently retired

@dataclass(frozen=True)
class WorkspaceStatus:
    workspace_id:    WorkspaceId
    readiness:       WorkspaceReadiness
    last_active_at:  datetime | None
    diagnostic:      str | None       # human-readable, optional


class SessionLiveness(str, Enum):
    UNKNOWN      = "unknown"
    IDLE         = "idle"             # bound to runtime but inactive
    ACTIVE       = "active"           # currently processing a turn
    DETACHED     = "detached"         # no runtime bound; next send rebinds
    CLOSED       = "closed"           # close_session was called

@dataclass(frozen=True)
class SessionStatus:
    session_id:    SessionId
    liveness:      SessionLiveness
    workspace_id:  WorkspaceId
    diagnostic:    str | None
```

### Warm hints

A non-binding hint the platform can pass to influence proactive warming.

```python
class WarmHint(str, Enum):
    NORMAL  = "normal"     # ensure ready, no special urgency
    EAGER   = "eager"      # user has opened the UI; prewarm aggressively
    LAZY    = "lazy"       # background touch; defer real work if expensive
```

Adapters MAY ignore hints. They MUST NOT change observable behavior based on
hints beyond timing and resource usage.

## Events

`send_message` returns an asynchronous stream of `AgentEvent`s. The platform
forwards relevant events to the UI, persists `MessageCompleteEvent`s to history,
and surfaces `StatusEvent`s as UX affordances.

```python
class AgentEvent: ...

@dataclass(frozen=True)
class TokenEvent(AgentEvent):
    """A chunk of streaming agent text."""
    text: str

@dataclass(frozen=True)
class ToolCallEvent(AgentEvent):
    """The agent invoked a tool."""
    call_id: str
    tool:    str
    args:    Mapping[str, Any]

@dataclass(frozen=True)
class ToolResultEvent(AgentEvent):
    """A tool call completed."""
    call_id: str
    result:  Any | None
    error:   str | None

@dataclass(frozen=True)
class MessageCompleteEvent(AgentEvent):
    """A complete message — the platform persists this to session history."""
    message: Message

@dataclass(frozen=True)
class StatusEvent(AgentEvent):
    """
    Informational; the platform MAY surface this in the UI but MUST NOT
    branch business logic on its content.
    """
    kind: Literal[
        "workspace_warming",
        "runtime_switching",
        "reconnecting",
        "queued",
    ]
    info: str | None = None

@dataclass(frozen=True)
class ErrorEvent(AgentEvent):
    """A terminal or partial error. recoverable=True means the stream may continue."""
    code:        ErrorCode
    message:     str
    recoverable: bool
```

### Error codes

A small, closed enum. Adapters map all provider errors into this set.

```python
class ErrorCode(str, Enum):
    RATE_LIMITED          = "rate_limited"
    PROVIDER_UNAVAILABLE  = "provider_unavailable"
    WORKSPACE_UNAVAILABLE = "workspace_unavailable"
    SESSION_NOT_FOUND     = "session_not_found"
    INVALID_REQUEST       = "invalid_request"
    QUOTA_EXCEEDED        = "quota_exceeded"
    INTERNAL              = "internal"
```

`INTERNAL` is the catch-all; adapters should prefer a more specific code where
possible.

## The interface

```python
class AgentDriver(Protocol):

    # ------------------------------------------------------------------
    # Workspace lifecycle
    # ------------------------------------------------------------------

    async def ensure_workspace_ready(
        self,
        workspace_id: WorkspaceId,
        *,
        hint: WarmHint = WarmHint.NORMAL,
    ) -> WorkspaceStatus:
        """
        Ensure a workspace is provisioned and (best-effort) warm.

        Idempotent. Safe to call repeatedly; the adapter coalesces concurrent
        calls for the same workspace.

        May return before the workspace is fully warm. Callers that need to
        block until READY should poll get_workspace_status.

        Raises only on permanent failures (e.g., workspace archived,
        misconfiguration). Transient provider failures are surfaced via
        WorkspaceReadiness.UNAVAILABLE in the returned status.
        """
        ...

    async def release_workspace(
        self,
        workspace_id: WorkspaceId,
    ) -> None:
        """
        Tear down all runtime state for a workspace.

        Durable filesystem state is preserved (it lives outside the runtime).
        Idempotent. Safe to call on already-released workspaces.

        After release, the next ensure_workspace_ready will provision from
        cold.
        """
        ...

    async def get_workspace_status(
        self,
        workspace_id: WorkspaceId,
    ) -> WorkspaceStatus:
        """Read-only status check. Cheap; does not trigger provisioning."""
        ...

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    async def open_session(
        self,
        workspace_id: WorkspaceId,
        session_id:   SessionId,
        *,
        history: AsyncIterable[Message] | None = None,
    ) -> None:
        """
        Register a session with the driver.

        Typically called the first time a session is used in this driver's
        lifetime, or after a driver restart when the session is being
        reattached.

        If history is provided, the adapter MAY replay or summarize it when
        binding the session to a fresh runtime conversation. If omitted, the
        adapter will fetch history (via callback or repository injected at
        construction) on demand.

        Idempotent. Calling open_session on an already-open session is a
        no-op (or a refresh, adapter's choice).
        """
        ...

    async def close_session(
        self,
        session_id: SessionId,
    ) -> None:
        """
        Signal that no more messages will be sent on this session.

        The adapter MAY release any bound runtime conversation. The session
        is not deleted; subsequent open_session calls re-bind it.

        Idempotent.
        """
        ...

    async def get_session_status(
        self,
        session_id: SessionId,
    ) -> SessionStatus:
        """Read-only status check."""
        ...

    # ------------------------------------------------------------------
    # The main event
    # ------------------------------------------------------------------

    async def send_message(
        self,
        session_id:      SessionId,
        message:         Message,
        *,
        idempotency_key: str,
    ) -> AsyncIterator[AgentEvent]:
        """
        Send a user message and stream the agent's response.

        The adapter is responsible for:
          - resolving the session to a live runtime conversation, spawning
            or rotating one as needed
          - replaying or summarizing session history into a newly-bound
            conversation
          - transparently retrying across runtime failures, gated by
            idempotency_key (a given key is processed at most once)
          - emitting StatusEvents during long-running provisioning
          - emitting exactly one MessageCompleteEvent per resulting agent
            message; the platform persists these to session history
          - emitting an ErrorEvent with recoverable=False before terminating
            the stream on unrecoverable failure

        idempotency_key MUST uniquely identify this message attempt. The
        platform's convention is "{session_id}:{message.id}".

        The iterator terminates after the final event (MessageCompleteEvent
        or terminal ErrorEvent).
        """
        ...
```

## Invariants (the contract)

These are the guarantees the driver makes to the platform. They are what makes
the abstraction worth having.

1. **Session history is conversation-agnostic.** A session's messages survive
   any number of internal conversation rotations, runtime restarts, or
   provider outages.

2. **Filesystem state is workspace-scoped and durable.** Within a workspace,
   all sessions share the same filesystem. Writes survive workspace teardown
   and re-provisioning.

3. **No session is pinned to a specific provider conversation.** Adapters
   are free to rotate conversations under a session at any time without
   notifying the platform (beyond optional `StatusEvent`s).

4. **`send_message` is at-most-once per idempotency key.** Replays with the
   same key return the same logical result; the adapter MUST NOT double-post
   to the underlying conversation.

5. **Streams terminate.** Every call to `send_message` eventually yields a
   terminal event (`MessageCompleteEvent` or `ErrorEvent` with
   `recoverable=False`) and closes, within a bounded timeout the adapter
   defines.

6. **Lifecycle calls are idempotent.** `ensure_workspace_ready`,
   `release_workspace`, `open_session`, `close_session` are all safe to call
   multiple times.

7. **Errors are normalized.** All errors surfaced to the platform use the
   `ErrorCode` enum. Provider-native error data may appear in `info` /
   `diagnostic` strings for debugging but MUST NOT be parsed by the platform.

## What the driver does NOT do

Explicitly out of scope. These are platform concerns:

- **Authentication and authorization.** The driver trusts its caller. ACL
  checks happen in the platform layer before calls reach the driver.
- **Quota enforcement.** The driver may surface `QUOTA_EXCEEDED` from a
  provider, but the platform owns its own quota policy.
- **Message persistence.** The platform persists history; the driver consumes
  it as input (`open_session(history=...)`) and emits `MessageCompleteEvent`s
  as output.
- **Multi-workspace policy.** "One active workspace per account" is enforced
  by the platform, not the driver. The driver operates on whatever workspaces
  it is told to operate on.
- **Billing, metrics aggregation, audit logging.** These are cross-cutting
  platform concerns; the driver may emit per-call telemetry but does not
  aggregate or persist it.

## Testing and fakes

A `FakeDriver` ships alongside the interface for platform testing. It:

- Holds workspace and session state in memory.
- Emits scripted event sequences for `send_message` based on a small DSL or
  per-session fixtures.
- Supports fault injection: configurable delays, simulated workspace
  unavailability, conversation rotation events, idempotency-key replays.

The litmus test for the boundary: **the platform's test suite passes against
`FakeDriver` with no provider adapter installed.** If a test requires a real
adapter, either the test is integration-level (and belongs in the adapter's
own suite) or the interface is leaking.

## Versioning

The `AgentDriver` protocol is versioned by addition only within a major
version. Adding a new method is a breaking change for adapter authors; adding
a new optional event type is non-breaking. The platform pins a major version
in its dependency on the interface package.

## Open questions

- **Multimodal content.** `StructuredContent` is sketched but not specified
  here. Needs a dedicated design once we know the shape of attachments,
  images, and file references in the chat surface.
- **Tool-result feedback.** When a tool result is computed platform-side
  (rather than runtime-side), how does it re-enter the message stream?
  Likely a separate `submit_tool_result(call_id, result)` method on the
  driver. Defer until needed.
- **Bulk session operations.** Migrating many sessions between workspaces
  (e.g., during a workspace archive) may want a batch API. Not currently
  needed.
