/**
 * Application-wide constants.
 */

/**
 * Workspace ID used for unauthenticated/anonymous mode.
 * 
 * When a client connects without providing a workspaceId, they are assigned
 * to this pseudo-workspace. This mode:
 * - Skips database persistence (no workspace FK to reference)
 * - Skips device registration in database
 * - Skips session tracking
 * - Uses in-memory message relay only
 * 
 * This exists for backward compatibility with pre-auth clients and for
 * quick demos without requiring login.
 */
export const ANONYMOUS_WORKSPACE_ID = 'default';

/**
 * Session ID used when running in anonymous mode (no database tracking).
 */
export const ANONYMOUS_SESSION_ID = 'default';

/**
 * Default session name shown in anonymous mode.
 */
export const ANONYMOUS_SESSION_NAME = 'Default Session';

/**
 * Check if a workspace ID represents anonymous/unauthenticated mode.
 * Centralizes the legacy mode detection logic.
 */
export function isAnonymousMode(workspaceId: string | undefined | null): boolean {
  return !workspaceId || workspaceId === ANONYMOUS_WORKSPACE_ID;
}

/**
 * Check if a session ID represents anonymous/unauthenticated mode.
 * Use this for session-level checks to avoid semantic confusion with isAnonymousMode().
 */
export function isAnonymousSession(sessionId: string | undefined | null): boolean {
  return !sessionId || sessionId === ANONYMOUS_SESSION_ID;
}
