import type { Request, Response, NextFunction } from 'express';
import type { JWTPayload, User } from './types.js';
import type { JWTService } from './jwt.js';
import type { UserRepository } from './user-repository.js';

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
 * Middleware that requires valid JWT authentication.
 * If valid, sets req.user and req.jwtPayload.
 * If invalid, returns 401 Unauthorized.
 */
export function requireAuth(config: AuthMiddlewareConfig) {
  const { jwtService, userRepository } = config;
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization header required' });
      return;
    }

    const token = authHeader.slice(7); // Remove 'Bearer '
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
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
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
