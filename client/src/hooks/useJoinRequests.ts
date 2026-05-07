import { useState, useCallback, useRef, useEffect } from 'react';
import type { JoinRequestMessage, JoinResponseMessage } from '../types';

/** Pending join request displayed on kiosk */
export interface PendingJoinRequestInfo {
  id: string;
  workspaceId: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  /** Time remaining until auto-expiry (updated by timer) */
  expiresIn?: number;
}

interface UseJoinRequestsOptions {
  /** Callback to send WebSocket message */
  sendMessage: (message: JoinResponseMessage) => void;
}

interface UseJoinRequestsReturn {
  /** List of pending join requests */
  pendingRequests: PendingJoinRequestInfo[];
  /** Handle incoming join-request WebSocket message */
  handleJoinRequest: (message: JoinRequestMessage) => void;
  /** Approve a join request */
  approveRequest: (requestId: string) => void;
  /** Deny a join request */
  denyRequest: (requestId: string) => void;
  /** Remove a request from the list (after resolution or timeout) */
  removeRequest: (requestId: string) => void;
}

// Request expiry time (5 minutes in milliseconds)
const REQUEST_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Hook to manage pending join requests on kiosk devices.
 * Receives join-request messages from WebSocket and provides
 * approve/deny functionality.
 */
export function useJoinRequests({
  sendMessage,
}: UseJoinRequestsOptions): UseJoinRequestsReturn {
  const [pendingRequests, setPendingRequests] = useState<PendingJoinRequestInfo[]>([]);
  
  // Track timeout IDs to prevent memory leaks and duplicate timers on unmount/remount
  const timeoutIdsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup all timeouts on unmount
  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    return () => {
      for (const timeoutId of timeoutIds.values()) {
        clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    };
  }, []);

  // Helper to clear and remove a timeout
  const clearRequestTimeout = useCallback((requestId: string) => {
    const timeoutId = timeoutIdsRef.current.get(requestId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(requestId);
    }
  }, []);

  // Handle incoming join-request message
  const handleJoinRequest = useCallback((message: JoinRequestMessage) => {
    const { request } = message;
    
    // Clear any existing timeout for this request (handles duplicate messages)
    clearRequestTimeout(request.id);
    
    // Add to pending requests (avoid duplicates)
    setPendingRequests(prev => {
      if (prev.some(r => r.id === request.id)) {
        return prev;
      }
      return [...prev, {
        ...request,
        expiresIn: REQUEST_EXPIRY_MS,
      }];
    });

    // Set up auto-removal after expiry with tracked timeout
    const timeoutId = setTimeout(() => {
      setPendingRequests(prev => prev.filter(r => r.id !== request.id));
      timeoutIdsRef.current.delete(request.id);
    }, REQUEST_EXPIRY_MS);
    
    timeoutIdsRef.current.set(request.id, timeoutId);
  }, [clearRequestTimeout]);

  // Approve a request
  const approveRequest = useCallback((requestId: string) => {
    sendMessage({
      type: 'join-response',
      requestId,
      approved: true,
    });
    
    // Clear timeout and remove from pending
    clearRequestTimeout(requestId);
    setPendingRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendMessage, clearRequestTimeout]);

  // Deny a request
  const denyRequest = useCallback((requestId: string) => {
    sendMessage({
      type: 'join-response',
      requestId,
      approved: false,
    });
    
    // Clear timeout and remove from pending
    clearRequestTimeout(requestId);
    setPendingRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendMessage, clearRequestTimeout]);

  // Manually remove a request
  const removeRequest = useCallback((requestId: string) => {
    clearRequestTimeout(requestId);
    setPendingRequests(prev => prev.filter(r => r.id !== requestId));
  }, [clearRequestTimeout]);

  return {
    pendingRequests,
    handleJoinRequest,
    approveRequest,
    denyRequest,
    removeRequest,
  };
}
