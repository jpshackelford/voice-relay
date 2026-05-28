import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useKioskConfig } from './useKioskConfig';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('useKioskConfig (issue #340)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch when workspaceId is undefined', async () => {
    const { result } = renderHook(() => useKioskConfig(undefined));
    // Give the effect a tick.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.config).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches and exposes config when workspaceId is set', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ workspaceId: 'ws-1', kioskFooterTickersEnabled: true })
    );
    const { result } = renderHook(() => useKioskConfig('ws-1'));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/kiosk-config',
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.current.config?.kioskFooterTickersEnabled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports an error and keeps prior config on failed fetch', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ workspaceId: 'ws-1', kioskFooterTickersEnabled: false })
    );
    const { result } = renderHook(() => useKioskConfig('ws-1'));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    fetchSpy.mockResolvedValueOnce(jsonResponse({}, false, 503));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toMatch(/HTTP 503/);
    // Prior config is intentionally retained for transient failures.
    expect(result.current.config?.workspaceId).toBe('ws-1');
  });

  it('refetches when workspaceId changes', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ workspaceId: 'ws-1', kioskFooterTickersEnabled: false })
    );
    const { result, rerender } = renderHook(({ id }) => useKioskConfig(id), {
      initialProps: { id: 'ws-1' as string | undefined },
    });
    await waitFor(() => expect(result.current.config?.workspaceId).toBe('ws-1'));

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ workspaceId: 'ws-2', kioskFooterTickersEnabled: true })
    );
    rerender({ id: 'ws-2' });
    await waitFor(() => expect(result.current.config?.workspaceId).toBe('ws-2'));
    expect(result.current.config?.kioskFooterTickersEnabled).toBe(true);
  });
});
