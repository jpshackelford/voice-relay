import { describe, it, expect } from 'vitest';
import { mergeTimeline } from './timeline';
import type { AgentAction, Utterance } from '../types';

function mkUtt(id: string, receivedAtISO: string, opts: Partial<Utterance> = {}): Utterance {
  return {
    id,
    senderId: 'user',
    senderName: 'User',
    text: `msg-${id}`,
    partial: false,
    receivedAt: new Date(receivedAtISO),
    ...opts,
  };
}

function mkAction(id: string, timestamp: string): AgentAction {
  return {
    id,
    timestamp,
    kind: 'TerminalAction',
    source: 'agent',
    summary: `action-${id}`,
  };
}

describe('mergeTimeline', () => {
  it('interleaves utterances and agent events chronologically with Z-suffixed timestamps', () => {
    const utterances = [
      mkUtt('u1', '2026-05-21T23:46:00.000Z'),
      mkUtt('u2', '2026-05-21T23:48:00.000Z'),
    ];
    const actions = [mkAction('a1', '2026-05-21T23:47:00.000Z')];

    const timeline = mergeTimeline(utterances, actions);
    expect(timeline.map(e => (e.type === 'utterance' ? e.data.id : e.data.id))).toEqual([
      'u1',
      'a1',
      'u2',
    ]);
  });

  // ---- the actual #264 regression ----
  // Naive OH timestamps must be treated as UTC by the merge, not local time.
  // We do not stub the host TZ here (vitest test env is usually UTC); instead
  // we assert against the *intent*: parsing should match the explicit-Z form.
  it('treats naive OH ISO strings as UTC (not local) when merging', () => {
    const utterances = [
      mkUtt('u1', '2026-05-21T23:46:00.000Z'),
      mkUtt('u2', '2026-05-21T23:48:00.000Z'),
    ];
    // Naive: no Z, no offset. Pre-fix this would parse as local time and end
    // up after both utterances on any non-UTC host.
    const actions = [mkAction('a1', '2026-05-21T23:47:00.274606')];

    const timeline = mergeTimeline(utterances, actions);
    expect(timeline.map(e => (e.type === 'utterance' ? e.data.id : e.data.id))).toEqual([
      'u1',
      'a1',
      'u2',
    ]);
  });

  it('prefers utterance.serverTimestamp over receivedAt when present', () => {
    // serverTimestamp says message was sent at 23:46, but the WS frame
    // didn't arrive until 23:50 ("now"). The merge must place it at 23:46.
    const utterances = [
      mkUtt('u-late-arrival', '2026-05-21T23:50:00.000Z', {
        serverTimestamp: '2026-05-21T23:46:00.000Z',
      }),
      mkUtt('u-other', '2026-05-21T23:48:00.000Z'),
    ];
    const actions = [mkAction('a1', '2026-05-21T23:47:00.000Z')];

    const timeline = mergeTimeline(utterances, actions);
    expect(timeline.map(e => (e.type === 'utterance' ? e.data.id : e.data.id))).toEqual([
      'u-late-arrival',
      'a1',
      'u-other',
    ]);
  });

  it('treats utterance.serverTimestamp with naive ISO as UTC (defensive)', () => {
    const utterances = [
      mkUtt('u-naive', '2026-05-22T03:50:00.000Z', {
        // No Z, no offset — must still parse to 23:46 UTC, not 03:46 UTC
        serverTimestamp: '2026-05-21T23:46:00.000',
      }),
    ];
    const actions = [mkAction('a-later', '2026-05-21T23:47:00.000Z')];

    const timeline = mergeTimeline(utterances, actions);
    expect(timeline.map(e => (e.type === 'utterance' ? e.data.id : e.data.id))).toEqual([
      'u-naive',
      'a-later',
    ]);
  });

  it('sorts entries with unparseable timestamps to the end (stable, not dropped)', () => {
    const utterances = [mkUtt('u1', '2026-05-21T23:46:00.000Z')];
    const actions = [
      mkAction('a-good', '2026-05-21T23:47:00.000Z'),
      mkAction('a-bad', 'not-a-date'),
    ];

    const timeline = mergeTimeline(utterances, actions);
    expect(timeline).toHaveLength(3);
    expect(timeline[timeline.length - 1]).toEqual({
      type: 'agent-event',
      data: actions[1],
    });
  });

  it('returns empty array for empty inputs', () => {
    expect(mergeTimeline([], [])).toEqual([]);
  });
});
