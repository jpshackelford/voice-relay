import { Router, type Request, type Response } from 'express';
import type { DeviceRepository } from './device-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

export interface DeviceRouterOptions {
  deviceRepository: DeviceRepository;
  authConfig: AuthMiddlewareConfig;
}

/**
 * Create the device API router.
 * Provides endpoints for device token management.
 */
export function createDeviceRouter({ deviceRepository, authConfig }: DeviceRouterOptions): Router {
  const router = Router();
  const auth = requireAuth(authConfig);

  // Validate device token (public endpoint for reconnection)
  router.post('/validate', (req: Request, res: Response) => {
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

    res.json({
      valid: true,
      device: {
        id: device.id,
        workspaceId: device.workspaceId,
        name: device.name,
        mode: device.mode,
      },
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
