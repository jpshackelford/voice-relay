import { useState, useEffect, useCallback } from 'react';
import { getUserFriendlyMessage } from '../utils/errors';

/** Error types for structured error handling */
export type ResourceErrorType = 'NOT_FOUND' | 'ACCESS_DENIED' | 'UNAUTHORIZED' | 'NETWORK' | 'UNKNOWN';

/** Structured error information from fetch */
export interface ResourceError {
  type: ResourceErrorType;
  message: string;
  status?: number;
}

interface ResourceFetchOptions<T> {
  /** URL to fetch from */
  url: string | null;
  /** Function to extract data from successful response */
  extractData?: (data: unknown) => T;
  /** Custom 404 error message */
  notFoundMessage?: string;
  /** Custom 403 error message */
  forbiddenMessage?: string;
  /** Generic failure message prefix */
  failurePrefix?: string;
  /** Function to call before fetch to ensure auth is valid */
  ensureAuth?: () => Promise<unknown>;
  /** Condition to enable fetching (defaults to true when url is present) */
  enabled?: boolean;
}

interface ResourceFetchResult<T> {
  data: T | null;
  loading: boolean;
  /** User-friendly error message (for display) */
  error: string | null;
  /** Structured error info (for programmatic checks) */
  errorInfo: ResourceError | null;
  refetch: () => void;
}

/**
 * Generic hook for fetching resources with standardized error handling.
 * Reduces duplication across workspace/session/device fetch patterns.
 * 
 * Returns both a user-friendly error message (for display) and structured
 * error info (for programmatic checks like auto-join triggering).
 */
export function useResourceFetch<T>({
  url,
  extractData = (d) => d as T,
  notFoundMessage = 'Resource not found',
  forbiddenMessage = 'You do not have access to this resource',
  failurePrefix = 'Failed to load resource',
  ensureAuth,
  enabled = true,
}: ResourceFetchOptions<T>): ResourceFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<ResourceError | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setFetchTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchResource() {
      if (!url || !enabled) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setErrorInfo(null);

      try {
        if (ensureAuth) {
          await ensureAuth();
        }

        const res = await fetch(url, { credentials: 'include' });

        if (cancelled) return;

        if (res.ok) {
          const json = await res.json();
          setData(extractData(json));
          setError(null);
          setErrorInfo(null);
        } else if (res.status === 404) {
          setError(notFoundMessage);
          setErrorInfo({ type: 'NOT_FOUND', message: notFoundMessage, status: 404 });
        } else if (res.status === 403) {
          setError(forbiddenMessage);
          setErrorInfo({ type: 'ACCESS_DENIED', message: forbiddenMessage, status: 403 });
        } else if (res.status === 401) {
          const msg = 'Session expired. Please log in again.';
          setError(msg);
          setErrorInfo({ type: 'UNAUTHORIZED', message: msg, status: 401 });
        } else {
          const errorData = await res.json().catch(() => null);
          const msg = getUserFriendlyMessage(errorData || failurePrefix);
          setError(msg);
          setErrorInfo({ type: 'UNKNOWN', message: msg, status: res.status });
        }
      } catch (err) {
        if (cancelled) return;
        console.error(`${failurePrefix}:`, err);
        const msg = getUserFriendlyMessage(err as Error);
        setError(msg);
        setErrorInfo({ type: 'NETWORK', message: msg });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchResource();

    return () => {
      cancelled = true;
    };
  }, [url, enabled, ensureAuth, extractData, notFoundMessage, forbiddenMessage, failurePrefix, fetchTrigger]);

  return { data, loading, error, errorInfo, refetch };
}
