/**
 * AgentDriver module barrel.
 *
 * Re-exports the provider-neutral types and the in-memory `FakeDriver`.
 * No platform code consumes this module yet — see issues #288 and #289 for
 * the follow-on work that wires real adapters and platform callers behind
 * this seam.
 */
export type {
  AgentDriver,
  AgentEvent,
  AgentAction,
  AgentSessionState,
  AgentSessionStatus,
  OpenSessionOpts,
} from './types.js';
export { FakeDriver, type ScriptEntry } from './fake.js';
