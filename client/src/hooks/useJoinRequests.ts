import { useState, useCallback } from 'react';
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

  // Handle incoming join-request message
  const handleJoinRequest = useCallback((message: JoinRequestMessage) => {
    const { request } = message;
    
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

    // Set up auto-removal after expiry
    setTimeout(() => {
      setPendingRequests(prev => prev.filter(r => r.id !== request.id));
    }, REQUEST_EXPIRY_MS);
  }, []);

  // Approve a request
  const approveRequest = useCallback((requestId: string) => {
    sendMessage({
      type: 'join-response',
      requestId,
      approved: true,
    });
    
    // Remove from pending
    setPendingRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendMessage]);

  // Deny a request
  const denyRequest = useCallback((requestId: string) => {
    sendMessage({
      type: 'join-response',
      requestId,
      approved: false,
    });
    
    // Remove from pending
    setPendingRequests(prev => prev.filter(r => r.id !== requestId));
  }, [sendMessage]);

  // Manually remove a request
  const removeRequest = useCallback((requestId: string) => {
    setPendingRequests(prev => prev.filter(r => r.id !== requestId));
  }, []);

  return {
    pendingRequests,
    handleJoinRequest,
    approveRequest,
    denyRequest,
    removeRequest,
  };
}
