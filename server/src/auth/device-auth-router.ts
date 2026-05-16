/**
 * Device Authorization Grant Router
 * 
 * Provides HTTP endpoints for the OAuth 2.0 Device Authorization Grant flow.
 * This enables devices without browsers (like Apple TV) to authenticate.
 * 
 * Endpoints:
 * - POST /auth/device/code - Request device/user codes
 * - POST /auth/device/token - Poll for access token
 * - GET /auth/device/verify - Verification page (user enters code)
 * - POST /auth/device/verify - Submit code and authenticate
 */

import { Router, type Request, type Response } from 'express';
import type { DeviceAuthManager } from './device-auth.js';
import type { JWTService } from './jwt.js';
import type { UserRepository } from './user-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import { requireAuth, type AuthMiddlewareConfig } from './middleware.js';
import { generateDeviceName } from '../devices/device-utils.js';

/**
 * Escape HTML special characters to prevent XSS attacks.
 * Must be used for any user input inserted into HTML responses.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface DeviceAuthRouterConfig {
  deviceAuthManager: DeviceAuthManager;
  jwtService: JWTService;
  userRepository: UserRepository;
  workspaceRepository?: WorkspaceRepository;
  deviceRepository?: DeviceRepository;
}

export function createDeviceAuthRouter(config: DeviceAuthRouterConfig): Router {
  const router = Router();
  const { deviceAuthManager, jwtService, userRepository, workspaceRepository, deviceRepository } = config;

  /**
   * POST /auth/device/code
   * 
   * Request a device code for device authorization flow.
   * Returns device_code (for polling), user_code (for user to enter),
   * and verification_uri (where user goes to authenticate).
   * 
   * Response follows RFC 8628 format.
   */
  router.post('/code', (_req: Request, res: Response) => {
    const response = deviceAuthManager.createRequest();
    
    console.log('[DeviceAuth] Created device auth request:', {
      user_code: response.user_code,
      expires_in: response.expires_in,
    });

    res.json(response);
  });

  /**
   * POST /auth/device/token
   * 
   * Poll for access token using device_code.
   * Called by the device to check if user has completed authentication.
   * 
   * Request body: { device_code: string }
   * 
   * Responses:
   * - 200 with tokens: Authentication completed successfully
   * - 400 with error "authorization_pending": User hasn't completed auth yet
   * - 400 with error "slow_down": Polling too frequently
   * - 400 with error "expired_token": Device code has expired
   * - 400 with error "access_denied": User denied authorization
   */
  router.post('/token', (req: Request, res: Response) => {
    const { device_code } = req.body;

    if (!device_code || typeof device_code !== 'string') {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'device_code is required',
      });
      return;
    }

    const { request, shouldSlowDown } = deviceAuthManager.pollForToken(device_code);

    // Invalid device code
    if (!request) {
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or unknown device_code',
      });
      return;
    }

    // Rate limiting
    if (shouldSlowDown) {
      res.status(400).json({
        error: 'slow_down',
        error_description: `Please wait at least ${request.interval} seconds between polling requests`,
      });
      return;
    }

    // Check for errors (expired, denied)
    if (request.error) {
      res.status(400).json({
        error: request.error,
        error_description: request.error === 'expired_token' 
          ? 'The device code has expired. Please request a new code.'
          : request.error === 'access_denied'
          ? 'The user denied the authorization request.'
          : 'Authorization is pending. Continue polling.',
      });
      return;
    }

    // Still pending
    if (!request.completed || !request.userId) {
      res.status(400).json({
        error: 'authorization_pending',
        error_description: 'The user has not yet completed authorization. Continue polling.',
      });
      return;
    }

    // Completed! Generate tokens
    const user = userRepository.findById(request.userId);
    if (!user) {
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'User not found',
      });
      return;
    }

    const accessToken = jwtService.sign(user);
    const refreshToken = jwtService.signRefresh(user);

    console.log('[DeviceAuth] Device authorized successfully:', {
      user_code: request.userCode,
      user: user.username,
    });

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: 604800, // 7 days in seconds
    });
  });

  /**
   * GET /auth/device/verify
   * 
   * Verification page where user enters the code shown on their device.
   * This is a simple HTML page - in production you might want to use
   * a proper frontend route with React.
   */
  router.get('/verify', (req: Request, res: Response) => {
    // SECURITY: Escape all user input to prevent XSS attacks
    const prefilledCode = escapeHtml(typeof req.query.code === 'string' ? req.query.code : '');
    const error = escapeHtml(typeof req.query.error === 'string' ? req.query.error : '');
    
    // Simple HTML verification page
    // In production, this could redirect to a React route
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Device Authorization - Voice Relay</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 400px;
      margin: 50px auto;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #333; }
    .code-input {
      font-size: 24px;
      letter-spacing: 4px;
      text-transform: uppercase;
      padding: 15px;
      width: 200px;
      text-align: center;
      border: 2px solid #ddd;
      border-radius: 8px;
    }
    .code-input:focus {
      border-color: #007bff;
      outline: none;
    }
    button {
      display: block;
      width: 100%;
      max-width: 230px;
      margin: 20px auto;
      padding: 15px 30px;
      font-size: 18px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    button:hover { background: #0056b3; }
    .error { color: #dc3545; margin-top: 10px; }
    .hint { color: #666; font-size: 14px; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>🖥️ Connect Your Device</h1>
  <p>Enter the code shown on your TV or device:</p>
  
  <form action="/auth/device/verify" method="POST">
    <input 
      type="text" 
      name="user_code" 
      class="code-input" 
      placeholder="XXXX-XXXX"
      value="${prefilledCode}"
      maxlength="9"
      pattern="[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}"
      required
      autofocus
    >
    ${error ? `<p class="error">${error}</p>` : ''}
    <button type="submit">Continue</button>
  </form>
  
  <p class="hint">
    The code is displayed on your device screen.<br>
    It looks like: ABCD-1234
  </p>
</body>
</html>
    `;

    res.type('html').send(html);
  });

  /**
   * POST /auth/device/verify
   * 
   * Submit the user code. If valid, redirect to GitHub OAuth.
   * After OAuth completes, the device will receive tokens on next poll.
   */
  router.post('/verify', (req: Request, res: Response) => {
    const { user_code } = req.body;

    if (!user_code || typeof user_code !== 'string') {
      res.redirect('/auth/device/verify?error=Please+enter+a+code');
      return;
    }

    // Find the pending request
    const request = deviceAuthManager.findByUserCode(user_code);
    
    if (!request) {
      res.redirect('/auth/device/verify?error=Invalid+or+expired+code.+Please+try+again.');
      return;
    }

    if (request.completed) {
      res.redirect('/auth/device/verify?error=This+code+has+already+been+used.');
      return;
    }

    // Store the user code in session/cookie for OAuth callback
    // We'll use a simple query param approach with the GitHub OAuth state
    const returnTo = `/auth/device/complete?user_code=${encodeURIComponent(user_code)}`;
    
    // Redirect to GitHub OAuth with returnTo
    res.redirect(`/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
  });

  /**
   * GET /auth/device/complete
   * 
   * Called after GitHub OAuth completes.
   * Links the authenticated user to the pending device request.
   * Requires authentication (user must have completed OAuth).
   */
  router.get('/complete', requireAuth({ jwtService, userRepository }), (req: Request, res: Response) => {
    const userCode = typeof req.query.user_code === 'string' ? req.query.user_code : '';
    const user = req.user;

    if (!userCode || !user) {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>❌ Authorization Failed</h1>
            <p>Missing user code or not authenticated.</p>
            <a href="/auth/device/verify">Try Again</a>
          </body>
        </html>
      `);
      return;
    }

    // Complete the device authorization
    const success = deviceAuthManager.completeRequest(userCode, user.id);

    if (!success) {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>❌ Authorization Failed</h1>
            <p>The code is invalid, expired, or already used.</p>
            <a href="/auth/device/verify">Try Again</a>
          </body>
        </html>
      `);
      return;
    }

    console.log('[DeviceAuth] User completed device authorization:', {
      user: user.username,
      user_code: userCode,
    });

    // Success! Show confirmation page
    res.send(`
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              text-align: center;
              padding: 50px;
              background: #f0f9f0;
            }
            .success { font-size: 64px; }
            h1 { color: #28a745; }
          </style>
        </head>
        <body>
          <div class="success">✅</div>
          <h1>Device Authorized!</h1>
          <p>You can close this window and return to your device.</p>
          <p style="color: #666;">Your TV/device will connect automatically.</p>
        </body>
      </html>
    `);
  });

  return router;
}
