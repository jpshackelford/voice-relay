import { useState, useEffect, useRef } from 'react';
import type { ResourceError } from './useResourceFetch';

/** Result of auto-join attempt */
export interface AutoJoinResult {
  /** true = success, false = failed, null = not attempted/in progress */
  success: boolean | null;
  /** Error message if failed */
  error: string | null;
}

interface UseWorkspaceAutoJoinOptions {
  /** Workspace ID to join */
  workspaceId: string | undefined;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Error info from workspace fetch (triggers auto-join on ACCESS_DENIED) */
  workspaceErrorInfo: ResourceError | null;
  /** Function to ensure auth token is valid before making request */
  ensureValidToken: () => Promise<unknown>;
  /** Callback when workspace should be refetched after successful join */
  onJoinSuccess: (wasNewlyJoined: boolean) => void;
}

interface UseWorkspaceAutoJoinReturn {
  /** Whether auto-join has been attempted */
  attempted: boolean;
  /** Whether auto-join is currently in progress */
  inProgress: boolean;
  /** Result of auto-join attempt (success/error) */
  result: AutoJoinResult;
}

/**
 * Hook to handle automatic workspace joining when user encounters 403.
 * Extracts auto-join logic from SessionView for better separation of concerns.
 * 
 * Triggers auto-join when:
 * - User is authenticated
 * - Workspace fetch returned ACCESS_DENIED error
 * - Auto-join hasn't been attempted yet
 * 
 * @returns Auto-join state including whether attempted, in progress, and result
 */
export function useWorkspaceAutoJoin({
  workspaceId,
  isAuthenticated,
  workspaceErrorInfo,
  ensureValidToken,
  onJoinSuccess,
}: UseWorkspaceAutoJoinOptions): UseWorkspaceAutoJoinReturn {
  // Use ref for synchronous guard against double-execution in useEffect
  const attemptedRef = useRef(false);
  
  // State for result tracking (triggers re-renders)
  const [result, setResult] = useState<AutoJoinResult>({
    success: null,
    error: null,
  });

  // Auto-join when we get ACCESS_DENIED error
  useEffect(() => {
    if (
      workspaceErrorInfo?.type === 'ACCESS_DENIED' &&
      isAuthenticated &&
      workspaceId &&
      !attemptedRef.current
    ) {
      // Mark as attempted synchronously to prevent re-runs
      attemptedRef.current = true;

      // Attempt auto-join
      (async () => {
        try {
          await ensureValidToken();
          const res = await fetch(`/api/workspaces/${workspaceId}/auto-join`, {
            method: 'POST',
            credentials: 'include',
          });

          if (res.ok) {
            const data = await res.json();
            setResult({ success: true, error: null });
            onJoinSuccess(data.joined === true);
          } else if (res.status === 404) {
            setResult({ success: false, error: 'Workspace not found' });
          } else {
            const errorData = await res.json().catch(() => null);
            setResult({
              success: false,
              error: errorData?.error || 'Failed to join workspace',
            });
          }
        } catch (err) {
          console.error('[useWorkspaceAutoJoin] Auto-join failed:', err);
          setResult({
            success: false,
            error: 'Failed to join workspace',
          });
        }
      })();
    }
  }, [workspaceErrorInfo, isAuthenticated, workspaceId, ensureValidToken, onJoinSuccess]);

  return {
    attempted: attemptedRef.current,
    inProgress: attemptedRef.current && result.success === null,
    result,
  };
}
