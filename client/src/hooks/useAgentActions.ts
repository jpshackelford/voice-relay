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
    /** Number of actions currently stored */
    actionCount: actions.length,
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
 */
export function getActionIcon(kind: string): string {
  switch (kind) {
    case 'CmdRunAction':
      return '🔧';
    case 'CmdOutputObservation':
      return '📤';
    case 'FileReadAction':
      return '📁';
    case 'FileWriteAction':
    case 'FileEditAction':
      return '✏️';
    case 'BrowseURLAction':
    case 'BrowseInteractiveAction':
      return '🌐';
    case 'AgentThinkAction':
      return '💭';
    case 'AgentStateChangeEvent':
      return '🔄';
    case 'AgentFinishAction':
      return '✅';
    case 'AgentDelegateAction':
      return '🤝';
    case 'AgentRejectAction':
      return '⛔';
    case 'MessageAction':
      return '💬';
    default:
      return '⚡';
  }
}
