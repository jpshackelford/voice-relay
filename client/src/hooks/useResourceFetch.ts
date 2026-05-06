import { useState, useEffect, useCallback } from 'react';
import { getUserFriendlyMessage } from '../utils/errors';

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
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for fetching resources with standardized error handling.
 * Reduces duplication across workspace/session/device fetch patterns.
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
        } else if (res.status === 404) {
          setError(notFoundMessage);
        } else if (res.status === 403) {
          setError(forbiddenMessage);
        } else if (res.status === 401) {
          setError('Session expired. Please log in again.');
        } else {
          const errorData = await res.json().catch(() => null);
          setError(getUserFriendlyMessage(errorData || failurePrefix));
        }
      } catch (err) {
        if (cancelled) return;
        console.error(`${failurePrefix}:`, err);
        setError(getUserFriendlyMessage(err as Error));
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

  return { data, loading, error, refetch };
}
