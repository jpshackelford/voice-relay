import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  filterKioskTimelineEvents,
  normalizeAgentEvent,
  normalizeAgentEvents,
  getEffectiveKind,
  getEventSummary,
  extractAgentActionFields,
  shouldShowInKioskTimeline,
  type RawAgentEvent,
} from './normalizeAgentEvent';

describe('getEffectiveKind', () => {
  it('returns top-level kind for direct events', () => {
    expect(getEffectiveKind({ kind: 'TerminalAction' })).toBe('TerminalAction');
    expect(getEffectiveKind({ kind: 'MessageEvent' })).toBe('MessageEvent');
  });

  it('unwraps ActionEvent to inner action.kind', () => {
    expect(
      getEffectiveKind({
        kind: 'ActionEvent',
        action: { kind: 'ExecuteBashAction' },
      }),
    ).toBe('ExecuteBashAction');
  });

  it('unwraps ObservationEvent to inner observation.kind', () => {
    expect(
      getEffectiveKind({
        kind: 'ObservationEvent',
        observation: { kind: 'ExecuteBashObservation' },
      }),
    ).toBe('ExecuteBashObservation');
  });

  it('keeps wrapper kind when nested kind is missing', () => {
    expect(getEffectiveKind({ kind: 'ActionEvent' })).toBe('ActionEvent');
    expect(getEffectiveKind({ kind: 'ObservationEvent', observation: {} })).toBe(
      'ObservationEvent',
    );
  });

  it('returns Unknown for events with no kind', () => {
    expect(getEffectiveKind({})).toBe('Unknown');
  });
});

describe('getEventSummary', () => {
  it('prefers the OH-supplied summary field', () => {
    const raw: RawAgentEvent = {
      kind: 'ActionEvent',
      summary: 'Display greeting on kiosk to confirm AI connection',
      action: { kind: 'TerminalAction', command: 'ls' },
    };
    expect(getEventSummary(raw)).toBe(
      'Display greeting on kiosk to confirm AI connection',
    );
  });

  it('truncates summaries longer than 80 chars', () => {
    const long = 'x'.repeat(120);
    const result = getEventSummary({ kind: 'ActionEvent', summary: long });
    expect(result.length).toBe(80);
    expect(result.endsWith('...')).toBe(true);
  });

  it('falls back to command for terminal kinds', () => {
    expect(
      getEventSummary({
        kind: 'ActionEvent',
        action: { kind: 'ExecuteBashAction', command: 'npm install' },
      }),
    ).toBe('npm install');
  });

  it('falls back to path for file kinds', () => {
    expect(
      getEventSummary({
        kind: 'ActionEvent',
        action: { kind: 'FileEditorAction', path: '/tmp/x.ts' },
      }),
    ).toBe('File: /tmp/x.ts');
  });

  it('falls back to url for browser kinds', () => {
    expect(
      getEventSummary({
        kind: 'ActionEvent',
        action: { kind: 'BrowserNavigateAction', url: 'https://example.com' },
      }),
    ).toBe('Navigate https://example.com');
  });

  it('falls back to thought for think kinds', () => {
    expect(
      getEventSummary({
        kind: 'ActionEvent',
        action: { kind: 'ThinkAction', thought: 'I will now plan the next step' },
      }),
    ).toBe('I will now plan the next step');
  });

  it('strips Action/Observation/Event suffix as last-resort fallback', () => {
    expect(getEventSummary({ kind: 'AgentStateChangeEvent' })).toBe(
      'AgentStateChange',
    );
    expect(getEventSummary({ kind: 'TerminalAction' })).toBe('Terminal');
  });

  it('ignores whitespace-only summaries', () => {
    const raw: RawAgentEvent = {
      kind: 'ActionEvent',
      summary: '   ',
      action: { kind: 'ExecuteBashAction', command: 'echo hi' },
    };
    expect(getEventSummary(raw)).toBe('echo hi');
  });
});

describe('extractAgentActionFields', () => {
  it('extracts terminal command + exit_code', () => {
    const fields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: { kind: 'ExecuteBashAction', command: 'ls -la' },
    });
    expect(fields.command).toBe('ls -la');
  });

  it('extracts observation content from nested observation', () => {
    const fields = extractAgentActionFields({
      kind: 'ObservationEvent',
      observation: {
        kind: 'ExecuteBashObservation',
        content: 'total 0',
        exit_code: 0,
      },
    });
    expect(fields.content).toBe('total 0');
    expect(fields.exit_code).toBe(0);
  });

  it('preserves ContentPart[] array content', () => {
    const fields = extractAgentActionFields({
      kind: 'ObservationEvent',
      observation: {
        kind: 'BrowserObservation',
        content: [
          { type: 'text', text: 'page text' },
          { type: 'image', image_urls: ['data:image/png;base64,abc'] },
        ],
      },
    });
    expect(Array.isArray(fields.content)).toBe(true);
    expect((fields.content as { type: string }[])[0].type).toBe('text');
  });

  it('extracts file editor fields', () => {
    const fields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: {
        kind: 'FileEditorAction',
        path: '/tmp/a.ts',
        command: 'view',
        file_text: 'const x = 1;',
        old_str: 'foo',
        new_str: 'bar',
      },
    });
    expect(fields.path).toBe('/tmp/a.ts');
    expect(fields.command).toBe('view');
    expect(fields.file_text).toBe('const x = 1;');
    expect(fields.old_str).toBe('foo');
    expect(fields.new_str).toBe('bar');
  });

  it('extracts browser navigation fields', () => {
    const fields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: {
        kind: 'BrowserNavigateAction',
        url: 'https://example.com',
        new_tab: true,
        tab_id: 'abc',
        include_screenshot: true,
      },
    });
    expect(fields.url).toBe('https://example.com');
    expect(fields.new_tab).toBe(true);
    expect(fields.tab_id).toBe('abc');
    expect(fields.include_screenshot).toBe(true);
  });

  it('extracts MCP fields including tool_name and data', () => {
    const fields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: {
        kind: 'MCPToolAction',
        tool_name: 'search',
        data: { query: 'rust' },
      },
    });
    expect(fields.tool_name).toBe('search');
    expect(fields.data).toEqual({ query: 'rust' });
  });

  it('extracts task tracker task_list', () => {
    const fields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: {
        kind: 'TaskTrackerAction',
        task_list: [
          { title: 'one', status: 'todo' },
          { title: 'two', status: 'in_progress', notes: 'wip' },
          { title: 'three', status: 'done' },
        ],
      },
    });
    expect(fields.task_list).toHaveLength(3);
    expect(fields.task_list?.[1].notes).toBe('wip');
  });

  it('drops malformed task entries', () => {
    const fields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: {
        kind: 'TaskTrackerAction',
        task_list: [
          { title: 'ok', status: 'done' },
          { title: 123, status: 'todo' }, // bad title
          { title: 'bad-status', status: 'invalid' }, // bad status
        ],
      },
    });
    expect(fields.task_list).toHaveLength(1);
  });

  it('extracts grep/glob arrays', () => {
    const fields = extractAgentActionFields({
      kind: 'ObservationEvent',
      observation: {
        kind: 'GlobObservation',
        files: ['a.ts', 'b.ts'],
        matches: ['line 1'],
      },
    });
    expect(fields.files).toEqual(['a.ts', 'b.ts']);
    expect(fields.matches).toEqual(['line 1']);
  });

  it('extracts action_id linkage from observation', () => {
    const fields = extractAgentActionFields({
      kind: 'ObservationEvent',
      observation: {
        kind: 'ExecuteBashObservation',
        action_id: 'parent-action-1',
      },
    });
    expect(fields.action_id).toBe('parent-action-1');
  });

  it('extracts skill_name only for invoke-skill events', () => {
    const skillFields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: { kind: 'InvokeSkillAction', name: 'create-pr' },
    });
    expect(skillFields.skill_name).toBe('create-pr');

    // `name` on an unrelated event must not be treated as a skill name.
    const otherFields = extractAgentActionFields({
      kind: 'ActionEvent',
      action: { kind: 'ExecuteBashAction', command: 'ls', name: 'should-not-leak' },
    });
    expect(otherFields.skill_name).toBeUndefined();
  });

  it('returns empty object for events with no extractable fields', () => {
    expect(extractAgentActionFields({ kind: 'SystemPromptEvent' })).toEqual({});
  });
});

describe('normalizeAgentEvent', () => {
  it('produces an AgentAction with id/timestamp/kind/source/summary', () => {
    const raw: RawAgentEvent = {
      id: 'evt-123',
      kind: 'ActionEvent',
      source: 'agent',
      timestamp: '2026-05-21T10:00:00.000Z',
      summary: 'Run command',
      action: { kind: 'ExecuteBashAction', command: 'ls' },
    };
    const action = normalizeAgentEvent(raw);
    expect(action.id).toBe('evt-123');
    expect(action.kind).toBe('ExecuteBashAction');
    expect(action.source).toBe('agent');
    expect(action.summary).toBe('Run command');
    expect(action.command).toBe('ls');
    expect(action.timestamp).toBe('2026-05-21T10:00:00.000Z');
  });

  it('appends Z to naive UTC OH timestamps via parseOhTimestamp (issue #264)', () => {
    const raw: RawAgentEvent = {
      id: 'evt-1',
      kind: 'ActionEvent',
      timestamp: '2026-05-21T10:00:00.000000', // naive, no Z
      action: { kind: 'ExecuteBashAction', command: 'ls' },
    };
    const action = normalizeAgentEvent(raw);
    // Naive UTC timestamp should be parsed as UTC, not local.
    expect(new Date(action.timestamp).toISOString()).toBe(
      '2026-05-21T10:00:00.000Z',
    );
  });

  it('generates a UUID when id is missing (synthetic event)', () => {
    const raw: RawAgentEvent = {
      kind: 'AgentStateChangeEvent',
      timestamp: '2026-05-21T10:00:00Z',
    };
    const a = normalizeAgentEvent(raw);
    const b = normalizeAgentEvent(raw);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    // Each normalization of an id-less event yields a *new* UUID — this is
    // best-effort dedupe per issue #269.
    expect(a.id).not.toBe(b.id);
  });

  it('defaults source to "unknown" when absent', () => {
    const action = normalizeAgentEvent({
      id: 'x',
      kind: 'TerminalAction',
      timestamp: '2026-05-21T10:00:00Z',
    });
    expect(action.source).toBe('unknown');
  });

  it('falls back to current time when timestamp is missing', () => {
    const before = Date.now();
    const action = normalizeAgentEvent({
      id: 'x',
      kind: 'TerminalAction',
    });
    const after = Date.now();
    const parsed = new Date(action.timestamp).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it('preserves nested observation content end-to-end', () => {
    const raw: RawAgentEvent = {
      id: 'obs-1',
      kind: 'ObservationEvent',
      source: 'environment',
      timestamp: '2026-05-21T10:00:01Z',
      observation: {
        kind: 'ExecuteBashObservation',
        content: 'hello\nworld',
        exit_code: 0,
        action_id: 'act-1',
      },
    };
    const action = normalizeAgentEvent(raw);
    expect(action.kind).toBe('ExecuteBashObservation');
    expect(action.content).toBe('hello\nworld');
    expect(action.exit_code).toBe(0);
    expect(action.action_id).toBe('act-1');
  });
});

describe('normalizeAgentEvents', () => {
  it('preserves input order', () => {
    const raws: RawAgentEvent[] = [
      { id: '1', kind: 'TerminalAction', timestamp: '2026-05-21T10:00:00Z' },
      { id: '2', kind: 'MessageEvent', timestamp: '2026-05-21T10:00:01Z' },
      { id: '3', kind: 'FinishAction', timestamp: '2026-05-21T10:00:02Z' },
    ];
    const out = normalizeAgentEvents(raws);
    expect(out.map(a => a.id)).toEqual(['1', '2', '3']);
  });

  it('returns an empty array for empty input', () => {
    expect(normalizeAgentEvents([])).toEqual([]);
  });
});

describe('shouldShowInKioskTimeline (issue #280)', () => {
  it('drops the kinds the server skip predicate also drops', () => {
    expect(shouldShowInKioskTimeline({ kind: 'SystemPromptEvent' })).toBe(false);
    expect(shouldShowInKioskTimeline({ kind: 'MessageEvent', source: 'agent' })).toBe(false);
    expect(shouldShowInKioskTimeline({ kind: 'MessageEvent', source: 'user' })).toBe(false);
    expect(shouldShowInKioskTimeline({ kind: 'MessageEvent', source: 'environment' })).toBe(false);
    expect(shouldShowInKioskTimeline({ kind: 'ConversationStateUpdateEvent' })).toBe(false);
    expect(shouldShowInKioskTimeline({ kind: 'ConversationErrorEvent' })).toBe(false);
    expect(shouldShowInKioskTimeline({ kind: 'ServerErrorEvent' })).toBe(false);
  });

  it('keeps wrapped ActionEvent / ObservationEvent and direct *Action / *Observation kinds', () => {
    expect(shouldShowInKioskTimeline({ kind: 'ActionEvent' })).toBe(true);
    expect(shouldShowInKioskTimeline({ kind: 'ObservationEvent' })).toBe(true);
    expect(shouldShowInKioskTimeline({ kind: 'TerminalAction' })).toBe(true);
    expect(shouldShowInKioskTimeline({ kind: 'TerminalObservation' })).toBe(true);
  });

  it('keeps unknown future event kinds (default-show regression guard)', () => {
    expect(shouldShowInKioskTimeline({ kind: 'SomeFutureEvent' })).toBe(true);
    expect(shouldShowInKioskTimeline({ kind: 'BrandNewAction' })).toBe(true);
  });

  it('default-shows malformed inputs to mirror the server (issue #280 parity)', () => {
    // Server's `shouldSkipForKioskTimeline` returns `false` (= don't skip
    // = SHOW) for null / undefined / non-object / missing-kind. The client
    // mirrors that so a malformed payload never gets silently dropped on
    // one side and kept on the other. The renderer handles "Unknown" kind
    // gracefully, so default-show is the safer of two safe options.
    expect(shouldShowInKioskTimeline(null)).toBe(true);
    expect(shouldShowInKioskTimeline(undefined)).toBe(true);
    expect(shouldShowInKioskTimeline({})).toBe(true);
    // Non-string `kind` falls back to default-show.
    expect(shouldShowInKioskTimeline({ kind: 123 } as unknown as RawAgentEvent)).toBe(true);
  });
});

describe('filterKioskTimelineEvents (issue #280 — fixture-driven)', () => {
  // Lazy fixture loader. Path is relative to this test file at runtime, so
  // we resolve via import.meta.url to stay robust against CWD changes.
  function loadFixture(): RawAgentEvent[] {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixturePath = path.resolve(here, '../../../test-fixtures/raw-events-real.json');
    const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { items: RawAgentEvent[] };
    return raw.items;
  }

  it('reduces the 23-event real fixture to the 4 surviving Terminal events', () => {
    // The real fixture from a recorded session contains 23 persisted events.
    // After the kiosk-timeline filter the only events that survive are the
    // two TerminalAction / TerminalObservation pairs:
    //   indices 7, 8  → TerminalAction + TerminalObservation
    //   indices 18, 19 → TerminalAction + TerminalObservation
    // (See issue #280 RCA — without the filter the refresh path renders 17
    // empty "Message" / "ConversationStateUpdate" / "SystemPrompt" cards.)
    const items = loadFixture();
    expect(items).toHaveLength(23);

    const filtered = filterKioskTimelineEvents(items);
    expect(filtered).toHaveLength(4);

    const kinds = filtered.map(getEffectiveKind);
    expect(kinds).toEqual([
      'TerminalAction',
      'TerminalObservation',
      'TerminalAction',
      'TerminalObservation',
    ]);
  });

  it('after pairAgentEvents-style filtering, normalization preserves the 4 actions', () => {
    // Composition with normalizeAgentEvents — what the live/refresh paths
    // actually deliver to useAgentActions. We sanity-check that the normalized
    // shape carries the expected fields so AgentEventCard has something to
    // render.
    const items = loadFixture();
    const filtered = filterKioskTimelineEvents(items);
    const normalized = normalizeAgentEvents(filtered);

    expect(normalized.map(a => a.kind)).toEqual([
      'TerminalAction',
      'TerminalObservation',
      'TerminalAction',
      'TerminalObservation',
    ]);
    // Both Terminal observations carry observation content; both actions
    // carry a command. These are what the renderer dispatches on.
    expect(normalized[0].command).toBeDefined();
    expect(normalized[2].command).toBeDefined();
    // action_id links observation → action (issue #258 contract).
    expect(normalized[1].action_id).toBeDefined();
    expect(normalized[3].action_id).toBeDefined();
  });

  it('parity guard: predicate matches expected per-index outcome (regression guard)', () => {
    // Hard-coded expected outcome per index for the 23 fixture items. If
    // either the server (`shouldSkipForKioskTimeline`) or the client
    // (`shouldShowInKioskTimeline`) drifts, this test must be updated in
    // lockstep — which is exactly the cross-checking we want for #280.
    const items = loadFixture();
    const expectedShow = [
      false, // 0 ConversationStateUpdateEvent
      false, // 1 ConversationStateUpdateEvent
      false, // 2 SystemPromptEvent
      false, // 3 MessageEvent user
      false, // 4 ConversationStateUpdateEvent
      false, // 5 ConversationStateUpdateEvent
      false, // 6 ConversationStateUpdateEvent
      true,  // 7 ActionEvent (TerminalAction)
      true,  // 8 ObservationEvent (TerminalObservation)
      false, // 9 ConversationStateUpdateEvent
      false, // 10 ConversationStateUpdateEvent
      false, // 11 MessageEvent agent
      false, // 12 ConversationStateUpdateEvent
      false, // 13 ConversationStateUpdateEvent
      false, // 14 MessageEvent user
      false, // 15 ConversationStateUpdateEvent
      false, // 16 ConversationStateUpdateEvent
      false, // 17 ConversationStateUpdateEvent
      true,  // 18 ActionEvent (TerminalAction)
      true,  // 19 ObservationEvent (TerminalObservation)
      false, // 20 ConversationStateUpdateEvent
      false, // 21 MessageEvent agent
      false, // 22 ConversationStateUpdateEvent
    ];
    const actual = items.map(e => shouldShowInKioskTimeline(e));
    expect(actual).toEqual(expectedShow);
  });
});
