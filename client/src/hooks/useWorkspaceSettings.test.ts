import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceSettings, type ElevenlabsVoice } from './useWorkspaceSettings';

// Create a mutable mock state that can be changed per test
let mockAuthState = {
  isAuthenticated: false,
  ensureValidToken: vi.fn().mockResolvedValue(undefined),
};

// Mock useAuth hook
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

describe('useWorkspaceSettings hook - synchronous behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset to unauthenticated state for sync tests
    mockAuthState = {
      isAuthenticated: false,
      ensureValidToken: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null settings when workspaceId is undefined', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings(undefined, true)
    );

    expect(result.current.settings).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns null settings when not owner', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', false)
    );

    expect(result.current.settings).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch settings when not authenticated', () => {
    global.fetch = vi.fn();
    
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    // Should not start loading because isAuthenticated is false
    expect(result.current.loading).toBe(false);
    expect(result.current.settings).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('provides refresh function', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    expect(typeof result.current.refresh).toBe('function');
  });

  it('provides updateSettings function', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    expect(typeof result.current.updateSettings).toBe('function');
  });
});

describe('useWorkspaceSettings hook - async behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Set authenticated state for async tests
    mockAuthState = {
      isAuthenticated: true,
      ensureValidToken: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches settings successfully when authenticated and owner', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSettings,
    });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.settings).toEqual(mockSettings);
    expect(result.current.error).toBeNull();
    expect(mockAuthState.ensureValidToken).toHaveBeenCalled();
  });

  it('handles 403 response gracefully for non-owners', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // 403 should set settings=null but error=null (graceful handling for non-owners)
    expect(result.current.settings).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('handles fetch failure with error state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.settings).toBeNull();
    expect(result.current.error).toBe('Failed to fetch settings');
  });

  it('handles network errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.settings).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('updates settings successfully via updateSettings()', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      ttsVoice: null,
      sttLanguage: 'en-US',
      allowAutoJoin: true,
      requireQrToken: false,
      updatedAt: new Date().toISOString(),
    };

    const updatedSettings = {
      ...mockSettings,
      requireQrToken: true,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    // Update settings
    await act(async () => {
      await result.current.updateSettings({ requireQrToken: true });
    });

    expect(result.current.settings).toEqual(updatedSettings);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/workspaces/ws1/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ requireQrToken: true }),
      })
    );
  });

  it('handles updateSettings failure with error', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid settings' }),
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    // Update should throw
    await expect(
      result.current.updateSettings({ requireQrToken: true })
    ).rejects.toThrow('Invalid settings');
  });

  it('throws error when updateSettings called without workspaceId', async () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings(undefined, true)
    );

    await expect(
      result.current.updateSettings({ requireQrToken: true })
    ).rejects.toThrow('No workspace selected');
  });

  it('calls ensureValidToken before API requests', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSettings,
    });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // ensureValidToken should be called on initial fetch
    expect(mockAuthState.ensureValidToken).toHaveBeenCalled();

    // Reset mock to verify it's called again on update
    mockAuthState.ensureValidToken.mockClear();

    await act(async () => {
      await result.current.updateSettings({ allowAutoJoin: false });
    });

    // ensureValidToken should be called again before update
    expect(mockAuthState.ensureValidToken).toHaveBeenCalled();
  });

  it('refresh function re-fetches settings', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      updatedAt: new Date().toISOString(),
    };

    const refreshedSettings = {
      ...mockSettings,
      hasApiKey: true,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => refreshedSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    // Manually refresh
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.settings).toEqual(refreshedSettings);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('useWorkspaceSettings hook - ElevenLabs API key operations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthState = {
      isAuthenticated: true,
      ensureValidToken: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides setElevenlabsApiKey function', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );
    expect(typeof result.current.setElevenlabsApiKey).toBe('function');
  });

  it('provides testElevenlabsApiKey function', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );
    expect(typeof result.current.testElevenlabsApiKey).toBe('function');
  });

  it('provides removeElevenlabsApiKey function', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );
    expect(typeof result.current.removeElevenlabsApiKey).toBe('function');
  });

  it('provides fetchElevenlabsVoices function', () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );
    expect(typeof result.current.fetchElevenlabsVoices).toBe('function');
  });

  it('setElevenlabsApiKey calls correct endpoint and refreshes settings', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const updatedSettings = {
      ...mockSettings,
      hasElevenlabsApiKey: true,
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    await act(async () => {
      await result.current.setElevenlabsApiKey('test-api-key');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws1/settings/elevenlabs-api-key',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'test-api-key' }),
      })
    );
  });

  it('testElevenlabsApiKey calls correct endpoint with provided key', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const testResult = { valid: true, message: 'API key is valid' };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => testResult,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let response;
    await act(async () => {
      response = await result.current.testElevenlabsApiKey('test-api-key');
    });

    expect(response).toEqual(testResult);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws1/settings/elevenlabs-api-key/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ apiKey: 'test-api-key' }),
      })
    );
  });

  it('testElevenlabsApiKey calls correct endpoint without key to test stored key', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const testResult = { valid: true, message: 'Stored API key is valid' };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => testResult,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let response;
    await act(async () => {
      response = await result.current.testElevenlabsApiKey();
    });

    expect(response).toEqual(testResult);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws1/settings/elevenlabs-api-key/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
  });

  it('removeElevenlabsApiKey calls correct endpoint', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-id',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    const updatedSettings = {
      ...mockSettings,
      hasElevenlabsApiKey: false,
      elevenlabsTtsEnabled: false,
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    await act(async () => {
      await result.current.removeElevenlabsApiKey();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws1/settings/elevenlabs-api-key',
      expect.objectContaining({
        method: 'DELETE',
      })
    );
  });

  it('fetchElevenlabsVoices returns voices array', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const mockVoices = {
      voices: [
        { voice_id: 'voice1', name: 'Aria' },
        { voice_id: 'voice2', name: 'Josh' },
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockVoices,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let voices;
    await act(async () => {
      voices = await result.current.fetchElevenlabsVoices();
    });

    expect(voices).toEqual(mockVoices.voices);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws1/settings/elevenlabs-voices',
      expect.objectContaining({
        credentials: 'include',
      })
    );
  });

  it('throws error when ElevenLabs operations called without workspaceId', async () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings(undefined, true)
    );

    await expect(
      result.current.setElevenlabsApiKey('test-key')
    ).rejects.toThrow('No workspace selected');

    await expect(
      result.current.testElevenlabsApiKey('test-key')
    ).rejects.toThrow('No workspace selected');

    await expect(
      result.current.removeElevenlabsApiKey()
    ).rejects.toThrow('No workspace selected');

    await expect(
      result.current.fetchElevenlabsVoices()
    ).rejects.toThrow('No workspace selected');
  });
});

describe('useWorkspaceSettings - integration behavior tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthState = {
      isAuthenticated: true,
      ensureValidToken: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchElevenlabsVoices parses voice response correctly with all fields', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const mockVoicesResponse = {
      voices: [
        { voice_id: 'v1', name: 'Voice One', labels: { accent: 'american', age: 'young' } },
        { voice_id: 'v2', name: 'Voice Two', labels: { accent: 'british' } },
        { voice_id: 'v3', name: 'Voice Three' },
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockVoicesResponse,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let voices: ElevenlabsVoice[] | undefined;
    await act(async () => {
      voices = await result.current.fetchElevenlabsVoices();
    });

    // Verify all voices are parsed correctly
    expect(voices).toBeDefined();
    expect(voices!).toHaveLength(3);
    expect(voices![0]).toEqual({ voice_id: 'v1', name: 'Voice One', labels: { accent: 'american', age: 'young' } });
    expect(voices![1]).toEqual({ voice_id: 'v2', name: 'Voice Two', labels: { accent: 'british' } });
    expect(voices![2]).toEqual({ voice_id: 'v3', name: 'Voice Three' });
    
    // Verify specific field access works
    expect(voices![0].voice_id).toBe('v1');
    expect(voices![0].name).toBe('Voice One');
    expect(voices![0].labels?.accent).toBe('american');
  });

  it('fetchElevenlabsVoices parses preview_url when present', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const mockVoicesResponse = {
      voices: [
        { voice_id: 'v1', name: 'Voice One', preview_url: 'https://example.com/voice1.mp3' },
        { voice_id: 'v2', name: 'Voice Two', preview_url: 'https://example.com/voice2.mp3' },
        { voice_id: 'v3', name: 'Voice Three' }, // No preview_url
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockVoicesResponse,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let voices: ElevenlabsVoice[] | undefined;
    await act(async () => {
      voices = await result.current.fetchElevenlabsVoices();
    });

    // Verify preview_url is parsed correctly
    expect(voices).toBeDefined();
    expect(voices!).toHaveLength(3);
    expect(voices![0].preview_url).toBe('https://example.com/voice1.mp3');
    expect(voices![1].preview_url).toBe('https://example.com/voice2.mp3');
    expect(voices![2].preview_url).toBeUndefined();
  });

  it('fetchElevenlabsVoices handles empty voices array', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ voices: [] }),
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let voices: ElevenlabsVoice[] | undefined;
    await act(async () => {
      voices = await result.current.fetchElevenlabsVoices();
    });

    expect(voices).toBeDefined();
    expect(voices).toEqual([]);
    expect(voices!.length).toBe(0);
  });

  it('updateSettings correctly updates state after voice change', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'original-voice-id',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    const updatedSettings = {
      ...mockSettings,
      elevenlabsVoiceId: 'new-voice-id',
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings?.elevenlabsVoiceId).toBe('original-voice-id');
    });

    await act(async () => {
      await result.current.updateSettings({ elevenlabsVoiceId: 'new-voice-id' });
    });

    // Verify state is updated with new voice ID
    expect(result.current.settings?.elevenlabsVoiceId).toBe('new-voice-id');
    expect(result.current.settings?.elevenlabsTtsEnabled).toBe(true);
  });

  it('updateSettings correctly toggles TTS enabled state', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-id',
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const enabledSettings = {
      ...mockSettings,
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => enabledSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings?.elevenlabsTtsEnabled).toBe(false);
    });

    await act(async () => {
      await result.current.updateSettings({ elevenlabsTtsEnabled: true });
    });

    // Verify TTS is now enabled in state
    expect(result.current.settings?.elevenlabsTtsEnabled).toBe(true);
  });

  it('testElevenlabsApiKey returns valid result and can be used in conditionals', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const validResult = { valid: true, message: 'API key is valid and working' };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => validResult,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let testResult: { valid: boolean; message: string } | undefined;
    await act(async () => {
      testResult = await result.current.testElevenlabsApiKey('test-key');
    });

    // Verify result can be used in real code conditions
    expect(testResult).toBeDefined();
    expect(testResult!.valid).toBe(true);
    expect(testResult!.message).toBe('API key is valid and working');
    
    // Test conditional usage pattern
    if (testResult!.valid) {
      expect(testResult!.message).toContain('valid');
    }
  });

  it('testElevenlabsApiKey handles invalid key response correctly', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const invalidResult = { valid: false, message: 'Invalid API key' };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidResult,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let testResult: { valid: boolean; message: string } | undefined;
    await act(async () => {
      testResult = await result.current.testElevenlabsApiKey('bad-key');
    });

    expect(testResult).toBeDefined();
    expect(testResult!.valid).toBe(false);
    expect(testResult!.message).toBe('Invalid API key');
  });

  it('setElevenlabsApiKey updates hasElevenlabsApiKey state after success', async () => {
    const initialSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: false,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    const configuredSettings = {
      ...initialSettings,
      hasElevenlabsApiKey: true,
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => initialSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => configuredSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings?.hasElevenlabsApiKey).toBe(false);
    });

    await act(async () => {
      await result.current.setElevenlabsApiKey('new-api-key');
    });

    // Verify state reflects the new API key being configured
    expect(result.current.settings?.hasElevenlabsApiKey).toBe(true);
  });

  it('removeElevenlabsApiKey clears hasElevenlabsApiKey state', async () => {
    const configuredSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-id',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    const clearedSettings = {
      ...configuredSettings,
      hasElevenlabsApiKey: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => configuredSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => clearedSettings,
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings?.hasElevenlabsApiKey).toBe(true);
      expect(result.current.settings?.elevenlabsVoiceId).toBe('voice-id');
    });

    await act(async () => {
      await result.current.removeElevenlabsApiKey();
    });

    // Verify state is cleared
    expect(result.current.settings?.hasElevenlabsApiKey).toBe(false);
    expect(result.current.settings?.elevenlabsVoiceId).toBeNull();
    expect(result.current.settings?.elevenlabsTtsEnabled).toBe(false);
  });

  it('fetchElevenlabsVoices throws on API error with meaningful message', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: null,
      elevenlabsTtsEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'ElevenLabs API key is invalid' }),
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    await expect(
      result.current.fetchElevenlabsVoices()
    ).rejects.toThrow('ElevenLabs API key is invalid');
  });

  it('multiple sequential voice changes maintain correct state', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-1',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    let currentVoiceId = 'voice-1';
    
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body);
        currentVoiceId = body.elevenlabsVoiceId;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...mockSettings,
            elevenlabsVoiceId: currentVoiceId,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...mockSettings,
          elevenlabsVoiceId: currentVoiceId,
        }),
      };
    });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings?.elevenlabsVoiceId).toBe('voice-1');
    });

    // First voice change
    await act(async () => {
      await result.current.updateSettings({ elevenlabsVoiceId: 'voice-2' });
    });
    expect(result.current.settings?.elevenlabsVoiceId).toBe('voice-2');

    // Second voice change
    await act(async () => {
      await result.current.updateSettings({ elevenlabsVoiceId: 'voice-3' });
    });
    expect(result.current.settings?.elevenlabsVoiceId).toBe('voice-3');

    // Change back
    await act(async () => {
      await result.current.updateSettings({ elevenlabsVoiceId: 'voice-1' });
    });
    expect(result.current.settings?.elevenlabsVoiceId).toBe('voice-1');
  });

  it('generateVoicePreview returns audio base64 on success', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-id',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    const mockAudio = 'SGVsbG8gV29ybGQ='; // base64 "Hello World"

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ audio: mockAudio }),
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    let previewResult: { audio: string } | undefined;
    await act(async () => {
      previewResult = await result.current.generateVoicePreview('test-voice-id');
    });

    expect(previewResult).toBeDefined();
    expect(previewResult!.audio).toBe(mockAudio);
    
    // Verify the API was called correctly
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/workspaces/ws1/settings/voice-preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ voiceId: 'test-voice-id' }),
      })
    );
  });

  it('generateVoicePreview throws on API error', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-id',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Failed to generate voice preview' }),
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    await expect(
      result.current.generateVoicePreview('test-voice-id')
    ).rejects.toThrow('Failed to generate voice preview');
  });

  it('generateVoicePreview throws when workspaceId is undefined', async () => {
    const { result } = renderHook(() => 
      useWorkspaceSettings(undefined, true)
    );

    await expect(
      result.current.generateVoicePreview('test-voice-id')
    ).rejects.toThrow('No workspace selected');
  });

  it('generateVoicePreview handles timeout error', async () => {
    const mockSettings = {
      workspaceId: 'ws1',
      hasApiKey: false,
      hasElevenlabsApiKey: true,
      ttsVoice: null,
      sttLanguage: null,
      allowAutoJoin: true,
      requireQrToken: false,
      elevenlabsVoiceId: 'voice-id',
      elevenlabsTtsEnabled: true,
      updatedAt: new Date().toISOString(),
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSettings,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({ error: 'Voice synthesis timed out' }),
      });

    const { result } = renderHook(() => 
      useWorkspaceSettings('ws1', true)
    );

    await waitFor(() => {
      expect(result.current.settings).toEqual(mockSettings);
    });

    await expect(
      result.current.generateVoicePreview('test-voice-id')
    ).rejects.toThrow('Voice synthesis timed out');
  });
});
