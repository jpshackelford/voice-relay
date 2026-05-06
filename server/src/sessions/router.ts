import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/index.js';
import type { QrTokenRepository } from '../qr-tokens/index.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

// Rate limiter for QR token generation to prevent abuse/DoS.
// Normal usage: tokens expire in 5 min, auto-refresh starts 30 sec before expiry → ~6 requests/5min
// Limit of 10/min provides headroom for manual refreshes while preventing abuse.
const qrTokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10, // 10 tokens per minute per IP
  message: { error: 'Too many token generation requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // Skip in tests
});

export interface SessionRouterOptions {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  qrTokenRepository?: QrTokenRepository;
  authConfig: AuthMiddlewareConfig;
}

/**
 * Create the session API router.
 * Provides endpoints for session management within workspaces.
 */
export function createSessionRouter({ 
  sessionRepository, 
  workspaceRepository,
  qrTokenRepository,
  authConfig 
}: SessionRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const auth = requireAuth(authConfig);

  // Workspace access middleware (runs after auth)
  const checkWorkspaceAccess = (req: Request, res: Response, next: NextFunction) => {
    const { workspaceId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!workspaceRepository.canAccess(workspaceId, userId)) {
      res.status(403).json({ error: 'Access denied to workspace' });
      return;
    }

    next();
  };

  // List sessions in a workspace
  router.get('/', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { status } = req.query;

    const validStatuses = ['active', 'ended', 'archived'];
    const statusFilter = status && validStatuses.includes(status as string) 
      ? (status as 'active' | 'ended' | 'archived') 
      : undefined;

    const sessions = sessionRepository.getSessionSummaries(workspaceId, statusFilter);
    res.json({ sessions });
  });

  // Get current/active session for a workspace
  router.get('/current', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    
    // Get or create an active session
    const session = sessionRepository.getOrCreateActiveSession(workspaceId);
    const devices = sessionRepository.getDevices(session.id);

    res.json({
      session: {
        ...session,
        deviceCount: devices.length,
      },
    });
  });

  // Create a new session
  router.post('/', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { name } = req.body;

    const session = sessionRepository.create({
      workspaceId,
      name,
    });

    res.status(201).json({ session });
  });

  // Get a specific session
  router.get('/:sessionId', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessionRepository.findById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const devices = sessionRepository.getDevices(sessionId);

    res.json({
      session: {
        ...session,
        devices: devices.map(d => ({ deviceId: d.deviceId, joinedAt: d.joinedAt })),
      },
    });
  });

  // Update a session
  router.patch('/:sessionId', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { name, status, metadata } = req.body;

    const session = sessionRepository.update(sessionId, { name, status, metadata });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ session });
  });

  // End a session
  router.post('/:sessionId/end', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessionRepository.endSession(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ session, message: 'Session ended' });
  });

  // Archive a session
  router.post('/:sessionId/archive', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessionRepository.archiveSession(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ session, message: 'Session archived' });
  });

  // Add device to session
  router.post('/:sessionId/devices', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { deviceId } = req.body;

    if (!deviceId) {
      res.status(400).json({ error: 'deviceId required' });
      return;
    }

    const session = sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const membership = sessionRepository.addDevice(sessionId, deviceId);
    res.json({ membership });
  });

  // Remove device from session
  router.delete('/:sessionId/devices/:deviceId', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
    const { sessionId, deviceId } = req.params;

    const session = sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    sessionRepository.removeDevice(sessionId, deviceId);
    res.json({ success: true, message: 'Device removed from session' });
  });

  // Generate a signed, time-limited QR token for this session.
  // Used when workspace has requireQrToken=true for enhanced security.
  // The token is included in the QR code URL and validated on auto-join.
  //
  // ACCESS: Any workspace member (not just owner) can generate tokens.
  // THREAT MODEL: The primary goal is preventing *URL bookmarking/sharing* for unauthorized
  // access (e.g., someone screenshots a QR code and uses it days later). The 5-minute TTL
  // addresses this. Real-time token sharing by a malicious member is out of scope - if a
  // member actively shares tokens with non-members, they could also just add them to the
  // workspace. Owner-only restriction would limit legitimate use cases (e.g., any member
  // projecting a QR code during a meeting).
  router.post('/:sessionId/qr-token', auth, checkWorkspaceAccess, qrTokenLimiter, (req: Request, res: Response) => {
    const { workspaceId, sessionId } = req.params;

    if (!qrTokenRepository) {
      res.status(503).json({ error: 'QR token generation not available' });
      return;
    }

    const session = sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Generate a new QR token
    const token = qrTokenRepository.create({
      workspaceId,
      sessionId,
    });

    // Build the full URL with the QR token
    // Use the origin from request headers or construct from host
    const host = req.get('host') || 'localhost:3000';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const baseUrl = `${proto}://${host}`;
    // SECURITY NOTE: Token in query parameter may be logged by proxies/browsers.
    // Acceptable trade-off: 5-minute TTL limits exposure window, and primary threat
    // (URL sharing for unauthorized access) is mitigated by token expiration.
    // Future hardening options: POST body, fragment identifier (#qr=), or one-time use.
    const sessionUrl = `${baseUrl}/workspace/${workspaceId}/session/${sessionId}?qr=${token.token}`;

    res.json({
      token: token.token,
      expiresAt: token.expiresAt,
      url: sessionUrl,
      workspaceId,
      sessionId,
    });
  });

  return router;
}
