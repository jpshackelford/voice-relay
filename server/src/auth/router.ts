import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import type { AuthConfig } from './types.js';
import { GitHubOAuth } from './github-oauth.js';
import { JWTService } from './jwt.js';
import { UserRepository } from './user-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from './middleware.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import { generateDeviceName } from '../devices/device-utils.js';

export interface AuthRouterConfig {
  config: AuthConfig;
  userRepository: UserRepository;
  /** Optional workspace repository for auto-creating default workspace */
  workspaceRepository?: WorkspaceRepository;
  /** Optional device repository for auto-creating first device */
  deviceRepository?: DeviceRepository;
  /** Where to redirect after successful login (default: /) */
  successRedirect?: string;
  /** Where to redirect after failed login (default: /login?error=1) */
  errorRedirect?: string;
}

// Cookie names
const AUTH_COOKIE_NAME = 'voice_relay_auth';
const REFRESH_COOKIE_NAME = 'voice_relay_refresh';
const DEVICE_TOKEN_COOKIE_NAME = 'voice_relay_device';

// Cookie options for secure httpOnly cookies (auth tokens)
function getAuthCookieOptions(isProduction: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction, // Require HTTPS in production
    sameSite: 'lax' as const,
    path: '/',
    maxAge, // in milliseconds
  };
}

/**
 * Cookie options for device token cookie.
 * 
 * SECURITY NOTE: Device cookies are NOT httpOnly because the client needs to read
 * them to restore device sessions. This is acceptable because:
 * 1. Device tokens have limited scope - they only identify a device within a workspace
 * 2. Auth tokens (which ARE httpOnly) are required for any authenticated operations  
 * 3. Device tokens cannot be used to impersonate users or access other workspaces
 * 4. The main XSS risk (session hijacking) is mitigated by httpOnly auth tokens
 * 
 * If XSS is a concern in your environment, consider using a server-side endpoint
 * to validate device tokens instead of client-side cookie reading.
 */
function getDeviceCookieOptions(isProduction: boolean, maxAge: number) {
  return {
    httpOnly: false, // Client needs to read device info
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

// Parse duration string (e.g., '7d', '1h', '30m') to milliseconds
function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) {
    console.warn(`[Auth] Invalid JWT_EXPIRES_IN format: "${duration}", using default 7d`);
    return 7 * 24 * 60 * 60 * 1000; // Default 7 days
  }
  
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

// Device token cookie expiry for one-time migration to localStorage
const DEVICE_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Auto-create first device for a user in their newly created workspace.
 * Sets device token cookie for client-side session restoration.
 * 
 * @param username - User's username for logging
 * @param displayName - User's display name for device naming
 * @param workspaceId - ID of the newly created workspace
 * @param userAgent - User-Agent header for device type detection
 * @param res - Express response for setting cookies
 * @param deviceRepository - Repository for creating devices
 * @param isProduction - Whether running in production (for secure cookies)
 */
function autoCreateFirstDevice(
  username: string,
  displayName: string,
  workspaceId: string,
  userAgent: string,
  res: Response,
  deviceRepository: DeviceRepository,
  isProduction: boolean
): void {
  try {
    const deviceName = generateDeviceName(displayName, userAgent);
    const { device, token: deviceToken } = deviceRepository.create({
      workspaceId,
      name: deviceName,
      mode: 'mobile', // Default to mobile mode
    });

    console.log(`[Auth] Auto-created first device for ${username}: ${device.name} (id: ${device.id})`);

    // Set device token cookie (short expiry for one-time migration to localStorage)
    const deviceCookieData = JSON.stringify({
      deviceId: device.id,
      deviceToken,
      workspaceId,
      name: device.name,
      mode: device.mode,
    });
    res.cookie(DEVICE_TOKEN_COOKIE_NAME, deviceCookieData, getDeviceCookieOptions(isProduction, DEVICE_TOKEN_MAX_AGE));
  } catch (err) {
    // Device creation is non-critical; log and continue
    console.error(`[Auth] Failed to auto-create first device for ${username}:`, err);
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
  const { config, userRepository, workspaceRepository, deviceRepository, successRedirect = '/', errorRedirect = '/login?error=1' } = options;

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
      
      // Auto-create default workspace if user doesn't have any
      // Note: In rare race conditions (simultaneous login requests for new user),
      // this could create duplicate workspaces. This is harmless since users can
      // have multiple workspaces, and the probability is very low in practice.
      // A more robust solution would use a unique constraint or transaction,
      // but that adds complexity for minimal benefit.
      let newlyCreatedWorkspaceId: string | null = null;
      if (workspaceRepository) {
        const workspaces = workspaceRepository.findByOwner(user.id);
        if (workspaces.length === 0) {
          const displayName = user.displayName || user.username;
          const workspaceName = `${displayName}'s Workspace`;
          const workspace = workspaceRepository.create(user.id, { name: workspaceName });
          newlyCreatedWorkspaceId = workspace.id;
          console.log(`[Auth] Created default workspace for ${user.username}: ${workspace.name} (id: ${workspace.id})`);
        }
      }
      
      // Auto-create first device in the newly created workspace
      // This reduces friction for first-time users
      if (newlyCreatedWorkspaceId && deviceRepository) {
        const userAgent = req.headers['user-agent'] || '';
        const displayName = user.displayName || user.username;
        autoCreateFirstDevice(user.username, displayName, newlyCreatedWorkspaceId, userAgent, res, deviceRepository, isProduction);
      }
      
      // Generate JWT access token
      const token = jwtService.sign(user);
      
      // Generate refresh token (longer-lived, for token renewal)
      const refreshToken = jwtService.signRefresh(user);
      
      // Set httpOnly cookies (not accessible via JavaScript - XSS safe)
      res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(isProduction, tokenMaxAge));
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getAuthCookieOptions(isProduction, refreshMaxAge));
      
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
    res.cookie(AUTH_COOKIE_NAME, newToken, getAuthCookieOptions(isProduction, tokenMaxAge));
    res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, getAuthCookieOptions(isProduction, refreshMaxAge));
    
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

  /**
   * POST /auth/test-session
   * Creates an authenticated session for automated testing.
   * 
   * SECURITY: Only available when TEST_AUTH_SECRET env var is set.
   * Requires the secret in the X-Test-Auth-Secret header.
   * 
   * This allows CI/CD pipelines to run authenticated smoke tests
   * without needing to go through GitHub OAuth interactively.
   */
  const testAuthSecret = process.env.TEST_AUTH_SECRET;
  if (testAuthSecret) {
    console.log('[Auth] Test auth endpoint enabled (TEST_AUTH_SECRET is set)');
    
    router.post('/test-session', (req: Request, res: Response) => {
      const providedSecret = req.headers['x-test-auth-secret'];
      
      if (providedSecret !== testAuthSecret) {
        res.status(403).json({ error: 'Invalid test auth secret' });
        return;
      }
      
      // Create or get test user
      const testUser = userRepository.upsertFromGitHub({
        githubId: 0, // Special ID for test user
        username: 'smoke-test-user',
        displayName: 'Smoke Test User',
        avatarUrl: null,
        email: 'smoke-test@example.com',
      });
      
      console.log(`[Auth] Test session created for user: ${testUser.username}`);
      
      // Auto-create default workspace if test user doesn't have any
      let testWorkspaceId: string | null = null;
      if (workspaceRepository) {
        const workspaces = workspaceRepository.findByOwner(testUser.id);
        if (workspaces.length === 0) {
          const workspaceName = `${testUser.displayName}'s Workspace`;
          const workspace = workspaceRepository.create(testUser.id, { name: workspaceName });
          testWorkspaceId = workspace.id;
          console.log(`[Auth] Created default workspace for test user: ${workspace.name} (id: ${workspace.id})`);
        }
      }
      
      // Auto-create first device in the newly created workspace
      if (testWorkspaceId && deviceRepository) {
        const userAgent = req.headers['user-agent'] || '';
        const displayName = testUser.displayName || testUser.username;
        autoCreateFirstDevice(testUser.username, displayName, testWorkspaceId, userAgent, res, deviceRepository, isProduction);
      }
      
      // Generate tokens
      const token = jwtService.sign(testUser);
      const refreshToken = jwtService.signRefresh(testUser);
      
      // Set cookies (same as normal OAuth flow)
      res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(isProduction, tokenMaxAge));
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getAuthCookieOptions(isProduction, refreshMaxAge));
      
      res.json({ 
        success: true,
        user: {
          id: testUser.id,
          username: testUser.username,
          displayName: testUser.displayName,
        }
      });
    });
  }

  return router;
}

export { JWTService, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME, DEVICE_TOKEN_COOKIE_NAME };
