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
  AISessionManager,
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
  setThinkingChangeCallback(cb: ThinkingChangeCallback | undefined): void;
  setActionCallback(cb: ActionCallback | undefined): void;
  setEventCallback(cb: EventCallback | undefined): void;
  getSessionAI(sessionId: string): AISession | undefined;
  getOrCreateForSession(
    sessionId: string,
    workspaceId: string,
    onMessage: (message: string, serverTimestamp?: string) => void,
    options?: { displayLines?: number; apiKey?: string; displayApiSecret?: string },
  ): Promise<AISession>;
  sendSessionMessage(sessionId: string, message: string): Promise<void>;
  endSessionAI(sessionId: string): Promise<void>;
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
  /** Per-`utteranceId` cache of the terminal event for idempotent retries. */
  utteranceMemo: Map<string, AgentEvent>;
  thinkingSince: string | null;
  startingSince: string | null;
}

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

export class OpenHandsAgentDriver implements AgentDriver {
  private readonly states = new Map<string, DriverSessionState>();

  constructor(private readonly mgr: AISessionManagerSurface) {
    this.mgr.setThinkingChangeCallback((sessionId, thinking) => {
      this.onThinking(sessionId, thinking);
    });
    this.mgr.setActionCallback((sessionId, action) => {
      this.onAction(sessionId, action);
    });
    this.mgr.setEventCallback((sessionId, _conversationId, rawEvent) => {
      this.onEvent(sessionId, rawEvent);
    });
  }

  // ---------------------------------------------------------------------------
  // AgentDriver implementation
  // ---------------------------------------------------------------------------

  async openSession(sessionId: string, opts: OpenSessionOpts): Promise<AgentSessionStatus> {
    const existing = this.states.get(sessionId);
    if (!existing) {
      this.states.set(sessionId, {
        opts,
        pending: [],
        utteranceMemo: new Map(),
        thinkingSince: null,
        startingSince: null,
      });
    }
    // Idempotent: re-opening does not reset upstream state or memo.
    return this.synthesizeStatus(sessionId);
  }

  sendMessage(sessionId: string, utteranceId: string, text: string): AsyncIterable<AgentEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        return self.runTurn(sessionId, utteranceId, text);
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
        },
      );
    } finally {
      state.startingSince = null;
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
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  private failPending(state: DriverSessionState, message: string, recoverable: boolean): void {
    for (const turn of state.pending) {
      if (turn.finished) continue;
      turn.push({ kind: 'error', message, recoverable });
      turn.finish();
    }
    state.pending.length = 0;
  }

  private async *runTurn(
    sessionId: string,
    utteranceId: string,
    text: string,
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
      const hadBinding = this.mgr.getSessionAI(sessionId) !== undefined;
      if (!hadBinding) {
        state.startingSince = nowIso();
        try {
          await this.mgr.getOrCreateForSession(
            sessionId,
            state.opts.workspaceId,
            () => {
              // Messages flow via the event-callback path.
            },
            {
              displayLines: state.opts.displayLines,
              apiKey: state.opts.apiKey,
              displayApiSecret: state.opts.displayApiSecret,
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errEvent: AgentEvent = { kind: 'error', message, recoverable: false };
          state.utteranceMemo.set(utteranceId, errEvent);
          yield errEvent;
          return;
        } finally {
          state.startingSince = null;
        }
      }

      try {
        await this.mgr.sendSessionMessage(sessionId, text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errEvent: AgentEvent = { kind: 'error', message, recoverable: false };
        state.utteranceMemo.set(utteranceId, errEvent);
        yield errEvent;
        return;
      }

      while (true) {
        if (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
          if (event.kind === 'message' || event.kind === 'error') {
            state.utteranceMemo.set(utteranceId, event);
            return;
          }
          continue;
        }
        if (finished) {
          if (terminal) {
            state.utteranceMemo.set(utteranceId, terminal);
          }
          return;
        }
        const next = await new Promise<IteratorResult<AgentEvent>>((resolve) => {
          pendingResolve = resolve;
        });
        if (next.done) {
          if (terminal) {
            state.utteranceMemo.set(utteranceId, terminal);
          }
          return;
        }
        yield next.value;
        if (next.value.kind === 'message' || next.value.kind === 'error') {
          state.utteranceMemo.set(utteranceId, next.value);
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
    const thinkingSince = state?.thinkingSince ?? null;
    const startingSince = state?.startingSince ?? null;

    if (ai) {
      conversationId = ai.conversationId;
      const wsState = ai.ws?.readyState;
      if (ai.isThinking) {
        agentState = 'thinking';
      } else if (wsState === 1 /* WebSocket.OPEN */) {
        agentState = 'ready';
      } else if (wsState === 0 /* WebSocket.CONNECTING */ || wsState === undefined) {
        agentState = 'starting';
      } else {
        // CLOSING (2) or CLOSED (3) — `AISessionManager` will auto-reconnect.
        agentState = 'reconnecting';
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
      error: null,
      thinkingSince,
      startingSince,
    };
  }
}
