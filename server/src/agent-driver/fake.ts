/**
 * FakeDriver — an in-memory `AgentDriver` implementation for unit and
 * integration tests. Knows nothing about any specific AI provider.
 *
 * Tests configure behavior by `script()`-ing per-`sessionId` event sequences
 * (or using the `simulate*` helpers), then exercising the driver methods and
 * asserting on the emitted `AgentEvent`s and on `getSessionStatus`.
 */

import type {
  AgentDriver,
  AgentEvent,
  AgentSenderMeta,
  AgentSessionState,
  AgentSessionStatus,
  OpenSessionOpts,
} from './types.js';

/**
 * One entry in a scripted `sendMessage` response. Either a literal event to
 * yield, or a control directive that synthesizes events / mutates state.
 */
export type ScriptEntry =
  | AgentEvent
  | { control: 'delay'; ms: number }
  | { control: 'simulateMissing' }
  | { control: 'simulateStuck' }
  | { control: 'simulateError'; code: string };

interface FakeSession {
  state: AgentSessionState;
  conversationId: string | null;
  error: string | null;
  thinkingSince: string | null;
  startingSince: string | null;
  startupPhase?: string;
  workspaceId: string;
  /** FIFO queue: one entry per future `sendMessage` invocation. */
  scripts: ScriptEntry[][];
  /** Idempotency cache: utteranceId → terminal event (`message`, `error`, or `status`). */
  utteranceMemo: Map<string, AgentEvent>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class FakeDriver implements AgentDriver {
  private readonly sessions = new Map<string, FakeSession>();
  /** Monotonic counter used to fabricate fake conversation ids. */
  private conversationCounter = 0;

  // ---------------------------------------------------------------------------
  // AgentDriver implementation
  // ---------------------------------------------------------------------------

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async openSession(sessionId: string, opts: OpenSessionOpts): Promise<AgentSessionStatus> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      // Idempotent: do not reset state on re-open.
      return this.toStatus(sessionId, existing);
    }
    const session: FakeSession = {
      state: 'ready',
      conversationId: `fake-conv-${++this.conversationCounter}`,
      error: null,
      thinkingSince: null,
      startingSince: null,
      workspaceId: opts.workspaceId,
      scripts: [],
      utteranceMemo: new Map(),
    };
    this.sessions.set(sessionId, session);
    return this.toStatus(sessionId, session);
  }

  /**
   * `_sender` is accepted to honour the {@link AgentDriver} contract
   * (#375) but intentionally ignored: the fake's job is to script
   * responses, not compose headers. Tests that need to assert sender
   * propagation should use a wrapper or the real `OpenHandsAgentDriver`.
   */
  sendMessage(
    sessionId: string,
    utteranceId: string,
    _text: string,
    _sender?: AgentSenderMeta,
  ): AsyncIterable<AgentEvent> {
    // Snapshot the driver so the iterable is tied to this call.
    const driver = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        return driver.runSendMessage(sessionId, utteranceId);
      },
    };
  }

  async restartSession(sessionId: string): Promise<AgentSessionStatus> {
    const session = this.ensureSession(sessionId, 'restart-workspace');
    session.state = 'starting';
    session.error = null;
    session.thinkingSince = null;
    session.startingSince = nowIso();
    session.utteranceMemo.clear();
    session.scripts.length = 0;
    // Simulate immediate readiness — tests can assert via status post-await.
    session.state = 'ready';
    session.startingSince = null;
    session.conversationId = `fake-conv-${++this.conversationCounter}`;
    return this.toStatus(sessionId, session);
  }

  async getSessionStatus(sessionId: string): Promise<AgentSessionStatus> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        sessionId,
        state: 'absent',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      };
    }
    return this.toStatus(sessionId, session);
  }

  async closeSession(sessionId: string): Promise<void> {
    // Idempotent: deleting a missing key is a no-op.
    this.sessions.delete(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /** Queue an event sequence to be yielded by the next `sendMessage` call. */
  script(sessionId: string, entries: ScriptEntry[]): void {
    const session = this.ensureSession(sessionId, 'scripted-workspace');
    session.scripts.push([...entries]);
  }

  /** Mark the next `sendMessage` as a transient connectivity failure. */
  simulateMissing(sessionId: string): void {
    this.script(sessionId, [{ control: 'simulateMissing' }]);
  }

  /** Mark the session as stuck/degraded immediately. */
  simulateStuck(sessionId: string): void {
    const session = this.ensureSession(sessionId, 'stuck-workspace');
    session.state = 'degraded';
    session.error = 'stuck';
    session.thinkingSince = null;
    session.startingSince = null;
  }

  /** Mark the next `sendMessage` as an unrecoverable error with `code`. */
  simulateError(sessionId: string, code: string): void {
    this.script(sessionId, [{ control: 'simulateError', code }]);
  }

  /** Wipe all per-driver state. Useful between test cases. */
  reset(): void {
    this.sessions.clear();
    this.conversationCounter = 0;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private ensureSession(sessionId: string, fallbackWorkspaceId: string): FakeSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        state: 'ready',
        conversationId: `fake-conv-${++this.conversationCounter}`,
        error: null,
        thinkingSince: null,
        startingSince: null,
        workspaceId: fallbackWorkspaceId,
        scripts: [],
        utteranceMemo: new Map(),
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private toStatus(sessionId: string, session: FakeSession): AgentSessionStatus {
    const status: AgentSessionStatus = {
      sessionId,
      state: session.state,
      conversationId: session.conversationId,
      error: session.error,
      thinkingSince: session.thinkingSince,
      startingSince: session.startingSince,
    };
    if (session.startupPhase !== undefined) {
      status.startupPhase = session.startupPhase;
    }
    return status;
  }

  private async *runSendMessage(
    sessionId: string,
    utteranceId: string,
  ): AsyncGenerator<AgentEvent> {
    // Idempotency: replay cached terminal event.
    const existing = this.sessions.get(sessionId);
    const cached = existing?.utteranceMemo.get(utteranceId);
    if (cached) {
      yield cached;
      return;
    }

    // Auto-open if the session was never registered.
    const session = this.ensureSession(sessionId, 'auto-open-workspace');
    const script = session.scripts.shift() ?? [{ kind: 'message', text: 'OK' } as AgentEvent];

    // Inspect script for terminal control entries that change pre-thinking flow.
    const firstControl = findFirstControl(script);
    if (firstControl?.control === 'simulateMissing') {
      session.state = 'reconnecting';
      const statusEvent: AgentEvent = { kind: 'status', status: this.toStatus(sessionId, session) };
      yield statusEvent;
      const errorEvent: AgentEvent = {
        kind: 'error',
        message: 'connection lost',
        recoverable: true,
      };
      session.utteranceMemo.set(utteranceId, errorEvent);
      yield errorEvent;
      return;
    }
    if (firstControl?.control === 'simulateStuck') {
      session.state = 'degraded';
      session.error = 'stuck';
      const statusEvent: AgentEvent = { kind: 'status', status: this.toStatus(sessionId, session) };
      yield statusEvent;
      session.utteranceMemo.set(utteranceId, statusEvent);
      return;
    }
    if (firstControl?.control === 'simulateError') {
      session.state = 'degraded';
      session.error = firstControl.code;
      const errorEvent: AgentEvent = {
        kind: 'error',
        message: firstControl.code,
        recoverable: false,
      };
      session.utteranceMemo.set(utteranceId, errorEvent);
      yield errorEvent;
      return;
    }

    // Happy path: transition ready → thinking, run script, transition back to ready.
    session.state = 'thinking';
    session.thinkingSince = nowIso();
    yield { kind: 'status', status: this.toStatus(sessionId, session) };

    let terminal: AgentEvent | null = null;
    for (const entry of script) {
      if (isControlEntry(entry)) {
        if (entry.control === 'delay') {
          await new Promise<void>((resolve) => setTimeout(resolve, entry.ms));
        }
        // Other control entries are handled pre-loop; no-op here for safety.
        continue;
      }
      yield entry;
      if (entry.kind === 'message' || entry.kind === 'error') {
        terminal = entry;
        break;
      }
    }

    if (!terminal) {
      terminal = { kind: 'message', text: 'OK' };
      yield terminal;
    }

    session.state = 'ready';
    session.thinkingSince = null;
    yield { kind: 'status', status: this.toStatus(sessionId, session) };
    session.utteranceMemo.set(utteranceId, terminal);
  }
}

function isControlEntry(
  entry: ScriptEntry,
): entry is Exclude<ScriptEntry, AgentEvent> {
  return typeof (entry as { control?: unknown }).control === 'string';
}

function findFirstControl(
  script: ScriptEntry[],
): Exclude<ScriptEntry, AgentEvent | { control: 'delay'; ms: number }> | null {
  for (const entry of script) {
    if (isControlEntry(entry) && entry.control !== 'delay') {
      return entry;
    }
  }
  return null;
}
