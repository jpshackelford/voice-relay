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
   */
  async startConversation(initialMessage: string, title?: string): Promise<StartTaskResponse> {
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
 */
export function loadPrompt(promptName: string): string {
  const promptsDir = path.join(__dirname, '..', 'prompts');
  const promptPath = path.join(promptsDir, `${promptName}.md`);
  
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt not found: ${promptName}`);
  }
  
  return fs.readFileSync(promptPath, 'utf-8');
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
   * Connect WebSocket to agent server
   */
  private connectWebSocket(session: AISession): void {
    if (!session.agentServerUrl || !session.sessionApiKey) {
      console.error('[AI] Missing agent server URL or session API key');
      return;
    }

    const wsUrl = session.agentServerUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const fullUrl = `${wsUrl}/sockets/events/${session.conversationId}`;
    console.log(`[AI] Connecting WebSocket to ${fullUrl}`);

    const ws = new WebSocket(fullUrl);
    session.ws = ws;

    ws.on('open', () => {
      console.log('[AI] WebSocket connected, sending auth...');
      ws.send(JSON.stringify({
        type: 'auth',
        session_api_key: session.sessionApiKey
      }));
      session.reconnectAttempts = 0;
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        
        if (event.kind === 'MessageEvent' && event.source === 'agent') {
          const text = event.llm_message?.content
            ?.filter((p: ContentPart) => p.type === 'text')
            ?.map((p: ContentPart) => p.text)
            ?.join('\n');

          if (text && session.onMessage) {
            console.log(`[AI] Got agent response: "${text.substring(0, 100)}..."`);
            session.onMessage(text);
          }
        } else if (event.kind === 'ConversationStateUpdateEvent') {
          // Status update, can log if needed
          if (event.execution_status) {
            console.log(`[AI] Execution status: ${event.execution_status}`);
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
   */
  async startSession(
    deviceId: string,
    mode: 'chat' | 'kiosk',
    onMessage: (message: string) => void
  ): Promise<AISession> {
    if (!this.client) {
      throw new Error('OpenHands API not configured');
    }

    console.log(`[AI] Starting ${mode} session for device ${deviceId}`);

    // End existing session if any
    if (this.sessions.has(deviceId)) {
      await this.endSession(deviceId);
    }

    // Load appropriate system prompt
    const systemPrompt = loadPrompt(mode === 'kiosk' ? 'kiosk-system' : 'chat-system');
    console.log(`[AI] Loaded system prompt (${systemPrompt.length} chars)`);

    // Start conversation
    console.log(`[AI] Creating OpenHands conversation...`);
    const startResponse = await this.client.startConversation(
      systemPrompt,
      `Voice Relay ${mode} session`
    );
    console.log(`[AI] Conversation started, task id: ${startResponse.id}`);

    // Wait for conversation to be ready
    console.log(`[AI] Waiting for conversation to be ready...`);
    const readyTask = await this.client.pollUntilReady(
      startResponse.id,
      60000, // 1 minute timeout for initial start
      2000
    );
    console.log(`[AI] Conversation ready:`, readyTask);

    const conversationId = readyTask.app_conversation_id || startResponse.id;
    console.log(`[AI] Using conversation ID: ${conversationId}`);

    // Get conversation details for WebSocket connection
    const convInfo = await this.client.getConversation(conversationId);
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
      content: [{ type: 'text', text: message }]
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
