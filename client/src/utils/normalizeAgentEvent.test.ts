import { describe, it, expect } from 'vitest';
import {
  normalizeAgentEvent,
  normalizeAgentEvents,
  getEffectiveKind,
  getEventSummary,
  extractAgentActionFields,
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
