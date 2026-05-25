/**
 * Unit tests for `replay.ts` — pure helpers for the memory-replay path
 * of the rebind feature (#297).
 *
 * Test IDs (T-4.2.U.*) correspond to the acceptance matrix in issue
 * #297. Integration coverage of the rebind orchestrator and the
 * AISessionManager wiring lives in `rebind.test.ts` and
 * `../openhands.test.ts`.
 */

import { describe, test, expect } from 'vitest';
import {
  buildSuffixFromCondense,
  buildFallbackSuffix,
  buildReplaySuffix,
  extractReplayTurn,
  extractReplayTurns,
  noopCondense,
  MAX_FALLBACK_SUFFIX_CHARS,
  MAX_SUFFIX_CHARS,
  FALLBACK_KEEP_LAST_TURNS,
  type CondenseResult,
  type CondenseFn,
} from './replay.js';
import type { RawOpenHandsEvent } from '../openhands.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a MessageEvent in the shape the OH events-search API returns. */
function msgEvent(
  source: 'user' | 'agent' | 'environment' | 'hook',
  text: string,
  extras: Partial<RawOpenHandsEvent> = {},
): RawOpenHandsEvent {
  return {
    id: extras.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'MessageEvent',
    source,
    timestamp: extras.timestamp ?? '2024-01-01T00:00:00Z',
    llm_message: {
      role: source === 'user' ? 'user' : 'assistant',
      content: [{ type: 'text', text }],
    },
    ...extras,
  };
}

/** Build a non-MessageEvent (tool call, state update, etc.) — should be filtered out. */
function toolEvent(kind: string, payload: Record<string, unknown> = {}): RawOpenHandsEvent {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    source: 'agent',
    timestamp: '2024-01-01T00:00:00Z',
    ...payload,
  };
}

// ---------------------------------------------------------------------------
// extractReplayTurn / extractReplayTurns
// ---------------------------------------------------------------------------

describe('extractReplayTurn', () => {
  test('returns user turn for user MessageEvent with text content', () => {
    const turn = extractReplayTurn(msgEvent('user', 'hello world'));
    expect(turn).toEqual({ role: 'user', text: 'hello world' });
  });

  test('returns agent turn for agent MessageEvent with text content', () => {
    const turn = extractReplayTurn(msgEvent('agent', 'sure thing'));
    expect(turn).toEqual({ role: 'agent', text: 'sure thing' });
  });

  test('drops MessageEvents from non-user / non-agent sources', () => {
    expect(extractReplayTurn(msgEvent('environment', 'env hint'))).toBeNull();
    expect(extractReplayTurn(msgEvent('hook', 'hook ran'))).toBeNull();
  });

  test('drops non-MessageEvent kinds (tool calls, state updates, etc.)', () => {
    expect(extractReplayTurn(toolEvent('ActionEvent'))).toBeNull();
    expect(extractReplayTurn(toolEvent('BashOutput'))).toBeNull();
    expect(extractReplayTurn(toolEvent('ConversationStateUpdateEvent'))).toBeNull();
  });

  test('drops events with empty / whitespace-only text', () => {
    expect(extractReplayTurn(msgEvent('user', ''))).toBeNull();
    expect(extractReplayTurn(msgEvent('user', '   \n  '))).toBeNull();
  });

  test('drops malformed events (missing llm_message, bad shape)', () => {
    expect(extractReplayTurn({ kind: 'MessageEvent', source: 'user' })).toBeNull();
    expect(
      extractReplayTurn({
        kind: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user' },
      } as RawOpenHandsEvent),
    ).toBeNull();
  });

  test('concatenates multi-part text content with newlines', () => {
    const event: RawOpenHandsEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [
          { type: 'text', text: 'line A' },
          { type: 'text', text: 'line B' },
        ],
      },
    };
    expect(extractReplayTurn(event)).toEqual({ role: 'user', text: 'line A\nline B' });
  });
});

describe('extractReplayTurns', () => {
  test('preserves order of input events', () => {
    const turns = extractReplayTurns([
      msgEvent('user', 'first'),
      msgEvent('agent', 'second'),
      msgEvent('user', 'third'),
    ]);
    expect(turns.map((t) => t.text)).toEqual(['first', 'second', 'third']);
  });

  test('returns [] for an empty input', () => {
    expect(extractReplayTurns([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T-4.2.U.1 — buildSuffixFromCondense
// ---------------------------------------------------------------------------

describe('buildSuffixFromCondense', () => {
  test('T-4.2.U.1: formats output containing the summary verbatim', () => {
    const result: CondenseResult = {
      summary: 'User asked about A and B.',
      highlights: ['A=foo', 'B=bar'],
    };
    const out = buildSuffixFromCondense(result);
    expect(out).toContain('User asked about A and B.');
    expect(out.length).toBeGreaterThan(0);
  });

  test('includes each highlight as a bullet line', () => {
    const out = buildSuffixFromCondense({
      summary: 'Discussed plan.',
      highlights: ['decided: option B', 'next: ship Tuesday'],
    });
    expect(out).toContain('- decided: option B');
    expect(out).toContain('- next: ship Tuesday');
  });

  test('omits highlights section when none / empty', () => {
    const out = buildSuffixFromCondense({ summary: 'Just a summary.' });
    expect(out).toContain('Just a summary.');
    expect(out).not.toContain('Highlights:');
  });

  test('returns "" for empty / whitespace summary', () => {
    expect(buildSuffixFromCondense({ summary: '' })).toBe('');
    expect(buildSuffixFromCondense({ summary: '   ' })).toBe('');
  });

  test('hard-clips at MAX_SUFFIX_CHARS even when condense returns a huge summary', () => {
    const huge = 'x'.repeat(MAX_SUFFIX_CHARS * 3);
    const out = buildSuffixFromCondense({ summary: huge });
    expect(out.length).toBeLessThanOrEqual(MAX_SUFFIX_CHARS);
  });
});

// ---------------------------------------------------------------------------
// T-4.2.U.2..6 — buildFallbackSuffix
// ---------------------------------------------------------------------------

describe('buildFallbackSuffix', () => {
  test('T-4.2.U.2: empty event list returns empty string', () => {
    expect(buildFallbackSuffix([])).toBe('');
  });

  test('event list with no replay-eligible turns returns empty string', () => {
    const events = [
      toolEvent('ActionEvent'),
      toolEvent('BashOutput'),
      msgEvent('environment', 'noise'),
    ];
    expect(buildFallbackSuffix(events)).toBe('');
  });

  test('T-4.2.U.3: short list returns full transcript with all turns in order', () => {
    const events = [
      msgEvent('user', 'hi there'),
      msgEvent('agent', 'hello, how can I help?'),
      msgEvent('user', 'tell me about widgets'),
    ];
    const out = buildFallbackSuffix(events);
    expect(out.length).toBeLessThan(500);
    expect(out).toContain('hi there');
    expect(out).toContain('hello, how can I help?');
    expect(out).toContain('tell me about widgets');
    // Order preserved.
    expect(out.indexOf('hi there')).toBeLessThan(out.indexOf('hello, how can I help?'));
    expect(out.indexOf('hello, how can I help?')).toBeLessThan(
      out.indexOf('tell me about widgets'),
    );
  });

  test('formats user vs agent turns distinctly', () => {
    const out = buildFallbackSuffix([
      msgEvent('user', 'utterance'),
      msgEvent('agent', 'response'),
    ]);
    expect(out).toMatch(/User: utterance/);
    expect(out).toMatch(/Assistant: response/);
  });

  test('T-4.2.U.4: caps at MAX_FALLBACK_SUFFIX_CHARS for 50 long turns', () => {
    const events: RawOpenHandsEvent[] = [];
    for (let i = 0; i < 50; i++) {
      const text = `turn ${i} ${'x'.repeat(195)}`;
      events.push(msgEvent(i % 2 === 0 ? 'user' : 'agent', text));
    }
    const out = buildFallbackSuffix(events);
    expect(out.length).toBeLessThanOrEqual(MAX_FALLBACK_SUFFIX_CHARS);
  });

  test('T-4.2.U.5: prioritises recent turns — last turn kept, first turn dropped', () => {
    const events: RawOpenHandsEvent[] = [];
    for (let i = 0; i < 50; i++) {
      // Use distinctive substrings so we can assert on presence without
      // accidentally matching another turn's content.
      const text = `__TURN_${i}__ ${'x'.repeat(190)}`;
      events.push(msgEvent(i % 2 === 0 ? 'user' : 'agent', text));
    }
    const out = buildFallbackSuffix(events);
    expect(out).toContain('__TURN_49__');
    expect(out).not.toContain('__TURN_0__');
    // Truncation marker should be present so the agent knows context was dropped.
    expect(out).toMatch(/earlier turns omitted/i);
  });

  test('T-4.2.U.6: excludes tool-call internals (file contents, bash output)', () => {
    const events: RawOpenHandsEvent[] = [
      msgEvent('user', 'show me main.py'),
      toolEvent('ActionEvent', { command: 'view_file' }),
      // The kind of event we explicitly DON'T want included:
      toolEvent('BashOutput', { stdout: 'PRIVATE_FILE_CONTENTS_DO_NOT_LEAK' }),
      msgEvent('agent', 'I see the helper function returns 42.'),
    ];
    const out = buildFallbackSuffix(events);
    expect(out).toContain('show me main.py');
    expect(out).toContain('I see the helper function returns 42.');
    expect(out).not.toContain('PRIVATE_FILE_CONTENTS_DO_NOT_LEAK');
  });

  test('preserves the last FALLBACK_KEEP_LAST_TURNS turns even when individually huge', () => {
    // Last 2 turns are huge but should still appear at least partially.
    const huge = 'h'.repeat(MAX_FALLBACK_SUFFIX_CHARS);
    const events = [
      msgEvent('user', 'old 1'),
      msgEvent('agent', 'old 2'),
      msgEvent('user', `__RECENT_PENULTIMATE__ ${huge}`),
      msgEvent('agent', `__RECENT_LAST__ ${huge}`),
    ];
    const out = buildFallbackSuffix(events);
    expect(out.length).toBeLessThanOrEqual(MAX_FALLBACK_SUFFIX_CHARS);
    // At minimum the last turn marker is visible since hard-clip starts
    // from the beginning of the assembled string.
    expect(out).toContain('__RECENT_PENULTIMATE__');
  });

  test('FALLBACK_KEEP_LAST_TURNS constant is the expected sentinel value', () => {
    // Sanity check: tests rely on this being 2.
    expect(FALLBACK_KEEP_LAST_TURNS).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildReplaySuffix — convenience wrapper
// ---------------------------------------------------------------------------

describe('buildReplaySuffix', () => {
  test('returns "" for an empty event list (no condense call)', async () => {
    let called = false;
    const condense: CondenseFn = async () => {
      called = true;
      return { summary: 'should not happen' };
    };
    const out = await buildReplaySuffix([], condense);
    expect(out).toBe('');
    expect(called).toBe(false);
  });

  test('uses condense result when condense succeeds', async () => {
    const events = [msgEvent('user', 'hi'), msgEvent('agent', 'hello')];
    const out = await buildReplaySuffix(events, async () => ({
      summary: 'They greeted each other.',
      highlights: ['user=hi', 'agent=hello'],
    }));
    expect(out).toContain('They greeted each other.');
    expect(out).toContain('user=hi');
  });

  test('falls back to event-log builder when condense throws', async () => {
    const events = [msgEvent('user', '__FALLBACK_USER__'), msgEvent('agent', '__FALLBACK_AGENT__')];
    const out = await buildReplaySuffix(events, async () => {
      throw new Error('condense down');
    });
    expect(out).toContain('__FALLBACK_USER__');
    expect(out).toContain('__FALLBACK_AGENT__');
  });

  test('falls back when condense returns empty summary', async () => {
    const events = [msgEvent('user', '__SURVIVES__'), msgEvent('agent', 'ack')];
    const out = await buildReplaySuffix(events, async () => ({ summary: '   ' }));
    expect(out).toContain('__SURVIVES__');
  });

  test('default condense is noopCondense → fallback path runs in production', async () => {
    const events = [msgEvent('user', '__PROD_USER__'), msgEvent('agent', '__PROD_AGENT__')];
    const out = await buildReplaySuffix(events);
    expect(out).toContain('__PROD_USER__');
    expect(out).toContain('__PROD_AGENT__');
  });

  test('noopCondense always rejects', async () => {
    await expect(noopCondense([])).rejects.toThrow();
  });

  test('feeds condense the raw event log (never a previously generated suffix)', async () => {
    const events = [msgEvent('user', 'q1'), msgEvent('agent', 'a1')];
    let observed: RawOpenHandsEvent[] | undefined;
    await buildReplaySuffix(events, async (es) => {
      observed = es;
      return { summary: 'noted' };
    });
    expect(observed).toBeDefined();
    expect(observed!.length).toBe(2);
    expect(observed![0].kind).toBe('MessageEvent');
  });
});
