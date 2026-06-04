/**
 * OpenHandsAgentDriver — adapter exposing `AgentDriver` over the existing
 * `AISessionManager` singleton.
 *
 * This is a non-behavior-changing wrap: every database write and WebSocket
 * broadcast performed by the unwrapped path continues to happen via the
 * underlying `AISessionManager`. The adapter only translates the
 * callback-based surface into the `AgentDriver` shape (async iterables for
 * `sendMessage`, snapshots for `getSessionStatus`).
 *
 * Designed for #288. Production callers continue to use `AISessionManager`
 * directly until #289 swaps them onto this seam.
 */

import type {
  AISession,
  ActionCallback,
  AgentAction as OHAgentAction,
  EventCallback,
  RawOpenHandsEvent,
  ThinkingChangeCallback,
} from '../openhands.js';
import type {
  AgentAction,
  AgentDriver,
  AgentEvent,
  AgentSenderMeta,
  AgentSessionState,
  AgentSessionStatus,
  OpenSessionOpts,
} from './types.js';

/**
 * Narrow structural subset of `AISessionManager` consumed by the adapter.
 *
 * Exposed for tests so they can substitute a fake without depending on the
 * full real manager (which constructs an `OpenHandsClient` on instantiation).
 */
export interface AISessionManagerSurface {
  isAvailable(): boolean;
  hasSessionAI(sessionId: string): boolean;
  setThinkingChangeCallback(cb: ThinkingChangeCallback | undefined): void;
  setActionCallback(cb: ActionCallback | undefined): void;
  setEventCallback(cb: EventCallback | undefined): void;
  getSessionAI(sessionId: string): AISession | undefined;
  getOrCreateForSession(
    sessionId: string,
    workspaceId: string,
    onMessage: (message: string, serverTimestamp?: string) => void,
    options?: {
      displayLines?: number;
      apiKey?: string;
      displayApiSecret?: string;
      existingConversationId?: string;
    },
  ): Promise<AISession>;
  sendSessionMessage(
    sessionId: string,
    message: string,
    sender?: AgentSenderMeta,
  ): Promise<void>;
  endSessionAI(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
  /**
   * Install a per-session prompt resolver (issue #378). Optional on the
   * surface because the fake driver and tests don't need it; the real
   * `AISessionManager` always implements it.
   */
  setPromptResolver?(
    resolver:
      | ((params: {
          sessionId: string;
          workspaceId: string;
          displayLines: number | undefined;
        }) => string)
      | undefined,
  ): void;
}

/**
 * Listener for raw OpenHands events. The OpenHands adapter is the single
 * subscriber to `AISessionManager.setEventCallback`; platform code attaches
 * listeners through {@link OpenHandsAgentDriver.onRawEvent} so the platform
 * can persist / fan out without bypassing the seam.
 */
export type RawEventListener = (
  sessionId: string,
  conversationId: string,
  rawEvent: RawOpenHandsEvent,
) => void;

/** Listener for session-level thinking-state changes. */
export type ThinkingListener = (sessionId: string, thinking: boolean) => void;

/** Listener for agent action events. */
export type ActionListener = (sessionId: string, action: OHAgentAction) => void;

/**
 * OpenHands' `ConversationExecutionStatus` values, as documented in
 * `docs/openhands-platform.md` § Conversation status. Emitted by the agent
 * server as the `value.execution_status` field of a
 * `ConversationStateUpdateEvent` with `key === 'execution_status'`, and
 * also returned on `GET /api/v1/app-conversations` as a top-level field.
 *
 * The driver maps these onto its provider-neutral `AgentSessionState` —
 * see `mapExecutionStatusToDriverState` and the table in
 * `docs/architecture.md` § Session state mapping. Reading this directly
 * replaces the previous "no message in N minutes → assume stuck" heuristic
 * with the API-native signal (#293).
 */
export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waiting_for_confirmation'
  | 'finished'
  | 'error'
  | 'stuck'
  | 'deleting';

/** Recognised execution status values; used to validate inbound events. */
const EXECUTION_STATUSES: ReadonlySet<ExecutionStatus> = new Set<ExecutionStatus>([
  'idle',
  'running',
  'paused',
  'waiting_for_confirmation',
  'finished',
  'error',
  'stuck',
  'deleting',
]);

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === 'string' && EXECUTION_STATUSES.has(value as ExecutionStatus);
}

/**
 * One in-flight `sendMessage` turn. Events received from `AISessionManager`
 * via the forwarder callbacks are pushed into this queue until a terminal
 * event arrives, at which point the iterable completes.
 */
interface PendingTurn {
  utteranceId: string;
  push: (event: AgentEvent) => void;
  finish: () => void;
  finished: boolean;
}

interface DriverSessionState {
  /** Persisted opts from `openSession`; reused for lazy `getOrCreateForSession`. */
  opts: OpenSessionOpts;
  /** FIFO of in-flight turns for this session. Oldest receives upstream events. */
  pending: PendingTurn[];
  /**
   * Per-`utteranceId` cache of the terminal event for idempotent retries.
   *
   * Bounded by `UTTERANCE_MEMO_LIMIT` to prevent unbounded growth in
   * long-running sessions: when full, the oldest entry (by insertion order)
   * is evicted FIFO. `restartSession` and `closeSession` also clear the map.
   * Repeats of evicted utteranceIds re-send to upstream rather than replay,
   * which matches `AISessionManager`'s existing behaviour for unknown
   * utterances.
   */
  utteranceMemo: Map<string, AgentEvent>;
  thinkingSince: string | null;
  startingSince: string | null;
  /**
   * Most recent `execution_status` reported by the upstream OH server, or
   * `null` if no status event has arrived yet. Drives the primary path in
   * `synthesizeStatus` per the mapping table in `docs/architecture.md`
   * § Session state mapping (#293).
   */
  executionStatus: ExecutionStatus | null;
  /**
   * Error message captured from the most recent `error`/`stuck`
   * execution-status event, surfaced through `AgentSessionStatus.error`.
   * Cleared on the next non-error status event.
   */
  executionError: string | null;
}

/**
 * Maximum number of `utteranceId → terminal AgentEvent` memo entries kept
 * per session. Above this, the oldest entry is evicted FIFO. A few hundred
 * is comfortably above any plausible client retry window while keeping
 * worst-case memory bounded for chatty long-lived sessions.
 */
const UTTERANCE_MEMO_LIMIT = 256;

/**
 * WebSocket `readyState` constants. Mirrors the spec values used by both
 * the browser `WebSocket` and the `ws` package on the server, restated
 * locally so the status machine in `synthesizeStatus` reads as a
 * self-documenting state table without relying on a global.
 */
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * V1 agent-message shape that the adapter recognises off the raw event
 * stream. We narrow with type guards so tests (and production) can pass
 * arbitrary unknown-shaped events without producing spurious yields.
 */
interface RawAgentMessage {
  source: 'agent';
  llm_message: { content: Array<{ type?: string; text?: string }> };
  timestamp?: string;
}

function isRawAgentMessage(raw: RawOpenHandsEvent): raw is RawOpenHandsEvent & RawAgentMessage {
  const candidate = raw as { source?: unknown; llm_message?: { content?: unknown } };
  return (
    candidate.source === 'agent' &&
    typeof candidate.llm_message === 'object' &&
    candidate.llm_message !== null &&
    Array.isArray(candidate.llm_message.content)
  );
}

/**
 * Recognises events that should surface as terminal `error` `AgentEvent`s.
 * The kind set is intentionally narrow; raw events that don't match drop
 * through to the no-op branch.
 */
function isErrorKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return (
    kind === 'ConnectionError' ||
    kind === 'AgentErrorEvent' ||
    kind === 'ErrorEvent' ||
    kind.endsWith('Error') ||
    kind.endsWith('ErrorObservation')
  );
}

function rawEventErrorMessage(raw: RawOpenHandsEvent): string {
  const candidate = raw as { message?: unknown; reason?: unknown; kind?: unknown };
  if (typeof candidate.message === 'string') return candidate.message;
  if (typeof candidate.reason === 'string') return candidate.reason;
  if (typeof candidate.kind === 'string') return candidate.kind;
  return 'agent error';
}

/**
 * Shape of the upstream `ConversationStateUpdateEvent` with
 * `key === 'execution_status'`. The agent server emits this on the
 * WebSocket every time the conversation's execution status transitions
 * (e.g. user message → `running`, agent turn done → `idle`).
 */
interface RawExecutionStatusEvent {
  kind: 'ConversationStateUpdateEvent';
  key: 'execution_status';
  value: { execution_status?: unknown; error?: unknown; reason?: unknown; message?: unknown };
  timestamp?: string;
}

function isExecutionStatusEvent(raw: RawOpenHandsEvent): raw is RawOpenHandsEvent & RawExecutionStatusEvent {
  const candidate = raw as { kind?: unknown; key?: unknown; value?: unknown };
  return (
    candidate.kind === 'ConversationStateUpdateEvent' &&
    candidate.key === 'execution_status' &&
    typeof candidate.value === 'object' &&
    candidate.value !== null
  );
}

/**
 * Extract a human-readable error message from the `value` payload of an
 * `execution_status: error` event. The upstream platform isn't strict
 * about which field carries the detail — we accept any of `error`,
 * `message`, or `reason`. Returns `null` when none are present so the
 * caller can substitute a default.
 */
function extractExecutionError(value: RawExecutionStatusEvent['value']): string | null {
  if (typeof value.error === 'string' && value.error.length > 0) return value.error;
  if (typeof value.message === 'string' && value.message.length > 0) return value.message;
  if (typeof value.reason === 'string' && value.reason.length > 0) return value.reason;
  return null;
}

/**
 * Mapping table from upstream `ConversationExecutionStatus` to the driver's
 * provider-neutral `AgentSessionState`. Mirrors the table in
 * `docs/architecture.md` § Session state mapping verbatim.
 *
 * `null` means "no opinion" — the caller should fall back to the legacy
 * ws/`isThinking` heuristic. We do not use that branch today (every
 * defined `ExecutionStatus` maps to a concrete state), but the function
 * shape leaves room for future statuses without a runtime crash.
 */
function mapExecutionStatusToDriverState(status: ExecutionStatus): AgentSessionState {
  switch (status) {
    case 'idle':
    case 'finished':
    case 'paused':
    case 'waiting_for_confirmation':
      return 'ready';
    case 'running':
      return 'thinking';
    case 'stuck':
    case 'error':
      return 'degraded';
    case 'deleting':
      return 'absent';
  }
}

/**
 * Map an OH `AgentAction` (`{id, timestamp, kind, source, summary, ...}`) onto
 * the provider-neutral `AgentAction` `{tool, args, toolCallId, observation?}`.
 *
 * The `kind` becomes `tool`; everything else lands inside `args` so callers
 * that need provider-specific fields can still retrieve them.
 */
function adaptAction(ohAction: OHAgentAction): AgentAction {
  // Project everything except `id` into args so the toolCallId isn't duplicated.
  const { id, ...rest } = ohAction;
  const args: Record<string, unknown> = { ...rest };
  return {
    tool: ohAction.kind,
    args,
    toolCallId: id,
  };
}

/**
 * Result of a binding attempt. Either the upstream session is bound and
 * subsequent `sendSessionMessage` calls are safe, or upstream rejected and
 * the caller should surface a terminal `error` `AgentEvent`.
 */
type BindResult = { kind: 'ok' } | { kind: 'error'; event: AgentEvent };

export class OpenHandsAgentDriver implements AgentDriver {
  private readonly states = new Map<string, DriverSessionState>();
  private readonly rawEventListeners = new Set<RawEventListener>();
  private readonly thinkingListeners = new Set<ThinkingListener>();
  private readonly actionListeners = new Set<ActionListener>();
  /**
   * In-flight upstream conversation-start promises keyed by `sessionId` so
   * concurrent `openSession` / `sendMessage` / `restartSession` callers
   * single-flight the underlying `getOrCreateForSession` call (#292).
   *
   * Two devices joining the same Voice Relay session within a few ms of
   * each other used to race here and create two orphaned upstream
   * conversations — the binding the late writer set was paid for but
   * never used. With this guard, every concurrent caller awaits the
   * same promise and shares its resolved binding.
   *
   * The promise self-deletes on settle (success OR rejection), so a
   * failed start does not poison the slot — a retry starts a fresh
   * attempt. Pattern mirrors `AISessionManager.inFlightRefresh` (#291).
   */
  private readonly inFlightStart = new Map<string, Promise<BindResult>>();

  constructor(private readonly mgr: AISessionManagerSurface) {
    this.mgr.setThinkingChangeCallback((sessionId, thinking) => {
      this.onThinking(sessionId, thinking);
      for (const listener of this.thinkingListeners) {
        try {
          listener(sessionId, thinking);
        } catch (err) {
          console.error('[AgentDriver] thinking listener threw:', err);
        }
      }
    });
    this.mgr.setActionCallback((sessionId, action) => {
      this.onAction(sessionId, action);
      for (const listener of this.actionListeners) {
        try {
          listener(sessionId, action);
        } catch (err) {
          console.error('[AgentDriver] action listener threw:', err);
        }
      }
    });
    this.mgr.setEventCallback((sessionId, conversationId, rawEvent) => {
      this.onEvent(sessionId, rawEvent);
      for (const listener of this.rawEventListeners) {
        try {
          listener(sessionId, conversationId, rawEvent);
        } catch (err) {
          console.error('[AgentDriver] raw event listener threw:', err);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // AgentDriver implementation
  // ---------------------------------------------------------------------------

  isAvailable(): boolean {
    return this.mgr.isAvailable();
  }

  hasSession(sessionId: string): boolean {
    return this.mgr.hasSessionAI(sessionId);
  }

  async openSession(sessionId: string, opts: OpenSessionOpts): Promise<AgentSessionStatus> {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        opts,
        pending: [],
        utteranceMemo: new Map(),
        thinkingSince: null,
        startingSince: null,
        executionStatus: null,
        executionError: null,
      };
      this.states.set(sessionId, state);
    } else {
      // Refresh opts on every call so subsequent callers (e.g. the #348/#358
      // fresh-create fallback that clears `existingConversationId` after an
      // attach failure, or any future retry-with-different-opts path) can
      // update the cached opts between calls. Prior to issue #362 the new
      // `opts` argument was silently dropped on the else branch, so retries
      // re-attached to the stale conversation id forever — the exact pattern
      // that caused the 2026-05-29 01:38Z incident behind #357. The upstream
      // bind itself is still single-flight + idempotent via
      // `mgr.hasSessionAI` / `lazyBindSession`; refreshing opts only affects
      // the *next* bind (e.g. via `restartSession` or `runTurn` lazy-open).
      state.opts = opts;
    }
    // Eagerly provision the upstream OpenHands session. This preserves the
    // legacy `aiSessionManager.getOrCreateForSession` semantics that the
    // platform's auto-connect path depends on (it reads `conversationId`
    // from the returned status to persist `session.metadata.aiConversationId`
    // and broadcast `session-ai-status`).
    //
    // Idempotent because `AISessionManager.getOrCreateForSession` returns the
    // existing binding when one is already present, and `mgr.hasSessionAI`
    // short-circuits the second call so we don't pay for a redundant lookup.
    if (!this.mgr.hasSessionAI(sessionId)) {
      const bind = await this.lazyBindSession(sessionId, state);
      if (bind.kind === 'error') {
        // Surface the error to the caller so the auto-connect path can
        // broadcast a connection-failed status. Same shape as the legacy
        // `getOrCreateForSession` rejection.
        const msg = bind.event.kind === 'error' ? bind.event.message : 'failed to open agent session';
        throw new Error(msg);
      }
    }
    return this.synthesizeStatus(sessionId);
  }

  sendMessage(
    sessionId: string,
    utteranceId: string,
    text: string,
    sender?: AgentSenderMeta,
  ): AsyncIterable<AgentEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        return self.runTurn(sessionId, utteranceId, text, sender);
      },
    };
  }

  async restartSession(sessionId: string): Promise<AgentSessionStatus> {
    const state = this.ensureState(sessionId);
    await this.mgr.endSessionAI(sessionId);
    // Drain any in-flight turns with a recoverable error.
    this.failPending(state, 'session restarted', true);
    state.utteranceMemo.clear();
    state.thinkingSince = null;
    state.executionStatus = null;
    state.executionError = null;
    // Use the single-flight slot so a concurrent `sendMessage` arriving
    // between `endSessionAI` and the new bind does not race a parallel
    // upstream conversation-start (#292). Throws on bind failure so the
    // caller (and any concurrent awaiter) sees the same rejection,
    // matching the legacy `getOrCreateForSession` contract.
    const bind = await this.lazyBindSession(sessionId, state);
    if (bind.kind === 'error') {
      const msg =
        bind.event.kind === 'error' ? bind.event.message : 'failed to restart agent session';
      throw new Error(msg);
    }
    return this.synthesizeStatus(sessionId);
  }

  async getSessionStatus(sessionId: string): Promise<AgentSessionStatus> {
    return this.synthesizeStatus(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    // Always delegate so callers that closed without first opening still
    // free upstream resources. `endSessionAI` is itself idempotent.
    await this.mgr.endSessionAI(sessionId);
    const state = this.states.get(sessionId);
    if (state) {
      this.failPending(state, 'session closed', false);
      this.states.delete(sessionId);
    }
  }

  // ---------------------------------------------------------------------------
  // Platform fan-out hooks (not part of `AgentDriver` interface)
  //
  // Platform code that needs to react to upstream signals (e.g. broadcasting
  // `ai-thinking` to devices, persisting raw events to `agent_events`) subscribes
  // through these helpers rather than calling `aiSessionManager.setXxxCallback`
  // directly. The adapter is the sole subscriber to those callbacks and
  // fan-outs to all registered listeners — see the constructor.
  // ---------------------------------------------------------------------------

  /** Subscribe to thinking-state changes. Returns an unsubscribe function. */
  onThinkingChange(listener: ThinkingListener): () => void {
    this.thinkingListeners.add(listener);
    return () => {
      this.thinkingListeners.delete(listener);
    };
  }

  /** Subscribe to agent action events. Returns an unsubscribe function. */
  onActionEvent(listener: ActionListener): () => void {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  }

  /**
   * Subscribe to raw upstream events. The platform's agent-events
   * persistence path uses this to write the `agent_events` table without
   * importing `AISessionManager` directly.
   *
   * Returns an unsubscribe function.
   */
  onRawEvent(listener: RawEventListener): () => void {
    this.rawEventListeners.add(listener);
    return () => {
      this.rawEventListeners.delete(listener);
    };
  }

  /**
   * Process-level shutdown. Tears down every upstream session via the
   * underlying manager. Idempotent.
   */
  async shutdown(): Promise<void> {
    await this.mgr.shutdown();
    for (const state of this.states.values()) {
      this.failPending(state, 'driver shutting down', false);
    }
    this.states.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private ensureState(sessionId: string): DriverSessionState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        // No prior `openSession`: use sessionId as fallback workspaceId so
        // lazy-open still has a non-empty value. Real callers should always
        // call `openSession` first, but `sendMessage` auto-opens per the
        // interface contract.
        opts: { workspaceId: sessionId },
        pending: [],
        utteranceMemo: new Map(),
        thinkingSince: null,
        startingSince: null,
        executionStatus: null,
        executionError: null,
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /**
   * Insert a terminal event into the per-session memo, evicting the oldest
   * entry FIFO when the map is at capacity. Maps preserve insertion order
   * in JS, so `keys().next().value` is the oldest key.
   */
  private memoize(state: DriverSessionState, utteranceId: string, event: AgentEvent): void {
    if (state.utteranceMemo.has(utteranceId)) {
      // Refresh insertion order so repeats stay "warm" against eviction.
      state.utteranceMemo.delete(utteranceId);
    } else if (state.utteranceMemo.size >= UTTERANCE_MEMO_LIMIT) {
      const oldest = state.utteranceMemo.keys().next().value;
      if (oldest !== undefined) state.utteranceMemo.delete(oldest);
    }
    state.utteranceMemo.set(utteranceId, event);
  }

  private failPending(state: DriverSessionState, message: string, recoverable: boolean): void {
    for (const turn of state.pending) {
      if (turn.finished) continue;
      turn.push({ kind: 'error', message, recoverable });
      turn.finish();
    }
    state.pending.length = 0;
  }

  /**
   * Lazily bind an `AISessionManager` session for this driver session.
   *
   * Single-flight on `sessionId`: if a start is already in flight for this
   * session, the caller awaits the existing promise rather than racing on
   * a fresh upstream conversation-start (#292). Concurrent callers see the
   * same `BindResult` — including the same error event on failure — and a
   * `.finally` clears the slot so subsequent retries are not blocked.
   *
   * Translates thrown errors into a terminal `AgentEvent`; the caller is
   * responsible for memoizing/yielding it. Pattern mirrors
   * `AISessionManager.inFlightRefresh` from #291.
   */
  private lazyBindSession(
    sessionId: string,
    state: DriverSessionState,
  ): Promise<BindResult> {
    const existing = this.inFlightStart.get(sessionId);
    if (existing) return existing;

    const work = this.doBindSession(sessionId, state).finally(() => {
      this.inFlightStart.delete(sessionId);
    });
    this.inFlightStart.set(sessionId, work);
    return work;
  }

  /**
   * Actual upstream bind. Holds `state.startingSince` for the duration so
   * `synthesizeStatus` reports `starting` for concurrent observers, and
   * translates rejections into a terminal `error` `AgentEvent`.
   */
  private async doBindSession(
    sessionId: string,
    state: DriverSessionState,
  ): Promise<BindResult> {
    state.startingSince = nowIso();
    try {
      await this.mgr.getOrCreateForSession(
        sessionId,
        state.opts.workspaceId,
        () => {
          // Messages flow via the event-callback path; nothing to do here.
        },
        {
          displayLines: state.opts.displayLines,
          apiKey: state.opts.apiKey,
          displayApiSecret: state.opts.displayApiSecret,
          // Plumb the attach-to-existing hint through (#341). The manager
          // routes this through `attachExistingForSession` and skips the
          // `POST /app-conversations` create step.
          existingConversationId: state.opts.existingConversationId,
        },
      );
      return { kind: 'ok' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', event: { kind: 'error', message, recoverable: false } };
    } finally {
      state.startingSince = null;
    }
  }

  private async *runTurn(
    sessionId: string,
    utteranceId: string,
    text: string,
    sender?: AgentSenderMeta,
  ): AsyncGenerator<AgentEvent> {
    const state = this.ensureState(sessionId);

    // Idempotency: replay cached terminal event when utteranceId is repeated.
    const cached = state.utteranceMemo.get(utteranceId);
    if (cached) {
      yield cached;
      return;
    }

    const queue: AgentEvent[] = [];
    let pendingResolve:
      | ((v: IteratorResult<AgentEvent>) => void)
      | null = null;
    let finished = false;
    let terminal: AgentEvent | null = null;

    const turn: PendingTurn = {
      utteranceId,
      push: (event) => {
        if (finished) return;
        if (event.kind === 'message' || event.kind === 'error') {
          terminal = event;
        }
        if (pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          resolve({ value: event, done: false });
        } else {
          queue.push(event);
        }
      },
      finish: () => {
        if (finished) return;
        finished = true;
        if (pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          resolve({ value: undefined, done: true });
        }
      },
      finished: false,
    };
    state.pending.push(turn);

    try {
      // Lazy bind. `getOrCreateForSession` returns the existing AI session
      // when one is already running, so this is cheap on the hot path.
      if (this.mgr.getSessionAI(sessionId) === undefined) {
        const bind = await this.lazyBindSession(sessionId, state);
        if (bind.kind === 'error') {
          this.memoize(state, utteranceId, bind.event);
          yield bind.event;
          return;
        }
      }

      try {
        await this.mgr.sendSessionMessage(sessionId, text, sender);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errEvent: AgentEvent = { kind: 'error', message, recoverable: false };
        this.memoize(state, utteranceId, errEvent);
        yield errEvent;
        return;
      }

      while (true) {
        if (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
          if (event.kind === 'message' || event.kind === 'error') {
            this.memoize(state, utteranceId, event);
            return;
          }
          continue;
        }
        if (finished) {
          if (terminal) {
            this.memoize(state, utteranceId, terminal);
          }
          return;
        }
        const next = await new Promise<IteratorResult<AgentEvent>>((resolve) => {
          pendingResolve = resolve;
        });
        if (next.done) {
          if (terminal) {
            this.memoize(state, utteranceId, terminal);
          }
          return;
        }
        yield next.value;
        if (next.value.kind === 'message' || next.value.kind === 'error') {
          this.memoize(state, utteranceId, next.value);
          return;
        }
      }
    } finally {
      finished = true;
      const idx = state.pending.indexOf(turn);
      if (idx >= 0) state.pending.splice(idx, 1);
    }
  }

  private onThinking(sessionId: string, thinking: boolean): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    state.thinkingSince = thinking ? nowIso() : null;
    const turn = state.pending[0];
    if (turn) {
      turn.push({ kind: 'status', status: this.synthesizeStatus(sessionId) });
    }
  }

  private onAction(sessionId: string, action: OHAgentAction): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    const turn = state.pending[0];
    if (!turn) return;
    turn.push({ kind: 'action', action: adaptAction(action) });
  }

  private onEvent(sessionId: string, raw: RawOpenHandsEvent): void {
    // ConversationStateUpdateEvent → drive the session-state machine (#293).
    // Handled *before* the orphan check (`states.get` could be absent for a
    // valid open binding when the platform calls `closeSession` mid-stream,
    // and the existing pending-turn check) so a status arriving outside an
    // in-flight `sendMessage` (e.g. an idle → running transition triggered
    // by something other than our own send) still updates the snapshot.
    if (isExecutionStatusEvent(raw)) {
      this.onExecutionStatusEvent(sessionId, raw);
      return;
    }

    const state = this.states.get(sessionId);
    if (!state) return;
    const turn = state.pending[0];
    if (!turn) return;

    // Agent message → terminal `message` event.
    if (isRawAgentMessage(raw)) {
      const text = raw.llm_message.content
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('\n');
      if (text) {
        const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : undefined;
        const event: AgentEvent =
          timestamp !== undefined
            ? { kind: 'message', text, serverTimestamp: timestamp }
            : { kind: 'message', text };
        turn.push(event);
        turn.finish();
      }
      return;
    }

    // Error kind → terminal `error` event. Recoverability is heuristic:
    // ConnectionError-style events are recoverable; everything else is not.
    if (typeof raw.kind === 'string' && isErrorKind(raw.kind)) {
      const recoverable = raw.kind === 'ConnectionError';
      turn.push({ kind: 'error', message: rawEventErrorMessage(raw), recoverable });
      turn.finish();
      return;
    }

    // Other event kinds are not surfaced as AgentEvents — they continue to
    // flow through whatever persistence/broadcast paths the platform has
    // wired on `AISessionManager` today.
  }

  /**
   * Apply an inbound `ConversationStateUpdateEvent(key='execution_status')`
   * to the driver's session-state machine. Implements the mapping table
   * documented in `docs/architecture.md` § Session state mapping (#293).
   *
   * Behavior:
   * - Unknown `execution_status` values (e.g. a future upstream addition)
   *   are logged and ignored — we never invent a state for an unrecognised
   *   value.
   * - Events for sessions the driver has no record of are logged once and
   *   dropped (the platform may have torn down the local state but the
   *   upstream still emits trailing events).
   * - Consecutive events with the same status (and same error payload, if
   *   any) are deduplicated — no listener re-fire, no extra status event
   *   pushed into an in-flight turn.
   * - `running` → `thinking` sets `thinkingSince` to the event's `timestamp`
   *   (or current time as a fallback) only on the *entry* into running.
   *   Subsequent `running` events while already running are ignored by the
   *   dedupe path above and therefore do not reset `thinkingSince`.
   * - Any non-`running` status clears `thinkingSince` and fires
   *   `thinking=false` to subscribed `thinkingListeners` (regardless of
   *   whether the turn emitted a user-facing message — fixes the
   *   tool-only-turn case from the issue).
   */
  private onExecutionStatusEvent(sessionId: string, raw: RawExecutionStatusEvent): void {
    const rawStatus = raw.value.execution_status;
    if (!isExecutionStatus(rawStatus)) {
      console.warn(
        `[AgentDriver] ignoring execution_status event with unknown value: ${JSON.stringify(rawStatus)}`,
      );
      return;
    }

    const state = this.states.get(sessionId);
    if (!state) {
      console.warn(
        `[AgentDriver] orphan execution_status event for unknown sessionId=${sessionId} (status=${rawStatus})`,
      );
      return;
    }

    // Errors carry an optional payload; `null` means "use a default
    // user-visible message at synthesizeStatus time".
    const newError =
      rawStatus === 'error' || rawStatus === 'stuck' ? extractExecutionError(raw.value) : null;

    // Dedupe consecutive identical events. Same status + same error
    // payload means nothing has changed; skipping avoids redundant
    // broadcast and stops `thinkingSince` resetting on `running → running`
    // (the issue calls this out explicitly).
    if (state.executionStatus === rawStatus && state.executionError === newError) {
      return;
    }

    const prevStatus = state.executionStatus;
    state.executionStatus = rawStatus;
    state.executionError = newError;

    // Maintain `thinkingSince` on the running entry/exit transitions.
    if (rawStatus === 'running' && prevStatus !== 'running') {
      state.thinkingSince =
        typeof raw.timestamp === 'string' && raw.timestamp.length > 0 ? raw.timestamp : nowIso();
    } else if (rawStatus !== 'running' && prevStatus === 'running') {
      state.thinkingSince = null;
    }

    // Fan out a thinking-change to subscribed listeners on the transition.
    // This is what flips the 🤔 indicator off when a tool-only turn ends —
    // `AISessionManager.isThinking` only flips on agent *message* arrival
    // today, so without this the indicator would stick on indefinitely
    // (#293 problem statement).
    const wasRunning = prevStatus === 'running';
    const isRunning = rawStatus === 'running';
    if (isRunning !== wasRunning) {
      for (const listener of this.thinkingListeners) {
        try {
          listener(sessionId, isRunning);
        } catch (err) {
          console.error('[AgentDriver] thinking listener threw:', err);
        }
      }
    }

    // Emit an intermediate `status` AgentEvent so any in-flight
    // `sendMessage` turn surfaces the transition to its consumer.
    const turn = state.pending[0];
    if (turn) {
      turn.push({ kind: 'status', status: this.synthesizeStatus(sessionId) });
    }
  }

  private synthesizeStatus(sessionId: string): AgentSessionStatus {
    const state = this.states.get(sessionId);
    const ai = this.mgr.getSessionAI(sessionId);
    if (!state && !ai) {
      return {
        sessionId,
        state: 'absent',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      };
    }

    let agentState: AgentSessionState;
    let conversationId: string | null = null;
    let error: string | null = null;
    const thinkingSince = state?.thinkingSince ?? null;
    const startingSince = state?.startingSince ?? null;

    if (ai) {
      conversationId = ai.conversationId;
      // Precedence (per `docs/architecture.md` § Session state mapping —
      // "adapter > upstream > default"):
      //
      //   1. Adapter overrides — in-flight rebind, MISSING-sandbox
      //      recovery, ws torn down. These describe states the upstream
      //      cannot know about, so they take priority.
      //   2. Upstream `execution_status` — the primary signal from #293.
      //   3. Default — legacy ws/`isThinking` heuristic, used until the
      //      first `execution_status` event arrives.
      const wsState = ai.ws?.readyState;
      const wsTornDown = wsState === WS_CLOSING || wsState === WS_CLOSED;

      if (ai.rebinding) {
        // Adapter-level override (from #296): the manager has detected
        // MISSING and is mid-flight attempting a rebind onto a fresh
        // sandbox. We report `reconnecting` (not `degraded`) so the
        // kiosk shows a reconnecting indicator rather than the more
        // alarming "agent unavailable" prompt. If the rebind fails the
        // manager flips `ai.degraded`, which is checked next.
        agentState = 'reconnecting';
      } else if (ai.degraded) {
        // Adapter-level override (from #291/#323/#296): the reconnect
        // loop gave up — sandbox MISSING with rebind exhausted, or
        // refresh-credentials retries exhausted. The user-visible
        // recovery path lives in #294/#296. This wins over upstream
        // execution_status because the upstream wire may still be
        // emitting trailing events on the way out.
        agentState = 'degraded';
        error = ai.degradedReason ?? 'Agent runtime no longer available';
      } else if (wsTornDown) {
        // Adapter-level override: the upstream wire is gone but the
        // reconnect loop hasn't given up yet — `AISessionManager` will
        // auto-reconnect. Stale `running`/`idle` events sitting in the
        // buffer must not override this.
        agentState = 'reconnecting';
      } else if (state?.executionStatus !== null && state?.executionStatus !== undefined) {
        // Upstream `execution_status` — the primary signal from #293.
        agentState = mapExecutionStatusToDriverState(state.executionStatus);
        if (agentState === 'degraded') {
          error =
            state.executionError ??
            (state.executionStatus === 'stuck'
              ? 'Agent appears stuck — try restarting the session.'
              : 'Agent reported an error.');
        }
      } else if (ai.isThinking) {
        // Legacy fallback (used until the first execution_status event
        // arrives) — derived from `AISessionManager.isThinking`, which
        // flips on send and off on agent-message receipt.
        agentState = 'thinking';
      } else if (wsState === WS_OPEN) {
        agentState = 'ready';
      } else {
        // wsState === WS_CONNECTING || undefined
        agentState = 'starting';
      }
    } else if (state?.startingSince !== null && state?.startingSince !== undefined) {
      agentState = 'starting';
    } else {
      agentState = 'absent';
    }

    return {
      sessionId,
      state: agentState,
      conversationId,
      error,
      thinkingSince,
      startingSince,
    };
  }
}
