/**
 * OpenHands Cloud API client for Voice Relay
 * 
 * Handles creating conversations and sending/receiving messages
 * via the OpenHands V1 API.
 */

import fs from 'fs';
import path from 'path';

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
  session_api_key?: string;
  conversation_url?: string;
}

interface MessageEvent {
  id: string;
  kind: string;
  source: string;
  timestamp: string;
  message?: {
    role: string;
    content: string | ContentPart[];
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
   */
  async sendMessage(conversationId: string, message: string): Promise<{ message_id: string; position: number }> {
    return this.request<{ message_id: string; position: number }>(
      'POST',
      `/conversations/${conversationId}/pending-messages`,
      { content: message }
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
 * Active AI session for a device
 */
export interface AISession {
  conversationId: string;
  taskId: string;
  deviceId: string;
  mode: 'chat' | 'kiosk';
  lastEventId?: string;
  pollingInterval?: NodeJS.Timeout;
}

/**
 * Manager for AI sessions
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

    // End existing session if any
    if (this.sessions.has(deviceId)) {
      await this.endSession(deviceId);
    }

    // Load appropriate system prompt
    const systemPrompt = loadPrompt(mode === 'kiosk' ? 'kiosk-system' : 'chat-system');

    // Start conversation
    const startResponse = await this.client.startConversation(
      systemPrompt,
      `Voice Relay ${mode} session`
    );

    // Wait for conversation to be ready
    const readyTask = await this.client.pollUntilReady(
      startResponse.id,
      60000, // 1 minute timeout for initial start
      2000
    );

    const conversationId = readyTask.app_conversation_id || startResponse.id;

    const session: AISession = {
      conversationId,
      taskId: startResponse.id,
      deviceId,
      mode,
    };

    // Start polling for responses
    session.pollingInterval = setInterval(async () => {
      try {
        await this.pollForResponses(session, onMessage);
      } catch (e) {
        console.error('Error polling for responses:', e);
      }
    }, 3000);

    this.sessions.set(deviceId, session);
    return session;
  }

  /**
   * Send a message from the user to the AI
   */
  async sendMessage(deviceId: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error('OpenHands API not configured');
    }

    const session = this.sessions.get(deviceId);
    if (!session) {
      throw new Error('No active AI session for this device');
    }

    await this.client.sendMessage(session.conversationId, message);
  }

  /**
   * Poll for new responses from the AI
   */
  private async pollForResponses(
    session: AISession,
    onMessage: (message: string) => void
  ): Promise<void> {
    if (!this.client) return;

    const events = await this.client.getMessageEvents(session.conversationId, 20);
    
    // Find new assistant messages
    for (const event of events) {
      // Skip if we've already processed this event
      if (session.lastEventId && event.id <= session.lastEventId) {
        continue;
      }

      // Process assistant messages
      if (event.message?.role === 'assistant') {
        const content = event.message.content;
        let text: string;
        
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = content
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('\n');
        } else {
          continue;
        }

        if (text) {
          onMessage(text);
        }
      }

      session.lastEventId = event.id;
    }
  }

  /**
   * End an AI session
   */
  async endSession(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId);
    if (!session) return;

    if (session.pollingInterval) {
      clearInterval(session.pollingInterval);
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
