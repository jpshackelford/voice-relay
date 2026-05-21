import { useState, useCallback } from 'react';
import type { AgentAction, AgentActionMessage } from '../types';

/** Maximum number of actions to retain */
const MAX_ACTIONS = 50;

/** Local storage key for toggle state */
const STORAGE_KEY = 'showAgentActions';

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
   * Filters by sessionId if provided, and maintains max action count.
   */
  const handleAgentAction = useCallback((message: AgentActionMessage) => {
    // Filter by session if we have a sessionId
    if (sessionId && message.sessionId !== sessionId) {
      return;
    }
    
    setActions((prev) => {
      const updated = [...prev, message.action];
      // Keep only the last MAX_ACTIONS
      return updated.slice(-MAX_ACTIONS);
    });
  }, [sessionId]);

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
