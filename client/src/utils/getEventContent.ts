/**
 * Content formatting helpers for agent events.
 * Ported from OpenHands frontend helpers with adaptations for voice-relay.
 * 
 * Reference:
 * - get-action-content.ts: https://github.com/All-Hands-AI/OpenHands/blob/main/frontend/src/components/v1/chat/event-content-helpers/get-action-content.ts
 * - get-observation-content.ts: https://github.com/All-Hands-AI/OpenHands/blob/main/frontend/src/components/v1/chat/event-content-helpers/get-observation-content.ts
 */

import type { AgentAction, ContentPart, TaskItem } from '../types';

/** Maximum content length before truncation */
export const MAX_CONTENT_LENGTH = 1000;

/**
 * Extract text content from a content field.
 * Handles both string and ContentPart[] formats.
 */
export function extractTextContent(content: ContentPart[] | string | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  
  return content
    .filter((c): c is ContentPart & { text: string } => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Truncate content and add indicator if too long.
 */
function truncateContent(content: string, maxLength = MAX_CONTENT_LENGTH): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}...(truncated)`;
}

/**
 * Format a task list with status icons.
 */
function formatTaskList(tasks: TaskItem[]): string {
  if (!tasks || tasks.length === 0) {
    return '**Task List:** Empty';
  }

  const statusMap: Record<string, string> = {
    todo: '⏳',
    in_progress: '🔄',
    done: '✅',
  };

  let content = `**Task List (${tasks.length} ${tasks.length === 1 ? 'item' : 'items'}):**\n`;
  
  tasks.forEach((task, index) => {
    const statusIcon = statusMap[task.status] || '❓';
    const statusLabel = task.status.toUpperCase().replace('_', ' ');
    content += `\n${index + 1}. ${statusIcon} **[${statusLabel}]** ${task.title}`;
    if (task.notes) {
      content += `\n   *Notes: ${task.notes}*`;
    }
  });

  return content;
}

// =============================================================================
// ACTION CONTENT HELPERS
// =============================================================================

/**
 * Get content for ExecuteBashAction / TerminalAction.
 */
function getExecuteBashActionContent(action: AgentAction): string {
  if (!action.command) return '';
  return `Command:\n\`${action.command}\``;
}

/**
 * Get content for FileEditorAction.
 *
 * The OpenHands file_editor tool dispatches on its `command` field
 * (view | create | str_replace | insert). We render an appropriate preview for
 * each so the card is never empty when the agent is operating on a file.
 */
function getFileEditorActionContent(action: AgentAction): string {
  const path = action.path || 'file';
  const command = action.command;

  // create: show the full new file body (truncated for long files)
  if (command === 'create' || (!command && action.file_text)) {
    const body = action.file_text ? truncateContent(action.file_text) : '';
    return body ? `**Create:** \`${path}\`\n\n\`\`\`\n${body}\n\`\`\`` : `**Create:** \`${path}\``;
  }

  // insert: show the inserted text. Checked before str_replace because both
  // can carry `new_str`.
  if (command === 'insert') {
    const body = action.new_str ? truncateContent(action.new_str) : '';
    return body
      ? `**Insert into:** \`${path}\`\n\n\`\`\`\n${body}\n\`\`\``
      : `**Insert into:** \`${path}\``;
  }

  // str_replace: show the before/after diff snippets
  if (command === 'str_replace' || action.old_str !== undefined || action.new_str !== undefined) {
    const parts: string[] = [`**Edit:** \`${path}\``];
    if (action.old_str !== undefined) {
      parts.push(`**Old:**\n\`\`\`\n${truncateContent(action.old_str)}\n\`\`\``);
    }
    if (action.new_str !== undefined) {
      parts.push(`**New:**\n\`\`\`\n${truncateContent(action.new_str)}\n\`\`\``);
    }
    return parts.join('\n\n');
  }

  // view (and unknown commands): announce the operation so the card has content
  // Full file contents arrive in the FileEditorObservation.
  if (command === 'view') {
    return `**View:** \`${path}\``;
  }

  return `**${command || 'File'}:** \`${path}\``;
}

/**
 * Get content for InvokeSkillAction.
 *
 * Shows which skill is being invoked. The actual skill output arrives in the
 * InvokeSkillObservation.
 */
function getInvokeSkillActionContent(action: AgentAction): string {
  const name = action.skill_name;
  return name ? `**Invoke skill:** \`${name}\`` : '**Invoke skill**';
}

/**
 * Get content for InvokeSkillObservation.
 */
function getInvokeSkillObservationContent(action: AgentAction): string {
  const textContent = extractTextContent(action.content);
  const header = action.skill_name ? `**Skill:** \`${action.skill_name}\`\n\n` : '';

  if (action.is_error) {
    return truncateContent(`${header}**Error:**\n${textContent}`);
  }

  if (!textContent) {
    return truncateContent(`${header}Skill completed.`);
  }

  return truncateContent(`${header}**Result:**\n${textContent}`);
}

/**
 * Get content for MCPToolAction.
 */
function getMCPToolActionContent(action: AgentAction): string {
  let details = '**MCP Tool Call**\n\n';
  
  if (action.data) {
    details += `**Arguments:**\n\`\`\`json\n${JSON.stringify(action.data, null, 2)}\n\`\`\``;
  }
  
  return details;
}

/**
 * Get content for ThinkAction.
 */
function getThinkActionContent(action: AgentAction): string {
  return action.thought || '';
}

/**
 * Get content for FinishAction.
 */
function getFinishActionContent(action: AgentAction): string {
  return action.message?.trim() || '';
}

/**
 * Get content for TaskTrackerAction.
 */
function getTaskTrackerActionContent(action: AgentAction): string {
  let content = `**Command:** \`plan\``;
  
  if (action.task_list && action.task_list.length > 0) {
    content += '\n\n' + formatTaskList(action.task_list);
  } else {
    content += '\n\n**Task List:** Empty';
  }
  
  return content;
}

/**
 * Get content for browser actions.
 */
function getBrowserActionContent(action: AgentAction): string {
  const kind = action.kind;
  
  switch (kind) {
    case 'BrowserNavigateAction': {
      let content = `Browsing ${action.url || 'unknown URL'}`;
      if (action.new_tab) {
        content += '\n**New Tab:** Yes';
      }
      return content;
    }
    case 'BrowserClickAction': {
      let content = `**Element Index:** ${action.index ?? 'unknown'}`;
      if (action.new_tab) {
        content += '\n**New Tab:** Yes';
      }
      return content;
    }
    case 'BrowserTypeAction': {
      const textPreview = action.text && action.text.length > 50
        ? `${action.text.slice(0, 50)}...`
        : (action.text || '');
      return `**Element Index:** ${action.index ?? 'unknown'}\n**Text:** ${textPreview}`;
    }
    case 'BrowserGetStateAction': {
      if (action.include_screenshot) {
        return '**Include Screenshot:** Yes';
      }
      return '';
    }
    case 'BrowserGetContentAction': {
      const parts: string[] = [];
      if (action.extract_links) {
        parts.push('**Extract Links:** Yes');
      }
      if (action.start_from_char && action.start_from_char > 0) {
        parts.push(`**Start From Character:** ${action.start_from_char}`);
      }
      return parts.join('\n');
    }
    case 'BrowserScrollAction': {
      return `**Direction:** ${action.direction || 'down'}`;
    }
    case 'BrowserSwitchTabAction':
    case 'BrowserCloseTabAction': {
      return `**Tab ID:** ${action.tab_id || 'unknown'}`;
    }
    default:
      return '';
  }
}

/**
 * Get content for GrepAction / GlobAction.
 */
function getSearchActionContent(action: AgentAction): string {
  const parts: string[] = [];
  
  if (action.pattern) {
    parts.push(`**Pattern:** \`${action.pattern}\``);
  }
  if (action.path || action.search_path) {
    parts.push(`**Path:** \`${action.path || action.search_path}\``);
  }
  if (action.include) {
    parts.push(`**Include:** \`${action.include}\``);
  }
  
  return parts.join('\n');
}

/**
 * Get formatted content for an action event (initiated by agent).
 * Returns markdown string for rendering in expanded event card.
 */
export function getActionContent(action: AgentAction): string {
  const kind = action.kind;
  
  switch (kind) {
    case 'FileEditorAction':
    case 'StrReplaceEditorAction':
      return getFileEditorActionContent(action);
    
    case 'ExecuteBashAction':
    case 'TerminalAction':
      return getExecuteBashActionContent(action);
    
    case 'MCPToolAction':
      return getMCPToolActionContent(action);

    case 'InvokeSkillAction':
      return getInvokeSkillActionContent(action);

    case 'ThinkAction':
      return getThinkActionContent(action);
    
    case 'FinishAction':
      return getFinishActionContent(action);
    
    case 'TaskTrackerAction':
      return getTaskTrackerActionContent(action);
    
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
      return getBrowserActionContent(action);
    
    case 'GrepAction':
    case 'GlobAction':
      return getSearchActionContent(action);
    
    default:
      // For unknown action types, return empty (use summary as fallback)
      return '';
  }
}

// =============================================================================
// OBSERVATION CONTENT HELPERS
// =============================================================================

/**
 * Get content for ExecuteBashObservation / TerminalObservation.
 */
function getTerminalObservationContent(action: AgentAction): string {
  const textContent = extractTextContent(action.content);
  let content = textContent || '';
  
  if (content.length > MAX_CONTENT_LENGTH) {
    content = truncateContent(content);
  }
  
  let output = '';
  
  // Display the command if available
  if (action.command) {
    output += `Command: \`${action.command}\`\n\n`;
  }
  
  // Display the output
  const trimmedContent = content.trim() || '(no output)';
  output += `Output:\n\`\`\`sh\n${trimmedContent}\n\`\`\``;
  
  return output;
}

/**
 * Get content for FileEditorObservation.
 */
function getFileEditorObservationContent(action: AgentAction): string {
  if (action.error) {
    return `**Error:**\n${action.error}`;
  }
  
  const textContent = extractTextContent(action.content);
  
  if (textContent) {
    const displayContent = truncateContent(textContent);
    return `\`\`\`\n${displayContent}\n\`\`\``;
  }
  
  return '';
}

/**
 * Get content for BrowserObservation.
 */
function getBrowserObservationContent(action: AgentAction): string {
  const textContent = extractTextContent(action.content);
  
  let contentDetails = '';
  
  if (action.error) {
    contentDetails = `**Error:**\n${action.error}`;
  } else if (textContent) {
    contentDetails = `**Output:**\n${textContent}`;
  } else {
    contentDetails = 'Browser action completed successfully.';
  }
  
  return truncateContent(contentDetails);
}

/**
 * Get content for MCPToolObservation.
 */
function getMCPToolObservationContent(action: AgentAction): string {
  const textContent = extractTextContent(action.content);
  
  let content = `**Tool:** ${action.tool_name || 'unknown'}\n\n`;
  
  if (action.is_error) {
    content += `**Error:**\n${textContent}`;
  } else {
    content += `**Result:**\n${textContent}`;
  }
  
  return truncateContent(content);
}

/**
 * Get content for TaskTrackerObservation.
 */
function getTaskTrackerObservationContent(action: AgentAction): string {
  let content = '**Command:** `view`';
  
  if (action.task_list && action.task_list.length > 0) {
    content += '\n\n' + formatTaskList(action.task_list);
  } else {
    content += '\n\n**Task List:** Empty';
  }
  
  return content;
}

/**
 * Get content for GlobObservation.
 */
function getGlobObservationContent(action: AgentAction): string {
  let content = `**Pattern:** \`${action.pattern || ''}\`\n`;
  content += `**Search Path:** \`${action.search_path || action.path || ''}\`\n\n`;
  
  if (action.is_error) {
    const textContent = extractTextContent(action.content);
    content += `**Error:**\n${textContent}`;
  } else if (!action.files || action.files.length === 0) {
    content += '**Result:** No files found.';
  } else {
    content += `**Files Found (${action.files.length}):**\n`;
    content += action.files.map((f) => `- \`${f}\``).join('\n');
  }
  
  return truncateContent(content);
}

/**
 * Get content for GrepObservation.
 */
function getGrepObservationContent(action: AgentAction): string {
  let content = `**Pattern:** \`${action.pattern || ''}\`\n`;
  content += `**Search Path:** \`${action.search_path || action.path || ''}\`\n`;
  
  if (action.include) {
    content += `**Include:** \`${action.include}\`\n`;
  }
  
  content += '\n';
  
  if (action.is_error) {
    const textContent = extractTextContent(action.content);
    content += `**Error:**\n${textContent}`;
  } else if (!action.matches || action.matches.length === 0) {
    content += '**Result:** No matches found.';
  } else {
    content += `**Matches (${action.matches.length}):**\n`;
    content += action.matches.map((m) => `- \`${m}\``).join('\n');
  }
  
  return truncateContent(content);
}

/**
 * Get content for ThinkObservation.
 *
 * Real ThinkObservations carry a short acknowledgement (e.g. "Thought
 * recorded."). Fall back to a descriptive placeholder rather than an empty
 * string when no content is present.
 */
function getThinkObservationContent(action: AgentAction): string {
  const text = extractTextContent(action.content).trim();
  return text || 'Thought recorded.';
}

/**
 * Get content for FinishObservation.
 */
function getFinishObservationContent(action: AgentAction): string {
  const textContent = extractTextContent(action.content);
  
  if (action.is_error) {
    return `**Error:**\n${textContent}`;
  }
  
  return textContent;
}

/**
 * Get formatted content for an observation event (result of action).
 * Returns markdown string for rendering in expanded event card.
 */
export function getObservationContent(action: AgentAction): string {
  const kind = action.kind;
  
  switch (kind) {
    case 'FileEditorObservation':
    case 'StrReplaceEditorObservation':
      return getFileEditorObservationContent(action);
    
    case 'ExecuteBashObservation':
    case 'TerminalObservation':
      return getTerminalObservationContent(action);
    
    case 'BrowserObservation':
      return getBrowserObservationContent(action);
    
    case 'MCPToolObservation':
      return getMCPToolObservationContent(action);

    case 'InvokeSkillObservation':
      return getInvokeSkillObservationContent(action);

    case 'TaskTrackerObservation':
      return getTaskTrackerObservationContent(action);
    
    case 'ThinkObservation':
      return getThinkObservationContent(action);
    
    case 'FinishObservation':
      return getFinishObservationContent(action);
    
    case 'GlobObservation':
      return getGlobObservationContent(action);
    
    case 'GrepObservation':
      return getGrepObservationContent(action);
    
    default:
      // For unknown observation types, try to extract text content
      return extractTextContent(action.content);
  }
}

/**
 * Get formatted content for any agent event.
 * Automatically determines if it's an action or observation based on kind.
 */
export function getEventContent(action: AgentAction): string {
  const isObservation = action.kind.includes('Observation');
  
  if (isObservation) {
    return getObservationContent(action);
  }
  
  return getActionContent(action);
}
