/**
 * Tests for `reportClientError` (issue #455).
 *
 * The helper is fire-and-forget by contract. These tests pin every
 * acceptance-criterion invariant:
 *  - Happy path: posts the expected JSON payload + bearer header.
 *  - Silent failure when fetch rejects / 4xx / 5xx.
 *  - Silent no-op when required IDs are missing.
 *  - Silent no-op when no device token is stored for the workspace.
 *  - 2s timeout aborts the request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reportClientError } from './reportClientError';
import { storeDeviceToken, clearDeviceToken } from './deviceToken';

const WORKSPACE_ID = 'ws-abc';
const DEVICE_ID = 'device-xyz';
const SESSION_ID = 'session-123';
const DEVICE_TOKEN = 'tok-secret';

describe('reportClientError (issue #455)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    storeDeviceToken({
      deviceId: DEVICE_ID,
      deviceToken: DEVICE_TOKEN,
      workspaceId: WORKSPACE_ID,
      name: 'Test Mobile',
      mode: 'mobile',
    });
  });

  afterEach(() => {
    clearDeviceToken(WORKSPACE_ID);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('posts the expected payload to /api/client-errors on the happy path', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    reportClientError({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      source: 'useSpeechRecognition',
      errorCode: 'aborted',
      message: 'Speech recognition error',
      context: { foo: 'bar' },
    });

    // Helper is fire-and-forget; let the microtask queue drain.
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/client-errors');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${DEVICE_TOKEN}`,
    );
    expect(init.keepalive).toBe(true);
    expect(init.signal).toBeDefined();

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      source: 'useSpeechRecognition',
      errorCode: 'aborted',
      message: 'Speech recognition error',
      context: { foo: 'bar' },
    });
    expect(typeof body.userAgent).toBe('string');
  });

  it('returns void synchronously even on the happy path (no promise leak)', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const ret = reportClientError({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      source: 'useSpeechRecognition',
      message: 'msg',
    });
    expect(ret).toBeUndefined();
  });

  it('does not throw when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    expect(() =>
      reportClientError({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        deviceId: DEVICE_ID,
        source: 'useSpeechRecognition',
        message: 'msg',
      }),
    ).not.toThrow();
    // Drain microtasks so the rejected fetch is consumed by `.catch`.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('does not throw when fetch resolves with 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    expect(() =>
      reportClientError({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        deviceId: DEVICE_ID,
        source: 'useSpeechRecognition',
        message: 'msg',
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('no-ops when sessionId is missing', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    reportClientError({
      workspaceId: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      source: 'src',
      message: 'msg',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when workspaceId is missing', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    reportClientError({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      source: 'src',
      message: 'msg',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when deviceId is missing', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    reportClientError({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      source: 'src',
      message: 'msg',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when no device token is stored for the workspace', () => {
    clearDeviceToken(WORKSPACE_ID);
    localStorage.clear();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    reportClientError({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      source: 'src',
      message: 'msg',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when the stored token's deviceId doesn't match the caller's deviceId", () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    reportClientError({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      deviceId: 'a-different-device-id',
      source: 'src',
      message: 'msg',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the fetch after the 2s timeout', async () => {
    vi.useFakeTimers();
    // We need to capture the signal that fetch was called with to
    // assert it gets aborted.
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      // Return a never-resolving promise so the timer is the only
      // thing that can complete the call.
      return new Promise(() => {});
    });

    reportClientError({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      deviceId: DEVICE_ID,
      source: 'src',
      message: 'msg',
    });

    expect(capturedSignal?.aborted).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(capturedSignal?.aborted).toBe(true);
  });
});
