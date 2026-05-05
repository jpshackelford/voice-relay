import type { Request, Response, NextFunction } from 'express';
import type { JWTPayload, User } from './types.js';
import type { JWTService } from './jwt.js';
import type { UserRepository } from './user-repository.js';

// Cookie name for httpOnly auth token
const AUTH_COOKIE_NAME = 'voice_relay_auth';

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      user?: User;
      jwtPayload?: JWTPayload;
    }
  }
}

export interface AuthMiddlewareConfig {
  jwtService: JWTService;
  userRepository: UserRepository;
}

/**
 * Extract JWT token from request.
 * Checks both httpOnly cookie (preferred) and Authorization header (for API/WebSocket compatibility).
 */
function extractToken(req: Request): string | null {
  // First check httpOnly cookie (more secure, preferred method)
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (cookieToken) {
    return cookieToken;
  }
  
  // Fall back to Authorization header (for backward compatibility and WebSocket)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7); // Remove 'Bearer '
  }
  
  return null;
}

/**
 * Middleware that requires valid JWT authentication.
 * If valid, sets req.user and req.jwtPayload.
 * If invalid, returns 401 Unauthorized.
 * 
 * Reads token from:
 * 1. httpOnly cookie (preferred, secure)
 * 2. Authorization header (for API/WebSocket compatibility)
 */
export function requireAuth(config: AuthMiddlewareConfig) {
  const { jwtService, userRepository } = config;
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);
    
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const payload = jwtService.verify(token);
    
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = userRepository.findById(payload.sub);
    
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    req.jwtPayload = payload;
    next();
  };
}

/**
 * Middleware that optionally parses JWT if present.
 * Sets req.user if valid token, but doesn't require it.
 * Useful for endpoints that work both authenticated and unauthenticated.
 */
export function optionalAuth(config: AuthMiddlewareConfig) {
  const { jwtService, userRepository } = config;
  
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);
    
    if (token) {
      const payload = jwtService.verify(token);
      
      if (payload) {
        const user = userRepository.findById(payload.sub);
        if (user) {
          req.user = user;
          req.jwtPayload = payload;
        }
      }
    }

    next();
  };
}
