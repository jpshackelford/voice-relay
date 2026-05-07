import { useState, useEffect, useRef, useCallback } from 'react';
import type { ResourceError } from './useResourceFetch';
import type { JoinResolvedMessage } from '../types';

/** Workspace data returned from auto-join endpoint */
export interface AutoJoinWorkspace {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
  joined: boolean;
}

/** Result of auto-join attempt */
export interface AutoJoinResult {
  /** true = success, false = failed, null = not attempted/in progress */
  success: boolean | null;
  /** Error message if failed */
  error: string | null;
  /** Workspace data returned on success (eliminates race condition with refetch) */
  workspace: AutoJoinWorkspace | null;
}

/** Pending join request state */
export interface PendingJoinRequest {
  requestId: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
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
  /** Pending join request waiting for approval */
  pendingRequest: PendingJoinRequest | null;
  /** Cancel the pending join request */
  cancelRequest: () => Promise<void>;
  /** Handle join-resolved WebSocket message */
  handleJoinResolved: (message: JoinResolvedMessage) => void;
}

/**
 * Hook to handle automatic workspace joining when user encounters 403.
 * Supports both auto-join (when allowAutoJoin=true) and join request flow
 * (when allowAutoJoin=false, requires owner approval).
 * 
 * Triggers auto-join when:
 * - User is authenticated
 * - Workspace fetch returned ACCESS_DENIED error
 * - Auto-join hasn't been attempted yet
 * 
 * If auto-join is disabled for the workspace, creates a join request and
 * waits for owner approval via WebSocket.
 * 
 * @returns Auto-join state including whether attempted, in progress, result, and pending request
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
    workspace: null,
  });

  // State for pending join request (waiting for approval)
  const [pendingRequest, setPendingRequest] = useState<PendingJoinRequest | null>(null);

  // Handle join-resolved WebSocket message
  const handleJoinResolved = useCallback((message: JoinResolvedMessage) => {
    if (pendingRequest && message.requestId === pendingRequest.requestId) {
      setPendingRequest(null);
      
      if (message.approved && message.workspace) {
        setResult({
          success: true,
          error: null,
          workspace: {
            id: message.workspace.id,
            name: message.workspace.name,
            slug: message.workspace.slug,
            isOwner: false,
            joined: true,
          },
        });
        onJoinSuccess(true);
      } else {
        setResult({
          success: false,
          error: message.error || 'Join request denied',
          workspace: null,
        });
      }
    }
  }, [pendingRequest, onJoinSuccess]);

  // Cancel pending join request
  const cancelRequest = useCallback(async () => {
    if (!pendingRequest || !workspaceId) return;

    try {
      await ensureValidToken();
      const res = await fetch(
        `/api/workspaces/${workspaceId}/requests/${pendingRequest.requestId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (res.ok || res.status === 204 || res.status === 404) {
        setPendingRequest(null);
        setResult({
          success: false,
          error: 'Join request cancelled',
          workspace: null,
        });
      }
    } catch (err) {
      console.error('[useWorkspaceAutoJoin] Failed to cancel request:', err);
    }
  }, [pendingRequest, workspaceId, ensureValidToken]);

  // Auto-join when we get ACCESS_DENIED error
  useEffect(() => {
    let cancelled = false;

    // Helper to set error result if not cancelled
    const setErrorResult = (error: string) => {
      if (!cancelled) {
        setResult({ success: false, error, workspace: null });
      }
    };

    // Handle the join request flow when auto-join is disabled
    const handleJoinRequestFlow = async () => {
      console.log('[useWorkspaceAutoJoin] Auto-join disabled, creating join request');
      
      try {
        // NOTE: We don't send deviceId - server tracks by authenticated userId for security
        const requestRes = await fetch(`/api/workspaces/${workspaceId}/request-join`, {
          method: 'POST',
          credentials: 'include',
        });

        if (requestRes.ok) {
          const requestData = await requestRes.json();
          if (!cancelled) {
            setPendingRequest({
              requestId: requestData.requestId,
              workspaceId: requestData.workspace.id,
              workspaceName: requestData.workspace.name,
              createdAt: requestData.createdAt,
            });
            // Don't set result yet - wait for approval
          }
          return;
        }

        if (requestRes.status === 400) {
          const reqErrorData = await requestRes.json().catch(() => null);
          if (reqErrorData?.alreadyMember) {
            // User is already a member - this shouldn't happen but handle it
            if (!cancelled) {
              onJoinSuccess(false);
            }
            return;
          }
          setErrorResult(reqErrorData?.error || 'Failed to create join request');
          return;
        }

        setErrorResult('Failed to create join request');
      } catch (reqErr) {
        console.error('[useWorkspaceAutoJoin] Failed to create join request:', reqErr);
        setErrorResult('Failed to create join request');
      }
    };

    // Main auto-join attempt
    const attemptAutoJoin = async () => {
      try {
        await ensureValidToken();
        const res = await fetch(`/api/workspaces/${workspaceId}/auto-join`, {
          method: 'POST',
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            // Store workspace data from response to eliminate race condition with refetch
            setResult({ success: true, error: null, workspace: data });
            onJoinSuccess(data.joined === true);
          }
          return;
        }

        if (res.status === 404) {
          setErrorResult('Workspace not found');
          return;
        }

        if (res.status === 403) {
          // Auto-join disabled - try request-join flow
          const errorData = await res.json().catch(() => null);
          
          if (cancelled) return;
          
          if (errorData?.error?.includes('disabled')) {
            await handleJoinRequestFlow();
          } else {
            setErrorResult(errorData?.error || 'Auto-join is not enabled for this workspace');
          }
          return;
        }

        // Other error status
        const errorData = await res.json().catch(() => null);
        setErrorResult(errorData?.error || 'Failed to join workspace');
      } catch (err) {
        console.error('[useWorkspaceAutoJoin] Auto-join failed:', err);
        setErrorResult('Failed to join workspace');
      }
    };

    if (
      workspaceErrorInfo?.type === 'ACCESS_DENIED' &&
      isAuthenticated &&
      workspaceId &&
      !attemptedRef.current
    ) {
      // Mark as attempted synchronously to prevent re-runs
      attemptedRef.current = true;
      attemptAutoJoin();
    }

    return () => {
      cancelled = true;
    };
  }, [workspaceErrorInfo, isAuthenticated, workspaceId, ensureValidToken, onJoinSuccess]);

  return {
    attempted: attemptedRef.current,
    inProgress: attemptedRef.current && result.success === null && !pendingRequest,
    result,
    pendingRequest,
    cancelRequest,
    handleJoinResolved,
  };
}
