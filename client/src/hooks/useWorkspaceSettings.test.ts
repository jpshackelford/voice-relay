import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceSettings } from './useWorkspaceSettings';

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
