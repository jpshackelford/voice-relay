/**
 * Memory replay helpers for the OpenHands rebind path (#297).
 *
 * When a conversation's sandbox is reaped and the driver rebinds the
 * conversation onto a fresh sandbox (#296), the agent on the new sandbox
 * starts with an empty context window — it has no recollection of the
 * prior turns. The user's session is otherwise preserved (same
 * `conversation_id`, same visible history) so any follow-up like "what
 * did we just decide?" lands on an amnesiac agent.
 *
 * This module provides the pure helpers that turn the platform-side
 * event log into a string suitable for the rebind POST's
 * `system_message_suffix` field (see
 * `docs/openhands-platform.md` § Death and recovery). The rebound agent's
 * system prompt then reads as:
 *
 *     [base system prompt]
 *     [system_message_suffix — what the user and agent discussed previously]
 *
 * Two paths are supported:
 *
 *  1. **Condense** (preferred). A server- or LLM-managed summarisation
 *     yielding a {@link CondenseResult}. {@link buildSuffixFromCondense}
 *     turns that into the suffix. The condense path is plug-in via
 *     {@link CondenseFn}; production currently has no wired
 *     implementation (the OH agent server's condense endpoint runs against
 *     a live sandbox, which the rebind path lacks), so {@link noopCondense}
 *     always throws and the fallback path runs in production.
 *
 *  2. **Fallback**. {@link buildFallbackSuffix} walks the raw event log,
 *     filters to user / agent text messages (dropping tool-call internals
 *     like `view_file` outputs), and assembles a transcript-style
 *     suffix. Output is capped at {@link MAX_FALLBACK_SUFFIX_CHARS} (2000)
 *     and prioritises recent turns by dropping oldest turns first while
 *     always preserving the last two turns intact.
 *
 * The overall convenience wrapper is {@link buildReplaySuffix}, which
 * tries condense and falls back on any error.
 *
 * All helpers are pure: no I/O, no shared mutable state, deterministic
 * output for given input. The orchestrator (`agent-driver/rebind.ts` and
 * the `AISessionManager.doRebindSession` path in `openhands.ts`) does
 * the I/O of fetching the event log and posting the rebind.
 */

import type { RawOpenHandsEvent } from '../openhands.js';

// ---------------------------------------------------------------------------
// Tunables (exported so tests can assert exact values)
// ---------------------------------------------------------------------------

/**
 * Hard cap on the fallback suffix length, in characters. Picked so a
 * verbose ~50-turn conversation still fits, but no single rebind can
 * blow past a model's context window for the system prompt portion.
 */
export const MAX_FALLBACK_SUFFIX_CHARS = 2000;

/**
 * Absolute ceiling on any replay suffix (condense or fallback), in
 * characters. Acts as a final guard against a pathological condense
 * result. ~4 KB so the suffix can never dominate the system prompt.
 */
export const MAX_SUFFIX_CHARS = 4096;

/**
 * The fallback truncation guarantee: the last N turns are always kept in
 * full, even if doing so pushes the total over
 * {@link MAX_FALLBACK_SUFFIX_CHARS}. Turns older than this are dropped
 * first when truncating.
 */
export const FALLBACK_KEEP_LAST_TURNS = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A summary produced by an LLM-based condense step. `summary` is the
 * narrative — what the prior conversation was about — and `highlights`
 * is an optional list of crisp facts the agent should remember (e.g.
 * decisions, names, file paths). Both are agent-readable text.
 */
export interface CondenseResult {
  summary: string;
  highlights?: string[];
}

/**
 * Plug-in seam for the condense step. Production has no wired
 * implementation; tests may inject one to exercise the condense-driven
 * code path. The function receives the raw event log (oldest → newest)
 * and returns a {@link CondenseResult}. Throwing forces the fallback
 * path; rejected promises are treated the same way.
 */
export type CondenseFn = (events: RawOpenHandsEvent[]) => Promise<CondenseResult>;

/**
 * Default {@link CondenseFn} that always rejects. The rebind path uses
 * this in production: condense requires a live agent server, which the
 * MISSING-sandbox recovery scenario doesn't have. The fallback builder
 * runs instead.
 */
export const noopCondense: CondenseFn = () => {
  return Promise.reject(new Error('condense not wired in production'));
};

/**
 * Normalised replay turn: just the role (user vs agent) and the
 * concatenated text. Tool-call internals are not represented — we
 * intentionally drop them because the new agent doesn't need the literal
 * output of past `view_file` etc.
 */
interface ReplayTurn {
  role: 'user' | 'agent';
  text: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single replay turn from a raw OH event, or return `null` if
 * the event is not a user/agent text message (e.g. tool calls, state
 * updates, hook events, empty content).
 *
 * Recognised event shapes (see V1MessageEvent in openhands.ts):
 *   { kind: 'MessageEvent', source: 'user'|'agent', llm_message: { role, content: [{type:'text',text}] } }
 *
 * Anything else returns `null` and is dropped.
 */
export function extractReplayTurn(event: RawOpenHandsEvent): ReplayTurn | null {
  if (!event || typeof event !== 'object') return null;
  if (event.kind !== 'MessageEvent') return null;

  // Only user and agent turns are meaningful for memory replay. Hook /
  // environment messages are sandbox noise.
  const source = event.source;
  if (source !== 'user' && source !== 'agent') return null;

  const llmMessage = event.llm_message;
  if (!llmMessage || typeof llmMessage !== 'object') return null;

  const content = (llmMessage as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter(
      (part): part is { type: string; text: string } =>
        !!part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (text.length === 0) return null;

  return { role: source, text };
}

/**
 * Walk the raw event log (oldest → newest) and return a normalised list
 * of replay turns: user / agent text messages only, in original order.
 */
export function extractReplayTurns(events: readonly RawOpenHandsEvent[]): ReplayTurn[] {
  const turns: ReplayTurn[] = [];
  for (const event of events) {
    const turn = extractReplayTurn(event);
    if (turn !== null) turns.push(turn);
  }
  return turns;
}

/**
 * Format a single turn as a transcript line. Kept short and uniform so
 * the agent's prompt sees a clean Q/A structure.
 */
function formatTurn(turn: ReplayTurn): string {
  const label = turn.role === 'user' ? 'User' : 'Assistant';
  return `${label}: ${turn.text}`;
}

/**
 * Header prefix prepended to every non-empty replay suffix. Lets the
 * agent recognise the suffix as memory continuity context rather than
 * an opaque instruction.
 */
const SUFFIX_HEADER =
  'Memory continuity from this conversation\'s prior turns ' +
  '(the runtime was restarted; the user-visible transcript is preserved). ' +
  'Use this to answer follow-up questions referencing earlier exchanges:\n';

/**
 * Format a condense result as a memory-replay suffix. Trusts the
 * upstream summariser — no per-turn caps — but still enforces the
 * absolute {@link MAX_SUFFIX_CHARS} guard so a runaway condense output
 * can't blow the system prompt.
 *
 * Output shape:
 *
 *     <SUFFIX_HEADER>
 *     <summary>
 *     Highlights:
 *     - <highlight 1>
 *     - <highlight 2>
 *
 * Returns `''` if `result.summary` is empty / whitespace.
 */
export function buildSuffixFromCondense(result: CondenseResult): string {
  const summary = (result.summary ?? '').trim();
  if (summary.length === 0) return '';

  const lines: string[] = [SUFFIX_HEADER + summary];

  const highlights = result.highlights;
  if (Array.isArray(highlights) && highlights.length > 0) {
    lines.push('Highlights:');
    for (const h of highlights) {
      const trimmed = (h ?? '').toString().trim();
      if (trimmed.length > 0) lines.push(`- ${trimmed}`);
    }
  }

  const joined = lines.join('\n');
  return joined.length > MAX_SUFFIX_CHARS
    ? joined.slice(0, MAX_SUFFIX_CHARS)
    : joined;
}

/**
 * Build a replay suffix directly from the raw event log when condense is
 * unavailable. Behaviour:
 *
 *  - Filters to user / agent text turns only (see {@link extractReplayTurn}).
 *  - If no turns survive, returns `''`.
 *  - Joins formatted turns with `\n\n` and prepends {@link SUFFIX_HEADER}.
 *  - If the total length is ≤ {@link MAX_FALLBACK_SUFFIX_CHARS}, returns
 *    as-is.
 *  - Otherwise drops the oldest turns one at a time, **always preserving
 *    the most-recent {@link FALLBACK_KEEP_LAST_TURNS} turns intact**, until
 *    the result fits. A truncation marker is inserted at the cut point so
 *    the agent knows older context exists but was dropped.
 *  - If even the recent-kept turns alone exceed the cap, the result is
 *    hard-clipped to {@link MAX_FALLBACK_SUFFIX_CHARS} as a final guard.
 */
export function buildFallbackSuffix(events: readonly RawOpenHandsEvent[]): string {
  const turns = extractReplayTurns(events);
  if (turns.length === 0) return '';

  const rendered = assembleTurns(turns);
  if (rendered.length <= MAX_FALLBACK_SUFFIX_CHARS) return rendered;

  // Drop oldest turns one at a time, but never the last
  // FALLBACK_KEEP_LAST_TURNS. The truncation marker reminds the agent
  // older context existed.
  const keep = Math.min(FALLBACK_KEEP_LAST_TURNS, turns.length);
  for (let drop = 1; drop <= turns.length - keep; drop++) {
    const kept = turns.slice(drop);
    const candidate = assembleTurns(kept, /* truncated */ true);
    if (candidate.length <= MAX_FALLBACK_SUFFIX_CHARS) return candidate;
  }

  // Even just the protected tail is too long. Hard-clip.
  const tail = turns.slice(turns.length - keep);
  const tailRendered = assembleTurns(tail, /* truncated */ true);
  return tailRendered.length > MAX_FALLBACK_SUFFIX_CHARS
    ? tailRendered.slice(0, MAX_FALLBACK_SUFFIX_CHARS)
    : tailRendered;
}

/**
 * Assemble a list of turns into the final suffix string with the
 * standard header (and optional truncation marker for fallback paths).
 * Pure / used only by {@link buildFallbackSuffix}.
 */
function assembleTurns(turns: readonly ReplayTurn[], truncated = false): string {
  const lines: string[] = [SUFFIX_HEADER.trimEnd()];
  if (truncated) lines.push('[earlier turns omitted for length]');
  for (const turn of turns) lines.push(formatTurn(turn));
  return lines.join('\n');
}

/**
 * Convenience wrapper used by the rebind path. Tries `condense` first;
 * on any rejection or throw, falls back to {@link buildFallbackSuffix}.
 * Returns `''` when there are no replay-eligible events at all.
 *
 * The condense function receives the *original* event log, not any
 * previous suffix, so multiple successive rebinds re-condense from the
 * raw conversation history rather than condensing a previously-condensed
 * summary (which would lose detail with each iteration).
 */
export async function buildReplaySuffix(
  events: readonly RawOpenHandsEvent[],
  condense: CondenseFn = noopCondense,
): Promise<string> {
  if (events.length === 0) return '';

  try {
    const result = await condense([...events]);
    const fromCondense = buildSuffixFromCondense(result);
    if (fromCondense.length > 0) return fromCondense;
    // Condense returned a useless result — try fallback instead of
    // shipping an empty suffix when we have raw events to work with.
    return buildFallbackSuffix(events);
  } catch {
    return buildFallbackSuffix(events);
  }
}
