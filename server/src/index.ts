import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import { DeviceRegistry } from './registry.js';
import { createStoreFromEnv, type MessageStore, SQLiteStore } from './storage/index.js';
import { aiSessionManager } from './openhands.js';
import { createAuthRouter, UserRepository, JWTService, type AuthConfig } from './auth/index.js';
import { createWorkspaceRouter, WorkspaceRepository, decryptApiKey } from './workspaces/index.js';
import { DeviceRepository, createDeviceRouter } from './devices/index.js';
import { SessionRepository, createSessionRouter } from './sessions/index.js';
import { QrTokenRepository } from './qr-tokens/index.js';
import type { ClientMessage, RegisteredMessage, RelayedTextMessage, HistoryMessage, DisplayContent, DisplayRequest } from './types.js';

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

// Repositories for database access (set up later if SQLite is used)
let workspaceRepository: WorkspaceRepository | null = null;
let deviceRepository: DeviceRepository | null = null;
let sessionRepository: SessionRepository | null = null;
let qrTokenRepository: QrTokenRepository | null = null;

// Auth configuration from environment variables

// Parse duration string (e.g., '7d', '1h', '30m') to milliseconds
// Returns null for invalid formats
function parseDurationToMs(duration: string): number | null {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return null;
  }
}

// Client-side token refresh interval (30 minutes)
const CLIENT_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

function getAuthConfig(): AuthConfig | null {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const jwtSecret = process.env.JWT_SECRET;

  if (!githubClientId || !githubClientSecret || !jwtSecret) {
    console.log('[Auth] Missing GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, or JWT_SECRET - auth disabled');
    return null;
  }

  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

  // Validate JWT_EXPIRES_IN is >= client refresh interval (30 min)
  const expiryMs = parseDurationToMs(jwtExpiresIn);
  if (expiryMs !== null && expiryMs < CLIENT_REFRESH_INTERVAL_MS) {
    console.warn(
      `[Auth] WARNING: JWT_EXPIRES_IN (${jwtExpiresIn}) is shorter than client refresh interval (30m). ` +
      `Users may be logged out unexpectedly before their session can refresh. ` +
      `Recommended: Set JWT_EXPIRES_IN to at least 30m.`
    );
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

  return {
    githubClientId,
    githubClientSecret,
    jwtSecret,
    jwtExpiresIn,
    callbackUrl: `${baseUrl}/auth/github/callback`,
  };
}

// Parse cookies for httpOnly auth tokens
app.use(cookieParser());

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
  const { type, content, title, workspaceId } = req.body as DisplayRequest;
  
  if (!type || !['markdown', 'image', 'clear'].includes(type)) {
    res.status(400).json({ error: 'Invalid display type. Must be markdown, image, or clear.' });
    return;
  }
  
  if (type !== 'clear' && !content) {
    res.status(400).json({ error: 'Content required for markdown and image types.' });
    return;
  }

  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required.' });
    return;
  }

  // NOTE: Workspace validation deferred to Phase 4 with user authentication
  // See: https://github.com/jpshackelford/voice-relay/issues/6
  
  const displayContent: DisplayContent = { type, content, title };
  registry.broadcastToKiosks(displayContent, workspaceId);
  
  const kioskCount = registry.getKioskDevices(workspaceId).length;
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
  
  try {
    const device = registry.getDevice(deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // Device's workspaceId is the one it registered with.
    const deviceWorkspaceId = device.workspaceId;

    // Try to get workspace-specific API key
    let workspaceApiKey: string | null = null;
    if (workspaceRepository) {
      const settings = workspaceRepository.getSettings(deviceWorkspaceId);
      if (settings?.openhandsApiKeyEncrypted && settings?.openhandsApiKeyIv && settings?.openhandsApiKeyTag) {
        try {
          workspaceApiKey = decryptApiKey({
            encrypted: settings.openhandsApiKeyEncrypted,
            iv: settings.openhandsApiKeyIv,
            tag: settings.openhandsApiKeyTag,
          });
          console.log(`[AI] Using workspace-specific API key for workspace ${deviceWorkspaceId}`);
        } catch (decryptErr) {
          console.error('[AI] Failed to decrypt workspace API key, falling back to env var:', decryptErr);
        }
      }
    }

    // Check if we have any API key available (workspace or env)
    if (!workspaceApiKey && !aiSessionManager.isAvailable()) {
      res.status(503).json({ error: 'OpenHands API not configured' });
      return;
    }

    // Callback to send AI responses as chat messages
    const onMessage = (text: string) => {
      const aiMessage: RelayedTextMessage = {
        type: 'text',
        utteranceId: `ai-${Date.now()}`,
        workspaceId: deviceWorkspaceId,
        senderId: 'openhands-ai',
        senderName: '✨ AI',
        text,
        partial: false,
      };
      
      // Store and broadcast the AI response (scoped to workspace)
      store.append(aiMessage).catch(err => console.error('Failed to store AI message:', err));
      registry.broadcastToOutputs(aiMessage, deviceWorkspaceId);
    };

    // Get the minimum display lines across kiosk devices in the workspace
    const displayLines = registry.getMinKioskDisplayLines(deviceWorkspaceId);
    
    const session = await aiSessionManager.startSession(
      deviceId, 
      mode || 'chat', 
      onMessage,
      displayLines,
      workspaceApiKey || undefined  // Pass workspace key or let it fall back to env
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

// NOTE: 404 fallback handlers are registered at the end of start() 
// AFTER all dynamic routes (auth, workspaces, etc.) are mounted.
// This ensures the fallbacks don't shadow conditionally-loaded routes.

// WebSocket connection handling
wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] New connection');
  let deviceId: string | null = null;
  let workspaceId: string | null = null;
  let sessionId: string | null = null;

  ws.on('message', async (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'register': {
          // Use provided workspaceId or default to 'default' for backward compatibility
          const requestedWorkspaceId = message.workspaceId || 'default';
          
          // NOTE: Workspace validation deferred to Phase 4 when proper user authentication
          // is implemented. At that point, we'll validate:
          // 1. The workspace exists in the database
          // 2. The authenticated user has access to the workspace
          // See: https://github.com/jpshackelford/voice-relay/issues/6

          deviceId = message.deviceId;
          workspaceId = requestedWorkspaceId;

          // Persist device to database FIRST (required for session FK constraint)
          // This auto-registers devices with generated names when joining via QR code
          let deviceToken: string | null = null;
          let tokenExpiresAt: string | null = null;
          if (deviceRepository) {
            const result = deviceRepository.registerOrUpdate(
              message.deviceId,
              requestedWorkspaceId,
              message.displayName,
              message.mode
            );
            // Only send token if this is a new device registration
            if (result.isNew && result.token) {
              deviceToken = result.token;
              tokenExpiresAt = result.expiresAt;
              console.log(`[WS] New device registered: ${message.displayName} (${message.deviceId})`);
            }
          }

          // Determine session for this device
          let session: { id: string; name: string | null } | null = null;
          
          if (sessionRepository) {
            // If client provided sessionId, try to use it
            if (message.sessionId) {
              const requestedSession = sessionRepository.findById(message.sessionId);
              if (requestedSession && requestedSession.workspaceId === requestedWorkspaceId && requestedSession.status === 'active') {
                session = { id: requestedSession.id, name: requestedSession.name };
              } else {
                console.warn(`[WS] Invalid session ${message.sessionId} requested by ${deviceId}, using active session`);
              }
            }
            
            // If no valid session from client request, get or create active session
            if (!session) {
              const activeSession = sessionRepository.getOrCreateActiveSession(requestedWorkspaceId);
              session = { id: activeSession.id, name: activeSession.name };
            }
            
            // Track device in session_devices table (device must exist for FK constraint)
            sessionRepository.addDevice(session.id, deviceId);
            sessionId = session.id;
          } else {
            // Fallback for non-SQLite stores: no session tracking
            session = { id: 'default', name: 'Default Session' };
            sessionId = 'default';
          }
          
          registry.register(
            message.deviceId,
            requestedWorkspaceId,
            ws, 
            message.displayName, 
            message.mode,
            message.screenWidth,
            message.screenHeight,
            sessionId
          );
          
          const response: RegisteredMessage = {
            type: 'registered',
            deviceId: message.deviceId,
            session: session,
            deviceToken: deviceToken ?? undefined,
            tokenExpiresAt: tokenExpiresAt ?? undefined,
          };
          ws.send(JSON.stringify(response));
          
          // Broadcast updated device list to devices in the same workspace
          registry.broadcastDeviceList(workspaceId);

          // Send session-scoped message history to this device
          const history = sessionRepository && sessionId !== 'default'
            ? await store.getRecentBySession(50, sessionId)
            : await store.getRecent(50, workspaceId);
          const historyMessage: HistoryMessage = {
            type: 'history',
            messages: history,
          };
          ws.send(JSON.stringify(historyMessage));
          break;
        }

        case 'update-device': {
          if (deviceId) {
            const device = registry.getDevice(deviceId);
            if (device) {
              registry.updateDevice(deviceId, message);
              registry.broadcastDeviceList(device.workspaceId);
            }
          }
          break;
        }

        case 'text': {
          if (!deviceId || !workspaceId) {
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
            workspaceId: device.workspaceId,
            sessionId: device.sessionId,
            senderId: deviceId,
            senderName: device.displayName,
            text: message.text,
            partial: message.partial,
          };

          // Store final messages only (with session_id)
          if (!message.partial) {
            await store.append(relayMessage);
          }

          // Broadcast to devices in the same session (or workspace if no session)
          if (device.sessionId && device.sessionId !== 'default') {
            registry.broadcastToSession(relayMessage, device.sessionId);
          } else {
            registry.broadcastToOutputs(relayMessage, device.workspaceId);
          }
          break;
        }
      }
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    if (deviceId) {
      const device = registry.getDevice(deviceId);
      const deviceWorkspaceId = device?.workspaceId;
      const deviceSessionId = device?.sessionId;
      
      // Remove device from session_devices table
      if (sessionRepository && deviceSessionId && deviceSessionId !== 'default') {
        sessionRepository.removeDevice(deviceSessionId, deviceId);
      }
      
      registry.disconnect(deviceId);
      // Broadcast updated device list to remaining devices in the workspace
      if (deviceWorkspaceId) {
        registry.broadcastDeviceList(deviceWorkspaceId);
      }
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

  // Set up repositories for API routes (requires SQLite)
  if (store instanceof SQLiteStore) {
    const db = store.getDatabase();
    if (db) {
      workspaceRepository = new WorkspaceRepository(db);
      deviceRepository = new DeviceRepository(db);
      sessionRepository = new SessionRepository(db);
      qrTokenRepository = new QrTokenRepository(db);
      console.log('[Repositories] Workspace, Device, Session, QrToken repositories initialized');
    }
  }

  // Set up auth and API routes if configured and using SQLite
  const authConfig = getAuthConfig();
  if (authConfig && store instanceof SQLiteStore && workspaceRepository && deviceRepository && sessionRepository) {
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
        workspaceRepository,
        deviceRepository,
      });
      app.use('/auth', authRouter);
      console.log('[Auth] GitHub OAuth enabled');
      
      // Set up workspace routes
      const workspaceRouter = createWorkspaceRouter({
        workspaceRepository,
        deviceRepository,
        qrTokenRepository: qrTokenRepository ?? undefined,
        authConfig: {
          jwtService,
          userRepository,
        },
      });
      app.use('/api/workspaces', workspaceRouter);
      console.log('[Workspaces] API enabled');

      // Set up device routes
      const deviceRouter = createDeviceRouter({
        deviceRepository,
        workspaceRepository,
        authConfig: {
          jwtService,
          userRepository,
        },
      });
      app.use('/api/devices', deviceRouter);
      console.log('[Devices] API enabled');

      // Set up session routes (nested under workspaces)
      const sessionRouter = createSessionRouter({
        sessionRepository,
        workspaceRepository,
        qrTokenRepository: qrTokenRepository ?? undefined,
        authConfig: {
          jwtService,
          userRepository,
        },
      });
      app.use('/api/workspaces/:workspaceId/sessions', sessionRouter);
      console.log('[Sessions] API enabled');
      
      if (qrTokenRepository) {
        console.log('[QR Tokens] Signed time-limited QR tokens enabled');
      }
    }
  }

  // Register 404 fallback handlers AFTER all dynamic routes are mounted
  // API 404 fallback - must come before SPA fallback
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Auth 404 fallback (only if auth routes weren't mounted)
  app.all('/auth/*', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // SPA fallback - serves index.html for client-side routing
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });

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
