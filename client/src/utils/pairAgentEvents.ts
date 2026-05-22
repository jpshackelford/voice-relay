/**
 * Pair agent ActionEvents with their matching ObservationEvents so the kiosk
 * timeline can render each tool invocation as a single card with both the
 * request (Command/Tool/Args) and the response (Output/Result/exit code).
 *
 * The pairing key is `observation.action_id === action.id` — the back-pointer
 * is set server-side from the raw OpenHands event stream
 * (see `test-fixtures/raw-events-real.json`). The secondary `tool_call_id`
 * is not needed for matching because `action_id` is canonical.
 *
 * Filed under issue #265.
 */

import type { AgentAction } from '../types';

/**
 * An entry produced by `pairAgentEvents()`. `observation` is set when the
 * matching observation has arrived; otherwise the card should render in a
 * "pending" state.
 */
export interface PairedAgentEvent {
  action: AgentAction;
  observation?: AgentAction;
}

/**
 * Heuristic: an event with a non-empty `action_id` is an observation pointing
 * at the action whose `id` matches. We treat the presence of `action_id` as
 * the canonical signal so that this works for ObservationEvent wrappers as
 * well as nested observation kinds (TerminalObservation, FileEditorObservation,
 * MCPToolObservation, etc.).
 */
function isObservation(action: AgentAction): boolean {
  return typeof action.action_id === 'string' && action.action_id.length > 0;
}

/**
 * Group agent actions and observations into paired entries.
 *
 * Behavior:
 * - Each action whose matching observation has arrived produces one entry
 *   with both attached.
 * - Each action whose observation has not yet arrived produces one entry with
 *   `observation` undefined (renders as "pending").
 * - Orphan observations (observation arrived for an action we never saw —
 *   e.g. server restart mid-conversation, or the action was filtered)
 *   fall through as their own entry, preserving today's degenerate-case
 *   behavior so nothing is silently dropped.
 *
 * Input order does not affect output: observations are indexed by `action_id`
 * in a single pre-pass, so a late-arriving action still pairs correctly.
 */
export function pairAgentEvents(actions: AgentAction[]): PairedAgentEvent[] {
  // First pass: index observations by the action they point at.
  // If multiple observations target the same action_id (shouldn't happen, but
  // be defensive against duplicate WebSocket frames), the last one wins —
  // it's the most recently-emitted state.
  const observationsByActionId = new Map<string, AgentAction>();
  for (const evt of actions) {
    if (isObservation(evt) && evt.action_id) {
      observationsByActionId.set(evt.action_id, evt);
    }
  }

  // Track which observations were consumed by a paired action so we can emit
  // the rest as orphans at the end.
  const consumed = new Set<string>();

  // Second pass: emit one entry per non-observation action, attaching its
  // observation if available.
  const paired: PairedAgentEvent[] = [];
  for (const evt of actions) {
    if (isObservation(evt)) continue;
    const observation = observationsByActionId.get(evt.id);
    if (observation) {
      consumed.add(observation.id);
    }
    paired.push({ action: evt, observation });
  }

  // Third pass: orphan observations (no matching action) fall through.
  for (const evt of actions) {
    if (!isObservation(evt)) continue;
    if (consumed.has(evt.id)) continue;
    paired.push({ action: evt });
  }

  return paired;
}
