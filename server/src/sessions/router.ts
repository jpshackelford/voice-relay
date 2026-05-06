import { Router, type Request, type Response, type NextFunction } from 'express';
import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/index.js';
import type { QrTokenRepository } from '../qr-tokens/index.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

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

  // Generate a signed, time-limited QR token for this session
  // Used when workspace has requireQrToken=true for enhanced security
  // The token is included in the QR code URL and validated on auto-join
  router.post('/:sessionId/qr-token', auth, checkWorkspaceAccess, (req: Request, res: Response) => {
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
