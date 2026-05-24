/**
 * AgentDriver module barrel.
 *
 * Re-exports the provider-neutral types, the in-memory `FakeDriver`, the
 * `OpenHandsAgentDriver` adapter, and a production `agentDriver` singleton
 * wired to the real `aiSessionManager`.
 *
 * No platform code consumes this module yet — see issues #288 and #289 for
 * the follow-on work that wires the adapter and platform callers behind
 * this seam.
 *
 * IMPORTANT: importing this barrel triggers construction of the
 * `OpenHandsAgentDriver` singleton, which installs forwarder callbacks on
 * `aiSessionManager`. Those forwarders overwrite the platform's existing
 * `setThinkingChangeCallback` / `setActionCallback` / `setEventCallback`
 * registrations. Until #289 migrates callers onto the adapter, this barrel
 * must stay out of the production import graph (verified by T-2.2.E.2).
 *
 * ## Singleton lifecycle (Phase 2)
 *
 * The `agentDriver` export is module-eager: the first `import` that loads
 * this file constructs it, and it lives for the lifetime of the Node
 * process. There is no `dispose()` and no factory. This is the right
 * trade-off for Phase 2 because:
 *
 * - `aiSessionManager` is itself a process-lifetime singleton (one
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
 *   between drivers). Today's eager binding to `aiSessionManager` would
 *   need to be deferred so callers can pass their own manager surface.
 * - **Graceful shutdown / hot-reload** hooks that need to detach the
 *   forwarder callbacks (`setX(undefined)`) and drain pending turns. Add
 *   a `dispose()` method on `OpenHandsAgentDriver` first, then call it
 *   from a process-level shutdown handler.
 * - **Test substitution at the import boundary** (rather than via DI in
 *   constructors). A `getAgentDriver()` accessor would let tests replace
 *   the production instance without monkey-patching the module.
 *
 * None of these are needed for #288/#289; capturing them here so the
 * lifecycle decision is intentional rather than incidental.
 */
import { aiSessionManager } from '../openhands.js';
import { OpenHandsAgentDriver } from './openhands.js';
import type { AgentDriver } from './types.js';

export type {
  AgentDriver,
  AgentEvent,
  AgentAction,
  AgentSessionState,
  AgentSessionStatus,
  OpenSessionOpts,
} from './types.js';
export { FakeDriver, type ScriptEntry } from './fake.js';
export { OpenHandsAgentDriver, type AISessionManagerSurface } from './openhands.js';

/** Production `AgentDriver` singleton wrapping `aiSessionManager`. */
export const agentDriver: AgentDriver = new OpenHandsAgentDriver(aiSessionManager);
