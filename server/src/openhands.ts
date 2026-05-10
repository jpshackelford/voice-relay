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
 * Active AI session for a device using WebSocket
 */
export interface AISession {
  conversationId: string;
  taskId: string;
  deviceId: string;
  mode: 'chat' | 'kiosk';
  ws?: WebSocket;
  agentServerUrl?: string;
  sessionApiKey?: string;
  lastEventId?: string;
  onMessage?: (message: string) => void;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
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
 * Manager for AI sessions using WebSocket
 */
export class AISessionManager {
  private sessions: Map<string, AISession> = new Map();
  private client: OpenHandsClient | null = null;

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

  getSession(deviceId: string): AISession | undefined {
    return this.sessions.get(deviceId);
  }

  hasSession(deviceId: string): boolean {
    return this.sessions.has(deviceId);
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
        // Log unknown event kinds for debugging
        else if (event.kind) {
          console.log(`[AI] Event: ${event.kind} (source: ${event.source || 'unknown'})`);
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

      // Attempt reconnect if session still exists and not max attempts
      if (this.sessions.has(session.deviceId) && 
          session.reconnectAttempts < session.maxReconnectAttempts) {
        session.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts), 30000);
        console.log(`[AI] Reconnecting in ${delay}ms (attempt ${session.reconnectAttempts}/${session.maxReconnectAttempts})`);
        setTimeout(() => {
          if (this.sessions.has(session.deviceId)) {
            this.connectWebSocket(session);
          }
        }, delay);
      }
    });
  }

  /**
   * Start a new AI session for a device
   * @param deviceId - Unique device identifier
   * @param mode - 'chat' or 'kiosk' mode
   * @param onMessage - Callback for agent responses
   * @param displayLines - Optional max display lines for kiosk (from device screen size)
   * @param apiKey - Optional workspace-specific API key (falls back to env var)
   * @param workspaceId - Optional workspace ID to inject into kiosk prompts for display API calls
   * @param sessionId - Optional session ID for display API calls
   * @param displayApiSecret - Optional display API secret for authenticating display API calls
   */
  async startSession(
    deviceId: string,
    mode: 'chat' | 'kiosk',
    onMessage: (message: string) => void,
    displayLines?: number,
    apiKey?: string,
    workspaceId?: string,
    sessionId?: string,
    displayApiSecret?: string
  ): Promise<AISession> {
    // Create a client with the provided API key or use the default
    const client = apiKey ? new OpenHandsClient(apiKey) : this.client;
    if (!client) {
      throw new Error('OpenHands API not configured');
    }

    console.log(`[AI] Starting ${mode} session for device ${deviceId}${displayLines ? ` (${displayLines} display lines)` : ''}${workspaceId ? ` (workspace: ${workspaceId})` : ''}${sessionId ? ` (session: ${sessionId})` : ''}`);

    // End existing session if any
    if (this.sessions.has(deviceId)) {
      await this.endSession(deviceId);
    }

    // Load unified system prompt with display line info, workspace ID, and session ID
    // All sessions receive the same prompt with full capabilities (including display API)
    const systemPrompt = loadPrompt('system-prompt', displayLines, workspaceId, sessionId);
    console.log(`[AI] Loaded system prompt (${systemPrompt.length} chars)`);

    // Build secrets map for OpenHands - inject display API secret for all sessions
    // Mobile devices can still command kiosk displays to show content
    const secrets: Record<string, string> = {};
    if (displayApiSecret) {
      secrets['DISPLAY_API_SECRET'] = displayApiSecret;
    }

    // Start conversation
    console.log(`[AI] Creating OpenHands conversation...`);
    const startResponse = await client.startConversation(
      systemPrompt,
      `Voice Relay ${mode} session`,
      Object.keys(secrets).length > 0 ? secrets : undefined
    );
    console.log(`[AI] Conversation started, task id: ${startResponse.id}`);

    // Wait for conversation to be ready
    console.log(`[AI] Waiting for conversation to be ready...`);
    const readyTask = await client.pollUntilReady(
      startResponse.id,
      60000, // 1 minute timeout for initial start
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

    // Extract agent server URL from conversation_url
    const agentServerUrl = convInfo.conversation_url?.split('/api/')[0];
    if (!agentServerUrl || !convInfo.session_api_key) {
      throw new Error('Missing agent server URL or session API key');
    }

    console.log(`[AI] Agent server: ${agentServerUrl}`);

    const session: AISession = {
      conversationId,
      taskId: startResponse.id,
      deviceId,
      mode,
      agentServerUrl,
      sessionApiKey: convInfo.session_api_key,
      onMessage,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
    };

    this.sessions.set(deviceId, session);

    // Connect WebSocket
    this.connectWebSocket(session);

    console.log(`[AI] Session started successfully with WebSocket`);
    return session;
  }

  /**
   * Send a message from the user to the AI via WebSocket
   */
  async sendMessage(deviceId: string, message: string): Promise<void> {
    const session = this.sessions.get(deviceId);
    if (!session) {
      throw new Error('No active AI session for this device');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    console.log(`[AI] Sending message via WebSocket: "${message.substring(0, 50)}..."`);
    
    session.ws.send(JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text: message }],
      run: true  // Auto-run agent loop to process and respond
    }));
  }

  /**
   * End an AI session
   */
  async endSession(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId);
    if (!session) return;

    console.log(`[AI] Ending session for device ${deviceId}`);

    // Close WebSocket
    if (session.ws) {
      session.ws.close();
      session.ws = undefined;
    }

    this.sessions.delete(deviceId);
  }

  /**
   * End all sessions
   */
  async shutdown(): Promise<void> {
    for (const deviceId of this.sessions.keys()) {
      await this.endSession(deviceId);
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
