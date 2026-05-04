/**
 * OpenHands Conversation + WebSocket Demo
 * 
 * Demonstrates:
 * 1. Creating a conversation via OpenHands V1 API
 * 2. Polling for conversation to be ready
 * 3. Getting WebSocket connection info
 * 4. Connecting to WebSocket and sending/receiving messages
 * 
 * Based on https://app.all-hands.dev/openapi.json
 * 
 * Usage:
 *   export OPENHANDS_CLOUD_API_KEY="your-api-key"
 *   npx tsx scripts/openhands-websocket-demo.ts
 */

import WebSocket from 'ws';

const OPENHANDS_BASE_URL = 'https://app.all-hands.dev';
const API_V1 = `${OPENHANDS_BASE_URL}/api/v1`;

// Terminal statuses for start task polling
const TERMINAL_STATUSES = new Set(['READY', 'ERROR', 'FAILED', 'CANCELLED', 'DONE', 'COMPLETED']);

// ============================================================================
// API Types (from OpenAPI spec)
// ============================================================================

interface ContentPart {
  type: 'text';
  text: string;
}

/** Request body for POST /api/v1/app-conversations */
interface AppConversationStartRequest {
  initial_message: {
    role: 'user';
    content: ContentPart[];
    run: boolean;
  };
  title?: string;
  selected_repository?: string;
  selected_branch?: string;
}

/** Response from POST /api/v1/app-conversations */
interface AppConversationStartTask {
  id: string;                      // start_task_id
  status: string;                  // PENDING, IN_PROGRESS, READY, ERROR, etc.
  app_conversation_id?: string;    // Available when READY
  error?: string;
}

/** AppConversation from GET /api/v1/app-conversations?ids=... */
interface AppConversation {
  id: string;
  title?: string;
  sandbox_status?: string;
  execution_status?: string;
  sandbox_id?: string;
  session_api_key?: string;        // For agent server auth
  conversation_url?: string;       // Agent server URL pattern
}

/** Message format for WebSocket send */
interface WsSendMessage {
  role: 'user';
  content: ContentPart[];
  run?: boolean;  // Auto-run agent loop after message
}

/** V1 MessageEvent from WebSocket */
interface MessageEvent {
  id: string;
  kind: 'MessageEvent';
  timestamp: string;
  source: 'agent' | 'user' | 'environment' | 'hook';
  llm_message: {
    role: string;
    content: ContentPart[];
  };
}

// ============================================================================
// API Client
// ============================================================================

class OpenHandsAPI {
  constructor(private apiKey: string) {}

  private async request<T>(method: string, endpoint: string, body?: object): Promise<T> {
    const url = `${API_V1}${endpoint}`;
    console.log(`[API] ${method} ${url}`);
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Step 1: Create a new conversation
   * POST /api/v1/app-conversations
   */
  async createConversation(message: string, title?: string): Promise<AppConversationStartTask> {
    const payload: AppConversationStartRequest = {
      initial_message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
        run: true,
      },
      title,
    };

    return this.request<AppConversationStartTask>('POST', '/app-conversations', payload);
  }

  /**
   * Step 2: Poll for start task completion
   * GET /api/v1/app-conversations/start-tasks?ids=...
   */
  async getStartTask(taskId: string): Promise<AppConversationStartTask | null> {
    const response = await this.request<(AppConversationStartTask | null)[]>(
      'GET',
      `/app-conversations/start-tasks?ids=${encodeURIComponent(taskId)}`
    );
    return response[0] ?? null;
  }

  /**
   * Step 3: Get conversation details (including WebSocket info)
   * GET /api/v1/app-conversations?ids=...
   */
  async getConversation(conversationId: string): Promise<AppConversation | null> {
    const response = await this.request<(AppConversation | null)[]>(
      'GET',
      `/app-conversations?ids=${encodeURIComponent(conversationId)}`
    );
    return response[0] ?? null;
  }

  /**
   * Poll until conversation is ready
   */
  async pollUntilReady(taskId: string, timeoutMs = 120000, intervalMs = 2000): Promise<AppConversationStartTask> {
    const deadline = Date.now() + timeoutMs;
    
    while (Date.now() < deadline) {
      const task = await this.getStartTask(taskId);
      const status = (task?.status || '').toUpperCase();
      
      console.log(`[Poll] Status: ${status}`);
      
      if (TERMINAL_STATUSES.has(status)) {
        if (status === 'ERROR' || status === 'FAILED') {
          throw new Error(`Conversation failed: ${task?.error || status}`);
        }
        return task!;
      }
      
      await sleep(intervalMs);
    }
    
    throw new Error(`Timeout waiting for conversation to be ready`);
  }
}

// ============================================================================
// WebSocket Client
// ============================================================================

interface WebSocketInfo {
  wsUrl: string;
  sessionApiKey: string;
  conversationId: string;
}

/**
 * Extract WebSocket connection info from conversation
 */
function getWebSocketInfo(conversation: AppConversation): WebSocketInfo {
  const { id, conversation_url, session_api_key } = conversation;
  
  if (!conversation_url || !session_api_key) {
    throw new Error('Missing conversation_url or session_api_key');
  }

  // conversation_url looks like: https://{runtime-host}/api/conversations/{id}
  // WebSocket URL is: wss://{runtime-host}/sockets/events/{id}
  const agentServerUrl = conversation_url.split('/api/')[0];
  const wsUrl = agentServerUrl.replace('https://', 'wss://').replace('http://', 'ws://');
  
  return {
    wsUrl: `${wsUrl}/sockets/events/${id}`,
    sessionApiKey: session_api_key,
    conversationId: id,
  };
}

/**
 * Connect to OpenHands WebSocket
 */
function connectWebSocket(info: WebSocketInfo, onMessage: (msg: MessageEvent) => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // V1 WebSocket auth via query parameters
    const params = new URLSearchParams({
      session_api_key: info.sessionApiKey,
      resend_all: 'true',  // Get all events on connect
    });
    
    const fullUrl = `${info.wsUrl}?${params.toString()}`;
    console.log(`[WS] Connecting to ${info.wsUrl}`);
    
    const ws = new WebSocket(fullUrl);
    let connected = false;
    
    ws.on('open', () => {
      console.log('[WS] Connected');
      connected = true;
      resolve(ws);
    });
    
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        
        // Handle different event types
        if (event.kind === 'MessageEvent' && event.source === 'agent') {
          onMessage(event as MessageEvent);
        } else if (event.kind === 'ConversationStateUpdateEvent') {
          console.log(`[WS] State update: ${event.key}`);
        } else if (event.kind === 'ConversationErrorEvent' || event.kind === 'ServerErrorEvent') {
          console.error(`[WS] Error: ${event.message || event.error}`);
        } else if (event.kind) {
          console.log(`[WS] Event: ${event.kind} (${event.source || 'unknown'})`);
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    });
    
    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      if (!connected) {
        reject(err);
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`[WS] Closed: ${code} - ${reason.toString()}`);
    });
  });
}

/**
 * Send a message via WebSocket
 */
function sendMessage(ws: WebSocket, message: string): void {
  const payload: WsSendMessage = {
    role: 'user',
    content: [{ type: 'text', text: message }],
    run: true,  // Auto-run agent loop
  };
  
  console.log(`[WS] Sending: "${message.substring(0, 50)}..."`);
  ws.send(JSON.stringify(payload));
}

// ============================================================================
// Demo
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Get API key from environment
  const apiKey = process.env.OPENHANDS_CLOUD_API_KEY || process.env.OPENHANDS_API_KEY;
  if (!apiKey) {
    console.error('Error: Set OPENHANDS_CLOUD_API_KEY environment variable');
    process.exit(1);
  }

  const api = new OpenHandsAPI(apiKey);

  console.log('\n=== Step 1: Create Conversation ===');
  const initialMessage = 'Hello! Please respond with a brief greeting.';
  const startTask = await api.createConversation(initialMessage, 'WebSocket Demo');
  console.log(`Start task ID: ${startTask.id}`);
  console.log(`Status: ${startTask.status}`);

  console.log('\n=== Step 2: Poll Until Ready ===');
  const readyTask = await api.pollUntilReady(startTask.id);
  const conversationId = readyTask.app_conversation_id || startTask.id;
  console.log(`Conversation ID: ${conversationId}`);

  console.log('\n=== Step 3: Get WebSocket Info ===');
  const conversation = await api.getConversation(conversationId);
  if (!conversation) {
    throw new Error('Failed to get conversation');
  }
  
  console.log(`Sandbox status: ${conversation.sandbox_status}`);
  console.log(`Execution status: ${conversation.execution_status}`);
  console.log(`Conversation URL: ${conversation.conversation_url}`);
  console.log(`Session API Key: ${conversation.session_api_key?.substring(0, 8)}...`);

  const wsInfo = getWebSocketInfo(conversation);
  console.log(`\nWebSocket URL: ${wsInfo.wsUrl}`);

  console.log('\n=== Step 4: Connect WebSocket ===');
  const ws = await connectWebSocket(wsInfo, (event) => {
    const text = event.llm_message?.content
      ?.filter(p => p.type === 'text')
      ?.map(p => p.text)
      ?.join('\n');
    console.log(`\n[Agent Response]\n${text}\n`);
  });

  console.log('\n=== Step 5: Send First Message via WebSocket ===');
  await sleep(2000); // Wait for initial events to settle
  
  sendMessage(ws, 'What is 2 + 2?');

  // Wait for response
  console.log('\nWaiting for first response (15s)...');
  await sleep(15000);

  console.log('\n=== Step 6: Send Second Message via WebSocket ===');
  sendMessage(ws, 'Now multiply that result by 10. What do you get?');

  // Wait for response
  console.log('\nWaiting for second response (15s)...');
  await sleep(15000);

  console.log('\n=== Step 7: Send Third Message via WebSocket ===');
  sendMessage(ws, 'Great! Can you tell me what day of the week it is today?');

  // Wait for response
  console.log('\nWaiting for third response (15s)...');
  await sleep(15000);

  console.log('\n=== Cleanup ===');
  ws.close();
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
