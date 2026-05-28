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
   * When set, the driver MUST attach to the supplied upstream conversation
   * instead of creating a new one. Used by the post-restart rehydration
   * path (issue #341) and by the restart-aware `autoConnectAI` fallback so
   * server restarts don't orphan in-flight OpenHands conversations.
   *
   * If the upstream conversation no longer exists (e.g. it was deleted /
   * timed out upstream), the driver throws and the caller is expected to
   * broadcast a `degraded` `session-state` so the kiosk can surface a
   * "restart session" affordance. Reviving ended upstream conversations
   * is explicitly out of scope.
   */
  existingConversationId?: string;
}

/**
 * Thrown by a driver when an attach to an existing upstream conversation
 * fails because the conversation no longer exists (HTTP 404, 410, etc.).
 *
 * Caught by the rehydration path (`agent-rehydrate.ts`) and the
 * restart-aware `autoConnectAI` so callers can distinguish "upstream is
 * gone, surface degraded" from "transient bind failure, retry". Drivers
 * that don't have an attach concept (e.g. `FakeDriver` without an
 * `existingConversationId` script entry) never throw this — they only
 * throw on missing prerequisites.
 */
export class UpstreamConversationEndedError extends Error {
  constructor(
    public readonly conversationId: string,
    message?: string,
  ) {
    super(message ?? `Upstream conversation ${conversationId} no longer available`);
    this.name = 'UpstreamConversationEndedError';
  }
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
