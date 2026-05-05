/**
 * Device mode (view type)
 */
export type DeviceMode = 'mobile' | 'kiosk';

/**
 * Persisted device record in database.
 * NOTE: Device tokens are ONLY stored as hashes for security.
 * The plaintext token is returned once on creation and never stored.
 */
export interface PersistedDevice {
  id: string;
  workspaceId: string;
  name: string;
  mode: DeviceMode;
  deviceTokenHash: string | null;
  tokenExpiresAt: string | null;
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
