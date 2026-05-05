import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DeviceRepository } from './device-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

export interface DeviceRouterOptions {
  deviceRepository: DeviceRepository;
  authConfig: AuthMiddlewareConfig;
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
export function createDeviceRouter({ deviceRepository, authConfig }: DeviceRouterOptions): Router {
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

  return router;
}
