/**
 * Display API authentication for AI agents to send content to kiosk displays.
 * 
 * This module provides secure authentication for the display API endpoint.
 * Each session has a unique display API secret that must be provided via
 * the Authorization header.
 */

import type { SessionRepository } from '../sessions/session-repository.js';

export interface DisplayAuthSuccess {
  authenticated: true;
  workspaceId: string;
}

export interface DisplayAuthFailure {
  authenticated: false;
  error: string;
  statusCode: number;
}

export type DisplayAuthResult = DisplayAuthSuccess | DisplayAuthFailure;

/**
 * Authenticate a display API request.
 * 
 * Validates the session ID and secret from the Authorization header.
 * Uses timing-safe comparison to prevent timing attacks.
 * 
 * @param authHeader - The Authorization header value (e.g., "Bearer <secret>")
 * @param sessionId - The session ID from the request body
 * @param sessionRepository - Repository for session lookups
 * @returns Authentication result with workspaceId on success, or error details on failure
 */
export async function authenticateDisplayRequest(
  authHeader: string | undefined,
  sessionId: string | undefined,
  sessionRepository: SessionRepository | null
): Promise<DisplayAuthResult> {
  // Validate authorization header format
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      authenticated: false,
      error: 'Authorization header required. Format: Bearer <secret>',
      statusCode: 401,
    };
  }

  const providedSecret = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Session ID is required
  if (!sessionId) {
    return {
      authenticated: false,
      error: 'sessionId is required',
      statusCode: 400,
    };
  }

  // Session repository must be available
  if (!sessionRepository) {
    return {
      authenticated: false,
      error: 'Session repository not available',
      statusCode: 500,
    };
  }

  // Lookup the session
  const session = sessionRepository.findById(sessionId);
  if (!session) {
    return {
      authenticated: false,
      error: 'Invalid session',
      statusCode: 401,
    };
  }

  // Get the stored secret
  const storedSecret = sessionRepository.getDisplaySecret(sessionId);
  if (!storedSecret) {
    return {
      authenticated: false,
      error: 'Session has no display API secret',
      statusCode: 401,
    };
  }

  // Timing-safe comparison to prevent timing attacks
  const providedBuffer = Buffer.from(providedSecret);
  const storedBuffer = Buffer.from(storedSecret);

  // Length check first - different lengths would leak info via timing
  if (providedBuffer.length !== storedBuffer.length) {
    return {
      authenticated: false,
      error: 'Invalid secret',
      statusCode: 401,
    };
  }

  const { timingSafeEqual } = await import('crypto');
  if (!timingSafeEqual(providedBuffer, storedBuffer)) {
    return {
      authenticated: false,
      error: 'Invalid secret',
      statusCode: 401,
    };
  }

  return {
    authenticated: true,
    workspaceId: session.workspaceId,
  };
}
