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

  /**
   * GET /auth/github/callback
   * Handles the OAuth callback from GitHub
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
      
      // Generate JWT
      const token = jwtService.sign(user);
      
      // Redirect with token
      // Client will extract token from URL fragment and store it
      const redirectTo = pendingState.returnTo || successRedirect;
      const separator = redirectTo.includes('?') ? '&' : '?';
      res.redirect(`${redirectTo}${separator}token=${token}`);
      
    } catch (err) {
      console.error('[Auth] OAuth callback error:', err);
      res.redirect(errorRedirect);
    }
  });

  /**
   * GET /auth/me
   * Returns the current authenticated user
   */
  router.get('/me', requireAuth(authMiddleware), (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  /**
   * POST /auth/logout
   * Client-side only (just clear token), but endpoint exists for future server-side session invalidation
   */
  router.post('/logout', (_req: Request, res: Response) => {
    // In the future, could invalidate tokens server-side
    res.json({ success: true });
  });

  return router;
}

export { JWTService };
