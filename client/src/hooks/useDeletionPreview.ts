import { useState, useEffect, useCallback } from 'react';

export interface DeletionCounts {
  sessions: number;
  devices: number;
  messages: number;
  members: number;
}

interface UseDeletionPreviewReturn {
  counts: DeletionCounts | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDeletionPreview(workspaceId: string | undefined): UseDeletionPreviewReturn {
  const [counts, setCounts] = useState<DeletionCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setCounts(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/deletion-preview`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch deletion preview');
      }

      const data = await res.json();
      setCounts(data);
    } catch (err) {
      setError((err as Error).message);
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    counts,
    loading,
    error,
    refresh,
  };
}
