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
  /**
   * Whether the kiosk display shows the new footer ticker strips
   * (transcription + AI action). See issue #340.
   */
  kioskFooterTickersEnabled: boolean;
  /**
   * Hosted-STT engine selection. See issues #386 / #412.
   * `'web-speech'` uses the browser's built-in Web Speech API (no usage).
   * `'deepgram'` routes audio through Deepgram via the workspace's key.
   */
  sttEngine: 'web-speech' | 'deepgram';
  /**
   * Monthly cap for Deepgram-routed minutes. `null` means "no cap".
   * Only meaningful when `sttEngine === 'deepgram'`.
   */
  sttMonthlyMinuteCap: number | null;
  /**
   * Whether a Deepgram API key has been configured for the workspace.
   * The key itself is never returned by the server; this is the
   * mask-aware boolean read of presence.
   */
  hasDeepgramApiKey: boolean;
  updatedAt: string | null;
}

/**
 * Current-month STT usage snapshot as reported by
 * `GET /api/stt/usage?workspaceId=...`. Used to render the
 * "Used X / Y minutes" row in the workspace settings UI (issue #412).
 */
export interface SttUsage {
  workspaceId: string;
  minutesUsedThisMonth: number;
  cap: number | null;
  engine: 'web-speech' | 'deepgram';
}

export interface ApiKeyTestResult {
  valid: boolean;
  message: string;
}

export interface ElevenlabsVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export interface VoicePreviewResult {
  audio: string; // base64 MP3
}

interface UseWorkspaceSettingsReturn {
  settings: WorkspaceSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSettings: (updates: Partial<Pick<WorkspaceSettings, 'ttsVoice' | 'sttLanguage' | 'allowAutoJoin' | 'requireQrToken' | 'elevenlabsVoiceId' | 'elevenlabsTtsEnabled' | 'kioskFooterTickersEnabled' | 'sttEngine' | 'sttMonthlyMinuteCap'>>) => Promise<void>;
  setApiKey: (apiKey: string) => Promise<void>;
  testApiKey: (apiKey?: string) => Promise<ApiKeyTestResult>;
  removeApiKey: () => Promise<void>;
  setElevenlabsApiKey: (apiKey: string) => Promise<void>;
  testElevenlabsApiKey: (apiKey?: string) => Promise<ApiKeyTestResult>;
  removeElevenlabsApiKey: () => Promise<void>;
  fetchElevenlabsVoices: () => Promise<ElevenlabsVoice[]>;
  generateVoicePreview: (voiceId: string) => Promise<VoicePreviewResult>;
  /**
   * Set / replace the workspace's Deepgram API key (PUT). The plaintext
   * key is sent once and never returned by subsequent reads (mask-aware
   * pattern; see `hasDeepgramApiKey`).
   */
  setDeepgramApiKey: (apiKey: string) => Promise<void>;
  /**
   * Clear the workspace's Deepgram API key (DELETE). Server-side this
   * also resets `sttEngine` back to `'web-speech'`.
   */
  removeDeepgramApiKey: () => Promise<void>;
  /**
   * Read the current-month STT usage snapshot from `/api/stt/usage`.
   * Used for the "Used X / Y minutes" row in the settings UI.
   */
  fetchSttUsage: () => Promise<SttUsage>;
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
    updates: Partial<Pick<WorkspaceSettings, 'ttsVoice' | 'sttLanguage' | 'allowAutoJoin' | 'requireQrToken' | 'elevenlabsVoiceId' | 'elevenlabsTtsEnabled' | 'kioskFooterTickersEnabled' | 'sttEngine' | 'sttMonthlyMinuteCap'>>
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

  const generateVoicePreview = useCallback(async (voiceId: string): Promise<VoicePreviewResult> => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/voice-preview`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to generate voice preview');
    }

    return await res.json() as VoicePreviewResult;
  }, [workspaceId, ensureValidToken]);

  // Set Deepgram API key and refresh to update hasDeepgramApiKey flag
  const setDeepgramApiKey = useCallback(async (apiKey: string) => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/deepgram-api-key`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to set Deepgram API key');
    }

    await refresh();
  }, [workspaceId, ensureValidToken, refresh]);

  const removeDeepgramApiKey = useCallback(async () => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/workspaces/${workspaceId}/settings/deepgram-api-key`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok && res.status !== 204) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove Deepgram API key');
    }

    await refresh();
  }, [workspaceId, ensureValidToken, refresh]);

  // Issue #412: current-month usage snapshot. Note the endpoint lives on
  // /api/stt/ rather than under /api/workspaces — it takes workspaceId
  // as a query param.
  const fetchSttUsage = useCallback(async (): Promise<SttUsage> => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await ensureValidToken?.();

    const res = await fetch(`/api/stt/usage?workspaceId=${encodeURIComponent(workspaceId)}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to fetch STT usage');
    }

    return await res.json() as SttUsage;
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
    generateVoicePreview,
    setDeepgramApiKey,
    removeDeepgramApiKey,
    fetchSttUsage,
  };
}
