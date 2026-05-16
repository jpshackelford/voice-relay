/**
 * Device Authorization Grant Flow (RFC 8628)
 * 
 * This module implements the OAuth 2.0 Device Authorization Grant flow
 * for devices that cannot easily use browser-based authentication,
 * such as Apple TV (tvOS) applications.
 * 
 * Flow:
 * 1. Device requests authorization (POST /auth/device/code)
 * 2. Server returns device_code, user_code, and verification_uri
 * 3. User visits verification_uri on another device (phone/computer)
 * 4. User enters user_code and authenticates via GitHub OAuth
 * 5. Device polls for completion (POST /auth/device/token)
 * 6. Once user completes auth, device receives JWT tokens
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc8628
 */

import crypto from 'crypto';

/** Characters used in user codes (avoiding ambiguous chars like 0/O, 1/I/l) */
const USER_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Device code request stored in memory (or Redis in production) */
export interface DeviceAuthRequest {
  /** Unique device code (used by device to poll) */
  deviceCode: string;
  /** User-facing code (entered on verification page) */
  userCode: string;
  /** When this request expires */
  expiresAt: Date;
  /** Minimum polling interval in seconds */
  interval: number;
  /** Has the user completed authentication? */
  completed: boolean;
  /** User ID once authenticated (null until completion) */
  userId: string | null;
  /** Error if authorization was denied */
  error: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | null;
  /** Last poll time (for rate limiting) */
  lastPollAt: Date | null;
}

/** Response to device code request */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** Response to token poll request */
export interface DeviceTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Configuration for device auth */
export interface DeviceAuthConfig {
  /** Base URL for verification URI */
  baseUrl: string;
  /** How long device codes are valid (default: 15 minutes) */
  codeExpirySeconds?: number;
  /** Minimum polling interval in seconds (default: 5) */
  pollingIntervalSeconds?: number;
}

const DEFAULT_CODE_EXPIRY_SECONDS = 15 * 60; // 15 minutes
const DEFAULT_POLLING_INTERVAL_SECONDS = 5;

/**
 * Generate a cryptographically secure device code
 */
function generateDeviceCode(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a user-friendly code (e.g., "ABCD-1234")
 * Format: XXXX-XXXX (8 chars with hyphen)
 */
function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    const idx = crypto.randomInt(USER_CODE_CHARS.length);
    code += USER_CODE_CHARS[idx];
    if (i === 3) code += '-'; // Add hyphen in middle
  }
  return code;
}

/**
 * Normalize user code input (uppercase, remove spaces/hyphens)
 */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Device Authorization Manager
 * 
 * Manages the lifecycle of device authorization requests.
 * In production with multiple servers, this should use Redis
 * instead of in-memory storage.
 */
export class DeviceAuthManager {
  private requests = new Map<string, DeviceAuthRequest>();
  private userCodeIndex = new Map<string, string>(); // userCode -> deviceCode
  private config: Required<DeviceAuthConfig>;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: DeviceAuthConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      codeExpirySeconds: config.codeExpirySeconds ?? DEFAULT_CODE_EXPIRY_SECONDS,
      pollingIntervalSeconds: config.pollingIntervalSeconds ?? DEFAULT_POLLING_INTERVAL_SECONDS,
    };

    // Cleanup expired requests every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Create a new device authorization request
   */
  createRequest(): DeviceCodeResponse {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const normalizedUserCode = normalizeUserCode(userCode);
    const expiresAt = new Date(Date.now() + this.config.codeExpirySeconds * 1000);

    const request: DeviceAuthRequest = {
      deviceCode,
      userCode,
      expiresAt,
      interval: this.config.pollingIntervalSeconds,
      completed: false,
      userId: null,
      error: null,
      lastPollAt: null,
    };

    this.requests.set(deviceCode, request);
    this.userCodeIndex.set(normalizedUserCode, deviceCode);

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${this.config.baseUrl}/auth/device/verify`,
      verification_uri_complete: `${this.config.baseUrl}/auth/device/verify?code=${encodeURIComponent(userCode)}`,
      expires_in: this.config.codeExpirySeconds,
      interval: this.config.pollingIntervalSeconds,
    };
  }

  /**
   * Find a request by user code (for verification page)
   */
  findByUserCode(userCode: string): DeviceAuthRequest | null {
    const normalizedCode = normalizeUserCode(userCode);
    const deviceCode = this.userCodeIndex.get(normalizedCode);
    if (!deviceCode) return null;

    const request = this.requests.get(deviceCode);
    if (!request) return null;

    // Check expiration
    if (new Date() > request.expiresAt) {
      request.error = 'expired_token';
      return null;
    }

    return request;
  }

  /**
   * Mark a request as completed after user authenticates
   */
  completeRequest(userCode: string, userId: string): boolean {
    const request = this.findByUserCode(userCode);
    if (!request || request.completed) return false;

    request.completed = true;
    request.userId = userId;
    request.error = null;
    return true;
  }

  /**
   * Deny a request (user declined authorization)
   */
  denyRequest(userCode: string): boolean {
    const request = this.findByUserCode(userCode);
    if (!request || request.completed) return false;

    request.completed = true;
    request.error = 'access_denied';
    return true;
  }

  /**
   * Poll for token (called by device)
   * Returns the request status and user info if completed
   */
  pollForToken(deviceCode: string): { request: DeviceAuthRequest | null; shouldSlowDown: boolean } {
    const request = this.requests.get(deviceCode);
    if (!request) {
      return { request: null, shouldSlowDown: false };
    }

    // Check expiration
    if (new Date() > request.expiresAt) {
      request.error = 'expired_token';
      return { request, shouldSlowDown: false };
    }

    // Rate limiting: enforce minimum polling interval
    const now = Date.now();
    const shouldSlowDown = request.lastPollAt !== null && 
      (now - request.lastPollAt.getTime()) < (request.interval * 1000 - 500); // 500ms grace

    request.lastPollAt = new Date();

    return { request, shouldSlowDown };
  }

  /**
   * Get request by device code (for status checking)
   */
  getRequest(deviceCode: string): DeviceAuthRequest | null {
    return this.requests.get(deviceCode) ?? null;
  }

  /**
   * Remove expired requests
   */
  private cleanup(): void {
    const now = new Date();
    const expiredCodes: string[] = [];

    for (const [deviceCode, request] of this.requests) {
      // Keep completed requests for a short grace period (1 minute after expiry)
      const graceExpiry = new Date(request.expiresAt.getTime() + 60 * 1000);
      if (now > graceExpiry) {
        expiredCodes.push(deviceCode);
        // Also remove from user code index
        const normalizedUserCode = normalizeUserCode(request.userCode);
        this.userCodeIndex.delete(normalizedUserCode);
      }
    }

    for (const code of expiredCodes) {
      this.requests.delete(code);
    }

    if (expiredCodes.length > 0) {
      console.log(`[DeviceAuth] Cleaned up ${expiredCodes.length} expired device auth requests`);
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
  }
}
