import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import { loadVersionInfo } from './version.js';
import { DeviceRegistry } from './registry.js';
import { createStoreFromEnv, type MessageStore, SQLiteStore } from './storage/index.js';
import { aiSessionManager, getWorkspaceApiKey } from './openhands.js';
import { createAuthRouter, UserRepository, JWTService, type AuthConfig } from './auth/index.js';
import { createWorkspaceRouter, WorkspaceRepository, JoinRequestRepository, decryptApiKey } from './workspaces/index.js';
import { DeviceRepository, createDeviceRouter } from './devices/index.js';
import { SessionRepository, createSessionRouter } from './sessions/index.js';
import { QrTokenRepository } from './qr-tokens/index.js';
import { authenticateDisplayRequest } from './display-api/index.js';
import type { 
  ClientMessage, 
  RegisteredMessage, 
  RelayedTextMessage, 
  HistoryMessage, 
  DisplayContent, 
  DisplayRequest,
  JoinRequestMessage,
  JoinResolvedMessage,
} from './types.js';

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

// Version info loaded at startup from version.json (generated during deployment)
const versionInfo = loadVersionInfo();
console.log(`[Server] Version: ${versionInfo.commit}`);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const registry = new DeviceRegistry();
const store: MessageStore = createStoreFromEnv();

// Repositories for database access (set up later if SQLite is used)
let workspaceRepository: WorkspaceRepository | null = null;
let joinRequestRepository: JoinRequestRepository | null = null;
let deviceRepository: DeviceRepository | null = null;
let sessionRepository: SessionRepository | null = null;
let qrTokenRepository: QrTokenRepository | null = null;

// Map requestId -> userId for tracking pending join requests
// Used to send join-resolved messages back to the requesting user's devices.
// NOTE: We track by userId (from authenticated HTTP request) instead of deviceId
// to prevent spoofing - a malicious user cannot hijack notifications by providing
// another user's deviceId. When resolving, we send to all connected devices in
// the workspace; the requesting user's device will receive the notification.
//
// Cleanup: Entries are removed when requests are approved/denied. For orphaned
// entries (e.g., server restart, expired requests), we run periodic cleanup.
const pendingJoinRequests = new Map<string, string>();

// Periodic cleanup of orphaned pending join requests (every 10 minutes)
// This handles edge cases where entries weren't cleaned up properly.
const PENDING_REQUEST_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const PENDING_REQUEST_MAX_AGE_MS = 6 * 60 * 1000; // 6 minutes (request expiry is 5 min)
const pendingRequestTimestamps = new Map<string, number>();

function cleanupOrphanedPendingRequests() {
  const now = Date.now();
  const expiredRequests: string[] = [];
  
  for (const [requestId, timestamp] of pendingRequestTimestamps) {
    if (now - timestamp > PENDING_REQUEST_MAX_AGE_MS) {
      expiredRequests.push(requestId);
    }
  }
  
  for (const requestId of expiredRequests) {
    pendingJoinRequests.delete(requestId);
    pendingRequestTimestamps.delete(requestId);
  }
  
  if (expiredRequests.length > 0) {
    console.log('[JoinRequest] Cleaned up orphaned pending requests:', expiredRequests.length);
  }
}

// Start periodic cleanup
setInterval(cleanupOrphanedPendingRequests, PENDING_REQUEST_CLEANUP_INTERVAL_MS);

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
  const testAuthSecret = process.env.TEST_AUTH_SECRET;

  // For testing: If TEST_AUTH_SECRET is set but GitHub credentials are missing,
  // use placeholder credentials. This allows the test auth endpoint to work
  // without requiring real GitHub OAuth setup.
  const useTestMode = testAuthSecret && jwtSecret && (!githubClientId || !githubClientSecret);

  // Note: useTestMode requires jwtSecret to be truthy, so this check is sufficient
  if (!jwtSecret) {
    console.log('[Auth] Missing JWT_SECRET - auth disabled');
    return null;
  }

  if (!githubClientId || !githubClientSecret) {
    if (useTestMode) {
      console.log('[Auth] Using test mode - TEST_AUTH_SECRET is set, GitHub OAuth disabled');
    } else {
      console.log('[Auth] Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET - auth disabled');
      return null;
    }
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

  // SECURITY: jwtSecret must be set at this point - the early return at lines 133-136
  // handles the missing case. Never use a fallback value for JWT secrets.
  if (!jwtSecret) {
    // This should be unreachable, but guard against future refactoring
    throw new Error('[Auth] JWT_SECRET is required but not set');
  }

  return {
    // In test mode (TEST_AUTH_SECRET set, GitHub credentials missing), use
    // placeholder values for GitHub OAuth. The GitHub OAuth routes will fail
    // but that's expected - we only need the test-session endpoint.
    // IMPORTANT: TEST_AUTH_SECRET requires JWT_SECRET to be explicitly set;
    // test mode does NOT bypass the JWT secret requirement.
    githubClientId: githubClientId || 'test-mode-placeholder',
    githubClientSecret: githubClientSecret || 'test-mode-placeholder',
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
  res.json({
    status: 'ok',
    devices: registry.getAllDevices().length,
    version: versionInfo.commit,
    deployedAt: versionInfo.deployedAt,
  });
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

app.post('/api/display', async (req, res) => {
  const { type, content, title, sessionId } = req.body as DisplayRequest;

  // Validate display type
  if (!type || !['markdown', 'image', 'clear'].includes(type)) {
    res.status(400).json({ error: 'Invalid display type. Must be markdown, image, or clear.' });
    return;
  }

  if (type !== 'clear' && !content) {
    res.status(400).json({ error: 'Content required for markdown and image types.' });
    return;
  }

  // Authenticate the request
  const authResult = await authenticateDisplayRequest(
    req.headers.authorization,
    sessionId,
    sessionRepository
  );

  if (!authResult.authenticated) {
    res.status(authResult.statusCode).json({ error: authResult.error });
    return;
  }

  // Broadcast to kiosks
  const displayContent: DisplayContent = { type, content, title };
  registry.broadcastToKiosks(displayContent, authResult.workspaceId);

  const kioskCount = registry.getKioskDevices(authResult.workspaceId).length;
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

    // Try to get workspace-specific API key using the helper
    const workspaceApiKey = workspaceRepository
      ? await getWorkspaceApiKey(
          deviceWorkspaceId,
          (id) => workspaceRepository?.getSettings(id) ?? null,
          decryptApiKey
        )
      : null;

    if (workspaceApiKey) {
      console.log(`[AI] Using workspace-specific API key for workspace ${deviceWorkspaceId}`);
    }

    // Check if we have any API key available (workspace or env)
    if (!workspaceApiKey && !aiSessionManager.isAvailable()) {
      res.status(503).json({ error: 'OpenHands API not configured' });
      return;
    }

    // Create or get session with display API secret for kiosk mode
    let vrSessionId: string | undefined;
    let displayApiSecret: string | undefined;

    if (mode === 'kiosk' && sessionRepository) {
      // Create a new session with display API secret
      const { session: vrSession, displayApiSecret: secret } = 
        sessionRepository.createWithDisplaySecret({ workspaceId: deviceWorkspaceId });
      vrSessionId = vrSession.id;
      displayApiSecret = secret;
      console.log(`[AI] Created session ${vrSessionId} with display API secret`);
    }

    // Callback to send AI responses as chat messages
    const onMessage = (text: string) => {
      const aiMessage: RelayedTextMessage = {
        type: 'text',
        utteranceId: `ai-${Date.now()}`,
        workspaceId: deviceWorkspaceId,
        sessionId: vrSessionId,
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
    
    const aiSession = await aiSessionManager.startSession(
      deviceId, 
      mode || 'chat', 
      onMessage,
      displayLines,
      workspaceApiKey || undefined,  // Pass workspace key or let it fall back to env
      deviceWorkspaceId,  // Pass workspace ID for injection into kiosk prompts
      vrSessionId,  // Pass session ID for display API calls
      displayApiSecret  // Pass display API secret for authentication
    );
    
    // Notify the device that AI is connected
    registry.sendToDevice(deviceId, {
      type: 'ai-status',
      connected: true,
      conversationId: aiSession.conversationId,
    });
    
    res.json({ 
      success: true, 
      conversationId: aiSession.conversationId,
      sessionId: vrSessionId,
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

        case 'join-response': {
          // Handle approve/deny from kiosk owner
          if (!deviceId || !workspaceId) {
            console.warn('[WS] Received join-response from unregistered device');
            return;
          }

          const device = registry.getDevice(deviceId);
          if (!device || device.mode !== 'kiosk') {
            console.warn('[WS] join-response received from non-kiosk device');
            return;
          }

          if (!joinRequestRepository || !workspaceRepository) {
            console.warn('[WS] Join request feature not available');
            return;
          }

          const { requestId, approved } = message;
          const request = joinRequestRepository.findById(requestId);
          
          if (!request) {
            console.warn('[WS] Join request not found:', requestId);
            return;
          }

          // Verify the device is in the same workspace as the request
          if (request.workspaceId !== device.workspaceId) {
            console.warn('[WS] Join request workspace mismatch');
            return;
          }

          // Get workspace to check ownership
          const workspace = workspaceRepository.findById(request.workspaceId);
          if (!workspace) {
            console.warn('[WS] Workspace not found for join request');
            return;
          }

          // SECURITY NOTE: We verify the kiosk device belongs to the workspace (line 516).
          // We cannot verify the *operator* is the owner because WebSocket connections
          // don't carry user authentication - kiosks are shared devices.
          // This is a known limitation of the current architecture. Physical access
          // to the kiosk is the security boundary. In high-security scenarios,
          // consider requiring owner re-authentication for approval actions.

          // Helper to broadcast join-resolved to all mobile devices in workspace
          const broadcastResolved = (resolvedMessage: JoinResolvedMessage) => {
            const mobileDevices = registry.getMobileDevices(workspace.id);
            const payload = JSON.stringify(resolvedMessage);
            let sentCount = 0;
            
            for (const mobileDevice of mobileDevices) {
              if (mobileDevice.ws.readyState === mobileDevice.ws.OPEN) {
                try {
                  mobileDevice.ws.send(payload);
                  sentCount++;
                } catch (err) {
                  console.error('[WS] Failed to send join-resolved:', err);
                }
              }
            }
            
            console.log('[WS] Broadcast join-resolved to mobile devices:', {
              requestId: request.id,
              approved: resolvedMessage.approved,
              sentCount,
            });
          };

          if (approved) {
            const updated = joinRequestRepository.approve(request.id, workspace.ownerId);
            if (updated) {
              // Add user as member
              workspaceRepository.addMember(workspace.id, request.userId);

              // Broadcast resolved message to all mobile devices in workspace
              broadcastResolved({
                type: 'join-resolved',
                requestId: request.id,
                approved: true,
                workspace: {
                  id: workspace.id,
                  name: workspace.name,
                  slug: workspace.slug,
                },
              });
            }
          } else {
            const updated = joinRequestRepository.deny(request.id, workspace.ownerId);
            if (updated) {
              // Broadcast resolved message to all mobile devices in workspace
              broadcastResolved({
                type: 'join-resolved',
                requestId: request.id,
                approved: false,
                error: 'Request denied by workspace owner',
              });
            }
          }

          // Remove from pending tracking
          pendingJoinRequests.delete(requestId);
          pendingRequestTimestamps.delete(requestId);
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
      joinRequestRepository = new JoinRequestRepository(db);
      deviceRepository = new DeviceRepository(db);
      sessionRepository = new SessionRepository(db);
      qrTokenRepository = new QrTokenRepository(db);
      console.log('[Repositories] Workspace, JoinRequest, Device, Session, QrToken repositories initialized');
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
      
      // Set up workspace routes with WebSocket callbacks for join request flow
      const workspaceRouter = createWorkspaceRouter({
        workspaceRepository,
        joinRequestRepository: joinRequestRepository ?? undefined,
        deviceRepository,
        qrTokenRepository: qrTokenRepository ?? undefined,
        authConfig: {
          jwtService,
          userRepository,
        },
        // Callback to broadcast join request to owner's kiosk devices
        onJoinRequest: (workspaceId, request) => {
          // Track the pending request for later resolution (requestId -> userId)
          // We track by userId (from authenticated request) not deviceId to prevent spoofing
          pendingJoinRequests.set(request.id, request.user.id);
          pendingRequestTimestamps.set(request.id, Date.now());

          // Find all kiosk devices for this workspace and send join-request message
          const kioskDevices = registry.getKioskDevices(workspaceId);
          const message: JoinRequestMessage = {
            type: 'join-request',
            request,
          };
          const payload = JSON.stringify(message);

          let sentCount = 0;
          for (const device of kioskDevices) {
            if (device.ws.readyState === device.ws.OPEN) {
              try {
                device.ws.send(payload);
                sentCount++;
              } catch (err) {
                console.error('[WS] Failed to send join-request to kiosk:', err);
              }
            }
          }

          // Warn if no kiosk devices received the request
          if (sentCount === 0) {
            console.warn('[JoinRequest] No kiosk devices available to receive request:', {
              workspaceId,
              requestId: request.id,
              userId: request.user.id,
              kioskCount: kioskDevices.length,
            });
          } else {
            console.log('[JoinRequest] Broadcast to kiosks:', {
              workspaceId,
              requestId: request.id,
              userId: request.user.id,
              kioskCount: kioskDevices.length,
              sentCount,
            });
          }
        },
        // Callback to send join-resolved to all mobile devices in workspace
        // (the requesting user's device is among them)
        onJoinResolved: (requestId, approved, workspace, error) => {
          // Get the tracked userId and remove from pending
          const userId = pendingJoinRequests.get(requestId);
          pendingJoinRequests.delete(requestId);
          pendingRequestTimestamps.delete(requestId);

          if (!userId) {
            console.log('[JoinRequest] No tracked user for request:', requestId);
            return;
          }

          // Send to all mobile devices in the workspace
          // Since we don't track user<->device association, we broadcast to all
          // mobile devices. The requesting user's device will receive it.
          const workspaceId = workspace?.id;
          if (!workspaceId) {
            console.log('[JoinRequest] No workspace for resolved request:', requestId);
            return;
          }

          const mobileDevices = registry.getMobileDevices(workspaceId);
          const message: JoinResolvedMessage = {
            type: 'join-resolved',
            requestId,
            approved,
            workspace,
            error,
          };
          const payload = JSON.stringify(message);
          let sentCount = 0;

          for (const device of mobileDevices) {
            if (device.ws.readyState === device.ws.OPEN) {
              try {
                device.ws.send(payload);
                sentCount++;
              } catch (err) {
                console.error('[WS] Failed to send join-resolved:', err);
              }
            }
          }

          console.log('[JoinRequest] Broadcast join-resolved to mobile devices:', {
            requestId,
            userId,
            approved,
            sentCount,
          });
        },
      });
      app.use('/api/workspaces', workspaceRouter);
      console.log('[Workspaces] API enabled (with join request flow)');

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
