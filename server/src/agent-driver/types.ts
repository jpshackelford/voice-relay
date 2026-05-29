/**
 * Public type exports for the AgentDriver module.
 *
 * This file defines the provider-neutral seam between Voice Relay's platform
 * layer and any AI agent backend. It intentionally contains no concepts
 * specific to any single provider.
 */

/**
 * Lifecycle states for an agent session, as observed by the platform.
 *
 * - `absent`       — session is not registered with the driver (or has been closed).
 * - `starting`     — registered; underlying agent infrastructure is provisioning.
 * - `ready`        — agent is idle and ready to accept the next utterance.
 * - `thinking`     — agent is actively processing the most recent utterance.
 * - `reconnecting` — driver lost upstream connectivity and is recovering.
 * - `degraded`     — agent is unhealthy; user intervention (restart) may be needed.
 */
export type AgentSessionState =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'thinking'
  | 'reconnecting'
  | 'degraded';

/**
 * Cheap, value-typed snapshot of an agent session's state. Drivers must be
 * able to return this without performing any upstream calls.
 */
export interface AgentSessionStatus {
  sessionId: string;
  state: AgentSessionState;
  conversationId: string | null;
  error: string | null;
  /** ISO timestamp when the current `thinking` state began, or null. */
  thinkingSince: string | null;
  /** ISO timestamp when the current `starting` state began, or null. */
  startingSince: string | null;
  /** Granular UX hint, e.g. 'WAITING_FOR_SANDBOX'. Provider-specific. */
  startupPhase?: string;
}

/**
 * A tool/action invocation the agent has made (with optional observation).
 * `args` is `unknown` because the shape is tool-specific and narrowed by callers.
 */
export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  toolCallId: string;
  observation?: { result: unknown; status: 'ok' | 'error' };
}

/**
 * Discriminated event emitted by `AgentDriver.sendMessage`.
 *
 * `message` is the canonical terminal event for a successful exchange.
 * `error` is the canonical terminal event for a failure.
 * `status` and `action` are intermediate signals consumers may ignore.
 */
export type AgentEvent =
  | { kind: 'message'; text: string; serverTimestamp?: string }
  | { kind: 'action'; action: AgentAction }
  | { kind: 'status'; status: AgentSessionStatus }
  | { kind: 'error'; message: string; recoverable: boolean };

/**
 * Options for `AgentDriver.openSession`. `workspaceId` is the only required
 * field; everything else is provider-optional metadata.
 */
export interface OpenSessionOpts {
  workspaceId: string;
  displayLines?: number;
  apiKey?: string;
  displayApiSecret?: string;
  /**
   * Optional pre-existing upstream conversation ID to attach to instead of
   * creating a new one.
   *
   * Used by the startup `rehydrateAgentSessions` pass (issue #341) to
   * re-attach to OpenHands conversations whose Voice Relay live binding
   * died with the previous process but whose upstream OpenHands
   * conversation is still alive. When supplied, the OpenHands adapter
   * skips `POST /app-conversations` and goes straight to fetching the
   * conversation info + opening a WS against the existing id.
   *
   * Drivers without an attach concept (e.g. `FakeDriver`) may ignore this
   * field — it is purely a hint, never a contract.
   */
  existingConversationId?: string;
  /**
   * Optional id of a *prior* upstream conversation whose context should be
   * carried forward into the new conversation via memory replay (issue
   * #349).
   *
   * Set by `attachOrCreateAgentSession` on the fresh-create-after-attach
   * branch: when the original `existingConversationId` is gone upstream,
   * the helper retries with `existingConversationId` stripped and
   * `previousConversationId` set to the dead id so the OpenHands adapter
   * can fetch its event log and pipe it through `buildReplaySuffix` as
   * a `system_message_suffix` on the create POST.
   *
   * Mutually exclusive with `existingConversationId` in practice: an
   * attach path doesn't need replay (the on-server event log is preserved
   * across rebinds). If both are set the adapter prefers `existingConversationId`
   * and ignores this hint.
   *
   * Drivers without a memory-replay concept (e.g. `FakeDriver`) may
   * ignore this field — it is purely a hint, never a contract.
   */
  previousConversationId?: string;
}

/**
 * Provider-neutral contract between the Voice Relay platform and any AI
 * agent backend. See `docs/architecture.md` for the design rationale; the
 * five methods below are deliberately narrow.
 */
export interface AgentDriver {
  /**
   * True when the driver is configured and can serve requests. Used by the
   * platform's auto-connect path to skip provisioning entirely when no
   * credentials are available. Cheap; no upstream calls.
   */
  isAvailable(): boolean;

  /**
   * True when the driver has a registered (and likely upstream-bound)
   * session for `sessionId`. Cheap synchronous check used by hot-path
   * dispatch decisions in the WS handler. Equivalent in spirit to
   * `getSessionStatus(sessionId).state !== 'absent'` but synchronous so
   * callers don't pay an `await` per inbound text frame.
   */
  hasSession(sessionId: string): boolean;

  /**
   * Idempotently register a session with the driver and provision upstream
   * resources if the driver requires them. Adapters MAY treat this as
   * cheap registration (deferring upstream allocation to `sendMessage`),
   * but the production OpenHands adapter binds eagerly so the returned
   * status carries a real `conversationId` callers can persist.
   * Calling twice with the same `sessionId` returns the same status.
   */
  openSession(sessionId: string, opts: OpenSessionOpts): Promise<AgentSessionStatus>;

  /**
   * Send a user utterance and stream the agent's response as `AgentEvent`s.
   *
   * Idempotent on `utteranceId`: a repeat call with the same id returns a
   * cached terminal event rather than double-posting. The returned iterable
   * must terminate cleanly (yield a terminal `message` or `error` and return).
   *
   * If the session is not open, the driver auto-opens it.
   */
  sendMessage(sessionId: string, utteranceId: string, text: string): AsyncIterable<AgentEvent>;

  /**
   * Explicit user-driven reset. Resets `state` to `starting` and clears any
   * `utteranceId` memo so retries can succeed.
   */
  restartSession(sessionId: string): Promise<AgentSessionStatus>;

  /** Read the current session status. Cheap; no upstream calls. */
  getSessionStatus(sessionId: string): Promise<AgentSessionStatus>;

  /** Idempotent teardown of the driver's side of the session. */
  closeSession(sessionId: string): Promise<void>;
}
