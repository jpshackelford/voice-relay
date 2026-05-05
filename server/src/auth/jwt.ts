import jwt from 'jsonwebtoken';
import type { JWTPayload, User } from './types.js';

export interface JWTConfig {
  secret: string;
  expiresIn: string; // e.g., '7d', '1h', '30m'
}

export class JWTService {
  private readonly secret: string;
  private readonly expiresIn: string;
  // Refresh tokens use a different secret suffix for separation
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn = '30d'; // Refresh tokens last longer

  constructor(config: JWTConfig) {
    this.secret = config.secret;
    this.expiresIn = config.expiresIn;
    this.refreshSecret = config.secret + '_refresh';
  }

  sign(user: User): string {
    const payload = {
      sub: user.id,
      username: user.username,
    };
    
    // Use type assertion since our expiresIn string is always a valid duration
    return jwt.sign(payload, this.secret, {
      expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  /**
   * Sign a refresh token (longer-lived, used to obtain new access tokens)
   */
  signRefresh(user: User): string {
    const payload = {
      sub: user.id,
      username: user.username,
      type: 'refresh',
    };
    
    return jwt.sign(payload, this.refreshSecret, {
      expiresIn: this.refreshExpiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  verify(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as JWTPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify a refresh token
   */
  verifyRefresh(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, this.refreshSecret) as JWTPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  decode(token: string): JWTPayload | null {
    try {
      const decoded = jwt.decode(token) as JWTPayload | null;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Check if a token is close to expiration (within threshold)
   * Returns true if token expires within the next `thresholdMs` milliseconds
   */
  isExpiringSoon(token: string, thresholdMs: number = 5 * 60 * 1000): boolean {
    const payload = this.decode(token);
    if (!payload || !payload.exp) return true;
    
    const expiresAt = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    
    return expiresAt - now < thresholdMs;
  }
}
