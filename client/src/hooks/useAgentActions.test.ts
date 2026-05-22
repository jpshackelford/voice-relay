import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentActions, getActionIcon } from './useAgentActions';
import type { AgentAction, AgentActionMessage } from '../types';

/** Test fixture builder for AgentAction. */
function makeAction(id: string, overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id,
    timestamp: `2026-05-21T10:00:${id.padStart(2, '0').slice(-2)}.000Z`,
    kind: 'CmdRunAction',
    source: 'agent',
    summary: `Action ${id}`,
    ...overrides,
  };
}

// Mock localStorage with proper reset between tests
let localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    localStorageStore = {};
  }),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('useAgentActions hook', () => {
  beforeEach(() => {
    // Reset the mock store between tests
    localStorageStore = {};
    vi.clearAllMocks();
  });

  it('initializes with empty actions and showActions false', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    expect(result.current.actions).toHaveLength(0);
    expect(result.current.showActions).toBe(false);
  });

  it('loads showActions state from localStorage', () => {
    // Set the value in the store before rendering
    localStorageStore['showAgentActions'] = 'true';

    const { result } = renderHook(() => useAgentActions('session-123'));

    expect(result.current.showActions).toBe(true);
  });

  it('toggleShowActions updates state and localStorage', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    expect(result.current.showActions).toBe(false);

    act(() => {
      result.current.toggleShowActions();
    });

    expect(result.current.showActions).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('showAgentActions', 'true');

    act(() => {
      result.current.toggleShowActions();
    });

    expect(result.current.showActions).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('showAgentActions', 'false');
  });

  it('handleAgentAction adds action to list', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    const message: AgentActionMessage = {
      type: 'agent-action',
      sessionId: 'session-123',
      action: {
        id: 'action-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        kind: 'CmdRunAction',
        source: 'agent',
        summary: 'npm install',
      },
    };

    act(() => {
      result.current.handleAgentAction(message);
    });

    expect(result.current.actions).toHaveLength(1);
    expect(result.current.actions[0].id).toBe('action-1');
    expect(result.current.actions[0].kind).toBe('CmdRunAction');
  });

  it('handleAgentAction filters by sessionId', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    const matchingMessage: AgentActionMessage = {
      type: 'agent-action',
      sessionId: 'session-123',
      action: {
        id: 'action-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        kind: 'CmdRunAction',
        source: 'agent',
        summary: 'matching session',
      },
    };

    const nonMatchingMessage: AgentActionMessage = {
      type: 'agent-action',
      sessionId: 'other-session',
      action: {
        id: 'action-2',
        timestamp: '2024-01-01T00:00:01.000Z',
        kind: 'FileReadAction',
        source: 'agent',
        summary: 'non-matching session',
      },
    };

    act(() => {
      result.current.handleAgentAction(matchingMessage);
      result.current.handleAgentAction(nonMatchingMessage);
    });

    expect(result.current.actions).toHaveLength(1);
    expect(result.current.actions[0].id).toBe('action-1');
  });

  it('handleAgentAction accepts all actions when sessionId is undefined', () => {
    const { result } = renderHook(() => useAgentActions(undefined));

    const message1: AgentActionMessage = {
      type: 'agent-action',
      sessionId: 'session-1',
      action: {
        id: 'action-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        kind: 'CmdRunAction',
        source: 'agent',
        summary: 'action 1',
      },
    };

    const message2: AgentActionMessage = {
      type: 'agent-action',
      sessionId: 'session-2',
      action: {
        id: 'action-2',
        timestamp: '2024-01-01T00:00:01.000Z',
        kind: 'FileReadAction',
        source: 'agent',
        summary: 'action 2',
      },
    };

    act(() => {
      result.current.handleAgentAction(message1);
      result.current.handleAgentAction(message2);
    });

    expect(result.current.actions).toHaveLength(2);
  });

  it('limits actions to 50 items', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    // Add 60 actions
    act(() => {
      for (let i = 0; i < 60; i++) {
        result.current.handleAgentAction({
          type: 'agent-action',
          sessionId: 'session-123',
          action: {
            id: `action-${i}`,
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
            kind: 'CmdRunAction',
            source: 'agent',
            summary: `action ${i}`,
          },
        });
      }
    });

    expect(result.current.actions).toHaveLength(50);
    // Should keep the last 50 (indices 10-59)
    expect(result.current.actions[0].id).toBe('action-10');
    expect(result.current.actions[49].id).toBe('action-59');
  });

  it('clearActions removes all actions', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    // Add some actions
    act(() => {
      result.current.handleAgentAction({
        type: 'agent-action',
        sessionId: 'session-123',
        action: {
          id: 'action-1',
          timestamp: '2024-01-01T00:00:00.000Z',
          kind: 'CmdRunAction',
          source: 'agent',
          summary: 'action 1',
        },
      });
      result.current.handleAgentAction({
        type: 'agent-action',
        sessionId: 'session-123',
        action: {
          id: 'action-2',
          timestamp: '2024-01-01T00:00:01.000Z',
          kind: 'FileReadAction',
          source: 'agent',
          summary: 'action 2',
        },
      });
    });

    expect(result.current.actions).toHaveLength(2);

    act(() => {
      result.current.clearActions();
    });

    expect(result.current.actions).toHaveLength(0);
  });

  // === Issue #269: history hydration + dedupe ===

  it('handleAgentAction dedupes by id (live event with already-seen id is a no-op)', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    const message: AgentActionMessage = {
      type: 'agent-action',
      sessionId: 'session-123',
      action: makeAction('act-1', { summary: 'first' }),
    };

    act(() => {
      result.current.handleAgentAction(message);
      // Same id, different summary — should be ignored.
      result.current.handleAgentAction({
        ...message,
        action: makeAction('act-1', { summary: 'second' }),
      });
    });

    expect(result.current.actions).toHaveLength(1);
    expect(result.current.actions[0].summary).toBe('first');
  });

  it('seedActions populates empty state', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    const seed: AgentAction[] = [makeAction('h1'), makeAction('h2'), makeAction('h3')];

    act(() => {
      result.current.seedActions(seed);
    });

    expect(result.current.actions).toHaveLength(3);
    expect(result.current.actions.map(a => a.id)).toEqual(['h1', 'h2', 'h3']);
  });

  it('seedActions is a no-op when given an empty array', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    act(() => {
      result.current.handleAgentAction({
        type: 'agent-action',
        sessionId: 'session-123',
        action: makeAction('live-1'),
      });
      result.current.seedActions([]);
    });

    expect(result.current.actions).toHaveLength(1);
    expect(result.current.actions[0].id).toBe('live-1');
  });

  it('seedActions dedupes against live events that arrived before hydration (live wins)', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    const liveAction = makeAction('shared-1', { summary: 'live version' });
    const seedDuplicate = makeAction('shared-1', { summary: 'historical version' });
    const seedNew = makeAction('hist-only');

    act(() => {
      // Live event arrives first (race condition)
      result.current.handleAgentAction({
        type: 'agent-action',
        sessionId: 'session-123',
        action: liveAction,
      });
      // Then history hydration completes
      result.current.seedActions([seedDuplicate, seedNew]);
    });

    // Expect: historical-only entry first, then live entry. Live wins on
    // id-collision (its summary "live version" remains).
    expect(result.current.actions).toHaveLength(2);
    const idToAction = new Map(result.current.actions.map(a => [a.id, a]));
    expect(idToAction.get('shared-1')?.summary).toBe('live version');
    expect(idToAction.get('hist-only')?.summary).toBe('Action hist-only');
    // History ordered before live
    expect(result.current.actions[0].id).toBe('hist-only');
    expect(result.current.actions[1].id).toBe('shared-1');
  });

  it('live events that overlap seeded history do not double-render (history-then-live)', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    act(() => {
      result.current.seedActions([makeAction('h1'), makeAction('h2')]);
    });

    expect(result.current.actions).toHaveLength(2);

    act(() => {
      // Server replays h2 over WS — should be ignored.
      result.current.handleAgentAction({
        type: 'agent-action',
        sessionId: 'session-123',
        action: makeAction('h2', { summary: 'duplicated over ws' }),
      });
      // And a brand new live event arrives.
      result.current.handleAgentAction({
        type: 'agent-action',
        sessionId: 'session-123',
        action: makeAction('live-1'),
      });
    });

    expect(result.current.actions.map(a => a.id)).toEqual(['h1', 'h2', 'live-1']);
    // h2 keeps its original summary, not the WS replay's.
    expect(result.current.actions[1].summary).toBe('Action h2');
  });

  it('seedActions trims to MAX_ACTIONS keeping the most recent (tail)', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    // 60 historical events. Cap is 50 — should keep entries 10..59.
    const seed: AgentAction[] = [];
    for (let i = 0; i < 60; i++) {
      seed.push(makeAction(`h-${String(i).padStart(2, '0')}`));
    }

    act(() => {
      result.current.seedActions(seed);
    });

    expect(result.current.actions).toHaveLength(50);
    expect(result.current.actions[0].id).toBe('h-10');
    expect(result.current.actions[49].id).toBe('h-59');
  });

  it('seedActions is idempotent (calling twice with the same seed yields the same state)', () => {
    const { result } = renderHook(() => useAgentActions('session-123'));

    const seed: AgentAction[] = [makeAction('h1'), makeAction('h2')];

    act(() => {
      result.current.seedActions(seed);
    });
    const firstSnapshot = result.current.actions;

    act(() => {
      result.current.seedActions(seed);
    });

    expect(result.current.actions).toHaveLength(2);
    expect(result.current.actions.map(a => a.id)).toEqual(['h1', 'h2']);
    // Object refs preserved (no mutation cascade through React).
    expect(result.current.actions[0]).toBe(firstSnapshot[0]);
  });
});

describe('getActionIcon function', () => {
  it('returns correct icons for known action kinds', () => {
    // Terminal actions/observations (legacy kinds)
    expect(getActionIcon('CmdRunAction')).toBe('🔧');
    expect(getActionIcon('CmdOutputObservation')).toBe('📤');
    
    // File actions - all use 📁 for actions, ✏️ for observations (legacy kinds)
    expect(getActionIcon('FileReadAction')).toBe('📁');
    expect(getActionIcon('FileWriteAction')).toBe('📁');
    expect(getActionIcon('FileEditAction')).toBe('📁');
    
    // Browser actions (legacy kinds)
    expect(getActionIcon('BrowseURLAction')).toBe('🌐');
    expect(getActionIcon('BrowseInteractiveAction')).toBe('🌐');
    
    // Agent actions (legacy kinds)
    expect(getActionIcon('AgentThinkAction')).toBe('💭');
    expect(getActionIcon('AgentStateChangeEvent')).toBe('🔄');
    expect(getActionIcon('AgentFinishAction')).toBe('✅');
    expect(getActionIcon('AgentDelegateAction')).toBe('🤝');
    expect(getActionIcon('AgentRejectAction')).toBe('⛔');
    expect(getActionIcon('MessageAction')).toBe('💬');
  });

  it('returns correct icons for V1Event kinds', () => {
    // Terminal actions/observations (V1Event kinds)
    expect(getActionIcon('ExecuteBashAction')).toBe('🔧');
    expect(getActionIcon('TerminalAction')).toBe('🔧');
    expect(getActionIcon('ExecuteBashObservation')).toBe('📤');
    expect(getActionIcon('TerminalObservation')).toBe('📤');
    
    // File actions/observations (V1Event kinds)
    expect(getActionIcon('FileEditorAction')).toBe('📁');
    expect(getActionIcon('StrReplaceEditorAction')).toBe('📁');
    expect(getActionIcon('FileEditorObservation')).toBe('✏️');
    expect(getActionIcon('StrReplaceEditorObservation')).toBe('✏️');
    
    // Browser actions/observations
    expect(getActionIcon('BrowserNavigateAction')).toBe('🌐');
    expect(getActionIcon('BrowserClickAction')).toBe('🌐');
    expect(getActionIcon('BrowserObservation')).toBe('🖥️');
    
    // MCP tools
    expect(getActionIcon('MCPToolAction')).toBe('🔌');
    expect(getActionIcon('MCPToolObservation')).toBe('📋');
    
    // Search
    expect(getActionIcon('GrepAction')).toBe('🔍');
    expect(getActionIcon('GlobAction')).toBe('🔍');
    expect(getActionIcon('GrepObservation')).toBe('📜');
    expect(getActionIcon('GlobObservation')).toBe('📜');
    
    // Think/Finish
    expect(getActionIcon('ThinkAction')).toBe('💭');
    expect(getActionIcon('ThinkObservation')).toBe('💡');
    expect(getActionIcon('FinishAction')).toBe('✅');
    expect(getActionIcon('FinishObservation')).toBe('🏁');
    
    // Task tracker
    expect(getActionIcon('TaskTrackerAction')).toBe('📋');
    expect(getActionIcon('TaskTrackerObservation')).toBe('📋');
  });

  it('returns default icon for unknown action kinds', () => {
    expect(getActionIcon('UnknownAction')).toBe('⚡');
    expect(getActionIcon('')).toBe('⚡');
    expect(getActionIcon('RandomKind')).toBe('⚡');
  });
});
