import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import { readFileSync, existsSync } from 'fs';
import { loadVersionInfo } from './version.js';
import { DeviceRegistry } from './registry.js';
import { createStoreFromEnv, type MessageStore, SQLiteStore } from './storage/index.js';
import { aiSessionManager, getWorkspaceApiKey } from './openhands.js';
import { createAuthRouter, UserRepository, JWTService, DeviceAuthManager, createDeviceAuthRouter, type AuthConfig } from './auth/index.js';
import { createWorkspaceRouter, WorkspaceRepository, JoinRequestRepository, decryptApiKey } from './workspaces/index.js';
import { DeviceRepository, createDeviceRouter } from './devices/index.js';
import { SessionRepository, createSessionRouter } from './sessions/index.js';
import { QrTokenRepository } from './qr-tokens/index.js';
import { authenticateDisplayRequest } from './display-api/index.js';
import { autoConnectAI, shouldAutoConnect } from './auto-connect.js';
import { TtsService } from './tts/index.js';
import { AudioBufferManager } from './transcription/index.js';
import { 
  ANONYMOUS_WORKSPACE_ID, 
  ANONYMOUS_SESSION_ID, 
  ANONYMOUS_SESSION_NAME, 
  isAnonymousMode 
} from './constants.js';
import { 
  isValidPlatform,
  type ClientMessage, 
  type RegisteredMessage, 
  type RelayedTextMessage, 
  type HistoryMessage, 
  type DisplayContent, 
  type DisplayRequest,
  type JoinRequestMessage,
  type JoinResolvedMessage,
  type DeviceRemovedMessage,
  type SessionAIStatusMessage,
  type AIThinkingMessage,
  type AgentActionMessage,
  type AgentAction,
  type DisplayResultMessage,
  type SessionTtsSettingsMessage,
  type SessionTtsSettingsChangedMessage,
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

/**
 * Resolves the session for a device during registration in authenticated mode.
 * 
 * @param sessionRepository - The session repository (must be defined in authenticated mode)
 * @param clientSessionId - Optional session ID provided by the client
 * @param workspaceId - The workspace the device is joining
 * @returns The resolved session (existing or newly created active session)
 */
function resolveSessionForDevice(
  sessionRepository: SessionRepository,
  clientSessionId: string | undefined,
  workspaceId: string
): { id: string; name: string | null } {
  // If client provided a sessionId, try to use it
  if (clientSessionId) {
    const requestedSession = sessionRepository.findById(clientSessionId);
    if (requestedSession && requestedSession.workspaceId === workspaceId && requestedSession.status === 'active') {
      return { id: requestedSession.id, name: requestedSession.name };
    }
    console.warn(`[WS] Invalid session ${clientSessionId} requested, using active session`);
  }
  
  // Fall back to active session for this workspace
  const activeSession = sessionRepository.getOrCreateActiveSession(workspaceId);
  return { id: activeSession.id, name: activeSession.name };
}

// Version info loaded at startup from version.json (generated during deployment)
const versionInfo = loadVersionInfo();
console.log(`[Server] Version: ${versionInfo.commit}`);

const app = express();

// Trust the first proxy (Apache) - required for express-rate-limit and IP detection
// See: https://expressjs.com/en/guide/behind-proxies.html
app.set('trust proxy', 1);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const registry = new DeviceRegistry();
const store: MessageStore = createStoreFromEnv();

// Wire AI thinking state to broadcast to session devices
// This enables the kiosk display to show 🤔 while AI is processing
aiSessionManager.setThinkingChangeCallback((sessionId: string, thinking: boolean) => {
  const message: AIThinkingMessage = {
    type: 'ai-thinking',
    sessionId,
    thinking,
  };
  registry.broadcastMessageToSession(sessionId, message);
});

// Wire AI action events to broadcast to session devices
// This enables the kiosk to show real-time agent activity
aiSessionManager.setActionCallback((sessionId: string, action: AgentAction) => {
  const message: AgentActionMessage = {
    type: 'agent-action',
    sessionId,
    action,
  };
  registry.broadcastMessageToSession(sessionId, message);
});

// Repositories for database access (set up later if SQLite is used)
let workspaceRepository: WorkspaceRepository | null = null;
let joinRequestRepository: JoinRequestRepository | null = null;
let deviceRepository: DeviceRepository | null = null;
let sessionRepository: SessionRepository | null = null;
let qrTokenRepository: QrTokenRepository | null = null;

// TTS service for AI response speech synthesis (set up after workspace repository)
let ttsService: TtsService | null = null;

// Audio buffer manager for server-side transcription (Phase 1 infrastructure)
// The transcription callback will be set in Phase 2 when Whisper/API is integrated
const audioBufferManager = new AudioBufferManager({
  maxDurationSeconds: 30,
  sampleRate: 16000,
});

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

// Changelog endpoint for release notes
// Serves changelog.json generated at build time
interface ChangelogEntry {
  commit: string;
  deployedAt: string;
  changes: Array<{
    type: 'feat' | 'fix';
    scope?: string;
    description: string;
  }>;
}

interface Changelog {
  generatedAt: string | null;
  entries: ChangelogEntry[];
}

const changelogPath = join(__dirname, '../changelog.json');
let cachedChangelog: Changelog | null = null;

app.get('/api/changelog', (_req, res) => {
  if (!cachedChangelog) {
    if (existsSync(changelogPath)) {
      try {
        cachedChangelog = JSON.parse(readFileSync(changelogPath, 'utf-8'));
      } catch {
        cachedChangelog = { generatedAt: null, entries: [] };
      }
    } else {
      cachedChangelog = { generatedAt: null, entries: [] };
    }
  }
  res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
  res.json(cachedChangelog);
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

// Legacy device-centric AI endpoints - deprecated in favor of session-centric auto-connect
// These endpoints now return 410 Gone to guide clients to the new architecture
app.post('/api/ai/connect', (_req, res) => {
  res.status(410).json({
    error: 'Deprecated: AI now auto-connects to sessions when the first device joins',
    see: 'https://github.com/jpshackelford/voice-relay/issues/120'
  });
});

app.post('/api/ai/message', (_req, res) => {
  res.status(410).json({
    error: 'Deprecated: Messages are now forwarded to AI via session WebSocket',
    see: 'https://github.com/jpshackelford/voice-relay/issues/119'
  });
});

app.delete('/api/ai/disconnect', (_req, res) => {
  res.status(410).json({
    error: 'Deprecated: AI sessions are managed per-session, not per-device',
    see: 'https://github.com/jpshackelford/voice-relay/issues/119'
  });
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
          // Determine workspace: use provided ID or fall back to anonymous mode
          const requestedWorkspaceId = message.workspaceId || ANONYMOUS_WORKSPACE_ID;
          const isAnonymous = isAnonymousMode(requestedWorkspaceId);
          
          // Anonymous mode: Skip all database operations (no workspace FK to reference)
          // Authenticated mode: Validate workspace, persist device, track sessions
          
          let deviceToken: string | null = null;
          let tokenExpiresAt: string | null = null;
          let session: { id: string; name: string | null };
          
          if (isAnonymous) {
            // Anonymous mode: in-memory relay only, no persistence
            session = { id: ANONYMOUS_SESSION_ID, name: ANONYMOUS_SESSION_NAME };
            sessionId = ANONYMOUS_SESSION_ID;
          } else {
            // Authenticated mode requires all repositories for FK constraints and persistence
            if (!workspaceRepository) {
              console.error(`[WS] Workspace repository not available in authenticated mode`);
              ws.send(JSON.stringify({
                type: 'error',
                code: 'SERVER_CONFIGURATION_ERROR',
                message: 'Workspace validation not available',
              }));
              ws.close();
              return;
            }
            
            if (!deviceRepository) {
              console.error(`[WS] Device repository not available in authenticated mode`);
              ws.send(JSON.stringify({
                type: 'error',
                code: 'SERVER_CONFIGURATION_ERROR',
                message: 'Device registration not available',
              }));
              ws.close();
              return;
            }
            
            if (!sessionRepository) {
              console.error(`[WS] Session repository not available in authenticated mode`);
              ws.send(JSON.stringify({
                type: 'error',
                code: 'SERVER_CONFIGURATION_ERROR',
                message: 'Session tracking not available',
              }));
              ws.close();
              return;
            }
            
            // Validate workspace exists (FK constraint)
            const workspace = workspaceRepository.findById(requestedWorkspaceId);
            if (!workspace) {
              console.warn(`[WS] Workspace not found: ${requestedWorkspaceId}, rejecting registration`);
              ws.send(JSON.stringify({
                type: 'error',
                code: 'WORKSPACE_NOT_FOUND',
                message: 'Workspace does not exist',
              }));
              ws.close();
              return;
            }
            
            // Persist device to database (required for session FK constraint)
            // This auto-registers devices with generated names when joining via QR code
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
            
            session = resolveSessionForDevice(sessionRepository, message.sessionId, requestedWorkspaceId);
            sessionId = session.id;
            
            // Track device in session_devices table (device must exist for FK constraint)
            sessionRepository.addDevice(sessionId, message.deviceId);
          }
          
          deviceId = message.deviceId;
          workspaceId = requestedWorkspaceId;
          
          // SECURITY: Validate platform to prevent log injection attacks
          const validatedPlatform = isValidPlatform(message.platform) ? message.platform : undefined;
          
          registry.register(
            message.deviceId,
            requestedWorkspaceId,
            ws, 
            message.displayName, 
            message.mode,
            message.screenWidth,
            message.screenHeight,
            sessionId,
            validatedPlatform
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
          const history = sessionRepository && sessionId !== ANONYMOUS_SESSION_ID
            ? await store.getRecentBySession(50, sessionId)
            : await store.getRecent(50, workspaceId);
          const historyMessage: HistoryMessage = {
            type: 'history',
            messages: history,
          };
          ws.send(JSON.stringify(historyMessage));

          // Send current TTS settings for this session (if any)
          if (sessionRepository && sessionId !== ANONYMOUS_SESSION_ID) {
            const sessionForTts = sessionRepository.findById(sessionId);
            const ttsSettings = sessionForTts?.metadata?.ttsSettings;
            if (ttsSettings) {
              const ttsSettingsMsg: SessionTtsSettingsChangedMessage = {
                type: 'session-tts-settings-changed',
                sessionId,
                enabled: ttsSettings.enabled,
                outputDeviceId: ttsSettings.outputDeviceId,
              };
              ws.send(JSON.stringify(ttsSettingsMsg));
            }
          }

          // Auto-connect AI when first device joins session
          if (sessionRepository && shouldAutoConnect(sessionId, sessionRepository, aiSessionManager)) {
            // Start AI connection asynchronously (don't block registration)
            autoConnectAI(sessionId, requestedWorkspaceId, {
              registry,
              sessionRepository,
              workspaceRepository,
              aiSessionManager,
              store,
              ttsService: ttsService ?? undefined,
              getWorkspaceApiKey: async (wsId) => 
                workspaceRepository
                  ? await getWorkspaceApiKey(
                      wsId,
                      (id) => workspaceRepository?.getSettings(id) ?? null,
                      decryptApiKey
                    )
                  : null,
            }).catch((err) => {
              console.warn('[AI] Auto-connect async operation failed:', err);
            });
          }
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
          if (device.sessionId && device.sessionId !== ANONYMOUS_SESSION_ID) {
            registry.broadcastToSession(relayMessage, device.sessionId);
          } else {
            registry.broadcastToOutputs(relayMessage, device.workspaceId);
          }

          // Forward final messages to session AI if connected
          if (device.sessionId && !message.partial && aiSessionManager.hasSessionAI(device.sessionId)) {
            try {
              await aiSessionManager.sendSessionMessage(device.sessionId, message.text);
              console.log(`[AI] Forwarded message to session AI: ${device.sessionId}`);
            } catch (err) {
              console.error(`[AI] Failed to forward message to session AI:`, err);
            }
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

        case 'session-tts-settings': {
          // Handle session TTS settings update from any device
          if (!deviceId || !sessionId) {
            console.warn('[WS] Received session-tts-settings from unregistered device');
            return;
          }

          const device = registry.getDevice(deviceId);
          if (!device) {
            console.warn('[WS] session-tts-settings received from unknown device');
            return;
          }

          if (!sessionRepository) {
            console.warn('[WS] Session repository not available');
            return;
          }

          const ttsMsg = message as SessionTtsSettingsMessage;
          
          // Update session metadata with new TTS settings
          const session = sessionRepository.findById(sessionId);
          if (!session) {
            console.warn(`[WS] Session not found: ${sessionId}`);
            return;
          }

          const newMetadata = {
            ...session.metadata,
            ttsSettings: {
              enabled: ttsMsg.enabled,
              outputDeviceId: ttsMsg.outputDeviceId,
            },
          };
          sessionRepository.update(sessionId, { metadata: newMetadata });

          console.log(`[TTS] Session settings updated for ${sessionId}: enabled=${ttsMsg.enabled}, outputDevice=${ttsMsg.outputDeviceId || 'all'}`);

          // Broadcast to all devices in session
          const broadcastMsg: SessionTtsSettingsChangedMessage = {
            type: 'session-tts-settings-changed',
            sessionId,
            enabled: ttsMsg.enabled,
            outputDeviceId: ttsMsg.outputDeviceId,
          };
          registry.broadcastMessageToSession(sessionId, broadcastMsg);
          break;
        }

        case 'display-result': {
          // Handle display result feedback from kiosk devices
          if (!deviceId || !workspaceId) {
            console.warn('[WS] Received display-result from unregistered device');
            return;
          }

          const device = registry.getDevice(deviceId);
          if (!device || device.mode !== 'kiosk') {
            console.warn('[WS] display-result received from non-kiosk device');
            return;
          }

          const { success, error, displayType } = message as DisplayResultMessage;
          
          // Log the display result
          if (success) {
            console.log(`[Display] ✓ ${displayType} loaded successfully`);
          } else {
            console.log(`[Display] ✗ ${displayType} failed: ${error || 'unknown error'}`);
            
            // Forward failure to AI session if connected
            if (device.sessionId && aiSessionManager.hasSessionAI(device.sessionId)) {
              const errorDescription = error === 'timeout' 
                ? 'timed out while loading'
                : error === 'cors'
                ? 'failed due to CORS restrictions'
                : 'failed to load';
              
              const feedbackMessage = `[Display Feedback] Image ${errorDescription}. Consider trying an alternative image URL or describing the content instead.`;
              
              try {
                await aiSessionManager.sendSessionMessage(device.sessionId, feedbackMessage);
                console.log(`[Display] Forwarded failure feedback to session AI: ${device.sessionId}`);
              } catch (aiErr) {
                console.error('[Display] Failed to forward feedback to AI:', aiErr);
              }
            }
          }
          break;
        }

        case 'audio-input-chunk': {
          // Handle audio chunk for server-side transcription (Phase 1)
          // Note: Base64 decoding and buffer operations are synchronous here.
          // For Phase 2, consider worker threads if multiple devices streaming
          // simultaneously becomes a performance bottleneck.
          if (!deviceId) {
            console.warn('[WS] Received audio-input-chunk from unregistered device');
            return;
          }

          const { audio, chunkIndex, sampleRate } = message;
          audioBufferManager.addChunk(deviceId, ws, audio, chunkIndex, sampleRate);
          break;
        }

        case 'audio-input-end': {
          // Handle end of audio stream for transcription (Phase 1)
          if (!deviceId) {
            console.warn('[WS] Received audio-input-end from unregistered device');
            return;
          }

          const { totalChunks } = message;
          await audioBufferManager.endStream(deviceId, totalChunks);
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
      
      // Clean up audio buffer for this device
      audioBufferManager.removeDevice(deviceId);
      
      // Remove device from session_devices table
      if (sessionRepository && deviceSessionId && deviceSessionId !== ANONYMOUS_SESSION_ID) {
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
  // Declare deviceAuthManager at function scope for access in shutdown handler
  let deviceAuthManager: DeviceAuthManager | null = null;
  
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

      // Initialize TTS service for AI response speech synthesis
      ttsService = new TtsService({
        registry,
        getWorkspaceSettings: (id) => workspaceRepository!.getSettings(id),
        decryptApiKey,
      });
      console.log('[TTS] Service initialized');
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

      // Set up Device Authorization Grant flow (RFC 8628) for tvOS/device authentication
      deviceAuthManager = new DeviceAuthManager({
        baseUrl: authConfig.callbackUrl.replace('/auth/github/callback', ''),
      });
      const deviceAuthRouter = createDeviceAuthRouter({
        deviceAuthManager,
        jwtService,
        userRepository,
        workspaceRepository,
        deviceRepository,
      });
      app.use('/auth/device', deviceAuthRouter);
      console.log('[Auth] Device Authorization Grant enabled (for tvOS/device auth)');
      
      // Set up workspace routes with WebSocket callbacks for join request flow
      const workspaceRouter = createWorkspaceRouter({
        workspaceRepository,
        joinRequestRepository: joinRequestRepository ?? undefined,
        deviceRepository,
        sessionRepository,
        qrTokenRepository: qrTokenRepository ?? undefined,
        authConfig: {
          jwtService,
          userRepository,
        },
        // Callback to handle device removal from workspace
        onDeviceRemoved: (deviceId, workspaceId) => {
          // Send removal notification to the device
          const device = registry.getDevice(deviceId);
          if (device && device.ws.readyState === device.ws.OPEN) {
            const message: DeviceRemovedMessage = {
              type: 'device-removed',
              deviceId,
              reason: 'removed-from-workspace',
            };
            try {
              device.ws.send(JSON.stringify(message));
            } catch (err) {
              console.error('[WS] Failed to send device-removed message:', err);
            }
          }

          // Disconnect the WebSocket (removes from registry)
          registry.disconnect(deviceId);

          // Broadcast updated device list to remaining devices
          registry.broadcastDeviceList(workspaceId);

          console.log('[DeviceRemoval] Device removed and notified:', {
            deviceId,
            workspaceId,
            wasConnected: !!device,
          });
        },
        // Callback to disconnect all devices when a workspace is deleted
        onWorkspaceDeleted: (workspaceId) => {
          const disconnectedCount = registry.disconnectWorkspaceDevices(
            workspaceId, 
            'This workspace has been deleted'
          );
          console.log('[WorkspaceDeletion] Disconnected devices:', {
            workspaceId,
            disconnectedCount,
          });
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
    deviceAuthManager?.shutdown();
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
