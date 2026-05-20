import { useState } from 'react';
import { SuccessIndicator, getObservationStatus } from './SuccessIndicator';
import { getActionIcon } from '../hooks/useAgentActions';
import type { AgentAction, ExtendedAgentAction } from '../types';

interface AgentEventCardProps {
  action: AgentAction | ExtendedAgentAction;
  /** Whether to start expanded (default: false) */
  defaultExpanded?: boolean;
}

/**
 * Collapsible card for displaying agent events inline with conversation.
 * Based on OpenHands' GenericEventMessage patterns.
 * 
 * Features:
 * - Purple left border to distinguish from user/AI messages
 * - Collapsible details section
 * - Success/timeout indicator for observations
 * - Action icon based on event kind
 */
export function AgentEventCard({ action, defaultExpanded = false }: AgentEventCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Determine if this is an extended action with observation data
  const extendedAction = action as ExtendedAgentAction;
  const isObservation = extendedAction.isObservation ?? isObservationKind(action.kind);
  const status = isObservation 
    ? getObservationStatus(extendedAction.exitCode, extendedAction.isError)
    : 'pending';

  // Get icon for the action kind
  const icon = getActionIcon(action.kind);

  // Get formatted title (use summary if available)
  const title = action.summary || formatActionKind(action.kind);

  return (
    <div className="agent-event-card">
      <div 
        className="agent-event-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse details' : 'Expand details'}
      >
        <div className="agent-event-title">
          <span className="agent-event-icon">{icon}</span>
          <span className="agent-event-summary">{title}</span>
          <span className="agent-event-toggle" aria-hidden="true">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
        <div className="agent-event-status">
          {isObservation && <SuccessIndicator status={status} />}
        </div>
      </div>

      {expanded && (
        <div className="agent-event-details">
          <div className="agent-event-kind">{action.kind}</div>
          <div className="agent-event-timestamp">
            {formatTimestamp(action.timestamp)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Check if the event kind represents an observation (result) vs action (initiated).
 * Any kind containing 'Observation' is treated as an observation.
 */
function isObservationKind(kind: string): boolean {
  return kind.includes('Observation');
}

/**
 * Format action kind into a readable title.
 * Removes "Action" or "Observation" suffix and adds spaces.
 */
function formatActionKind(kind: string): string {
  return kind
    .replace(/Action$/, '')
    .replace(/Observation$/, '')
    .replace(/Event$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

/**
 * Format timestamp for display.
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return timestamp;
  }
}
