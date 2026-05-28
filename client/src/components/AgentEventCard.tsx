import { useState, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { SuccessIndicator, getObservationStatus } from './SuccessIndicator';
import { getActionIcon } from '../hooks/useAgentActions';
import { getEventContent } from '../utils/getEventContent';
import { formatActionKind, isObservationKind } from '../utils/formatActionKind';
import type { AgentAction, ExtendedAgentAction, ObservationStatus } from '../types';

// Configure marked for code blocks and basic markdown
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface AgentEventCardProps {
  /** The agent action (request). Card title and icon come from here. */
  action: AgentAction | ExtendedAgentAction;
  /**
   * Optional matching observation (response). When present the card renders
   * both the action and the observation under an "Output:" header, and the
   * status indicator reflects the observation's exit_code / is_error /
   * timeout fields. When absent the card shows a "Pending…" indicator while
   * the agent is waiting for the tool to complete (issue #265).
   */
  observation?: AgentAction | ExtendedAgentAction;
  /** Whether to start expanded (default: false) */
  defaultExpanded?: boolean;
}

/**
 * Parse markdown to sanitized HTML.
 * Uses marked for parsing and DOMPurify for XSS protection.
 * Falls back to sanitized plaintext if parsing fails.
 */
function parseMarkdown(text: string): string {
  try {
    const rawHtml = marked.parse(text) as string;
    return DOMPurify.sanitize(rawHtml);
  } catch (error) {
    console.error('Markdown parsing failed:', error);
    return DOMPurify.sanitize(text);
  }
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
export function AgentEventCard({ action, observation, defaultExpanded = false }: AgentEventCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Decide which event carries the outcome (exit_code / is_error / timeout):
  //   - paired:     `observation` was passed in
  //   - orphan obs: `action` is itself an observation (no matching action)
  //   - pending:    neither — the action is in-flight, status = 'pending'
  const extendedAction = action as ExtendedAgentAction;
  const actionIsObservation = extendedAction.isObservation ?? isObservationKind(action.kind);
  const statusSource = observation ?? (actionIsObservation ? action : undefined);
  const statusExtended = statusSource as ExtendedAgentAction | undefined;

  const exitCode = statusSource?.exit_code ?? statusExtended?.exitCode;
  const isError = statusSource?.is_error ?? statusExtended?.isError;
  const isTimeout = statusSource?.timeout;

  const status: ObservationStatus = statusSource
    ? getObservationStatus(exitCode, isError, isTimeout)
    : 'pending';

  // Icon and title come from the action so the card identifies the operation
  // (TerminalAction "Display greeting on kiosk" rather than the bare
  // "Observation" we'd get from the response side).
  const icon = getActionIcon(action.kind);
  const title = action.summary || formatActionKind(action.kind);

  // Build expanded content: action body + observation body (if attached)
  // under an "Output:" header. Memoized so toggling expand state doesn't
  // re-parse markdown.
  const expandedContent = useMemo(() => {
    if (!expanded) return '';

    const actionContent = getEventContent(action) || action.summary || '';

    if (observation) {
      const observationContent = getEventContent(observation);
      if (observationContent) {
        return `${actionContent}\n\n**Output:**\n\n${observationContent}`;
      }
    }

    return actionContent;
  }, [expanded, action, observation]);

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
        <div className="agent-event-status" data-status={status}>
          <SuccessIndicator status={status} />
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

// `isObservationKind` is imported from ../utils/formatActionKind (issue #346 —
// shared between AgentEventCard and KioskMode's action ticker).


