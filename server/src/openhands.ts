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

/** Generic OpenHands event shape for action forwarding */
interface V1Event {
  id?: string;
  timestamp?: string;
  kind?: string;
  source?: string;
  // Action-specific fields (direct event format)
  command?: string;
  path?: string;
  thought?: string;
  args?: Record<string, unknown>;
  // V1 wrapped event format - nested action/observation objects
  action?: Record<string, unknown> | string;
  observation?: Record<string, unknown>;
  // For nested structures
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
      // Try to get a preview of the message content
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
            const action: AgentAction = {
              id: event.id || crypto.randomUUID(),
              timestamp: event.timestamp || new Date().toISOString(),
              kind: event.kind,
              source: event.source || 'unknown',
              summary: formatEventSummary(event as V1Event),
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
