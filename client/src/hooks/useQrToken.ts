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
  /** Maximum number of retry attempts on failure (default: 3) */
  maxRetries?: number;
  /** Base retry delay in ms (default: 5000). Actual delay = baseRetryDelayMs * 2^retryCount */
  baseRetryDelayMs?: number;
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
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_RETRY_DELAY_MS = 30000; // 30 seconds cap

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
  maxRetries = DEFAULT_MAX_RETRIES,
  baseRetryDelayMs = DEFAULT_BASE_RETRY_DELAY_MS,
}: UseQrTokenOptions): UseQrTokenReturn {
  const { isAuthenticated } = useAuth();
  const [token, setToken] = useState<QrTokenInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

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

      // 503 indicates the QR token feature is not configured on the server
      // (e.g., requireQrToken is disabled for this workspace).
      // This is not a hard error - we gracefully degrade by marking the feature
      // as unsupported while keeping error=null so the UI can fall back to
      // unsigned URLs without showing error states.
      if (res.status === 503) {
        setSupported(false);
        setToken(null);
        setError(null);
        retryCountRef.current = 0; // Reset retry count on 503 (not a transient error)
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
      retryCountRef.current = 0; // Reset retry count on success

      // Schedule refresh before expiration
      const expiresAt = new Date(data.expiresAt).getTime();
      const now = Date.now();
      const timeUntilRefresh = Math.max(0, expiresAt - now - refreshBufferMs);
      
      clearRefreshTimer();
      refreshTimerRef.current = setTimeout(() => {
        fetchToken();
      }, timeUntilRefresh);

    } catch (err) {
      const errorMessage = (err as Error).message;
      setError(errorMessage);
      
      // Schedule retry with exponential backoff if we haven't exceeded max retries
      // Don't clear the existing token on retry - preserve the last good token
      if (retryCountRef.current < maxRetries) {
        const retryDelay = Math.min(
          baseRetryDelayMs * Math.pow(2, retryCountRef.current),
          MAX_RETRY_DELAY_MS
        );
        retryCountRef.current++;
        
        console.log(`[useQrToken] Retry ${retryCountRef.current}/${maxRetries} in ${retryDelay}ms`);
        
        clearRefreshTimer();
        refreshTimerRef.current = setTimeout(() => {
          setError(null); // Clear error before retry
          fetchToken();
        }, retryDelay);
      } else {
        // Max retries exceeded - clear token and give up
        console.log('[useQrToken] Max retries exceeded, giving up');
        setToken(null);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, sessionId, isAuthenticated, refreshBufferMs, maxRetries, baseRetryDelayMs, clearRefreshTimer]);

  // Fetch token when enabled
  useEffect(() => {
    if (enabled && workspaceId && sessionId && isAuthenticated) {
      retryCountRef.current = 0; // Reset retry count when re-enabling
      fetchToken();
    } else {
      setToken(null);
      setError(null);
      clearRefreshTimer();
      retryCountRef.current = 0;
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
