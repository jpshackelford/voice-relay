import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import type { AuthConfig } from './types.js';
import { GitHubOAuth } from './github-oauth.js';
import { JWTService } from './jwt.js';
import { UserRepository } from './user-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from './middleware.js';

export interface AuthRouterConfig {
  config: AuthConfig;
  userRepository: UserRepository;
  /** Where to redirect after successful login (default: /) */
  successRedirect?: string;
  /** Where to redirect after failed login (default: /login?error=1) */
  errorRedirect?: string;
}

// Cookie names
const AUTH_COOKIE_NAME = 'voice_relay_auth';
const REFRESH_COOKIE_NAME = 'voice_relay_refresh';

// Cookie options for secure httpOnly cookies
function getCookieOptions(isProduction: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction, // Require HTTPS in production
    sameSite: 'lax' as const,
    path: '/',
    maxAge, // in milliseconds
  };
}

// Parse duration string (e.g., '7d', '1h', '30m') to milliseconds
function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

// In-memory state store (for CSRF protection)
// In production with multiple servers, use Redis
const pendingStates = new Map<string, { createdAt: number; returnTo?: string }>();

// Cleanup old states every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [state, data] of pendingStates) {
    if (now - data.createdAt > maxAge) {
      pendingStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

export function createAuthRouter(options: AuthRouterConfig): Router {
  const router = Router();
  const { config, userRepository, successRedirect = '/', errorRedirect = '/login?error=1' } = options;

  const github = new GitHubOAuth({
    githubClientId: config.githubClientId,
    githubClientSecret: config.githubClientSecret,
    callbackUrl: config.callbackUrl,
  });

  const jwtService = new JWTService({
    secret: config.jwtSecret,
    expiresIn: config.jwtExpiresIn ?? '7d',
  });

  const authMiddleware: AuthMiddlewareConfig = {
    jwtService,
    userRepository,
  };

  /**
   * GET /auth/github
   * Initiates GitHub OAuth flow by redirecting to GitHub
   */
  router.get('/github', (req: Request, res: Response) => {
    const state = crypto.randomBytes(32).toString('hex');
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
    
    pendingStates.set(state, { createdAt: Date.now(), returnTo });
    
    const authUrl = github.getAuthorizationUrl(state);
    res.redirect(authUrl);
  });

  // Determine if running in production (HTTPS)
  const isProduction = process.env.NODE_ENV === 'production' || 
                       config.callbackUrl.startsWith('https://');
  const tokenMaxAge = parseDurationToMs(config.jwtExpiresIn ?? '7d');
  // Refresh token lasts longer (30 days)
  const refreshMaxAge = 30 * 24 * 60 * 60 * 1000;

  /**
   * GET /auth/github/callback
   * Handles the OAuth callback from GitHub
   * Sets httpOnly cookies instead of passing token in URL (security: prevents token leakage)
   */
  router.get('/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;

    // Validate state
    if (!state || typeof state !== 'string') {
      console.error('[Auth] Missing state parameter');
      res.redirect(errorRedirect);
      return;
    }

    const pendingState = pendingStates.get(state);
    if (!pendingState) {
      console.error('[Auth] Invalid or expired state');
      res.redirect(errorRedirect);
      return;
    }
    pendingStates.delete(state);

    // Validate code
    if (!code || typeof code !== 'string') {
      console.error('[Auth] Missing code parameter');
      res.redirect(errorRedirect);
      return;
    }

    try {
      // Exchange code for token
      const accessToken = await github.exchangeCodeForToken(code);
      
      // Get user info from GitHub
      const githubUser = await github.getUser(accessToken);
      
      // Create or update user in our database
      const user = userRepository.upsertFromGitHub({
        githubId: githubUser.id,
        username: githubUser.login,
        displayName: githubUser.name,
        avatarUrl: githubUser.avatar_url,
        email: githubUser.email,
      });
      
      console.log(`[Auth] User ${user.username} logged in (id: ${user.id})`);
      
      // Generate JWT access token
      const token = jwtService.sign(user);
      
      // Generate refresh token (longer-lived, for token renewal)
      const refreshToken = jwtService.signRefresh(user);
      
      // Set httpOnly cookies (not accessible via JavaScript - XSS safe)
      res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions(isProduction, tokenMaxAge));
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions(isProduction, refreshMaxAge));
      
      // Redirect without token in URL (security: prevents browser history/referer leakage)
      const redirectTo = pendingState.returnTo || successRedirect;
      res.redirect(redirectTo);
      
    } catch (err) {
      console.error('[Auth] OAuth callback error:', err);
      res.redirect(errorRedirect);
    }
  });

  /**
   * GET /auth/me
   * Returns the current authenticated user
   * Reads token from httpOnly cookie or Authorization header (for WebSocket/API compatibility)
   */
  router.get('/me', requireAuth(authMiddleware), (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  /**
   * POST /auth/refresh
   * Refresh the access token using the refresh token cookie
   * Returns new tokens and updates cookies
   */
  router.post('/refresh', (req: Request, res: Response) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    
    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token' });
      return;
    }
    
    // Verify refresh token
    const payload = jwtService.verifyRefresh(refreshToken);
    if (!payload) {
      // Clear invalid cookies
      res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    
    // Get fresh user data
    const user = userRepository.findById(payload.sub);
    if (!user) {
      res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      res.status(401).json({ error: 'User not found' });
      return;
    }
    
    // Issue new tokens
    const newToken = jwtService.sign(user);
    const newRefreshToken = jwtService.signRefresh(user);
    
    // Update cookies
    res.cookie(AUTH_COOKIE_NAME, newToken, getCookieOptions(isProduction, tokenMaxAge));
    res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, getCookieOptions(isProduction, refreshMaxAge));
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        email: user.email,
      }
    });
  });

  /**
   * POST /auth/logout
   * Clears auth cookies and invalidates session
   */
  router.post('/logout', (_req: Request, res: Response) => {
    // Clear httpOnly cookies
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    // In the future, could also invalidate tokens server-side (token blacklist)
    res.json({ success: true });
  });

  return router;
}

export { JWTService, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME };
