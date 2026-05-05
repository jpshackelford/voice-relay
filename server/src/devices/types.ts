/**
 * Device mode (view type)
 */
export type DeviceMode = 'mobile' | 'kiosk';

/**
 * Persisted device record in database
 */
export interface PersistedDevice {
  id: string;
  workspaceId: string;
  name: string;
  mode: DeviceMode;
  deviceToken: string | null;
  deviceTokenHash: string | null;
  lastSeenAt: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Input for creating a new device
 */
export interface DeviceCreateInput {
  workspaceId: string;
  name: string;
  mode: DeviceMode;
}

/**
 * Input for updating a device
 */
export interface DeviceUpdateInput {
  name?: string;
  mode?: DeviceMode;
  config?: Record<string, unknown>;
}

/**
 * Device token response (returned to client)
 */
export interface DeviceTokenResponse {
  deviceId: string;
  deviceToken: string;
  expiresAt: string | null;
}
