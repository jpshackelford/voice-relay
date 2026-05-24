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
