/**
 * OpenHands Cloud API client for Voice Relay
 * 
 * Handles creating conversations and sending/receiving messages
 * via the OpenHands V1 API and WebSocket.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENHANDS_BASE_URL = 'https://app.all-hands.dev';
const START_TASK_TERMINAL_STATUSES = new Set(['READY', 'ERROR', 'FAILED', 'CANCELLED', 'DONE', 'COMPLETED']);

interface ContentPart {
  type: 'text';
  text: string;
}

interface InitialMessage {
  role: 'user';
  content: ContentPart[];
  run: boolean;
}

interface StartConversationRequest {
  initial_message: InitialMessage;
  title?: string;
  /** Environment variable secrets to inject into the conversation sandbox */
  secrets?: Record<string, string>;
}

interface StartTaskResponse {
  id: string;
  status: string;
  app_conversation_id?: string;
  error?: string;
}

interface ConversationInfo {
  id: string;
  status: string;
  execution_status?: string;
  sandbox_status?: string;
  sandbox_id?: string;
  session_api_key?: string;
  conversation_url?: string;
}

interface MessageEvent {
  id: string;
  kind: string;
  source: string;
  timestamp: string;
  // API returns llm_message, not message
  llm_message?: {
    role: string;
    content: ContentPart[];
  };
}

interface EventsSearchResponse {
  items: MessageEvent[];
  next_page_id?: string;
}

export class OpenHandsClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl: string = OPENHANDS_BASE_URL) {
    const resolvedKey = apiKey || process.env.OPENHANDS_CLOUD_API_KEY || process.env.OPENHANDS_API_KEY;
    if (!resolvedKey) {
      throw new Error('Missing OpenHands API key. Set OPENHANDS_CLOUD_API_KEY or OPENHANDS_API_KEY environment variable.');
    }
    this.apiKey = resolvedKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private get apiV1Url(): string {
    return `${this.baseUrl}/api/v1`;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: object,
    timeoutMs: number = 30000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.apiV1Url}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenHands API error ${response.status}: ${text}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Start a new OpenHands conversation
   * @param initialMessage - The initial message to send to the AI
   * @param title - Optional title for the conversation
   * @param secrets - Optional map of environment variable secrets to inject
   */
  async startConversation(
    initialMessage: string,
    title?: string,
    secrets?: Record<string, string>
  ): Promise<StartTaskResponse> {
    const payload: StartConversationRequest = {
      initial_message: {
        role: 'user',
        content: [{ type: 'text', text: initialMessage }],
        run: true,
      },
    };
    if (title) {
      payload.title = title;
    }
    if (secrets && Object.keys(secrets).length > 0) {
      payload.secrets = secrets;
    }

    return this.request<StartTaskResponse>('POST', '/app-conversations', payload, 120000);
  }

  /**
   * Get a start task by ID to check status
   */
  async getStartTask(taskId: string): Promise<StartTaskResponse | null> {
    const response = await this.request<(StartTaskResponse | null)[]>(
      'GET',
      `/app-conversations/start-tasks?ids=${encodeURIComponent(taskId)}`
    );
    return response[0] || null;
  }

  /**
   * Poll until the conversation is ready
   */
  async pollUntilReady(
    taskId: string,
    timeoutMs: number = 10 * 60 * 1000,
    pollIntervalMs: number = 2000
  ): Promise<StartTaskResponse> {
    const deadline = Date.now() + timeoutMs;
    let interval = pollIntervalMs;
    let lastTask: StartTaskResponse | null = null;

    while (Date.now() < deadline) {
      lastTask = await this.getStartTask(taskId);
      const status = (lastTask?.status || '').toUpperCase();

      if (START_TASK_TERMINAL_STATUSES.has(status)) {
        if (status === 'ERROR' || status === 'FAILED') {
          throw new Error(`Conversation failed to start: ${lastTask?.error || status}`);
        }
        return lastTask!;
      }

      await new Promise(resolve => setTimeout(resolve, Math.min(interval, deadline - Date.now())));
      interval = Math.min(interval * 1.5, 10000);
    }

    throw new Error(`Conversation start timed out after ${timeoutMs}ms`);
  }

  /**
   * Get conversation info
   */
  async getConversation(conversationId: string): Promise<ConversationInfo | null> {
    const response = await this.request<(ConversationInfo | null)[]>(
      'GET',
      `/app-conversations?ids=${encodeURIComponent(conversationId)}`
    );
    return response[0] || null;
  }

  /**
   * Send a message to an existing conversation via pending messages endpoint
   * Uses SendMessageRequest format: { role, content: [{type, text}], run }
   */
  async sendMessage(conversationId: string, message: string): Promise<{ id: string; queued: boolean; position: number }> {
    return this.request<{ id: string; queued: boolean; position: number }>(
      'POST',
      `/conversations/${conversationId}/pending-messages`,
      {
        role: 'user',
        content: [{ type: 'text', text: message }],
        run: true  // Auto-run the agent loop to process the message
      }
    );
  }

  /**
   * Get recent events from a conversation
   */
  async getEvents(conversationId: string, limit: number = 50): Promise<EventsSearchResponse> {
    return this.request<EventsSearchResponse>(
      'GET',
      `/conversation/${conversationId}/events/search?limit=${limit}`
    );
  }

  /**
   * Get message events (filter for MessageEvent kind)
   */
  async getMessageEvents(conversationId: string, limit: number = 50): Promise<MessageEvent[]> {
    const response = await this.getEvents(conversationId, limit);
    return response.items.filter(e => e.kind === 'MessageEvent');
  }
}

/**
 * Get the server URL for API calls in prompts
 * Uses BASE_URL env var if set, otherwise falls back to localhost in dev/test.
 * Throws in production if BASE_URL is not set to prevent silent failures.
 */
export function getServerUrl(): string {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  // Only use localhost fallback in dev/test environments
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BASE_URL environment variable is required in production for display API');
  }
  
  return `http://localhost:${process.env.PORT || 3001}`;
}

/**
 * Load a prompt from the prompts directory
 * @param promptName - Name of the prompt file (without .md extension)
 * @param displayLines - Optional number of display lines to inject into the prompt
 * @param workspaceId - Optional workspace ID to inject into the prompt for display API calls
 * @param sessionId - Optional session ID to inject into the prompt for display API calls
 */
export function loadPrompt(
  promptName: string,
  displayLines?: number,
  workspaceId?: string,
  sessionId?: string
): string {
  const promptsDir = path.join(__dirname, '..', 'prompts');
  const promptPath = path.join(promptsDir, `${promptName}.md`);
  
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt not found: ${promptName}`);
  }
  
  let prompt = fs.readFileSync(promptPath, 'utf-8');
  
  // Replace placeholder with actual display lines if provided
  if (displayLines !== undefined) {
    // Replace generic "10-12 lines" guidance with actual calculated value
    prompt = prompt.replace(
      /Maximum 10-12 lines of body text/g,
      `Maximum ${displayLines} lines of body text`
    );
    prompt = prompt.replace(
      /content beyond ~10 lines will be invisible/g,
      `content beyond ${displayLines} lines will be invisible`
    );
  }
  
  // Replace server URL placeholder for display API calls
  // This ensures prompts work in any environment (dev, test, production)
  prompt = prompt.replace(/{{SERVER_URL}}/g, getServerUrl());
  
  // Replace workspace ID placeholder if provided
  // Escape JSON-breaking characters to prevent malformed curl examples in prompts
  if (workspaceId) {
    const escapedId = workspaceId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    prompt = prompt.replace(/{{WORKSPACE_ID}}/g, escapedId);
  }

  // Replace session ID placeholder if provided
  if (sessionId) {
    const escapedId = sessionId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    prompt = prompt.replace(/{{SESSION_ID}}/g, escapedId);
  }
  
  return prompt;
}

/**
 * Active AI session linked to a VR session
 */
/** Agent action event from OpenHands event stream */
export interface AgentAction {
  id: string;
  timestamp: string;
  kind: string;
  source: string;
  summary: string;
}

export interface AISession {
  conversationId: string;
  taskId: string;
  /** VR session ID - the session this AI is connected to */
  sessionId?: string;
  mode: 'chat' | 'kiosk';
  ws?: WebSocket;
  agentServerUrl?: string;
  sessionApiKey?: string;
  lastEventId?: string;
  onMessage?: (message: string) => void;
  /** Callback for agent action events */
  onAction?: (action: AgentAction) => void;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  /** Whether AI is currently processing a response */
  isThinking: boolean;
  /** ID of the pending message being processed */
  pendingMessageId?: string;
  /** Timestamp when the last message was sent */
  lastMessageSentAt?: number;
}

// V1 Event type interfaces
interface V1MessageEvent {
  id: string;
  timestamp: string;
  source: 'agent' | 'user' | 'environment' | 'hook';
  llm_message: {
    role: string;
    content: ContentPart[];
  };
}

interface V1ConversationStateUpdateEvent {
  kind: 'ConversationStateUpdateEvent';
  key: string;
  value: Record<string, unknown>;
}

/**
 * Content part in OpenHands events (text or image).
 * Uses OpenHands field naming conventions for client portability.
 */
interface V1ContentPart {
  type: 'text' | 'image';
  text?: string;
  image_urls?: string[];  // snake_case per OpenHands convention
}

/**
 * Task item in task tracker events.
 */
interface V1TaskItem {
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  notes?: string;
}

/**
 * Generic OpenHands event shape for action forwarding.
 * Extended to capture all fields needed for rich content rendering.
 * 
 * IMPORTANT: Field names use snake_case to match OpenHands conventions exactly.
 * This is intentional for client portability - see issue #252.
 */
interface V1Event {
  id?: string;
  timestamp?: string;
  kind?: string;
  source?: string;
  
  // === Direct event fields ===
  command?: string;
  path?: string;
  thought?: string;
  args?: Record<string, unknown>;
  
  // === V1 wrapped event format - nested action/observation objects ===
  action?: Record<string, unknown> | string;
  observation?: Record<string, unknown>;
  
  // === Terminal action/observation fields ===
  content?: V1ContentPart[] | string;
  exit_code?: number;
  timeout?: boolean;
  
  // === File action/observation fields ===
  file_text?: string;
  old_str?: string;
  new_str?: string;
  error?: string;
  
  // === MCP action/observation fields ===
  tool_name?: string;
  data?: Record<string, unknown>;
  is_error?: boolean;
  
  // === Browser action fields ===
  url?: string;
  index?: number;
  text?: string;
  direction?: string;
  tab_id?: string;
  new_tab?: boolean;
  include_screenshot?: boolean;
  extract_links?: boolean;
  start_from_char?: number;
  
  // === Search action/observation fields ===
  pattern?: string;
  include?: string;
  search_path?: string;
  files?: string[];
  matches?: string[];
  
  // === Think/Finish action fields ===
  message?: string;
  
  // === Task tracker fields ===
  task_list?: V1TaskItem[];
  
  // === Observation linkage ===
  action_id?: string;
  
  // For nested structures and unknown fields
  [key: string]: unknown;
}

/** Helper to truncate strings for display summaries */
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

/** Format ActionEvent with nested action object */
function formatActionEvent(event: V1Event): string {
  const action = event.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object') {
    return 'Action';
  }

  const actionType = action.action;
  
  switch (actionType) {
    case 'run':
      if (action.command) {
        return truncate(String(action.command), 60);
      }
      return 'Running command';
      
    case 'read':
      if (action.path) {
        return `Read ${action.path}`;
      }
      return 'Reading file';
      
    case 'write':
      if (action.path) {
        return `Write ${action.path}`;
      }
      return 'Writing file';
      
    case 'edit':
      if (action.path) {
        return `Edit ${action.path}`;
      }
      return 'Editing file';
      
    case 'browse':
    case 'browse_url':
      if (action.url) {
        return `Navigate to ${truncate(String(action.url), 40)}`;
      }
      return 'Navigating browser';
      
    case 'browse_interactive':
      if (action.browser_actions) {
        return `Browser: ${truncate(String(action.browser_actions), 50)}`;
      }
      return 'Browser interaction';
      
    case 'think':
      if (action.thought) {
        return truncate(String(action.thought), 60);
      }
      return 'Thinking...';
      
    case 'finish':
      return 'Task completed';
      
    case 'delegate':
      return 'Delegating to sub-agent';
      
    case 'message':
      if (action.content) {
        return truncate(String(action.content), 60);
      }
      return 'Message';
      
    default:
      // Return cleaned action type name
      if (typeof actionType === 'string') {
        return actionType.charAt(0).toUpperCase() + actionType.slice(1);
      }
      return 'Action';
  }
}

/** Format ObservationEvent with nested observation object */
function formatObservationEvent(event: V1Event): string {
  const observation = event.observation as Record<string, unknown> | undefined;
  if (!observation || typeof observation !== 'object') {
    return 'Observation';
  }

  const obsType = observation.observation;
  
  switch (obsType) {
    case 'run':
    case 'cmd_output':
      if (observation.content) {
        return `Output: ${truncate(String(observation.content), 55)}`;
      }
      return 'Command output';
      
    case 'read':
      if (observation.path) {
        return `Read ${observation.path}`;
      }
      return 'File content';
      
    case 'write':
      if (observation.path) {
        return `Wrote ${observation.path}`;
      }
      return 'File written';
      
    case 'edit':
      if (observation.path) {
        return `Edited ${observation.path}`;
      }
      return 'File edited';
      
    case 'browse':
    case 'browser':
      if (observation.url) {
        return `Browsed ${truncate(String(observation.url), 40)}`;
      }
      return 'Browser result';
      
    case 'error':
      if (observation.content) {
        return `Error: ${truncate(String(observation.content), 55)}`;
      }
      return 'Error occurred';
      
    case 'agent':
      return 'Agent observation';
      
    default:
      if (typeof obsType === 'string') {
        return obsType.charAt(0).toUpperCase() + obsType.slice(1) + ' result';
      }
      return 'Observation';
  }
}

/**
 * Format an OpenHands event into a human-readable summary.
 * Used to create concise descriptions of agent actions.
 * Handles both V1 wrapped events (ActionEvent, ObservationEvent) and direct action types.
 */
export function formatEventSummary(event: V1Event): string {
  const kind = event.kind || 'Unknown';
  
  // Handle V1 wrapped event formats first
  switch (kind) {
    case 'ActionEvent':
      return formatActionEvent(event);
      
    case 'ObservationEvent':
      return formatObservationEvent(event);
      
    case 'SystemPromptEvent':
      return 'System prompt loaded';
      
    case 'MessageEvent':
      // OpenHands LLM messages contain nested content arrays with typed parts (e.g., [{type: 'text', text: '...'}])
      if (event.llm_message && typeof event.llm_message === 'object') {
        const msg = event.llm_message as { content?: Array<{ type: string; text?: string }> };
        if (msg.content && Array.isArray(msg.content)) {
          const textPart = msg.content.find(p => p.type === 'text' && p.text);
          if (textPart?.text) {
            return truncate(textPart.text, 60);
          }
        }
      }
      return 'Message';
  }
  
  // Handle direct action types (backward compatibility)
  switch (kind) {
    case 'CmdRunAction':
      if (event.command) {
        return truncate(String(event.command), 60);
      }
      return 'Running command';
      
    case 'CmdOutputObservation':
      return 'Command output received';
      
    case 'FileReadAction':
      if (event.path) {
        return `Read ${event.path}`;
      }
      return 'Reading file';
      
    case 'FileWriteAction':
      if (event.path) {
        return `Write ${event.path}`;
      }
      return 'Writing file';
      
    case 'FileEditAction':
      if (event.path) {
        return `Edit ${event.path}`;
      }
      return 'Editing file';
      
    case 'BrowseURLAction':
      if (event.args && typeof event.args === 'object' && 'url' in event.args) {
        const url = String(event.args.url);
        return `Navigate to ${truncate(url, 40)}`;
      }
      return 'Navigating browser';
      
    case 'BrowseInteractiveAction':
      if (typeof event.action === 'string') {
        return `Browser: ${event.action}`;
      }
      return 'Browser interaction';
      
    case 'AgentThinkAction':
      if (event.thought) {
        return truncate(String(event.thought), 60);
      }
      return 'Thinking...';
      
    case 'AgentStateChangeEvent':
      if (event.args && typeof event.args === 'object' && 'agent_state' in event.args) {
        return `State: ${event.args.agent_state}`;
      }
      return 'State change';
      
    case 'AgentFinishAction':
      return 'Task completed';
      
    case 'AgentDelegateAction':
      return 'Delegating to sub-agent';
      
    case 'ConversationStateUpdateEvent':
      return 'Status update';
      
    default:
      // For unknown types, use the kind as the summary with cleaned name
      return kind.replace(/Action$|Observation$|Event$/i, '');
  }
}

/**
 * Extracted fields from a V1Event for rich content rendering.
 * Uses snake_case field names to match OpenHands conventions for client portability.
 * See issue #252 for context on why we adopted OpenHands naming conventions.
 */
export interface ExtractedEventFields {
  // Terminal actions/observations
  command?: string;
  content?: V1ContentPart[] | string;
  exit_code?: number;
  timeout?: boolean;
  
  // File actions/observations
  path?: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  error?: string;
  
  // MCP actions/observations
  tool_name?: string;
  data?: Record<string, unknown>;
  is_error?: boolean;
  
  // Browser actions
  url?: string;
  index?: number;
  text?: string;
  direction?: string;
  tab_id?: string;
  new_tab?: boolean;
  include_screenshot?: boolean;
  extract_links?: boolean;
  start_from_char?: number;
  
  // Search actions/observations
  pattern?: string;
  include?: string;
  search_path?: string;
  files?: string[];
  matches?: string[];
  
  // Think/Finish actions
  thought?: string;
  message?: string;
  
  // Task tracker
  task_list?: V1TaskItem[];
  
  // Observation linkage
  action_id?: string;
}

/**
 * Helper to safely extract a string field from an object.
 */
function extractString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Helper to safely extract a number field from an object.
 */
function extractNumber(obj: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Helper to safely extract a boolean field from an object.
 */
function extractBoolean(obj: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Helper to safely extract a string array field from an object.
 */
function extractStringArray(obj: Record<string, unknown> | undefined, key: string): string[] | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value as string[];
  }
  return undefined;
}

/**
 * Helper to safely extract content which can be an array of content parts or a string.
 * Validates that content parts have the correct structure including field types.
 */
function extractContent(obj: Record<string, unknown> | undefined, key: string): V1ContentPart[] | string | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    // Check if it's an array of content parts with strict type validation
    const isContentParts = value.every(item => {
      if (typeof item !== 'object' || item === null || !('type' in item)) return false;
      const partItem = item as Record<string, unknown>;
      if (partItem.type === 'text') {
        // text field must be string if present
        return !('text' in partItem) || typeof partItem.text === 'string';
      }
      if (partItem.type === 'image') {
        // image_urls must be array of strings if present
        return !('image_urls' in partItem) || 
          (Array.isArray(partItem.image_urls) && partItem.image_urls.every(u => typeof u === 'string'));
      }
      return false;
    });
    if (isContentParts) {
      return value as V1ContentPart[];
    }
  }
  return undefined;
}

/**
 * Helper to safely extract task list from an object.
 * Validates that task items have the correct structure including optional notes field.
 */
function extractTaskList(obj: Record<string, unknown> | undefined, key: string): V1TaskItem[] | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  if (Array.isArray(value)) {
    const validTasks = value.filter(item => {
      if (typeof item !== 'object' || item === null) return false;
      const taskItem = item as Record<string, unknown>;
      // Required: title must be string
      if (!('title' in taskItem) || typeof taskItem.title !== 'string') return false;
      // Required: status must be valid enum value
      if (!('status' in taskItem) || !['todo', 'in_progress', 'done'].includes(taskItem.status as string)) return false;
      // Optional: notes must be string if present
      if ('notes' in taskItem && typeof taskItem.notes !== 'string') return false;
      return true;
    });
    if (validTasks.length > 0) {
      return validTasks as V1TaskItem[];
    }
  }
  return undefined;
}

// Sets of known event kinds for exact matching - more maintainable than string.includes()
// and prevents false matches (e.g., 'Terminal' matching hypothetical 'TerminalEmulator')
const TERMINAL_KINDS = new Set([
  'TerminalAction', 'TerminalObservation',
  'ExecuteBashAction', 'ExecuteBashObservation',
  'CmdRunAction', 'CmdOutputObservation'
]);
const FILE_KINDS = new Set([
  'FileReadAction', 'FileReadObservation',
  'FileWriteAction', 'FileWriteObservation',
  'FileEditAction', 'FileEditObservation',
  'EditorAction', 'EditorObservation',
  'FileEditorAction', 'FileEditorObservation',
  'StrReplaceAction', 'StrReplaceObservation',
  'StrReplaceEditorAction', 'StrReplaceEditorObservation'
]);
const MCP_KINDS = new Set([
  'MCPAction', 'MCPObservation',
  'MCPToolAction', 'MCPToolObservation',
  'ToolAction', 'ToolObservation'
]);
const BROWSER_KINDS = new Set([
  'BrowserAction', 'BrowserObservation',
  'BrowseAction', 'BrowseObservation',
  'BrowserNavigateAction', 'BrowserClickAction', 'BrowserTypeAction',
  'BrowserScrollAction', 'BrowserGetStateAction', 'BrowserGetContentAction',
  'BrowserSwitchTabAction', 'BrowserCloseTabAction', 'BrowserListTabsAction',
  'BrowserGoBackAction', 'BrowserGetStorageAction', 'BrowserSetStorageAction',
  'BrowserStartRecordingAction', 'BrowserStopRecordingAction'
]);
const SEARCH_KINDS = new Set([
  'GrepAction', 'GrepObservation',
  'GlobAction', 'GlobObservation',
  'SearchAction', 'SearchObservation'
]);
const THINK_KINDS = new Set(['ThinkAction', 'AgentThinkAction']);
const FINISH_KINDS = new Set(['FinishAction', 'AgentFinishAction']);
const TASK_TRACKER_KINDS = new Set(['TaskTrackerAction', 'TaskTrackerObservation']);
const OBSERVATION_KINDS = new Set([
  'ObservationEvent', 'TerminalObservation', 'ExecuteBashObservation',
  'CmdOutputObservation', 'FileReadObservation', 'FileWriteObservation',
  'FileEditObservation', 'EditorObservation', 'FileEditorObservation',
  'StrReplaceObservation', 'StrReplaceEditorObservation',
  'MCPObservation', 'MCPToolObservation', 'ToolObservation',
  'BrowserObservation', 'BrowseObservation',
  'GrepObservation', 'GlobObservation', 'SearchObservation', 'TaskTrackerObservation'
]);

/**
 * Extract relevant fields from a V1Event based on its kind.
 * 
 * This function examines the event kind and extracts the appropriate fields
 * from either the top-level event object or nested action/observation objects.
 * 
 * IMPORTANT: Field names use snake_case to match OpenHands conventions exactly.
 * This is intentional for client portability - see issue #252.
 * 
 * @param event - The V1Event to extract fields from
 * @returns Object containing only the relevant extracted fields
 */
export function extractEventFields(event: V1Event): ExtractedEventFields {
  const kind = event.kind || '';
  const result: ExtractedEventFields = {};
  
  // Cast event to Record for extraction helpers (V1Event has index signature)
  const eventObj = event as Record<string, unknown>;
  
  // Get nested action/observation objects if present
  const actionObj = typeof event.action === 'object' ? event.action as Record<string, unknown> : undefined;
  const obsObj = typeof event.observation === 'object' ? event.observation as Record<string, unknown> : undefined;
  
  // For wrapped events (ActionEvent, ObservationEvent), prefer nested object fields
  // For direct events (TerminalAction, etc.), use top-level fields
  const isActionEvent = kind === 'ActionEvent';
  const isObservationEvent = kind === 'ObservationEvent';
  
  // Determine the actual action/observation type for wrapped events
  const actionType = isActionEvent ? extractString(actionObj, 'action') : undefined;
  const obsType = isObservationEvent ? extractString(obsObj, 'observation') : undefined;
  
  // === Terminal actions/observations ===
  // Matches: TerminalAction, ExecuteBashAction, CmdRunAction, and their observations
  const isTerminalEvent = TERMINAL_KINDS.has(kind) || actionType === 'run' || obsType === 'run' || obsType === 'cmd_output';
  if (isTerminalEvent) {
    result.command = extractString(eventObj, 'command') ?? extractString(actionObj, 'command') ?? extractString(obsObj, 'command');
    result.content = extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.exit_code = extractNumber(eventObj, 'exit_code') ?? extractNumber(obsObj, 'exit_code');
    result.timeout = extractBoolean(eventObj, 'timeout') ?? extractBoolean(obsObj, 'timeout');
  }
  
  // === File actions/observations ===
  // Matches: FileReadAction, FileWriteAction, FileEditAction, EditorAction, StrReplaceAction
  const isFileEvent = FILE_KINDS.has(kind) ||
      actionType === 'read' || actionType === 'write' || actionType === 'edit' ||
      obsType === 'read' || obsType === 'write' || obsType === 'edit';
  if (isFileEvent) {
    result.path = extractString(eventObj, 'path') ?? extractString(actionObj, 'path') ?? extractString(obsObj, 'path');
    result.file_text = extractString(eventObj, 'file_text') ?? extractString(actionObj, 'file_text') ?? extractString(obsObj, 'file_text');
    result.old_str = extractString(eventObj, 'old_str') ?? extractString(actionObj, 'old_str');
    result.new_str = extractString(eventObj, 'new_str') ?? extractString(actionObj, 'new_str');
    // Priority: terminal content > file content (preserves earlier extraction)
    result.content = result.content ?? extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.error = extractString(eventObj, 'error') ?? extractString(obsObj, 'error');
  }
  
  // === MCP actions/observations ===
  // Matches: MCPAction, MCPObservation, ToolAction, ToolObservation
  const isMCPEvent = MCP_KINDS.has(kind);
  if (isMCPEvent) {
    result.tool_name = extractString(eventObj, 'tool_name') ?? extractString(actionObj, 'tool_name') ?? extractString(obsObj, 'tool_name');
    result.data = (eventObj.data as Record<string, unknown>) ?? (actionObj?.data as Record<string, unknown>);
    // Priority: terminal/file content > MCP content (preserves earlier extraction)
    result.content = result.content ?? extractContent(eventObj, 'content') ?? extractContent(obsObj, 'content');
    result.is_error = extractBoolean(eventObj, 'is_error') ?? extractBoolean(obsObj, 'is_error');
  }
  
  // === Browser actions ===
  // Matches: BrowserAction, BrowseAction, and specific browser action types
  const isBrowserEvent = BROWSER_KINDS.has(kind) || actionType === 'browse' || actionType === 'browse_url' || actionType === 'browse_interactive' ||
      obsType === 'browse' || obsType === 'browser';
  if (isBrowserEvent) {
    result.url = extractString(eventObj, 'url') ?? extractString(actionObj, 'url') ?? extractString(obsObj, 'url');
    result.index = extractNumber(eventObj, 'index') ?? extractNumber(actionObj, 'index');
    result.text = extractString(eventObj, 'text') ?? extractString(actionObj, 'text');
    result.direction = extractString(eventObj, 'direction') ?? extractString(actionObj, 'direction');
    result.tab_id = extractString(eventObj, 'tab_id') ?? extractString(actionObj, 'tab_id');
    result.new_tab = extractBoolean(eventObj, 'new_tab') ?? extractBoolean(actionObj, 'new_tab');
    result.include_screenshot = extractBoolean(eventObj, 'include_screenshot') ?? extractBoolean(actionObj, 'include_screenshot');
    result.extract_links = extractBoolean(eventObj, 'extract_links') ?? extractBoolean(actionObj, 'extract_links');
    result.start_from_char = extractNumber(eventObj, 'start_from_char') ?? extractNumber(actionObj, 'start_from_char');
  }
  
  // === Search actions/observations (Grep, Glob) ===
  // Matches: GrepAction, GlobAction, SearchAction and their observations
  const isSearchEvent = SEARCH_KINDS.has(kind);
  if (isSearchEvent) {
    result.pattern = extractString(eventObj, 'pattern') ?? extractString(actionObj, 'pattern') ?? extractString(obsObj, 'pattern');
    result.include = extractString(eventObj, 'include') ?? extractString(actionObj, 'include');
    result.search_path = extractString(eventObj, 'search_path') ?? extractString(obsObj, 'search_path');
    // Priority: file path > search path (preserves earlier extraction)
    result.path = result.path ?? extractString(eventObj, 'path') ?? extractString(actionObj, 'path');
    result.files = extractStringArray(eventObj, 'files') ?? extractStringArray(obsObj, 'files');
    result.matches = extractStringArray(eventObj, 'matches') ?? extractStringArray(obsObj, 'matches');
    // Priority: MCP is_error > search is_error (preserves earlier extraction)
    result.is_error = result.is_error ?? extractBoolean(eventObj, 'is_error') ?? extractBoolean(obsObj, 'is_error');
  }
  
  // === Think actions ===
  // Matches: ThinkAction
  const isThinkEvent = THINK_KINDS.has(kind) || actionType === 'think';
  if (isThinkEvent) {
    result.thought = extractString(eventObj, 'thought') ?? extractString(actionObj, 'thought');
  }
  
  // === Finish actions ===
  // Matches: FinishAction
  const isFinishEvent = FINISH_KINDS.has(kind) || actionType === 'finish';
  if (isFinishEvent) {
    result.message = extractString(eventObj, 'message') ?? extractString(actionObj, 'message') ?? extractString(actionObj, 'content');
  }
  
  // === Task tracker ===
  // Matches: TaskTrackerAction, TaskTrackerObservation
  const isTaskTrackerEvent = TASK_TRACKER_KINDS.has(kind);
  if (isTaskTrackerEvent) {
    // Priority: terminal command > task tracker command (preserves earlier extraction)
    result.command = result.command ?? extractString(eventObj, 'command') ?? extractString(actionObj, 'command') ?? extractString(obsObj, 'command');
    result.task_list = extractTaskList(eventObj, 'task_list') ?? extractTaskList(actionObj, 'task_list') ?? extractTaskList(obsObj, 'task_list');
  }
  
  // === Observation linkage ===
  // Matches: ObservationEvent and all *Observation kinds
  const isObservation = isObservationEvent || OBSERVATION_KINDS.has(kind);
  if (isObservation) {
    result.action_id = extractString(eventObj, 'action_id') ?? extractString(obsObj, 'action_id');
  }
  
  // === Error handling for any observation ===
  if (obsType === 'error') {
    result.error = result.error ?? extractString(obsObj, 'content');
    result.content = result.content ?? extractContent(obsObj, 'content');
  }
  
  return result;
}

/** Callback type for thinking state changes */
export type ThinkingChangeCallback = (sessionId: string, isThinking: boolean) => void;

/** Callback type for agent action events */
export type ActionCallback = (sessionId: string, action: AgentAction) => void;

/**
 * Manager for AI sessions using WebSocket
 */
export class AISessionManager {
  /** Session-centric: VR sessionId → AISession */
  private sessionAI: Map<string, AISession> = new Map();
  private client: OpenHandsClient | null = null;
  /** Callback invoked when AI thinking state changes */
  private onThinkingChange?: ThinkingChangeCallback;
  /** Callback invoked when agent performs an action */
  private onAction?: ActionCallback;

  constructor() {
    try {
      this.client = new OpenHandsClient();
    } catch (e) {
      console.warn('OpenHands client not initialized:', (e as Error).message);
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Set callback for thinking state changes
   * Used by the server to broadcast ai-thinking messages
   */
  setThinkingChangeCallback(callback: ThinkingChangeCallback | undefined): void {
    this.onThinkingChange = callback;
  }

  /**
   * Set callback for agent action events
   * Used by the server to broadcast agent-action messages
   */
  setActionCallback(callback: ActionCallback | undefined): void {
    this.onAction = callback;
  }

  // ==================== Session-Centric Methods (NEW) ====================

  /**
   * Check if a VR session has an active AI session
   */
  hasSessionAI(sessionId: string): boolean {
    return this.sessionAI.has(sessionId);
  }

  /**
   * Get the AI session for a VR session
   */
  getSessionAI(sessionId: string): AISession | undefined {
    return this.sessionAI.get(sessionId);
  }

  /**
   * Get or create an AI session for a VR session
   * @param sessionId - VR session ID
   * @param workspaceId - Workspace ID for context
   * @param onMessage - Callback for agent responses
   * @param options - Optional configuration
   */
  async getOrCreateForSession(
    sessionId: string,
    workspaceId: string,
    onMessage: (message: string) => void,
    options: {
      displayLines?: number;
      apiKey?: string;
      displayApiSecret?: string;
    } = {}
  ): Promise<AISession> {
    // Return existing if available
    const existing = this.sessionAI.get(sessionId);
    if (existing) {
      console.log(`[AI] Returning existing session AI for session ${sessionId}`);
      return existing;
    }

    // Create new AI session
    const client = options.apiKey ? new OpenHandsClient(options.apiKey) : this.client;
    if (!client) {
      throw new Error('OpenHands API not configured');
    }

    console.log(`[AI] Creating new session AI for session ${sessionId}${options.displayLines ? ` (${options.displayLines} display lines)` : ''}`);

    // Load system prompt with session context
    const systemPrompt = loadPrompt('system-prompt', options.displayLines, workspaceId, sessionId);
    console.log(`[AI] Loaded system prompt (${systemPrompt.length} chars)`);

    // Build secrets map
    const secrets: Record<string, string> = {};
    if (options.displayApiSecret) {
      secrets['DISPLAY_API_SECRET'] = options.displayApiSecret;
    }

    // Start conversation
    console.log(`[AI] Creating OpenHands conversation for session ${sessionId}...`);
    const startResponse = await client.startConversation(
      systemPrompt,
      `Voice Relay session: ${sessionId}`,
      Object.keys(secrets).length > 0 ? secrets : undefined
    );
    console.log(`[AI] Conversation started, task id: ${startResponse.id}`);

    // Wait for conversation to be ready
    console.log(`[AI] Waiting for conversation to be ready...`);
    const readyTask = await client.pollUntilReady(
      startResponse.id,
      120000,
      2000
    );
    console.log(`[AI] Conversation ready:`, readyTask);

    const conversationId = readyTask.app_conversation_id || startResponse.id;
    console.log(`[AI] Using conversation ID: ${conversationId}`);

    // Get conversation details for WebSocket connection
    const convInfo = await client.getConversation(conversationId);
    if (!convInfo) {
      throw new Error('Failed to get conversation info');
    }

    const agentServerUrl = convInfo.conversation_url?.split('/api/')[0];
    if (!agentServerUrl || !convInfo.session_api_key) {
      throw new Error('Missing agent server URL or session API key');
    }

    console.log(`[AI] Agent server: ${agentServerUrl}`);

    const session: AISession = {
      conversationId,
      taskId: startResponse.id,
      sessionId,  // Key by session, not device
      mode: 'kiosk',
      agentServerUrl,
      sessionApiKey: convInfo.session_api_key,
      onMessage,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      isThinking: false,
    };

    this.sessionAI.set(sessionId, session);

    // Connect WebSocket
    this.connectWebSocket(session);

    console.log(`[AI] Session AI started successfully for session ${sessionId}`);
    return session;
  }

  /**
   * Send a message to the AI for a VR session
   */
  async sendSessionMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessionAI.get(sessionId);
    if (!session) {
      throw new Error('No active AI session for this VR session');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Track thinking state
    session.isThinking = true;
    session.lastMessageSentAt = Date.now();

    // Notify via callback
    if (this.onThinkingChange && session.sessionId) {
      this.onThinkingChange(session.sessionId, true);
    }

    console.log(`[AI] Sending session message via WebSocket: "${message.substring(0, 50)}..."`);
    
    session.ws.send(JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text: message }],
      run: true,
    }));
  }

  /**
   * End the AI session for a VR session
   */
  async endSessionAI(sessionId: string): Promise<void> {
    const session = this.sessionAI.get(sessionId);
    if (!session) return;

    console.log(`[AI] Ending session AI for session ${sessionId}`);

    if (session.ws) {
      session.ws.close();
      session.ws = undefined;
    }

    this.sessionAI.delete(sessionId);
  }

  /**
   * V1 type guard for MessageEvent
   */
  private isV1MessageEvent(event: unknown): event is V1MessageEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'llm_message' in event &&
      typeof (event as V1MessageEvent).llm_message === 'object' &&
      (event as V1MessageEvent).llm_message !== null &&
      'role' in (event as V1MessageEvent).llm_message &&
      'content' in (event as V1MessageEvent).llm_message
    );
  }

  /**
   * V1 type guard for ConversationStateUpdateEvent
   */
  private isV1ConversationStateUpdateEvent(event: unknown): event is V1ConversationStateUpdateEvent {
    return (
      typeof event === 'object' &&
      event !== null &&
      'kind' in event &&
      (event as V1ConversationStateUpdateEvent).kind === 'ConversationStateUpdateEvent'
    );
  }

  /**
   * Connect WebSocket to agent server (V1 API)
   * Authentication is done via query parameters, not a separate auth message
   * @param session - The AI session to connect
   */
  private connectWebSocket(session: AISession): void {
    if (!session.agentServerUrl || !session.sessionApiKey) {
      console.error('[AI] Missing agent server URL or session API key');
      return;
    }

    const wsUrl = session.agentServerUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    // V1 WebSocket authentication via query parameters
    const queryParams = new URLSearchParams({
      session_api_key: session.sessionApiKey,
      resend_all: 'true',  // Request all events on connect
    });
    const fullUrl = `${wsUrl}/sockets/events/${session.conversationId}?${queryParams.toString()}`;
    console.log(`[AI] Connecting V1 WebSocket to ${fullUrl.replace(session.sessionApiKey, '***')}`);

    const ws = new WebSocket(fullUrl);
    session.ws = ws;

    ws.on('open', () => {
      console.log('[AI] V1 WebSocket connected (auth via query params)');
      session.reconnectAttempts = 0;
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        
        // V1 MessageEvent - agent messages have llm_message with role/content
        if (this.isV1MessageEvent(event) && event.source === 'agent') {
          // Update thinking state when agent responds
          if (session.isThinking) {
            session.isThinking = false;
            session.pendingMessageId = undefined;
            
            // Notify via callback for session-centric sessions
            if (this.onThinkingChange && session.sessionId) {
              this.onThinkingChange(session.sessionId, false);
            }
          }

          const text = event.llm_message?.content
            ?.filter((p: ContentPart) => p.type === 'text')
            ?.map((p: ContentPart) => p.text)
            ?.join('\n');

          if (text && session.onMessage) {
            console.log(`[AI] Got agent response: "${text.substring(0, 100)}..."`);
            session.onMessage(text);
          }
        } 
        // V1 ConversationStateUpdateEvent - status updates
        else if (this.isV1ConversationStateUpdateEvent(event)) {
          if (event.key === 'execution_status' && event.value?.execution_status) {
            console.log(`[AI] Execution status: ${event.value.execution_status}`);
          } else if (event.key === 'full_state') {
            console.log(`[AI] Full state update received`);
          }
        }
        // V1 ConversationErrorEvent or ServerErrorEvent
        else if (event.kind === 'ConversationErrorEvent' || event.kind === 'ServerErrorEvent') {
          console.error(`[AI] Error event: ${event.message || event.error || 'Unknown error'}`);
        }
        // Forward other events as agent actions for visibility
        else if (event.kind) {
          console.log(`[AI] Event: ${event.kind} (source: ${event.source || 'unknown'})`);
          
          // Forward action events to the session via callback
          if (this.onAction && session.sessionId) {
            // Extract relevant fields based on event kind for rich content rendering
            const extractedFields = extractEventFields(event as V1Event);
            
            const action: AgentAction = {
              id: event.id || crypto.randomUUID(),
              timestamp: event.timestamp || new Date().toISOString(),
              kind: event.kind,
              source: event.source || 'unknown',
              summary: formatEventSummary(event as V1Event),
              // Spread extracted fields (only non-undefined values will be present)
              ...extractedFields,
            };
            this.onAction(session.sessionId, action);
          }
        }
      } catch (e) {
        console.error('[AI] Error parsing WebSocket message:', e);
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[AI] WebSocket error:', err.message);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[AI] WebSocket closed: ${code} - ${reason.toString()}`);
      session.ws = undefined;

      // Check if session still exists for reconnection
      const sessionExists = session.sessionId && this.sessionAI.has(session.sessionId);

      // Attempt reconnect if session still exists and not max attempts
      if (sessionExists && session.reconnectAttempts < session.maxReconnectAttempts) {
        session.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts), 30000);
        console.log(`[AI] Reconnecting in ${delay}ms (attempt ${session.reconnectAttempts}/${session.maxReconnectAttempts})`);
        setTimeout(() => {
          if (session.sessionId && this.sessionAI.has(session.sessionId)) {
            this.connectWebSocket(session);
          }
        }, delay);
      }
    });
  }

  /**
   * End all AI sessions
   */
  async shutdown(): Promise<void> {
    for (const sessionId of this.sessionAI.keys()) {
      await this.endSessionAI(sessionId);
    }
  }
}

// Export singleton instance
export const aiSessionManager = new AISessionManager();

/**
 * Helper function to get workspace API key from settings
 * Returns null if not configured or if decryption fails
 */
export async function getWorkspaceApiKey(
  workspaceId: string,
  getSettings: (id: string) => { 
    openhandsApiKeyEncrypted: string | null;
    openhandsApiKeyIv: string | null;
    openhandsApiKeyTag: string | null;
  } | null,
  decryptFn: (encrypted: { encrypted: string; iv: string; tag: string }) => string
): Promise<string | null> {
  const settings = getSettings(workspaceId);
  if (!settings?.openhandsApiKeyEncrypted || !settings?.openhandsApiKeyIv || !settings?.openhandsApiKeyTag) {
    return null;
  }

  try {
    return decryptFn({
      encrypted: settings.openhandsApiKeyEncrypted,
      iv: settings.openhandsApiKeyIv,
      tag: settings.openhandsApiKeyTag,
    });
  } catch (err) {
    console.error('[AI] Failed to decrypt workspace API key:', err);
    return null;
  }
}
