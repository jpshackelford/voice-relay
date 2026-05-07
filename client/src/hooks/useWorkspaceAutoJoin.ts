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
  /** Device ID for WebSocket tracking */
  deviceId: string | undefined;
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
  deviceId,
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
            if (!cancelled) {
              // Store workspace data from response to eliminate race condition with refetch
              setResult({ success: true, error: null, workspace: data });
              onJoinSuccess(data.joined === true);
            }
          } else if (res.status === 404) {
            if (!cancelled) {
              setResult({ success: false, error: 'Workspace not found', workspace: null });
            }
          } else if (res.status === 403) {
            // Auto-join disabled - try request-join flow
            const errorData = await res.json().catch(() => null);
            
            if (!cancelled && errorData?.error?.includes('disabled')) {
              console.log('[useWorkspaceAutoJoin] Auto-join disabled, creating join request');
              
              // Create join request
              try {
                const requestRes = await fetch(`/api/workspaces/${workspaceId}/request-join`, {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ deviceId }),
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
                } else if (requestRes.status === 400) {
                  const reqErrorData = await requestRes.json().catch(() => null);
                  if (reqErrorData?.alreadyMember) {
                    // User is already a member - this shouldn't happen but handle it
                    if (!cancelled) {
                      onJoinSuccess(false);
                    }
                  } else {
                    if (!cancelled) {
                      setResult({
                        success: false,
                        error: reqErrorData?.error || 'Failed to create join request',
                        workspace: null,
                      });
                    }
                  }
                } else {
                  if (!cancelled) {
                    setResult({
                      success: false,
                      error: 'Failed to create join request',
                      workspace: null,
                    });
                  }
                }
              } catch (reqErr) {
                console.error('[useWorkspaceAutoJoin] Failed to create join request:', reqErr);
                if (!cancelled) {
                  setResult({
                    success: false,
                    error: 'Failed to create join request',
                    workspace: null,
                  });
                }
              }
            } else if (!cancelled) {
              setResult({
                success: false,
                error: errorData?.error || 'Auto-join is not enabled for this workspace',
                workspace: null,
              });
            }
          } else {
            const errorData = await res.json().catch(() => null);
            if (!cancelled) {
              setResult({
                success: false,
                error: errorData?.error || 'Failed to join workspace',
                workspace: null,
              });
            }
          }
        } catch (err) {
          console.error('[useWorkspaceAutoJoin] Auto-join failed:', err);
          if (!cancelled) {
            setResult({
              success: false,
              error: 'Failed to join workspace',
              workspace: null,
            });
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [workspaceErrorInfo, isAuthenticated, workspaceId, deviceId, ensureValidToken, onJoinSuccess]);

  return {
    attempted: attemptedRef.current,
    inProgress: attemptedRef.current && result.success === null && !pendingRequest,
    result,
    pendingRequest,
    cancelRequest,
    handleJoinResolved,
  };
}
