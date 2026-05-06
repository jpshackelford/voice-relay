import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkspaceSettings } from './useWorkspaceSettings';

// Mock useAuth hook with unauthenticated state for synchronous tests
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ 
    isAuthenticated: false, // Start unauthenticated for predictable sync behavior
    ensureValidToken: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('useWorkspaceSettings hook - synchronous behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
