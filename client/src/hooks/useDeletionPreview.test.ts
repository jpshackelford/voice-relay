import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDeletionPreview } from './useDeletionPreview';

const sampleCounts = { sessions: 3, devices: 2, messages: 17, members: 4 };

function mockJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('useDeletionPreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and exposes counts for a valid workspace id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(sampleCounts));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDeletionPreview('ws-123'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.counts).toEqual(sampleCounts);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-123/deletion-preview',
      expect.objectContaining({
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('clears counts and skips fetching when workspaceId is undefined', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDeletionPreview(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.counts).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces the API error message on non-ok responses', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ error: 'forbidden' }, false)) as unknown as typeof fetch;

    const { result } = renderHook(() => useDeletionPreview('ws-err'));

    await waitFor(() => expect(result.current.error).toBe('forbidden'));
    expect(result.current.counts).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('falls back to a default message when the error body has no message', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({}, false)) as unknown as typeof fetch;

    const { result } = renderHook(() => useDeletionPreview('ws-empty-err'));

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch deletion preview'));
    expect(result.current.counts).toBeNull();
  });

  it('surfaces network errors and clears counts', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof fetch;

    const { result } = renderHook(() => useDeletionPreview('ws-net'));

    await waitFor(() => expect(result.current.error).toBe('Network down'));
    expect(result.current.counts).toBeNull();
  });

  it('refresh refetches and replaces stale data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(sampleCounts))
      .mockResolvedValueOnce(mockJsonResponse({ ...sampleCounts, messages: 99 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useDeletionPreview('ws-refresh'));
    await waitFor(() => expect(result.current.counts).toEqual(sampleCounts));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.counts?.messages).toBe(99);
  });
});
