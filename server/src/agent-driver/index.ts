/**
 * AgentDriver module barrel.
 *
 * Re-exports the provider-neutral types, the in-memory `FakeDriver`, the
 * `OpenHandsAgentDriver` adapter, and a production `agentDriver` singleton
 * wired to a process-lifetime `AISessionManager`.
 *
 * After issue #289, this barrel owns the canonical `AISessionManager`
 * singleton: it's constructed here and lives for the lifetime of the Node
 * process. Platform code consumes only the `AgentDriver` interface (via
 * `agentDriver`) and the platform fan-out hooks
 * (`onAgentRawEvent`, `onAgentThinkingChange`, `onAgentAction`,
 * `shutdownAgentDriver`) exported below.
 *
 * IMPORTANT: importing this barrel triggers construction of the
 * `OpenHandsAgentDriver` singleton, which installs forwarder callbacks on
 * `AISessionManager`. Those forwarders are the sole subscriber to
 * `setThinkingChangeCallback` / `setActionCallback` / `setEventCallback`
 * — platform code attaches its own listeners through the
 * `onAgentXxx` helpers, which the driver fan-outs to.
 *
 * ## Singleton lifecycle (Phase 2)
 *
 * `agentDriver` is module-eager: the first `import` that loads this file
 * constructs it. This is the right trade-off for Phase 2 because:
 *
 * - `AISessionManager` is itself a process-lifetime singleton (one
 *   `OpenHandsClient`, one set of platform callbacks).
 * - Each call to `setThinkingChangeCallback` / `setActionCallback` /
 *   `setEventCallback` replaces, rather than composes, the previous
 *   handler. There can only be one driver bound at a time without losing
 *   events.
 * - Tests construct their own `new OpenHandsAgentDriver(fakeMgr)` against
 *   a `FakeAISessionManager` rather than importing this barrel, so they
 *   are unaffected by the production singleton.
 *
 * ## Phase 3+ evolution (forward-looking notes)
 *
 * If a future phase needs any of the following, this export should evolve
 * into a factory or lazy-initialised holder rather than a top-level `new`:
 *
 * - **Multiple driver instances** (e.g. multi-tenant routing or A/B
 *   between drivers). Today's eager binding to a single
 *   `AISessionManager` would need to be deferred so callers can pass
 *   their own manager surface.
 * - **Graceful shutdown / hot-reload** hooks that need to detach the
 *   forwarder callbacks (`setX(undefined)`) and drain pending turns. The
 *   `shutdownAgentDriver` helper is a first step; a richer `dispose()`
 *   method may be needed.
 * - **Test substitution at the import boundary** (rather than via DI in
 *   constructors). A `getAgentDriver()` accessor would let tests replace
 *   the production instance without monkey-patching the module.
 */
import { AISessionManager } from '../openhands.js';
import {
  OpenHandsAgentDriver,
  type RawEventListener,
  type ThinkingListener,
  type ActionListener,
} from './openhands.js';
import type { AgentDriver } from './types.js';

export type {
  AgentDriver,
  AgentEvent,
  AgentAction,
  AgentSenderMeta,
  AgentSessionState,
  AgentSessionStatus,
  OpenSessionOpts,
} from './types.js';
export { FakeDriver, type ScriptEntry } from './fake.js';
export {
  OpenHandsAgentDriver,
  type AISessionManagerSurface,
  type RawEventListener,
  type ThinkingListener,
  type ActionListener,
} from './openhands.js';

/**
 * Process-lifetime `AISessionManager` instance. Owned by the agent-driver
 * module — platform code must not import this directly; consume the
 * `AgentDriver` seam below instead.
 */
const aiSessionManager = new AISessionManager();

const openHandsDriver = new OpenHandsAgentDriver(aiSessionManager);

/** Production `AgentDriver` singleton wrapping the legacy `AISessionManager`. */
export const agentDriver: AgentDriver = openHandsDriver;

/**
 * Subscribe to raw upstream events from the production driver. Used by the
 * agent-events live-ingest path to persist events to the `agent_events`
 * table without bypassing the seam.
 */
export function onAgentRawEvent(listener: RawEventListener): () => void {
  return openHandsDriver.onRawEvent(listener);
}

/**
 * Subscribe to session-level thinking-state changes from the production
 * driver. The platform broadcasts `ai-thinking` messages to session
 * devices through this hook.
 */
export function onAgentThinkingChange(listener: ThinkingListener): () => void {
  return openHandsDriver.onThinkingChange(listener);
}

/**
 * Subscribe to agent action events from the production driver. The
 * platform broadcasts `agent-action` messages to session devices through
 * this hook.
 */
export function onAgentAction(listener: ActionListener): () => void {
  return openHandsDriver.onActionEvent(listener);
}

/**
 * Process-level shutdown for the production driver. Mirrors the legacy
 * `aiSessionManager.shutdown()` semantics.
 */
export async function shutdownAgentDriver(): Promise<void> {
  await openHandsDriver.shutdown();
}

/**
 * Install (or clear) the per-session system-prompt resolver used by the
 * production `AISessionManager` when binding a new OpenHands conversation
 * for a VR session. The resolver lets the platform inject session-level
 * `agentPrompt` overrides and workspace-level defaults without bypassing
 * the driver seam. Issue #378.
 *
 * Called once from `server/src/index.ts` after the session and workspace
 * repositories are constructed.
 */
export function setAgentPromptResolver(
  resolver:
    | ((params: {
        sessionId: string;
        workspaceId: string;
        displayLines: number | undefined;
      }) => string)
    | undefined,
): void {
  aiSessionManager.setPromptResolver(resolver);
}
