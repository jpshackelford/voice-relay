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
  /**
   * Stable id of the user who claimed this device via an authenticated
   * flow (GitHub OAuth, QR-token auto-join, …). `null` for anonymous
   * kiosks and for devices that pre-date #383 / migration 017.
   *
   * Used by the speaker-identity resolution path: when no per-session
   * override is set on `session_devices.active_speaker_id`, the speaker
   * is looked up via `primaryUserId` → workspace-scoped `speakers` row.
   */
  primaryUserId: string | null;
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
