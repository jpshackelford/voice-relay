import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface QrTokenInfo {
  token: string;
  expiresAt: string;
  url: string;
  workspaceId: string;
  sessionId: string;
}

interface UseQrTokenOptions {
  /** Workspace ID */
  workspaceId?: string;
  /** Session ID */
  sessionId?: string;
  /** 
   * Whether to enable signed QR tokens.
   * When true, always attempts to generate tokens (best effort).
   * When false, doesn't generate tokens.
   */
  enabled?: boolean;
  /** Buffer time before expiration to auto-refresh (ms, default: 30s) */
  refreshBufferMs?: number;
}

interface UseQrTokenReturn {
  /** Current valid QR token, or null if not enabled/not available */
  token: QrTokenInfo | null;
  /** Loading state while fetching token */
  loading: boolean;
  /** Error message if token fetch failed (null if graceful fallback) */
  error: string | null;
  /** Whether token generation is supported and working */
  supported: boolean;
  /** Manually refresh the token */
  refresh: () => Promise<void>;
  /** Get the URL to encode in QR code (with or without token) */
  getQrUrl: () => string;
}

const DEFAULT_REFRESH_BUFFER_MS = 30 * 1000; // 30 seconds

/**
 * Hook for managing signed, time-limited QR tokens.
 * 
 * When enabled is true, this hook:
 * - Attempts to fetch a signed token from the server
 * - Auto-refreshes before expiration
 * - Provides the token-enhanced URL for QR codes
 * - Gracefully falls back to URL without token on errors
 * 
 * When enabled is false:
 * - Returns null for token
 * - getQrUrl returns the standard URL without token
 */
export function useQrToken({
  workspaceId,
  sessionId,
  enabled = false,
  refreshBufferMs = DEFAULT_REFRESH_BUFFER_MS,
}: UseQrTokenOptions): UseQrTokenReturn {
  const { isAuthenticated } = useAuth();
  const [token, setToken] = useState<QrTokenInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const fetchToken = useCallback(async () => {
    if (!workspaceId || !sessionId || !isAuthenticated) {
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sessions/${sessionId}/qr-token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      // 503 means feature not configured - gracefully degrade
      if (res.status === 503) {
        setSupported(false);
        setToken(null);
        setError(null); // Not an error - just not supported
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate QR token');
      }

      const data = await res.json() as QrTokenInfo;
      setToken(data);
      setSupported(true);
      setError(null);

      // Schedule refresh before expiration
      const expiresAt = new Date(data.expiresAt).getTime();
      const now = Date.now();
      const timeUntilRefresh = Math.max(0, expiresAt - now - refreshBufferMs);
      
      clearRefreshTimer();
      refreshTimerRef.current = setTimeout(() => {
        fetchToken();
      }, timeUntilRefresh);

    } catch (err) {
      setError((err as Error).message);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, sessionId, isAuthenticated, refreshBufferMs, clearRefreshTimer]);

  // Fetch token when enabled
  useEffect(() => {
    if (enabled && workspaceId && sessionId && isAuthenticated) {
      fetchToken();
    } else {
      setToken(null);
      setError(null);
      clearRefreshTimer();
    }

    return () => {
      clearRefreshTimer();
    };
  }, [enabled, workspaceId, sessionId, isAuthenticated, fetchToken, clearRefreshTimer]);

  const getQrUrl = useCallback((): string => {
    const { protocol, hostname, port } = window.location;
    const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;
    
    if (!workspaceId || !sessionId) {
      return window.location.href.replace(/\/$/, '');
    }

    const url = `${baseUrl}/workspace/${workspaceId}/session/${sessionId}`;
    
    // If we have a token, append it to the URL
    if (token) {
      return `${url}?qr=${token.token}`;
    }
    
    return url;
  }, [workspaceId, sessionId, token]);

  return {
    token,
    loading,
    error,
    supported,
    refresh: fetchToken,
    getQrUrl,
  };
}
