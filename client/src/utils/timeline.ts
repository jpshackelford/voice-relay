/**
 * Pure timeline merge utility used by KioskMode (and any future surface
 * that wants the same interleaved view).
 *
 * Extracted from `KioskMode.tsx` so the merge invariant (chronological
 * order across two sources) can be unit-tested independently of React.
 * See issue #264.
 */

import type { AgentAction, TimelineEntry, Utterance } from '../types';
import { parseOhTimestampMs } from './parseOhTimestamp';

/**
 * Merge utterances and agent-action events into a single chronological
 * timeline.
 *
 * Clock sources:
 *  - Utterances: prefer `utterance.serverTimestamp` (upstream OH event
 *    time, set on the server boundary), fall back to client-side
 *    `receivedAt` for human-typed messages or pre-normalization payloads.
 *  - Agent actions: parse `action.timestamp` defensively via
 *    {@link parseOhTimestampMs} so naive OH ISO strings are treated as
 *    UTC rather than local time.
 *
 * Entries with an unparseable timestamp are sorted to the end (stable
 * fallback to insertion order) so they remain visible rather than being
 * dropped.
 */
export function mergeTimeline(
  utterances: Iterable<Utterance>,
  actions: readonly AgentAction[]
): TimelineEntry[] {
  const entriesWithTime: Array<{ entry: TimelineEntry; time: number }> = [];

  for (const utterance of utterances) {
    const t = utterance.serverTimestamp
      ? parseOhTimestampMs(utterance.serverTimestamp)
      : utterance.receivedAt.getTime();
    entriesWithTime.push({
      entry: { type: 'utterance', data: utterance },
      time: Number.isNaN(t) ? Number.POSITIVE_INFINITY : t,
    });
  }

  for (const action of actions) {
    const t = parseOhTimestampMs(action.timestamp);
    entriesWithTime.push({
      entry: { type: 'agent-event', data: action },
      time: Number.isNaN(t) ? Number.POSITIVE_INFINITY : t,
    });
  }

  return entriesWithTime
    .sort((a, b) => a.time - b.time)
    .map(({ entry }) => entry);
}
