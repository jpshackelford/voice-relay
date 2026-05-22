import { useState, useCallback } from 'react';
import type { AgentAction, AgentActionMessage } from '../types';

/** Maximum number of actions to retain */
const MAX_ACTIONS = 50;

/** Local storage key for toggle state */
const STORAGE_KEY = 'showAgentActions';

/**
 * Merge an existing list and one or more incoming events into a single
 * dedupe-by-id list, preserving insertion order (base first, then incoming)
 * and trimming to {@link MAX_ACTIONS} from the *tail* (most recent kept).
 *
 * Used by `handleAgentAction` to fold a new live event into existing state.
 * `seedActions` does *not* use this helper because it needs the opposite
 * ordering (historical seed inserted *before* existing live events) — see
 * its own inline dedupe loop below. See issue #269 — dedupe strategy.
 *
 * Note: synthetic events with no upstream id receive a fresh UUID each time
 * the normalizer runs, so they cannot dedupe across the live ↔ history
 * boundary. Acceptable for v1 — bias toward "show twice rather than drop"
 * (see issue #269 risk section).
 */
function mergeAndDedupe(
  base: ReadonlyArray<AgentAction>,
  incoming: ReadonlyArray<AgentAction>,
): AgentAction[] {
  if (incoming.length === 0) return [...base];

  const seen = new Set<string>();
  const out: AgentAction[] = [];

  // Base entries take precedence on id-collision (preserves the existing
  // reference so React reconciles minimally). Seed-then-live ordering is the
  // caller's responsibility — see seedActions.
  for (const a of base) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  for (const a of incoming) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }

  return out.length > MAX_ACTIONS ? out.slice(-MAX_ACTIONS) : out;
}

/**
 * Hook to manage agent action events for the kiosk display.
 * Provides state for actions list, toggle visibility, and handles incoming action messages.
 * 
 * @param sessionId - Current session ID to filter actions
 * @returns Agent actions state and handlers
 */
export function useAgentActions(sessionId?: string) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [showActions, setShowActions] = useState(() => {
    // Load initial state from localStorage
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false; // Default to hidden
    }
  });

  /**
   * Handle incoming agent action message from WebSocket.
   * Filters by sessionId if provided. Dedupes against already-seeded
   * history (or earlier live events) by `AgentAction.id` and maintains the
   * {@link MAX_ACTIONS} retention cap (oldest trimmed first).
   *
   * Issue #269: dedupe-by-id allows a live message that overlaps the
   * persisted history to be a no-op rather than render twice.
   */
  const handleAgentAction = useCallback((message: AgentActionMessage) => {
    // Filter by session if we have a sessionId
    if (sessionId && message.sessionId !== sessionId) {
      return;
    }

    setActions((prev) => mergeAndDedupe(prev, [message.action]));
  }, [sessionId]);

  /**
   * Seed the actions state with historical events fetched from
   * `GET /api/sessions/:sessionId/agent-events` (issue #269).
   *
   * Behavior:
   * - Historical events are placed *before* any live events already in
   *   state, so the timeline reads chronologically when seed arrives after
   *   the first live events.
   * - Dedupe is by `AgentAction.id`. Live events already in state win on
   *   id-collision (their object reference is preserved so React reconciles
   *   minimally and any in-flight observation linkage stays intact).
   * - Respects the {@link MAX_ACTIONS} cap, trimming the *oldest* entries
   *   first — matches kiosk UX of "show me the most recent N".
   * - Empty seed is a no-op.
   *
   * Idempotent: calling with the same seed twice yields the same state.
   */
  const seedActions = useCallback((seed: ReadonlyArray<AgentAction>) => {
    if (seed.length === 0) return;
    setActions((prev) => {
      // Build the live-id set first so we can skip seed entries that have
      // already been delivered live. Preserves live object references on
      // id-collision (existing-instance wins).
      const liveIds = new Set(prev.map(a => a.id));
      const merged: AgentAction[] = [];
      for (const a of seed) {
        if (!liveIds.has(a.id)) merged.push(a);
      }
      // Append all existing live events after the historical seed.
      for (const a of prev) {
        merged.push(a);
      }
      return merged.length > MAX_ACTIONS
        ? merged.slice(-MAX_ACTIONS)
        : merged;
    });
  }, []);

  /**
   * Toggle the visibility of the actions panel.
   * Persists state to localStorage.
   */
  const toggleShowActions = useCallback(() => {
    setShowActions((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(newValue));
      } catch {
        // Ignore localStorage errors (e.g., private browsing)
      }
      return newValue;
    });
  }, []);

  /**
   * Clear all stored actions.
   * Useful when changing sessions or resetting state.
   */
  const clearActions = useCallback(() => {
    setActions([]);
  }, []);

  return {
    /** List of agent actions (most recent last) */
    actions,
    /** Whether the actions panel is visible */
    showActions,
    /** Handle an incoming agent action message */
    handleAgentAction,
    /** Toggle the visibility of the actions panel */
    toggleShowActions,
    /** Clear all stored actions */
    clearActions,
    /** Seed actions with historical events (issue #269) */
    seedActions,
  };
}

/**
 * Get an emoji icon for an action kind.
 * Used for visual distinction in the UI.
 * 
 * Supports both V1Event kinds (ExecuteBashAction, etc.) and
 * legacy kinds (CmdRunAction, etc.) for backward compatibility.
 */
export function getActionIcon(kind: string): string {
  switch (kind) {
    // === Terminal actions/observations ===
    case 'ExecuteBashAction':
    case 'TerminalAction':
    case 'CmdRunAction':  // Legacy
      return '🔧';
    case 'ExecuteBashObservation':
    case 'TerminalObservation':
    case 'CmdOutputObservation':  // Legacy
      return '📤';

    // === File actions/observations ===
    case 'FileEditorAction':
    case 'StrReplaceEditorAction':
    case 'FileReadAction':  // Legacy
    case 'FileWriteAction':  // Legacy
    case 'FileEditAction':  // Legacy
      return '📁';
    case 'FileEditorObservation':
    case 'StrReplaceEditorObservation':
      return '✏️';

    // === Browser actions/observations ===
    case 'BrowserNavigateAction':
    case 'BrowserClickAction':
    case 'BrowserTypeAction':
    case 'BrowserGetStateAction':
    case 'BrowserGetContentAction':
    case 'BrowserScrollAction':
    case 'BrowserGoBackAction':
    case 'BrowserListTabsAction':
    case 'BrowserSwitchTabAction':
    case 'BrowserCloseTabAction':
    case 'BrowseURLAction':  // Legacy
    case 'BrowseInteractiveAction':  // Legacy
      return '🌐';
    case 'BrowserObservation':
      return '🖥️';

    // === MCP tool actions/observations ===
    case 'MCPToolAction':
      return '🔌';
    case 'MCPToolObservation':
      return '📋';

    // === Search actions/observations ===
    case 'GrepAction':
    case 'GlobAction':
      return '🔍';
    case 'GrepObservation':
    case 'GlobObservation':
      return '📜';

    // === Think/Finish actions/observations ===
    case 'ThinkAction':
    case 'AgentThinkAction':  // Legacy
      return '💭';
    case 'ThinkObservation':
      return '💡';
    case 'FinishAction':
    case 'AgentFinishAction':  // Legacy
      return '✅';
    case 'FinishObservation':
      return '🏁';

    // === Task tracker ===
    case 'TaskTrackerAction':
    case 'TaskTrackerObservation':
      return '📋';

    // === State/delegate actions ===
    case 'AgentStateChangeEvent':
      return '🔄';
    case 'AgentDelegateAction':
      return '🤝';
    case 'AgentRejectAction':
      return '⛔';

    // === Message/communication ===
    case 'MessageAction':
      return '💬';

    default:
      return '⚡';
  }
}
