import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface WorkspaceSettings {
  workspaceId: string;
  hasApiKey: boolean;
  ttsVoice: string | null;
  sttLanguage: string | null;
  allowAutoJoin: boolean;
  requireQrToken: boolean;
  hasElevenlabsApiKey: boolean;
  elevenlabsVoiceId: string | null;
  elevenlabsTtsEnabled: boolean;
  updatedAt: string | null;
}

export interface ApiKeyTestResult {
  valid: boolean;
  message: string;
}

export interface ElevenlabsVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

interface UseWorkspaceSettingsReturn {
  settings: WorkspaceSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSettings: (updates: Partial<Pick<WorkspaceSettings, 'ttsVoice' | 'sttLanguage' | 'allowAutoJoin' | 'requireQrToken' | 'elevenlabsVoiceId' | 'elevenlabsTtsEnabled'>>) => Promise<void>;
  setApiKey: (apiKey: string) => Promise<void>;
  testApiKey: (apiKey?: string) => Promise<ApiKeyTestResult>;
  removeApiKey: () => Promise<void>;
  setElevenlabsApiKey: (apiKey: string) => Promise<void>;
  testElevenlabsApiKey: (apiKey?: string) => Promise<ApiKeyTestResult>;
  removeElevenlabsApiKey: () => Promise<void>;
  fetchElevenlabsVoices: () => Promise<ElevenlabsVoice[]>;
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

  const setApiKey = useCallback(async (apiKey: string) => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/api-key`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to set API key');
    }

    // Refresh settings to get updated hasApiKey
    await refresh();
  }, [workspaceId, ensureValidToken, refresh]);

  const testApiKey = useCallback(async (apiKey?: string): Promise<ApiKeyTestResult> => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/api-key/test`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to test API key');
    }

    return await res.json() as ApiKeyTestResult;
  }, [workspaceId, ensureValidToken]);

  const removeApiKey = useCallback(async () => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/api-key`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok && res.status !== 204) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove API key');
    }

    // Refresh settings to get updated hasApiKey
    await refresh();
  }, [workspaceId, ensureValidToken, refresh]);

  const setElevenlabsApiKey = useCallback(async (apiKey: string) => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/elevenlabs-api-key`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to set ElevenLabs API key');
    }

    // Refresh settings to get updated hasElevenlabsApiKey
    await refresh();
  }, [workspaceId, ensureValidToken, refresh]);

  const testElevenlabsApiKey = useCallback(async (apiKey?: string): Promise<ApiKeyTestResult> => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/elevenlabs-api-key/test`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to test ElevenLabs API key');
    }

    return await res.json() as ApiKeyTestResult;
  }, [workspaceId, ensureValidToken]);

  const removeElevenlabsApiKey = useCallback(async () => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/elevenlabs-api-key`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok && res.status !== 204) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove ElevenLabs API key');
    }

    // Refresh settings to get updated hasElevenlabsApiKey
    await refresh();
  }, [workspaceId, ensureValidToken, refresh]);

  const fetchElevenlabsVoices = useCallback(async (): Promise<ElevenlabsVoice[]> => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/elevenlabs-voices`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to fetch ElevenLabs voices');
    }

    const data = await res.json();
    return data.voices as ElevenlabsVoice[];
  }, [workspaceId, ensureValidToken]);

  return {
    settings,
    loading,
    error,
    refresh,
    updateSettings,
    setApiKey,
    testApiKey,
    removeApiKey,
    setElevenlabsApiKey,
    testElevenlabsApiKey,
    removeElevenlabsApiKey,
    fetchElevenlabsVoices,
  };
}
