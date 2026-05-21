import { useState, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { SuccessIndicator, getObservationStatus } from './SuccessIndicator';
import { getActionIcon } from '../hooks/useAgentActions';
import { getEventContent } from '../utils/getEventContent';
import type { AgentAction, ExtendedAgentAction } from '../types';

// Configure marked for code blocks and basic markdown
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface AgentEventCardProps {
  action: AgentAction | ExtendedAgentAction;
  /** Whether to start expanded (default: false) */
  defaultExpanded?: boolean;
}

/**
 * Parse markdown to sanitized HTML.
 * Uses marked for parsing and DOMPurify for XSS protection.
 */
function parseMarkdown(text: string): string {
  const rawHtml = marked.parse(text) as string;
  return DOMPurify.sanitize(rawHtml);
}

/**
 * Collapsible card for displaying agent events inline with conversation.
 * Based on OpenHands' GenericEventMessage patterns.
 * 
 * Features:
 * - Purple left border to distinguish from user/AI messages
 * - Collapsible details section with rich markdown content
 * - Success/timeout indicator for observations
 * - Action icon based on event kind
 */
export function AgentEventCard({ action, defaultExpanded = false }: AgentEventCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Determine if this is an extended action with observation data
  // Now use V1Event field names (exit_code, is_error, timeout)
  const extendedAction = action as ExtendedAgentAction;
  const isObservation = extendedAction.isObservation ?? isObservationKind(action.kind);
  
  // Use V1Event fields from AgentAction (exit_code, is_error, timeout)
  // with fallback to ExtendedAgentAction fields for backward compatibility
  const exitCode = action.exit_code ?? extendedAction.exitCode;
  const isError = action.is_error ?? extendedAction.isError;
  const isTimeout = action.timeout;
  
  const status = isObservation 
    ? getObservationStatus(exitCode, isError, isTimeout)
    : 'pending';

  // Get icon for the action kind
  const icon = getActionIcon(action.kind);

  // Get formatted title (use summary if available)
  const title = action.summary || formatActionKind(action.kind);

  // Get rich content for expanded view (memoized for performance)
  const expandedContent = useMemo(() => {
    if (!expanded) return '';
    
    // Get formatted content from helper
    const content = getEventContent(action);
    
    // If we got content from the helper, use it
    // Otherwise fall back to summary
    return content || action.summary || '';
  }, [expanded, action]);

  // Parse markdown content (memoized)
  const renderedContent = useMemo(() => {
    if (!expandedContent) return '';
    return parseMarkdown(expandedContent);
  }, [expandedContent]);

  return (
    <div className="agent-event-card">
      <div 
        className="agent-event-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
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

      {expanded && renderedContent && (
        <div className="agent-event-details">
          <div 
            className="agent-event-content"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
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
