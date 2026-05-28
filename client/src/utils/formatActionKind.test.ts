import { describe, it, expect } from 'vitest';
import { formatActionKind, isObservationKind } from './formatActionKind';

describe('formatActionKind', () => {
  it('strips the Action suffix and adds spaces', () => {
    expect(formatActionKind('ExecuteBashAction')).toBe('Execute Bash');
  });

  it('strips the Observation suffix and adds spaces', () => {
    expect(formatActionKind('ExecuteBashObservation')).toBe('Execute Bash');
  });

  it('strips the Event suffix and adds spaces', () => {
    expect(formatActionKind('AgentStateChangeEvent')).toBe('Agent State Change');
  });

  it('returns the kind unchanged when no recognized suffix is present', () => {
    expect(formatActionKind('Foo')).toBe('Foo');
  });

  it('handles multi-camel-case correctly', () => {
    expect(formatActionKind('StrReplaceEditorAction')).toBe('Str Replace Editor');
  });
});

describe('isObservationKind', () => {
  it('returns true for known observation kinds', () => {
    expect(isObservationKind('ExecuteBashObservation')).toBe(true);
    expect(isObservationKind('FileEditorObservation')).toBe(true);
    expect(isObservationKind('MCPToolObservation')).toBe(true);
    expect(isObservationKind('BrowserObservation')).toBe(true);
  });

  it('returns false for action kinds', () => {
    expect(isObservationKind('ExecuteBashAction')).toBe(false);
    expect(isObservationKind('FileEditorAction')).toBe(false);
    expect(isObservationKind('MCPToolAction')).toBe(false);
    expect(isObservationKind('FinishAction')).toBe(false);
  });

  it('returns false for empty or arbitrary strings', () => {
    expect(isObservationKind('')).toBe(false);
    expect(isObservationKind('Foo')).toBe(false);
  });

  // The heuristic is substring-based; verify it matches anywhere in the
  // kind string so future kinds like 'NestedObservationWrapper' (hypothetical)
  // are still classified correctly.
  it('treats substring matches as observations', () => {
    expect(isObservationKind('SomeObservationThing')).toBe(true);
  });
});
