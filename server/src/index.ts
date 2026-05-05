import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import { DeviceRegistry } from './registry.js';
import { createStoreFromEnv, type MessageStore, SQLiteStore } from './storage/index.js';
import { aiSessionManager } from './openhands.js';
import { createAuthRouter, UserRepository, JWTService, type AuthConfig } from './auth/index.js';
import { createWorkspaceRouter, WorkspaceRepository } from './workspaces/index.js';
import type { ClientMessage, RegisteredMessage, RelayedTextMessage, HistoryMessage, DisplayContent } from './types.js';

function getNetworkAddresses(): string[] {
  const nets = networkInterfaces();
  const addresses: string[] = [];
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const registry = new DeviceRegistry();
const store: MessageStore = createStoreFromEnv();

// Auth configuration from environment variables
function getAuthConfig(): AuthConfig | null {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const jwtSecret = process.env.JWT_SECRET;
  
  if (!githubClientId || !githubClientSecret || !jwtSecret) {
    console.log('[Auth] Missing GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, or JWT_SECRET - auth disabled');
    return null;
  }
  
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  
  return {
    githubClientId,
    githubClientSecret,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    callbackUrl: `${baseUrl}/auth/github/callback`,
  };
}

// Serve static files from client build (production)
const clientDist = join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', devices: registry.getAllDevices().length });
});

// Server info endpoint (for QR code generation)
app.get('/api/server-info', (req, res) => {
  const addresses = getNetworkAddresses();
  const port = PORT;
  const protocol = req.secure ? 'https' : 'http';
  
  // Build URLs for each network interface
  const urls = addresses.map(addr => `${protocol}://${addr}:${port}`);
  
  // Also include hostname if available
  const hostname = req.hostname;
  if (hostname && hostname !== 'localhost' && !addresses.includes(hostname)) {
    urls.unshift(`${protocol}://${hostname}:${port}`);
  }
  
  res.json({
    urls,
    addresses,
    port,
    hostname,
  });
});

// Display API for AI agents to send content to kiosk displays
app.use(express.json());

app.post('/api/display', (req, res) => {
  const { type, content, title } = req.body as DisplayContent;
  
  if (!type || !['markdown', 'image', 'clear'].includes(type)) {
    res.status(400).json({ error: 'Invalid display type. Must be markdown, image, or clear.' });
    return;
  }
  
  if (type !== 'clear' && !content) {
    res.status(400).json({ error: 'Content required for markdown and image types.' });
    return;
  }
  
  const displayContent: DisplayContent = { type, content, title };
  registry.broadcastToKiosks(displayContent);
  
  const kioskCount = registry.getKioskDevices().length;
  res.json({ success: true, kioskCount });
});

// AI conversation management endpoints
app.get('/api/ai/status', (_req, res) => {
  res.json({ 
    available: aiSessionManager.isAvailable(),
    message: aiSessionManager.isAvailable() 
      ? 'OpenHands AI is available' 
      : 'OpenHands API key not configured'
  });
});

app.post('/api/ai/connect', async (req, res) => {
  const { deviceId, mode } = req.body as { deviceId: string; mode: 'chat' | 'kiosk' };
  
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId required' });
    return;
  }
  
  if (!aiSessionManager.isAvailable()) {
    res.status(503).json({ error: 'OpenHands API not configured' });
    return;
  }
  
  try {
    const device = registry.getDevice(deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // Callback to send AI responses as chat messages
    const onMessage = (text: string) => {
      const aiMessage: RelayedTextMessage = {
        type: 'text',
        utteranceId: `ai-${Date.now()}`,
        senderId: 'openhands-ai',
        senderName: '✨ AI',
        text,
        partial: false,
      };
      
      // Store and broadcast the AI response
      store.append(aiMessage).catch(err => console.error('Failed to store AI message:', err));
      registry.broadcastToOutputs(aiMessage);
    };

    // Get the minimum display lines across all kiosk devices for safe content sizing
    const displayLines = registry.getMinKioskDisplayLines();
    
    const session = await aiSessionManager.startSession(
      deviceId, 
      mode || 'chat', 
      onMessage,
      displayLines
    );
    
    // Notify the device that AI is connected
    registry.sendToDevice(deviceId, {
      type: 'ai-status',
      connected: true,
      conversationId: session.conversationId,
    });
    
    res.json({ 
      success: true, 
      conversationId: session.conversationId,
      displayLines,
      message: 'AI connected'
    });
  } catch (err) {
    console.error('Failed to connect AI:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/message', async (req, res) => {
  const { deviceId, message } = req.body as { deviceId: string; message: string };
  
  if (!deviceId || !message) {
    res.status(400).json({ error: 'deviceId and message required' });
    return;
  }
  
  if (!aiSessionManager.hasSession(deviceId)) {
    res.status(404).json({ error: 'No active AI session for this device' });
    return;
  }
  
  try {
    await aiSessionManager.sendMessage(deviceId, message);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send AI message:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/ai/disconnect', async (req, res) => {
  const { deviceId } = req.body as { deviceId: string };
  
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId required' });
    return;
  }
  
  try {
    await aiSessionManager.endSession(deviceId);
    
    // Notify the device that AI is disconnected
    registry.sendToDevice(deviceId, {
      type: 'ai-status',
      connected: false,
    });
    
    res.json({ success: true, message: 'AI disconnected' });
  } catch (err) {
    console.error('Failed to disconnect AI:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(clientDist, 'index.html'));
});

// WebSocket connection handling
wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] New connection');
  let deviceId: string | null = null;

  ws.on('message', async (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'register': {
          deviceId = message.deviceId;
          registry.register(
            message.deviceId, 
            ws, 
            message.displayName, 
            message.mode,
            message.screenWidth,
            message.screenHeight
          );
          
          const response: RegisteredMessage = {
            type: 'registered',
            deviceId: message.deviceId,
          };
          ws.send(JSON.stringify(response));
          
          // Broadcast updated device list to all clients
          registry.broadcastDeviceList();

          // Send message history to all devices (both mobile and kiosk can receive)
          const history = await store.getRecent(50);
          const historyMessage: HistoryMessage = {
            type: 'history',
            messages: history,
          };
          ws.send(JSON.stringify(historyMessage));
          break;
        }

        case 'update-device': {
          if (deviceId) {
            registry.updateDevice(deviceId, message);
            registry.broadcastDeviceList();
          }
          break;
        }

        case 'text': {
          if (!deviceId) {
            console.warn('[WS] Received text from unregistered device');
            return;
          }

          const device = registry.getDevice(deviceId);
          if (!device || !registry.canSend(device)) {
            console.warn('[WS] Text received from device that cannot send');
            return;
          }

          const relayMessage: RelayedTextMessage = {
            type: 'text',
            utteranceId: message.utteranceId,
            senderId: deviceId,
            senderName: device.displayName,
            text: message.text,
            partial: message.partial,
          };

          // Store final messages only
          if (!message.partial) {
            await store.append(relayMessage);
          }

          registry.broadcastToOutputs(relayMessage);
          break;
        }
      }
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    if (deviceId) {
      registry.disconnect(deviceId);
      registry.broadcastDeviceList();
    }
    console.log('[WS] Connection closed');
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  await store.connect();

  // Set up auth and workspace routes if configured and using SQLite
  const authConfig = getAuthConfig();
  if (authConfig && store instanceof SQLiteStore) {
    const db = store.getDatabase();
    if (db) {
      const userRepository = new UserRepository(db);
      const jwtService = new JWTService({
        secret: authConfig.jwtSecret,
        expiresIn: authConfig.jwtExpiresIn || '7d',
      });
      
      const authRouter = createAuthRouter({
        config: authConfig,
        userRepository,
      });
      app.use('/auth', authRouter);
      console.log('[Auth] GitHub OAuth enabled');
      
      // Set up workspace routes
      const workspaceRepository = new WorkspaceRepository(db);
      const workspaceRouter = createWorkspaceRouter({
        workspaceRepository,
        authConfig: {
          jwtService,
          userRepository,
        },
      });
      app.use('/api/workspaces', workspaceRouter);
      console.log('[Workspaces] API enabled');
    }
  }

  server.listen(Number(PORT), HOST, () => {
    console.log(`[Server] Running on http://${HOST}:${PORT}`);
    console.log(`[Server] WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
    
    // Show network addresses for easy access
    const addresses = getNetworkAddresses();
    if (addresses.length > 0) {
      console.log('[Server] Network URLs:');
      for (const addr of addresses) {
        console.log(`         http://${addr}:${PORT}`);
      }
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Server] Shutting down...');
    await aiSessionManager.shutdown();
    await store.disconnect();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
