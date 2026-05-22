import { describe, it, expect } from 'vitest';
import { pairAgentEvents } from './pairAgentEvents';
import type { AgentAction } from '../types';

/**
 * Tests for the ActionEvent + ObservationEvent pairing logic (issue #265).
 *
 * The pairing key is `observation.action_id === action.id`. The function must
 * be order-independent (observation may arrive before its action in the
 * `agentActions` array after a REST rehydration) and must not drop orphan
 * observations.
 */
describe('pairAgentEvents', () => {
  const makeAction = (id: string, kind = 'TerminalAction'): AgentAction => ({
    id,
    timestamp: `2026-05-21T11:46:32.${id}`,
    kind,
    source: 'agent',
    summary: `action ${id}`,
  });

  const makeObservation = (id: string, actionId: string, kind = 'TerminalObservation'): AgentAction => ({
    id,
    timestamp: `2026-05-21T11:46:33.${id}`,
    kind,
    source: 'environment',
    summary: `observation for ${actionId}`,
    action_id: actionId,
  });

  it('returns an empty array for no input', () => {
    expect(pairAgentEvents([])).toEqual([]);
  });

  it('pairs an action with its matching observation (ordered)', () => {
    const action = makeAction('a1');
    const observation = makeObservation('o1', 'a1');

    const result = pairAgentEvents([action, observation]);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe(action);
    expect(result[0].observation).toBe(observation);
  });

  it('pairs correctly when observation arrives before its action in the input', () => {
    // Defensive: REST rehydration may sort by timestamp and an observation
    // emitted in the same millisecond as the action could end up first.
    const action = makeAction('a1');
    const observation = makeObservation('o1', 'a1');

    const result = pairAgentEvents([observation, action]);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe(action);
    expect(result[0].observation).toBe(observation);
  });

  it('leaves an action unpaired when its observation has not arrived (pending)', () => {
    const action = makeAction('a1');

    const result = pairAgentEvents([action]);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe(action);
    expect(result[0].observation).toBeUndefined();
  });

  it('passes through an orphan observation as its own entry', () => {
    // The action was never seen (server restart, or filtered). The
    // observation must still appear so we never silently drop events.
    const orphan = makeObservation('o1', 'never-seen-action-id');

    const result = pairAgentEvents([orphan]);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe(orphan);
    expect(result[0].observation).toBeUndefined();
  });

  it('preserves action order in the output (stable)', () => {
    const a1 = makeAction('a1');
    const o1 = makeObservation('o1', 'a1');
    const a2 = makeAction('a2');
    const o2 = makeObservation('o2', 'a2');
    const a3 = makeAction('a3'); // pending

    const result = pairAgentEvents([a1, o1, a2, o2, a3]);

    expect(result.map(r => r.action.id)).toEqual(['a1', 'a2', 'a3']);
    expect(result[0].observation?.id).toBe('o1');
    expect(result[1].observation?.id).toBe('o2');
    expect(result[2].observation).toBeUndefined();
  });

  it('emits paired actions before orphan observations', () => {
    const a1 = makeAction('a1');
    const o1 = makeObservation('o1', 'a1');
    const orphan = makeObservation('o-orphan', 'never-seen');

    const result = pairAgentEvents([a1, o1, orphan]);

    expect(result).toHaveLength(2);
    expect(result[0].action.id).toBe('a1');
    expect(result[0].observation?.id).toBe('o1');
    expect(result[1].action.id).toBe('o-orphan');
    expect(result[1].observation).toBeUndefined();
  });

  it('handles a mix of paired, pending, and orphan in a single call', () => {
    const a1 = makeAction('a1');
    const o1 = makeObservation('o1', 'a1');
    const a2 = makeAction('a2'); // pending
    const orphan = makeObservation('o-orphan', 'unknown-action');

    const result = pairAgentEvents([a1, o1, a2, orphan]);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ action: a1, observation: o1 });
    expect(result[1]).toEqual({ action: a2, observation: undefined });
    expect(result[2]).toEqual({ action: orphan, observation: undefined });
  });

  it('treats events without action_id as actions (not observations)', () => {
    // An action that happens to have no observation should not be confused
    // with an orphan observation.
    const action = makeAction('a1', 'CmdRunAction');
    expect(action.action_id).toBeUndefined();

    const result = pairAgentEvents([action]);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe(action);
    expect(result[0].observation).toBeUndefined();
  });

  it('matches the real OpenHands event stream pair from raw-events-real.json', () => {
    // Verbatim shape from test-fixtures/raw-events-real.json, items 1–2:
    //   ActionEvent { id: ecb6b141…, kind: TerminalAction }
    //   ObservationEvent { id: e468e9f8…, kind: TerminalObservation,
    //                      action_id: ecb6b141… }
    const action: AgentAction = {
      id: 'ecb6b141-73d6-4e22-9c6a-80334b2d430f',
      timestamp: '2026-05-21T11:46:32.885607',
      kind: 'TerminalAction',
      source: 'agent',
      summary: 'Display greeting on kiosk to confirm AI connection',
      command: 'curl -X POST https://app.no-hands.dev/api/display …',
    };
    const observation: AgentAction = {
      id: 'e468e9f8-295f-4c79-af6b-b00cc1d6c530',
      timestamp: '2026-05-21T11:46:33.921736',
      kind: 'TerminalObservation',
      source: 'environment',
      summary: '',
      action_id: 'ecb6b141-73d6-4e22-9c6a-80334b2d430f',
      exit_code: 0,
      content: [{ type: 'text', text: '{"success":true,"kioskCount":1}' }],
    };

    const result = pairAgentEvents([action, observation]);

    expect(result).toHaveLength(1);
    expect(result[0].action.id).toBe('ecb6b141-73d6-4e22-9c6a-80334b2d430f');
    expect(result[0].observation?.id).toBe('e468e9f8-295f-4c79-af6b-b00cc1d6c530');
    expect(result[0].observation?.exit_code).toBe(0);
  });

  it('does not pair an observation with the wrong action_id', () => {
    const a1 = makeAction('a1');
    const wrongObservation = makeObservation('o1', 'a2'); // points at a2, not a1

    const result = pairAgentEvents([a1, wrongObservation]);

    expect(result).toHaveLength(2);
    expect(result[0].action.id).toBe('a1');
    expect(result[0].observation).toBeUndefined();
    expect(result[1].action.id).toBe('o1'); // orphan
    expect(result[1].observation).toBeUndefined();
  });
});
