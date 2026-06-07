import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DeviceRepository } from './device-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRegistry } from '../registry.js';
import type { SessionRepository } from '../sessions/session-repository.js';
import type { SpeakerRepository } from '../speakers/speaker-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

/** Max device name length (prevents UI overflow and DB bloat) */
const MAX_DEVICE_NAME_LENGTH = 100;

/**
 * Max preferred-name / pronouns length on the active-speaker endpoint (#433).
 *
 * IMPORTANT: These must stay in sync with the client-side limits in
 * `client/src/components/ClaimSpeakerCard.tsx` (`PREFERRED_NAME_MAX_LEN`,
 * `PRONOUNS_MAX_LEN`). If you change one, change the other.
 */
const MAX_SPEAKER_NAME_LENGTH = 80;
const MAX_SPEAKER_PRONOUNS_LENGTH = 32;

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
   * Optional repositories needed by the device-token-authenticated
   * `POST /:deviceId/sessions/:sessionId/active-speaker` endpoint
   * (#433). When either is omitted, the endpoint is not mounted — keeps
   * tests that don't exercise the claim flow from needing to wire them.
   */
  sessionRepository?: SessionRepository;
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


// Issue #433: separate limiter for the active-speaker endpoint.
// Authenticated by a valid device token, but the abuse profile differs
// from `/validate` (token enumeration vs. anonymous-speaker spam), so
// we don't share a budget. 30/minute/IP gives normal kiosk flows
// plenty of headroom while still blocking runaway scripts.
const activeSpeakerRateLimiter = new RateLimiter(30, 60_000);
setInterval(() => activeSpeakerRateLimiter.cleanup(), 5 * 60_000);

function rateLimitActiveSpeaker(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (activeSpeakerRateLimiter.isLimited(ip)) {
    res.status(429).json({
      error: 'Too many active-speaker writes. Please try again later.',
      retryAfter: 60,
    });
    return;
  }
  next();
}

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

    // Issue #439: seed the speaker row for the now-authenticated user so
    // `resolveSpeakerForUser` returns a row on the very next utterance
    // (the in-memory registry already has `primaryUserId`; what was
    // missing was a `speakers` row to look up). Run on EVERY authenticated
    // PATCH — not gated by `primaryUserId !== req.user.id` — so devices
    // that already have `primary_user_id` set but no speaker row (e.g.
    // historical backfills like #432) self-heal on the next claim
    // attempt. `upsertForUser` is idempotent and explicitly preserves an
    // existing `preferred_name` (agent-learned name wins), so re-running
    // it on already-seeded rows is cheap.
    if (speakerRepository) {
      try {
        speakerRepository.upsertForUser(updated.workspaceId, req.user!.id, {
          preferredName: req.user!.displayName ?? req.user!.username,
        });
      } catch (err) {
        console.warn(
          '[Devices] Speaker upsert on device claim failed (non-fatal):',
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

  // Issue #433: device-token-authenticated active-speaker endpoint.
  // Lets unclaimed devices set a per-session speaker without requiring
  // the human to be a workspace member.
  if (sessionRepository && speakerRepository) {
    router.post(
      '/:deviceId/sessions/:sessionId/active-speaker',
      rateLimitActiveSpeaker,
      (req: Request, res: Response) => {
        const { deviceId, sessionId } = req.params;

        // 1. Validate the Authorization: Bearer <deviceToken> header.
        const authHeader = req.headers.authorization;
        const match = authHeader?.match(/^Bearer\s+(.+)$/);
        if (!match) {
          res.status(401).json({ error: 'Device token required' });
          return;
        }
        const deviceToken = match[1].trim();
        const tokenDevice = deviceRepository.validateToken(deviceToken);
        if (!tokenDevice || tokenDevice.id !== deviceId) {
          res.status(401).json({ error: 'Invalid device token' });
          return;
        }

        // 2. Validate session lives in the same workspace as the device.
        const session = sessionRepository.findById(sessionId);
        if (!session || session.workspaceId !== tokenDevice.workspaceId) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }

        // 3. Parse + validate body.
        const body = (req.body ?? {}) as {
          preferredName?: unknown;
          pronouns?: unknown;
        };
        const preferredNameRaw = body.preferredName;
        if (typeof preferredNameRaw !== 'string') {
          res.status(400).json({ error: 'preferredName required' });
          return;
        }
        const preferredName = preferredNameRaw.trim();
        if (preferredName.length === 0) {
          res.status(400).json({ error: 'preferredName cannot be empty' });
          return;
        }
        if (preferredName.length > MAX_SPEAKER_NAME_LENGTH) {
          res.status(400).json({
            error: `preferredName too long (max ${MAX_SPEAKER_NAME_LENGTH} chars)`,
          });
          return;
        }
        let pronouns: string | null = null;
        if (body.pronouns !== undefined && body.pronouns !== null) {
          if (typeof body.pronouns !== 'string') {
            res.status(400).json({ error: 'pronouns must be a string' });
            return;
          }
          const trimmedPronouns = body.pronouns.trim();
          if (trimmedPronouns.length > MAX_SPEAKER_PRONOUNS_LENGTH) {
            res.status(400).json({
              error: `pronouns too long (max ${MAX_SPEAKER_PRONOUNS_LENGTH} chars)`,
            });
            return;
          }
          pronouns = trimmedPronouns.length > 0 ? trimmedPronouns : null;
        }

        // 4. Create anonymous speaker + write override. Wrapped in
        //    try/catch so a unique-index race (very unlikely for an
        //    anonymous speaker — the partial index is only on
        //    user_id IS NOT NULL — but guard anyway) doesn't 500.
        try {
          const speaker = speakerRepository.create({
            workspaceId: tokenDevice.workspaceId,
            userId: null,
            preferredName,
            pronouns,
          });

          // Ensure a session_devices row exists. The WS register flow
          // normally inserts this, but the claim card could fire before
          // a re-register (and we don't want a silent no-op write).
          sessionRepository.addDevice(sessionId, deviceId);
          sessionRepository.setActiveSpeaker(sessionId, deviceId, speaker.id);

          res.status(201).json({ speakerId: speaker.id });
        } catch (err) {
          console.error('[Devices] active-speaker write failed:', err);
          res.status(500).json({ error: 'Failed to record speaker' });
        }
      }
    );
  }

  return router;
}
