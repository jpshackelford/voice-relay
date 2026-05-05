import jwt from 'jsonwebtoken';
import type { JWTPayload, User } from './types.js';

export interface JWTConfig {
  secret: string;
  expiresIn: string; // e.g., '7d', '1h', '30m'
}

export class JWTService {
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(config: JWTConfig) {
    this.secret = config.secret;
    this.expiresIn = config.expiresIn;
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

  verify(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as JWTPayload;
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
}
