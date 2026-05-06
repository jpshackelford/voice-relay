import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface WorkspaceSettings {
  workspaceId: string;
  hasApiKey: boolean;
  ttsVoice: string | null;
  sttLanguage: string | null;
  allowAutoJoin: boolean;
  requireQrToken: boolean;
  updatedAt: string | null;
}

interface UseWorkspaceSettingsReturn {
  settings: WorkspaceSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSettings: (updates: Partial<Pick<WorkspaceSettings, 'ttsVoice' | 'sttLanguage' | 'allowAutoJoin' | 'requireQrToken'>>) => Promise<void>;
}

/**
 * Hook for fetching and updating workspace settings.
 * Only owners can access settings - non-owners will get 403.
 */
export function useWorkspaceSettings(
  workspaceId: string | undefined,
  isOwner: boolean = false
): UseWorkspaceSettingsReturn {
  const { isAuthenticated, ensureValidToken } = useAuth();
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Only fetch if authenticated and owner
    if (!isAuthenticated || !workspaceId || !isOwner) {
      setSettings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await ensureValidToken?.();
      
      const res = await fetch(`/api/workspaces/${workspaceId}/settings`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 403) {
        // Not owner - this is expected for non-owners
        setSettings(null);
        setError(null);
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to fetch settings');
      }

      const data = await res.json();
      setSettings(data as WorkspaceSettings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, workspaceId, isOwner, ensureValidToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateSettings = useCallback(async (
    updates: Partial<Pick<WorkspaceSettings, 'ttsVoice' | 'sttLanguage' | 'allowAutoJoin' | 'requireQrToken'>>
  ) => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update settings');
    }

    const data = await res.json();
    setSettings(data as WorkspaceSettings);
  }, [workspaceId, ensureValidToken]);

  return {
    settings,
    loading,
    error,
    refresh,
    updateSettings,
  };
}
