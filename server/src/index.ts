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
import { attachKeepalive } from './keepalive.js';
import { createStoreFromEnv, type MessageStore, SQLiteStore } from './storage/index.js';
import { AgentEventRepository } from './storage/agent-event-repository.js';
import { getWorkspaceApiKey, OpenHandsClient, resolveSessionSystemPrompt } from './openhands.js';
import {
  agentDriver,
  onAgentRawEvent,
  onAgentThinkingChange,
  onAgentAction,
  setAgentSystemPromptResolver,
  shutdownAgentDriver,
} from './agent-driver/index.js';
import {
  AgentEventRehydrator,
  createAgentEventRouter,
} from './agent-events/index.js';
import { createAuthRouter, UserRepository, JWTService, DeviceAuthManager, createDeviceAuthRouter, type AuthConfig } from './auth/index.js';
import { createWorkspaceRouter, WorkspaceRepository, JoinRequestRepository, decryptApiKey } from './workspaces/index.js';
import { DeviceRepository, createDeviceRouter } from './devices/index.js';
import {
  SessionRepository,
  createSessionRouter,
  createSessionAIRouter,
  createSessionSettingsRouter,
  createSessionSettingsService,
  type SessionSettingsService,
} from './sessions/index.js';
import { SpeakerRepository, createSpeakerRouter } from './speakers/index.js';
import { QrTokenRepository } from './qr-tokens/index.js';
import { authenticateDisplayRequest } from './display-api/index.js';
import { autoConnectAI, shouldAutoConnect } from './auto-connect.js';
import { rehydrateAgentSessions } from './agent-rehydrate.js';
import { reportDroppedText } from './dropped-text-handler.js';
import { relayAgentResponse } from './agent-message-relay.js';
import { resyncAgentSessionStatus } from './resync-agent-status.js';
import { replayDisplayContent } from './replay-display-content.js';
import { broadcastSessionState } from './session-state-broadcast.js';
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
import { isIsoZuluTimestamp, isValidIanaTimezone } from './utils/timezone.js';

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
 * Resolution order (issue #393 extended this):
 *   1. Explicit `clientSessionId` — honoured when it points to an active
 *      session in this workspace.
 *   2. Kiosk registering (`mode === 'kiosk'`) — anchors to its own
 *      per-kiosk session via `getOrCreateActiveSessionForKiosk(self)`,
 *      so every kiosk has a well-defined "Idle / In session" pill and
 *      its own `metadata.displayContent`.
 *   3. Mobile registering with `targetKioskDeviceId` — joins (or creates)
 *      the active session anchored to that kiosk. This is the
 *      multi-kiosk picker path.
 *   4. Otherwise — legacy workspace-wide single-active fallback.
 *      Single-kiosk and zero-kiosk workspaces keep working unchanged.
 *
 * @param sessionRepository - The session repository (must be defined in authenticated mode)
 * @param clientSessionId - Optional session ID provided by the client
 * @param workspaceId - The workspace the device is joining
 * @param deviceId - The id of the registering device (mode-2 anchor when kiosk)
 * @param mode - The registering device's mode (kiosk vs mobile)
 * @param targetKioskDeviceId - Mobile-only: kiosk the mobile is targeting
 * @returns The resolved session (existing or newly created active session)
 */
export function resolveSessionForDevice(
  sessionRepository: SessionRepository,
  clientSessionId: string | undefined,
  workspaceId: string,
  deviceId: string,
  mode: 'mobile' | 'kiosk',
  targetKioskDeviceId?: string
): { id: string; name: string | null } {
  // 1. If client provided a sessionId, try to use it
  if (clientSessionId) {
    const requestedSession = sessionRepository.findById(clientSessionId);
    if (requestedSession && requestedSession.workspaceId === workspaceId && requestedSession.status === 'active') {
      return { id: requestedSession.id, name: requestedSession.name };
    }
    console.warn(`[WS] Invalid session ${clientSessionId} requested, falling back`);
  }

  // 2. Kiosks anchor to their own per-kiosk session (#393).
  if (mode === 'kiosk') {
    const kioskSession = sessionRepository.getOrCreateActiveSessionForKiosk(workspaceId, deviceId);
    return { id: kioskSession.id, name: kioskSession.name };
  }

  // 3. Mobile with a kiosk target — join the kiosk's session.
  if (targetKioskDeviceId) {
    const kioskSession = sessionRepository.getOrCreateActiveSessionForKiosk(workspaceId, targetKioskDeviceId);
    return { id: kioskSession.id, name: kioskSession.name };
  }

  // 4. Legacy fallback: workspace-wide single active session.
  const activeSession = sessionRepository.getOrCreateActiveSession(workspaceId);
  return { id: activeSession.id, name: activeSession.name };
}

/**
 * Duration (ms) the chosen kiosk shows the
 * `📱 <mobile> connecting…` banner from a `kiosk-attention` message
 * (issue #393). Long enough to confirm the right physical screen by
 * eye, short enough to disappear by the time the user actually starts
 * talking.
 */
export const KIOSK_ATTENTION_TTL_MS = 3000;

/**
 * Minimal registry surface needed to look up the targeted kiosk and
 * deliver the attention banner. Defined as a structural interface so
 * the helper can be unit-tested with a lightweight fake.
 */
export interface KioskAttentionRegistry {
  getDevice(id: string): { mode: 'mobile' | 'kiosk' } | undefined;
  sendToDevice(deviceId: string, message: object): boolean;
}

/**
 * Send a `kiosk-attention` nudge to the target kiosk, but only when the
 * sender is a mobile and the target device is actually a registered
 * kiosk in the workspace. Returns true when a message was sent.
 *
 * Defensive guard (PR #396 review feedback): a mobile client could in
 * principle send another mobile's deviceId in `targetKioskDeviceId`.
 * Without this check, the attention message would be relayed to that
 * mobile, which silently ignores `kiosk-attention` — harmless but
 * confusing during debugging. Validating `device.mode === 'kiosk'`
 * here makes the contract explicit at the call site.
 */
export function sendKioskAttentionIfValid(
  registry: KioskAttentionRegistry,
  params: {
    senderMode: 'mobile' | 'kiosk';
    senderDeviceId: string;
    senderDisplayName: string;
    targetKioskDeviceId: string | undefined;
  }
): boolean {
  const { senderMode, senderDeviceId, senderDisplayName, targetKioskDeviceId } = params;
  if (senderMode !== 'mobile') return false;
  if (!targetKioskDeviceId) return false;
  if (targetKioskDeviceId === senderDeviceId) return false;

  const targetDevice = registry.getDevice(targetKioskDeviceId);
  if (!targetDevice || targetDevice.mode !== 'kiosk') {
    // Mobile sent a target that doesn't resolve to a registered kiosk
    // (offline kiosk, stale id, or — the guarded case — another mobile's
    // id). Log and drop so we never broadcast attention to a non-kiosk.
    console.warn(
      `[WS] kiosk-attention dropped: target ${targetKioskDeviceId} is not a registered kiosk ` +
        `(sender=${senderDeviceId})`
    );
    return false;
  }

  return registry.sendToDevice(targetKioskDeviceId, {
    type: 'kiosk-attention' as const,
    mobileDeviceId: senderDeviceId,
    mobileDisplayName: senderDisplayName,
    ttlMs: KIOSK_ATTENTION_TTL_MS,
  });
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
// This enables the kiosk display to show 🤔 while AI is processing.
//
// `onAgentThinkingChange` registers a listener on the production
// `AgentDriver`; the driver fan-outs from its single subscription on
// `AISessionManager.setThinkingChangeCallback`. Multiple subscribers
// coexist without clobbering each other (unlike the legacy setter
// pattern).
onAgentThinkingChange((sessionId: string, thinking: boolean) => {
  const message: AIThinkingMessage = {
    type: 'ai-thinking',
    sessionId,
    thinking,
  };
  registry.broadcastMessageToSession(sessionId, message);

  // Unified `session-state` (issue #295). Read the driver's authoritative
  // snapshot and broadcast the full status so clients on the new shape
  // get a single coherent state object instead of reconstructing it from
  // the parallel `ai-thinking` + `session-ai-status` pair. Fire-and-forget:
  // a status read failure must not abort the thinking broadcast.
  void (async () => {
    try {
      const status = await agentDriver.getSessionStatus(sessionId);
      if (status.state === 'absent') return;
      broadcastSessionState(registry, sessionId, status, 'thinking-change');
    } catch (err) {
      console.error(
        `[SessionState] thinking-change getSessionStatus failed for ${sessionId}:`,
        err,
      );
    }
  })();
});

// Wire AI action events to broadcast to session devices
// This enables the kiosk to show real-time agent activity.
onAgentAction((sessionId: string, action: AgentAction) => {
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
let sessionSettingsService: SessionSettingsService | null = null;
let qrTokenRepository: QrTokenRepository | null = null;
let agentEventRepository: AgentEventRepository | null = null;
let speakerRepository: SpeakerRepository | null = null;
let agentEventRehydrator: AgentEventRehydrator | null = null;
let agentEventTtlInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Resolve the workspace-scoped speaker for a (workspace, user) pair (#383).
 *
 * Returns the agent-driver-shaped `AgentSpeakerMeta` or `null` when the
 * device is anonymous (no `primaryUserId`) or no speaker row exists yet.
 *
 * Callers pass `primaryUserId` directly from the in-memory `Device`
 * (cached at registration time in `DeviceRegistry`), so this path runs
 * on every inbound utterance without re-querying the `devices` table.
 *
 * Best-effort & cheap: the speakers lookup is indexed by `(workspace_id,
 * user_id)`. Errors are logged and swallowed — speaker resolution must
 * never crash the message-relay path.
 */
function resolveSpeakerForUser(
  workspaceId: string,
  primaryUserId: string | null | undefined
): { id: string; preferredName: string | null; pronouns: string | null } | null {
  if (!speakerRepository || !primaryUserId) return null;
  try {
    const speaker = speakerRepository.findByWorkspaceUser(
      workspaceId,
      primaryUserId
    );
    if (!speaker) return null;
    return {
      id: speaker.id,
      preferredName: speaker.preferredName,
      pronouns: speaker.pronouns,
    };
  } catch (err) {
    console.warn('[Speakers] resolve failed (non-fatal):', err);
    return null;
  }
}

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

export function getAuthConfig(): AuthConfig | null {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const githubAppSlug = process.env.GITHUB_APP_SLUG;
  const jwtSecret = process.env.JWT_SECRET;
  const testAuthSecret = process.env.TEST_AUTH_SECRET;

  // Test mode is only valid when *no* GitHub vars are configured. Partial
  // configuration is always an error (see fail-fast branch below) so that
  // the 'test-mode-placeholder' string can never leak into a real
  // /auth/github redirect served to a user. See issue #336.
  const allGitHubVarsMissing = !githubClientId && !githubClientSecret && !githubAppSlug;
  const someGitHubVarsMissing = !githubClientId || !githubClientSecret || !githubAppSlug;
  const useTestMode = testAuthSecret && jwtSecret && allGitHubVarsMissing;

  if (!jwtSecret) {
    console.log('[Auth] Missing JWT_SECRET - auth disabled');
    return null;
  }

  if (someGitHubVarsMissing && !allGitHubVarsMissing) {
    // Partial GitHub App config = misconfigured. Fail loudly at startup so
    // the placeholder credentials below can never be served to real users.
    const missing = [
      !githubClientId && 'GITHUB_CLIENT_ID',
      !githubClientSecret && 'GITHUB_CLIENT_SECRET',
      !githubAppSlug && 'GITHUB_APP_SLUG',
    ].filter(Boolean).join(', ');
    throw new Error(
      `[Auth] Incomplete GitHub App configuration: missing ${missing}. ` +
      `Set all three vars together, or unset all three to disable GitHub auth.`,
    );
  }

  if (allGitHubVarsMissing) {
    if (useTestMode) {
      console.log('[Auth] Using test mode - no GitHub vars set; TEST_AUTH_SECRET active');
    } else {
      console.log('[Auth] No GitHub vars set and no TEST_AUTH_SECRET - auth disabled');
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
    githubAppSlug: githubAppSlug || 'test-mode-placeholder',
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

  // Persist display content so kiosks refreshing/rejoining can be caught
  // up at register time (issue #338). Gated on a real (non-anonymous)
  // session — anonymous sessions don't have stable identity to key
  // persisted display content off of.
  if (sessionRepository && sessionId && sessionId !== ANONYMOUS_SESSION_ID) {
    if (type === 'clear') {
      sessionRepository.clearDisplayContent(sessionId);
    } else {
      // `type !== 'clear'` and the earlier guard ensures `content` is set.
      sessionRepository.updateMetadata(sessionId, {
        displayContent: { type, content: content!, ...(title ? { title } : {}) },
      });
    }
  }

  const kioskCount = registry.getKioskDevices(authResult.workspaceId).length;
  res.json({ success: true, kioskCount });
});

// AI conversation management endpoints
app.get('/api/ai/status', (_req, res) => {
  const available = agentDriver.isAvailable();
  res.json({
    available,
    message: available
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

  // Keep the connection from being reaped by middleboxes during idle
  // periods, and detect frozen clients within ~50 s. See server/src/keepalive.ts
  // for the rationale. Browsers auto-respond to protocol-level pings with
  // pongs, so this requires no client-side cooperation. The helper wires
  // its own 'close' cleanup, so we don't need to track the handle here.
  attachKeepalive(ws, {
    onTerminate: () => {
      console.warn('[WS] Keepalive: terminating unresponsive connection', {
        deviceId,
        workspaceId,
      });
    },
  });

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
          // Issue #383: surface the device's claimed user (if any) into the
          // in-memory registry so per-utterance speaker resolution doesn't
          // need to re-query the `devices` table. Anonymous mode has no
          // workspace user, so this stays `null`.
          let primaryUserId: string | null = null;

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
            // Issue #383: capture the persisted primary_user_id so we can
            // seed the in-memory device cache below.
            primaryUserId = result.device.primaryUserId;

            session = resolveSessionForDevice(
              sessionRepository,
              message.sessionId,
              requestedWorkspaceId,
              message.deviceId,
              message.mode,
              message.targetKioskDeviceId,
            );
            sessionId = session.id;

            // Track device in session_devices table (device must exist for FK constraint)
            sessionRepository.addDevice(sessionId, message.deviceId);

            // Issue #393: nudge the chosen kiosk's screen so the user
            // can confirm the right physical kiosk picked up the
            // connection. Fire-and-forget — when the kiosk is offline
            // (no WS in the registry), the helper drops the send and
            // the mobile flow proceeds anyway. The helper also enforces
            // that the target is actually a registered kiosk (PR #396
            // review feedback) so we never broadcast attention to a
            // non-kiosk device.
            sendKioskAttentionIfValid(registry, {
              senderMode: message.mode,
              senderDeviceId: message.deviceId,
              senderDisplayName: message.displayName,
              targetKioskDeviceId: message.targetKioskDeviceId,
            });
          }
          
          deviceId = message.deviceId;
          workspaceId = requestedWorkspaceId;
          
          // SECURITY: Validate platform to prevent log injection attacks
          const validatedPlatform = isValidPlatform(message.platform) ? message.platform : undefined;

          // Issue #340: workspace footer-ticker setting reduces the kiosk's
          // usable display lines so the OpenHands system prompt stays honest.
          const tickersEnabled = workspaceRepository
            ?.getSettings(requestedWorkspaceId)
            ?.kioskFooterTickersEnabled ?? false;

          // Issue #375: speaker's local timezone (IANA) + offset, captured
          // by the client. Validated here so a malformed IANA string from
          // an older/buggy client doesn't poison the per-turn header.
          const validatedTimezone =
            typeof message.timezone === 'string' && isValidIanaTimezone(message.timezone)
              ? message.timezone
              : undefined;
          const validatedTzOffset =
            typeof message.tzOffsetMinutes === 'number' && Number.isFinite(message.tzOffsetMinutes)
              ? message.tzOffsetMinutes
              : undefined;

          registry.register(
            message.deviceId,
            requestedWorkspaceId,
            ws,
            message.displayName,
            message.mode,
            message.screenWidth,
            message.screenHeight,
            sessionId,
            validatedPlatform,
            tickersEnabled,
            validatedTimezone,
            validatedTzOffset,
            primaryUserId,
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

          // Replay the last persisted display content (issue #338) so a
          // refreshing kiosk doesn't fall back to the default "Session
          // ready" placeholder. No-op when there is no persisted content
          // (e.g. nothing displayed yet, or the last call was clear).
          replayDisplayContent(ws, sessionId, sessionRepository);

          // Catch a (re)joining device up on the current AI session state.
          // Live transitions are only broadcast as they happen, so without
          // this resync a device that refreshes mid-conversation would not
          // see the ✨/🤔 indicator until the next user utterance. (#290)
          await resyncAgentSessionStatus(ws, sessionId, agentDriver);

          // Auto-connect AI when first device joins session
          if (sessionRepository && shouldAutoConnect(sessionId, sessionRepository, agentDriver)) {
            // Start AI connection asynchronously (don't block registration)
            autoConnectAI(sessionId, requestedWorkspaceId, {
              registry,
              sessionRepository,
              workspaceRepository,
              agentDriver,
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

          // Issue #375: All timestamps on the wire are UTC (`Z`). If the
          // client supplied one we use it; otherwise we substitute the
          // server's receipt time. Validate the ISO Zulu format defensively
          // so a malformed client value doesn't poison the per-turn header.
          const clientTimestamp = isIsoZuluTimestamp(message.clientTimestamp)
            ? message.clientTimestamp
            : new Date().toISOString();

          // Issue #383: resolve the speaker once per inbound utterance
          // so the same id is stamped on the persisted row AND forwarded
          // to the agent driver below. `device.primaryUserId` is cached
          // on the in-memory registry entry at registration time, so this
          // path runs without a per-utterance `devices` table lookup.
          const utteranceSpeaker = resolveSpeakerForUser(
            device.workspaceId,
            device.primaryUserId
          );
          const relayMessage: RelayedTextMessage = {
            type: 'text',
            utteranceId: message.utteranceId,
            workspaceId: device.workspaceId,
            sessionId: device.sessionId,
            senderId: deviceId,
            senderName: device.displayName,
            text: message.text,
            partial: message.partial,
            clientTimestamp,
            ...(device.timezone ? { senderTimezone: device.timezone } : {}),
            ...(utteranceSpeaker ? { speakerId: utteranceSpeaker.id } : {}),
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

          // Forward final messages to session AI if connected.
          //
          // Note: `relayAgentResponse` iterates the driver's
          // `AsyncIterable<AgentEvent>` and broadcasts `message` events to
          // session devices, persists them, and drives TTS (the legacy
          // session-level `onMessage` callback path lives there now). We
          // intentionally do not await — the relay completes
          // out-of-band so subsequent inbound WS frames keep flowing.
          if (device.sessionId && !message.partial && agentDriver.hasSession(device.sessionId)) {
            // Issue #383: reuse the speaker resolved above for the
            // persisted row, so the sender meta and the message row
            // always carry the same speaker id.
            const resolvedSpeaker = utteranceSpeaker;
            relayAgentResponse(
              device.sessionId,
              device.workspaceId,
              message.utteranceId,
              message.text,
              {
                agentDriver,
                registry,
                store,
                sessionRepository,
                ttsService: ttsService ?? undefined,
                // Issue #375: forward speaker identity + UTC timestamp so
                // the OpenHands driver can compose its per-turn header.
                sender: {
                  deviceId: device.id,
                  senderName: device.displayName,
                  saidAtUtc: clientTimestamp,
                  ...(device.timezone ? { timezone: device.timezone } : {}),
                  ...(resolvedSpeaker ? { speaker: resolvedSpeaker } : {}),
                },
              }
            ).catch((err) => {
              console.error(`[AI] Failed to forward message to session AI:`, err);
            });
            console.log(`[AI] Forwarded message to session AI: ${device.sessionId}`);
          } else {
            // Observability hatch for #341: pre-fix, a final-text message
            // arriving while the driver had no live session would silently
            // drop here. Logged + (conditional, #373) degraded-broadcast
            // inside the helper. Fire-and-forget: nothing in the WS path
            // depends on the result.
            reportDroppedText({
              sessionId: device.sessionId,
              utteranceId: message.utteranceId,
              partial: message.partial,
              registry,
              agentDriver,
            }).catch((err) => {
              console.error('[AI] reportDroppedText failed:', err);
            });
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

          if (!sessionRepository || !sessionSettingsService) {
            console.warn('[WS] Session settings service not available');
            return;
          }

          const ttsMsg = message as SessionTtsSettingsMessage;

          // Funnel through the unified settings service (issue #378) so
          // REST and WS writes share validation, persistence, and
          // broadcast. The service also emits the new
          // `session-settings-changed` snapshot in addition to the
          // legacy `session-tts-settings-changed` for back-compat.
          try {
            sessionSettingsService.applyPatch(sessionId, {
              tts: { enabled: ttsMsg.enabled, outputDeviceId: ttsMsg.outputDeviceId },
            });
            console.log(`[TTS] Session settings updated for ${sessionId}: enabled=${ttsMsg.enabled}, outputDevice=${ttsMsg.outputDeviceId || 'all'}`);
          } catch (err) {
            console.warn(`[WS] session-tts-settings rejected for ${sessionId}:`, (err as Error).message);
          }
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
            
            // Forward failure to AI session if connected. The agent's
            // response is relayed via the standard `relayAgentResponse`
            // iterable consumer (broadcasts/persists/TTS the AI reply).
            if (device.sessionId && agentDriver.hasSession(device.sessionId)) {
              const errorDescription = error === 'timeout'
                ? 'timed out while loading'
                : error === 'cors'
                ? 'failed due to CORS restrictions'
                : 'failed to load';

              const feedbackMessage = `[Display Feedback] Image ${errorDescription}. Consider trying an alternative image URL or describing the content instead.`;
              const feedbackUtteranceId = `display-feedback-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

              relayAgentResponse(
                device.sessionId,
                device.workspaceId,
                feedbackUtteranceId,
                feedbackMessage,
                {
                  agentDriver,
                  registry,
                  store,
                  sessionRepository,
                  ttsService: ttsService ?? undefined,
                }
              ).catch((aiErr) => {
                console.error('[Display] Failed to forward feedback to AI:', aiErr);
              });
              console.log(`[Display] Forwarded failure feedback to session AI: ${device.sessionId}`);
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
      agentEventRepository = new AgentEventRepository(db);
      speakerRepository = new SpeakerRepository(db);
      console.log('[Repositories] Workspace, JoinRequest, Device, Session, QrToken, AgentEvent, Speaker repositories initialized');

      // Issue #393: install the per-kiosk picker enrichment hook so
      // every `broadcastDeviceList` includes `activeSessionId` and
      // `lastUsedAt` for kiosks. Mobile picker cards depend on this
      // for the status pill and "last used 2h ago" line.
      const sessionRepoForEnricher = sessionRepository;
      registry.setKioskEnricher((wsId) =>
        sessionRepoForEnricher.getKioskPickerEnrichment(wsId),
      );

      // Session settings service (issue #378). Single funnel for REST
      // and WS writes; installed once the repositories are available
      // and reused by the WS `session-tts-settings` handler.
      sessionSettingsService = createSessionSettingsService({
        sessionRepository,
        workspaceRepository,
        registry,
      });

      // Install the per-session system-prompt resolver on the
      // production AISessionManager so future agent binds layer
      // session > workspace > built-in (issue #378). Same resolver runs
      // for both the lazy-bind (`getOrCreateForSession`) and the
      // `restartSession` path because the driver calls into the
      // manager for both.
      const sessionRepoForResolver = sessionRepository;
      const workspaceRepoForResolver = workspaceRepository;
      setAgentSystemPromptResolver(({ sessionId, workspaceId, displayLines }) => {
        const sess = sessionRepoForResolver.findById(sessionId);
        const wsSettings = workspaceRepoForResolver.getSettings(workspaceId);
        const resolved = resolveSessionSystemPrompt({
          sessionMetadata: sess?.metadata ?? null,
          workspaceSettings: wsSettings ?? null,
          sessionId,
          workspaceId,
          displayLines,
        });
        return resolved.effective;
      });
      console.log('[Sessions] Settings service ready; agent prompt resolver installed');

      // Initialize TTS service for AI response speech synthesis
      ttsService = new TtsService({
        registry,
        getWorkspaceSettings: (id) => workspaceRepository!.getSettings(id),
        decryptApiKey,
      });
      console.log('[TTS] Service initialized');

      // Wire live-ingest of upstream agent events into `agent_events`.
      //
      // Subscribes through the `AgentDriver` fan-out (`onAgentRawEvent`)
      // instead of the legacy manager-level setEventCallback setter
      // pattern. The driver is the sole subscriber on the manager; this
      // hook composes (rather than replaces) so multiple listeners
      // coexist. Errors are swallowed so DB hiccups can't block device
      // broadcast.
      onAgentRawEvent((vrSessionId, conversationId, rawEvent) => {
        if (!agentEventRepository) return;
        const session = sessionRepository?.findById(vrSessionId);
        if (!session) {
          // Best effort: skip events for sessions we don't recognise. This
          // can happen during shutdown or for the anonymous session.
          return;
        }
        try {
          agentEventRepository.insert({
            conversationId,
            sessionId: vrSessionId,
            workspaceId: session.workspaceId,
            rawEvent,
          });
        } catch (err) {
          console.error('[AgentEvents] Failed to persist live event:', err);
        }
      });

      // Rehydrator for on-demand REST backfill when a session is read after
      // pruning. Uses workspace API key (encrypted in workspace_settings).
      agentEventRehydrator = new AgentEventRehydrator({
        repo: agentEventRepository,
        buildClient: (apiKey) => new OpenHandsClient(apiKey),
        getWorkspaceApiKey: async (wsId) =>
          workspaceRepository
            ? await getWorkspaceApiKey(
                wsId,
                (id) => workspaceRepository?.getSettings(id) ?? null,
                decryptApiKey
              )
            : null,
      });
      console.log('[AgentEvents] Rehydrator initialized');

      // TTL pruning loop. Defaults: 7-day retention, hourly sweep. Setting
      // AGENT_EVENTS_TTL_DAYS=0 disables pruning entirely.
      const ttlDays = Number(process.env.AGENT_EVENTS_TTL_DAYS ?? 7);
      const ttlIntervalMs = Number(process.env.AGENT_EVENTS_TTL_INTERVAL_MS ?? 60 * 60 * 1000);
      if (Number.isFinite(ttlDays) && ttlDays > 0 && Number.isFinite(ttlIntervalMs) && ttlIntervalMs > 0) {
        const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
        const runPrune = () => {
          if (!agentEventRepository) return;
          const cutoff = new Date(Date.now() - ttlMs).toISOString();
          try {
            const deleted = agentEventRepository.deleteOlderThan(cutoff);
            if (deleted > 0) {
              console.log(`[AgentEvents] TTL prune removed ${deleted} rows older than ${cutoff}`);
            }
          } catch (err) {
            console.error('[AgentEvents] TTL prune failed:', err);
          }
        };
        agentEventTtlInterval = setInterval(runPrune, ttlIntervalMs);
        // `setInterval` in Node holds the event loop open; unref so it doesn't
        // block graceful shutdown.
        agentEventTtlInterval.unref?.();
        console.log(`[AgentEvents] TTL prune enabled (${ttlDays}d retention, every ${ttlIntervalMs}ms)`);
      } else {
        console.log('[AgentEvents] TTL prune disabled (AGENT_EVENTS_TTL_DAYS=0)');
      }
    }
  }

  // Re-attach the agent driver to any session that was mid-AI when the
  // previous process died. Runs before `server.listen` so it's done before
  // any device WS connection arrives. Best-effort: a single bad session
  // does not block the rest of the pass; failures broadcast a `degraded`
  // session-state so a later device join shows the correct UI. (#341 § A)
  if (sessionRepository) {
    try {
      const outcomes = await rehydrateAgentSessions({
        sessionRepository,
        workspaceRepository,
        agentDriver,
        registry,
        getWorkspaceApiKey: async (wsId) =>
          workspaceRepository
            ? await getWorkspaceApiKey(
                wsId,
                (id) => workspaceRepository?.getSettings(id) ?? null,
                decryptApiKey,
              )
            : null,
      });
      const rehydrated = outcomes.filter((o) => o.status === 'rehydrated').length;
      const failed = outcomes.filter((o) => o.status === 'failed').length;
      const skipped = outcomes.filter((o) => o.status === 'skipped').length;
      if (outcomes.length > 0) {
        console.log(
          `[AI] Rehydration complete: ${rehydrated} rehydrated, ${failed} failed, ${skipped} skipped`,
        );
      }
    } catch (err) {
      // The pass itself is already wrapped per-session — a thrown error
      // here means a programming bug, not a transient session failure.
      // Log and continue so a broken rehydration path can't keep the
      // server from accepting connections.
      console.error('[AI] Rehydration pass crashed:', err);
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
        // Used by the test-only /auth/test-terminate-ws endpoint (issue #310)
        // to look up the live WS for a given deviceId. No-op when
        // TEST_AUTH_SECRET is unset or NODE_ENV === 'production'.
        deviceRegistry: registry,
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
        speakerRepository: speakerRepository ?? undefined,
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
        // Issue #383: pass the registry so PATCH-time primary user changes
        // also update the in-memory device cache (avoids a stale lookup on
        // the next utterance from the same device session).
        deviceRegistry: registry,
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

      // Set up workspace-scoped speaker profile routes (#383).
      if (speakerRepository) {
        const speakerRouter = createSpeakerRouter({
          speakerRepository,
          workspaceRepository,
          authConfig: {
            jwtService,
            userRepository,
          },
        });
        app.use('/api/workspaces/:workspaceId/speakers', speakerRouter);
        console.log('[Speakers] API enabled');
      }

      // Set up agent-events read API. Top-level mount: a sessionId already
      // resolves to its workspace via SessionRepository.findById, so we
      // don't need the redundant /api/workspaces/:workspaceId prefix here.
      if (agentEventRepository && agentEventRehydrator) {
        const agentEventRouter = createAgentEventRouter({
          agentEventRepository,
          rehydrator: agentEventRehydrator,
          sessionRepository,
          workspaceRepository,
          authConfig: { jwtService, userRepository },
        });
        app.use('/api/sessions', agentEventRouter);
        console.log('[AgentEvents] Read API enabled at /api/sessions/:sessionId/agent-events');
      }

      // Session AI control surface (issue #294) — currently exposes
      // POST /api/sessions/:sessionId/ai/restart so the kiosk can recover
      // from a degraded agent without a full page reload.
      const sessionAIRouter = createSessionAIRouter({
        sessionRepository,
        workspaceRepository,
        agentDriver,
        registry,
        authConfig: { jwtService, userRepository },
      });
      app.use('/api/sessions', sessionAIRouter);
      console.log('[Sessions] AI control API enabled at /api/sessions/:sessionId/ai/restart');

      // Session settings REST surface (issue #378). Mounted on the same
      // `/api/sessions` prefix so the full paths are
      // `GET|PATCH /api/sessions/:sessionId/settings`. The router shares
      // the settings service with the WS handler so REST and WS writes
      // are funneled through the same validation/persist/broadcast path.
      if (sessionSettingsService) {
        const sessionSettingsRouter = createSessionSettingsRouter({
          sessionRepository,
          workspaceRepository,
          settingsService: sessionSettingsService,
          authConfig: { jwtService, userRepository },
        });
        app.use('/api/sessions', sessionSettingsRouter);
        console.log('[Sessions] Settings REST API enabled at /api/sessions/:sessionId/settings');
      }

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
    if (agentEventTtlInterval) {
      clearInterval(agentEventTtlInterval);
      agentEventTtlInterval = null;
    }
    deviceAuthManager?.shutdown();
    await shutdownAgentDriver();
    await store.disconnect();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Skip auto-start under vitest so test files can import this module
// (e.g. to unit-test getAuthConfig) without spinning up the server.
if (!process.env.VITEST) {
  start().catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
}
