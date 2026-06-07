import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DeviceRepository } from './device-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRegistry } from '../registry.js';
import type { SessionRepository } from '../sessions/session-repository.js';
import type { SpeakerRepository } from '../speakers/speaker-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

/** Max device name length (prevents UI overflow and DB bloat) */
const MAX_DEVICE_NAME_LENGTH = 100;
/** Max preferred-name length for anonymous active-speaker claims (#433). */
const MAX_PREFERRED_NAME_LENGTH = 200;
/** Max pronouns length for anonymous active-speaker claims (#433). */
const MAX_PRONOUNS_LENGTH = 64;

export interface DeviceRouterOptions {
  deviceRepository: DeviceRepository;
  workspaceRepository: WorkspaceRepository;
  authConfig: AuthMiddlewareConfig;
  /**
   * In-memory device registry, used to keep cached fields (`primaryUserId`,
   * #383) in sync when the PATCH endpoint claims the device for a user.
   * Optional so tests that don't exercise the registry can omit it.
   */
  deviceRegistry?: DeviceRegistry;
  /**
   * Session repository — required for the #433 active-speaker endpoint,
   * which writes `session_devices.active_speaker_id`. Optional so older
   * tests that don't exercise that endpoint can omit it.
   */
  sessionRepository?: SessionRepository;
  /**
   * Speaker repository — required for the #433 active-speaker endpoint
   * (creates an anonymous workspace-scoped speaker row).
   */
  speakerRepository?: SpeakerRepository;
}

/**
 * Simple in-memory rate limiter for public endpoints.
 * Limits requests per IP to prevent token enumeration attacks.
 */
class RateLimiter {
  private attempts: Map<string, { count: number; resetAt: number }> = new Map();
  
  constructor(
    private readonly maxAttempts: number = 10,
    private readonly windowMs: number = 60_000 // 1 minute
  ) {}

  /**
   * Check if request should be rate limited.
   * Returns true if limit exceeded.
   */
  isLimited(ip: string): boolean {
    const now = Date.now();
    const record = this.attempts.get(ip);

    if (!record || record.resetAt <= now) {
      this.attempts.set(ip, { count: 1, resetAt: now + this.windowMs });
      return false;
    }

    record.count++;
    return record.count > this.maxAttempts;
  }

  /**
   * Get remaining attempts for an IP.
   */
  getRemainingAttempts(ip: string): number {
    const record = this.attempts.get(ip);
    if (!record || record.resetAt <= Date.now()) {
      return this.maxAttempts;
    }
    return Math.max(0, this.maxAttempts - record.count);
  }

  /**
   * Clean up expired entries periodically.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [ip, record] of this.attempts) {
      if (record.resetAt <= now) {
        this.attempts.delete(ip);
      }
    }
  }
}

// Rate limiter for the validate endpoint (10 attempts per minute per IP)
const validateRateLimiter = new RateLimiter(10, 60_000);

// Cleanup rate limiter every 5 minutes
setInterval(() => validateRateLimiter.cleanup(), 5 * 60_000);

/**
 * Rate limiting middleware for the validate endpoint.
 */
function rateLimitValidate(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  if (validateRateLimiter.isLimited(ip)) {
    res.status(429).json({ 
      error: 'Too many validation attempts. Please try again later.',
      retryAfter: 60
    });
    return;
  }
  
  next();
}

/**
 * Create the device API router.
 * Provides endpoints for device token management.
 */
export function createDeviceRouter({
  deviceRepository,
  workspaceRepository,
  authConfig,
  deviceRegistry,
  sessionRepository,
  speakerRepository,
}: DeviceRouterOptions): Router {
  const router = Router();
  const auth = requireAuth(authConfig);
  // #433: rate-limit the device-token active-speaker endpoint to
  // discourage device-id probing. A fresh per-router limiter (vs.
  // sharing the global `validateRateLimiter`) means tests and
  // independent router instances don't burn each other's budgets,
  // and avoids accidental coupling of unrelated routes.
  const activeSpeakerRateLimiter = new RateLimiter(10, 60_000);
  const rateLimitActiveSpeaker = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const ip = req.ip || 'unknown';
    if (activeSpeakerRateLimiter.isLimited(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    next();
  };

  // Validate device token (public endpoint for reconnection)
  // Rate limited to prevent token enumeration attacks
  router.post('/validate', rateLimitValidate, (req: Request, res: Response) => {
    const { deviceToken } = req.body;
    if (!deviceToken) {
      res.status(400).json({ error: 'deviceToken required' });
      return;
    }

    const device = deviceRepository.validateToken(deviceToken);
    if (!device) {
      res.status(401).json({ error: 'Invalid device token' });
      return;
    }

    // Update last seen
    deviceRepository.updateLastSeen(device.id);

    // Check if token is expiring soon
    const tokenExpiringSoon = deviceRepository.isTokenExpiringSoon(device);

    res.json({
      valid: true,
      device: {
        id: device.id,
        workspaceId: device.workspaceId,
        name: device.name,
        mode: device.mode,
      },
      tokenExpiringSoon,
      expiresAt: device.tokenExpiresAt,
    });
  });

  // Get device by ID (requires auth)
  router.get('/:deviceId', auth, (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const device = deviceRepository.findById(deviceId);

    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    res.json({
      id: device.id,
      workspaceId: device.workspaceId,
      name: device.name,
      mode: device.mode,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
    });
  });

  // Update device (requires auth) - for renaming, changing mode
  router.patch('/:deviceId', auth, (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const { name, mode } = req.body;
    
    const device = deviceRepository.findById(deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // Security: Check user has access to the workspace that owns this device
    if (!workspaceRepository.canAccess(device.workspaceId, req.user!.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Validate name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Device name is required' });
        return;
      }
      if (name.length > MAX_DEVICE_NAME_LENGTH) {
        res.status(400).json({ error: `Device name too long (max ${MAX_DEVICE_NAME_LENGTH} chars)` });
        return;
      }
    }

    const updated = deviceRepository.update(deviceId, { name: name?.trim(), mode });
    if (!updated) {
      res.status(500).json({ error: 'Failed to update device' });
      return;
    }

    // Speaker identity (#383): claim the device for the authenticated
    // user. The PATCH endpoint requires the caller to be a workspace
    // member (checked above), so this binding is safe — and it lets a
    // human "log in to" a shared kiosk simply by configuring it. Skip
    // when the device already belongs to this user.
    if (updated.primaryUserId !== req.user!.id) {
      try {
        deviceRepository.setPrimaryUser(updated.id, req.user!.id);
        // Keep the in-memory registry cache in sync so the next utterance
        // resolves to the correct speaker without a DB lookup. No-op when
        // the device isn't currently connected.
        deviceRegistry?.updateDevice(updated.id, { primaryUserId: req.user!.id });
      } catch (err) {
        console.warn(
          '[Devices] Failed to set primary_user_id (non-fatal):',
          err
        );
      }
    }

    res.json({
      id: updated.id,
      workspaceId: updated.workspaceId,
      name: updated.name,
      mode: updated.mode,
      lastSeenAt: updated.lastSeenAt,
      createdAt: updated.createdAt,
    });
  });

  // Regenerate device token (requires auth)
  router.post('/:deviceId/token', auth, (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const result = deviceRepository.regenerateToken(deviceId);

    if (!result) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    res.json({
      deviceId: result.device.id,
      deviceToken: result.token,
      expiresAt: result.expiresAt,
    });
  });

  // Renew token expiration (requires auth, extends current token's life)
  router.post('/:deviceId/token/renew', auth, (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const device = deviceRepository.renewTokenExpiry(deviceId);

    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    res.json({
      deviceId: device.id,
      expiresAt: device.tokenExpiresAt,
      message: 'Token expiration renewed',
    });
  });

  // Revoke device token (requires auth)
  router.delete('/:deviceId/token', auth, (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const device = deviceRepository.findById(deviceId);

    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    deviceRepository.revokeToken(deviceId);
    res.json({ success: true, message: 'Device token revoked' });
  });

  // Delete device (requires auth)
  router.delete('/:deviceId', auth, (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const device = deviceRepository.findById(deviceId);

    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    deviceRepository.delete(deviceId);
    res.json({ success: true, message: 'Device deleted' });
  });

  /**
   * #433: Set a per-session anonymous active speaker via device-token
   * auth.
   *
   * The first-run "claim this device" card's "Just remember a name"
   * path posts here when the human at the kiosk isn't a workspace
   * member and OAuth would be too heavy. The route:
   *
   *   1. Authenticates with the device token (NOT the user cookie) so
   *      anyone holding the kiosk can claim a name for the session.
   *   2. Validates `:sessionId` belongs to the device's workspace.
   *   3. Creates an anonymous `speakers` row (`user_id = NULL`) with the
   *      supplied preferred name + optional pronouns.
   *   4. Writes `session_devices.active_speaker_id` for the (sessionId,
   *      deviceId) row. The next utterance will pick this up via
   *      `resolveSpeakerForUtterance` in index.ts and emit a
   *      `[speaker id=<new> name=<…>]` line on the agent turn.
   *
   * Rate-limited via the existing per-IP budget shared with /validate
   * to discourage device-id probing.
   */
  router.post(
    '/:deviceId/sessions/:sessionId/active-speaker',
    rateLimitActiveSpeaker,
    (req: Request, res: Response) => {
      if (!sessionRepository || !speakerRepository) {
        res.status(503).json({ error: 'Speaker repository not available' });
        return;
      }

      const { deviceId, sessionId } = req.params;
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Device token required' });
        return;
      }
      const deviceToken = authHeader.slice('Bearer '.length).trim();
      if (!deviceToken) {
        res.status(401).json({ error: 'Device token required' });
        return;
      }

      const tokenDevice = deviceRepository.validateToken(deviceToken);
      if (!tokenDevice || tokenDevice.id !== deviceId) {
        // Always respond 401 for either case so an attacker can't
        // distinguish "wrong token" from "right token, wrong device".
        res.status(401).json({ error: 'Invalid device token' });
        return;
      }

      const session = sessionRepository.findById(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      if (session.workspaceId !== tokenDevice.workspaceId) {
        // Cross-workspace claim attempt — refuse without leaking which
        // workspace the session belongs to.
        res.status(403).json({ error: 'Session not in device workspace' });
        return;
      }

      // Validate body. `preferredName` is required; `pronouns` optional.
      const body = (req.body ?? {}) as {
        preferredName?: unknown;
        pronouns?: unknown;
      };

      if (typeof body.preferredName !== 'string') {
        res.status(400).json({ error: 'preferredName (string) required' });
        return;
      }
      const preferredName = body.preferredName.trim();
      if (preferredName.length === 0) {
        res.status(400).json({ error: 'preferredName must not be blank' });
        return;
      }
      if (preferredName.length > MAX_PREFERRED_NAME_LENGTH) {
        res
          .status(400)
          .json({ error: `preferredName too long (max ${MAX_PREFERRED_NAME_LENGTH} chars)` });
        return;
      }

      let pronouns: string | null = null;
      if (body.pronouns !== undefined && body.pronouns !== null) {
        if (typeof body.pronouns !== 'string') {
          res.status(400).json({ error: 'pronouns must be a string when set' });
          return;
        }
        const trimmed = body.pronouns.trim();
        if (trimmed.length > MAX_PRONOUNS_LENGTH) {
          res
            .status(400)
            .json({ error: `pronouns too long (max ${MAX_PRONOUNS_LENGTH} chars)` });
          return;
        }
        pronouns = trimmed.length === 0 ? null : trimmed;
      }

      // Create the anonymous speaker row, then write the per-session
      // override. We ensure a session_devices row exists first so the
      // UPDATE in `setActiveSpeaker` actually matches (UPSERT semantics
      // via addDevice's `INSERT OR REPLACE` are safe — it preserves
      // the row on conflict and refreshes `joined_at`).
      let speakerId: string;
      try {
        const created = speakerRepository.create({
          workspaceId: tokenDevice.workspaceId,
          userId: null,
          preferredName,
          pronouns,
          notes: null,
        });
        speakerId = created.id;
      } catch (err) {
        console.error('[Devices] Active speaker create failed:', err);
        res.status(500).json({ error: 'Failed to create speaker' });
        return;
      }

      try {
        sessionRepository.addDevice(sessionId, deviceId);
        sessionRepository.setActiveSpeaker(sessionId, deviceId, speakerId);
      } catch (err) {
        console.error('[Devices] Active speaker assignment failed:', err);
        res.status(500).json({ error: 'Failed to set active speaker' });
        return;
      }

      res.status(201).json({ speakerId });
    },
  );

  return router;
}
