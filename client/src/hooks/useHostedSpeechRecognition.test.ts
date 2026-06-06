/**
 * Unit tests for {@link useHostedSpeechRecognition}.
 *
 * Mirrors the FakeSpeechRecognition pattern in
 * `useSpeechRecognition.test.ts`: each unsupported browser API
 * (WebSocket, AudioContext, getUserMedia) is replaced by a
 * deterministic fake whose recent instance(s) the test can drive
 * directly.
 *
 * We mock infrastructure (the browser APIs and `fetch`), not the
 * hook's own logic — every test exercises real code paths through the
 * hook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useHostedSpeechRecognition,
  type HostedSpeechRecognitionError,
} from './useHostedSpeechRecognition';

// ---------- Fake WebSocket ----------

interface FakeCloseEvent {
  code: number;
  reason?: string;
  wasClean?: boolean;
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  sentChunks: ArrayBuffer[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: FakeCloseEvent) => void) | null = null;

  url: string;
  protocols: string | string[] | undefined;

  send = vi.fn((data: ArrayBuffer | string) => {
    if (data instanceof ArrayBuffer) this.sentChunks.push(data);
  });

  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  // Test helpers
  _open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  _message(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  _close(ev: FakeCloseEvent) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(ev);
  }
  _error() {
    this.onerror?.();
  }
}

// ---------- Fake AudioContext ----------

class FakeMediaStreamSource {
  disconnect = vi.fn();
  connect = vi.fn();
}

class FakeScriptProcessor {
  disconnect = vi.fn();
  connect = vi.fn();
  onaudioprocess: ((e: { inputBuffer: { getChannelData: (i: number) => Float32Array } }) => void) | null = null;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 16000;
  state: 'running' | 'closed' | 'suspended' = 'running';
  destination = {};
  createMediaStreamSource = vi.fn(() => new FakeMediaStreamSource());
  createScriptProcessor = vi.fn(() => new FakeScriptProcessor());
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

// ---------- Fake MediaStream ----------

function makeFakeStream(): MediaStream {
  const track = {
    stop: vi.fn(),
    kind: 'audio',
    enabled: true,
  } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

// ---------- Test scaffolding ----------

interface InstallOpts {
  withAudioContext?: boolean;
  withWebSocket?: boolean;
  withGetUserMedia?: boolean;
  getUserMediaImpl?: () => Promise<MediaStream>;
}

let originalWebSocket: unknown;
let originalAudioContext: unknown;
let originalWebkitAudioContext: unknown;
let originalMediaDevices: unknown;
let originalFetch: unknown;

function installEnvironment(opts: InstallOpts = {}) {
  const {
    withAudioContext = true,
    withWebSocket = true,
    withGetUserMedia = true,
    getUserMediaImpl,
  } = opts;

  FakeWebSocket.instances = [];
  FakeAudioContext.instances = [];

  // WebSocket
  if (withWebSocket) {
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
    (globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
  } else {
    Reflect.deleteProperty(window, 'WebSocket');
    Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'WebSocket');
  }

  // AudioContext
  if (withAudioContext) {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });
  } else {
    Reflect.deleteProperty(window, 'AudioContext');
    Reflect.deleteProperty(window, 'webkitAudioContext');
  }

  // getUserMedia
  if (withGetUserMedia) {
    const impl =
      getUserMediaImpl ?? (async () => makeFakeStream());
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia: vi.fn(impl) },
    });
  } else {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'mediaDevices');
  }
}

function setFetch(impl: typeof fetch) {
  (globalThis as unknown as Record<string, unknown>).fetch = impl;
}

beforeEach(() => {
  originalWebSocket = (window as unknown as { WebSocket?: unknown }).WebSocket;
  originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;
  originalWebkitAudioContext = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  originalMediaDevices = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
  installEnvironment();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (originalWebSocket) (window as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  if (originalAudioContext) (window as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
  if (originalWebkitAudioContext)
    (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = originalWebkitAudioContext;
  if (originalMediaDevices)
    (navigator as unknown as { mediaDevices: unknown }).mediaDevices = originalMediaDevices;
  if (originalFetch) (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------- Helpers ----------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetchToken(status = 200, body: object = {
  engine: 'deepgram',
  token: 'fake-tok',
  expiresAt: Date.now() + 60_000,
}) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/api/stt/token')) return jsonResponse(status, body);
    if (u.endsWith('/api/stt/usage')) return jsonResponse(200, { ok: true });
    return jsonResponse(404, { error: 'not mocked' });
  }) as unknown as typeof fetch;
  setFetch(fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------- Tests ----------

describe('useHostedSpeechRecognition', () => {
  describe('initial state and support detection', () => {
    it('reports supported when WebSocket, AudioContext, and getUserMedia exist', () => {
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );
      expect(result.current.isSupported).toBe(true);
      expect(result.current.isListening).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('reports unsupported when AudioContext is missing', () => {
      installEnvironment({ withAudioContext: false });
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );
      expect(result.current.isSupported).toBe(false);
    });

    it('reports unsupported when WebSocket is missing', () => {
      installEnvironment({ withWebSocket: false });
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );
      expect(result.current.isSupported).toBe(false);
    });

    it('surfaces an unsupported error from startListening when not supported', async () => {
      installEnvironment({ withAudioContext: false });
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
      expect(err.cause).toBe('unsupported');
      expect(err.fallbackEligible).toBe(false);
      expect(result.current.error?.cause).toBe('unsupported');
    });
  });

  describe('startListening cold path', () => {
    it('mints a token, opens the WS with the token sub-protocol, and toggles isListening on open', async () => {
      const fetchMock = mockFetchToken();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );

      await act(async () => {
        await result.current.startListening();
      });

      // Token endpoint hit with the deviceId
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/stt/token',
        expect.objectContaining({ method: 'POST' }),
      );
      const tokenCall = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/api/stt/token'),
      )!;
      const tokenInit = tokenCall[1] as RequestInit;
      expect(JSON.parse(tokenInit.body as string)).toEqual({ deviceId: 'dev-1' });

      // WS constructed with the token sub-protocol
      const ws = FakeWebSocket.instances[0];
      expect(ws).toBeDefined();
      expect(ws.protocols).toEqual(['token', 'fake-tok']);

      // Open the socket — isListening flips true and the audio graph
      // is wired up.
      act(() => ws._open());
      expect(result.current.isListening).toBe(true);
      expect(FakeAudioContext.instances).toHaveLength(1);
      const ctx = FakeAudioContext.instances[0];
      expect(ctx.createMediaStreamSource).toHaveBeenCalled();
      expect(ctx.createScriptProcessor).toHaveBeenCalled();
    });

    it('sends Int16 PCM chunks over the WS when the processor fires', async () => {
      mockFetchToken();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );

      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      const ctx = FakeAudioContext.instances[0];
      // The most recently returned processor is held inside the hook.
      const processor = ctx.createScriptProcessor.mock.results[0].value as FakeScriptProcessor;
      const samples = new Float32Array([0, 0.5, -0.5, 1]);
      act(() =>
        processor.onaudioprocess?.({
          inputBuffer: { getChannelData: () => samples },
        }),
      );
      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = ws.send.mock.calls[0][0] as ArrayBuffer;
      expect(sent).toBeInstanceOf(ArrayBuffer);
      // 4 samples at sample_rate=context_rate -> 4 Int16 values = 8 bytes.
      expect(sent.byteLength).toBe(8);
      const view = new Int16Array(sent);
      // Conversion (clamped): 0 -> 0, 0.5 -> 0x3FFF, -0.5 -> -0x4000, 1 -> 0x7FFF
      expect(view[0]).toBe(0);
      expect(view[1]).toBe(0x3fff);
      expect(view[2]).toBe(-0x4000);
      expect(view[3]).toBe(0x7fff);
    });
  });

  describe('Deepgram result handling', () => {
    it('routes interim and final transcripts to the matching callbacks with speaker labels', async () => {
      mockFetchToken();
      const onInterimResult = vi.fn();
      const onFinalResult = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({
          deviceId: 'dev-1',
          onInterimResult,
          onFinalResult,
        }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());

      act(() =>
        ws._message({
          type: 'Results',
          is_final: false,
          channel: {
            alternatives: [
              {
                transcript: 'hello',
                words: [
                  { word: 'hello', speaker: 0 },
                ],
              },
            ],
          },
        }),
      );
      expect(onInterimResult).toHaveBeenCalledWith('hello', 'S1');
      expect(onFinalResult).not.toHaveBeenCalled();

      act(() =>
        ws._message({
          type: 'Results',
          is_final: true,
          channel: {
            alternatives: [
              {
                transcript: 'hello world',
                // Speaker 1 dominates -> S2
                words: [
                  { word: 'hello', speaker: 0 },
                  { word: 'world', speaker: 1 },
                  { word: 'there', speaker: 1 },
                ],
              },
            ],
          },
        }),
      );
      expect(onFinalResult).toHaveBeenCalledWith('hello world', 'S2');
    });

    it('omits the speaker label when Deepgram supplies no speaker info', async () => {
      mockFetchToken();
      const onFinalResult = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onFinalResult }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());

      act(() =>
        ws._message({
          type: 'Results',
          is_final: true,
          channel: { alternatives: [{ transcript: 'no diarization' }] },
        }),
      );
      expect(onFinalResult).toHaveBeenCalledWith('no diarization', undefined);
    });

    it('ignores non-Results messages and unparseable payloads', async () => {
      mockFetchToken();
      const onFinalResult = vi.fn();
      const onInterimResult = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({
          deviceId: 'dev-1',
          onFinalResult,
          onInterimResult,
        }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());

      act(() => ws._message({ type: 'Metadata' }));
      // Bypass the JSON helper to feed raw garbage.
      act(() =>
        ws.onmessage?.({ data: 'not-json' as unknown as string }),
      );
      act(() =>
        ws._message({
          type: 'Results',
          channel: { alternatives: [{ transcript: '   ' }] },
        }),
      );
      expect(onFinalResult).not.toHaveBeenCalled();
      expect(onInterimResult).not.toHaveBeenCalled();
    });
  });

  describe('token-mint error matrix', () => {
    it.each([
      // [status, fallbackEligible, cause, bannerEligible]
      [401, false, 'token-mint', false],
      [402, true, 'token-mint', true],
      [403, true, 'token-mint', false],
      [404, false, 'token-mint', false],
      [500, true, 'token-mint', false],
      [502, true, 'token-mint', false],
      [503, true, 'token-mint', true],
    ])(
      'status %s -> fallbackEligible=%s, cause=%s, bannerEligible=%s',
      async (status, eligible, cause, bannerEligible) => {
        mockFetchToken(status as number, { error: 'mocked' });
        const onError = vi.fn();
        const { result } = renderHook(() =>
          useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
        );
        await act(async () => {
          await result.current.startListening();
        });
        expect(onError).toHaveBeenCalledTimes(1);
        const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
        expect(err.fallbackEligible).toBe(eligible);
        expect(err.cause).toBe(cause);
        expect(err.bannerEligible).toBe(bannerEligible);
        expect(result.current.error).toEqual(err);
        expect(result.current.isListening).toBe(false);
        // No WS was opened on token-mint failure.
        expect(FakeWebSocket.instances).toHaveLength(0);
      },
    );

    it('treats a 4xx not in the matrix as non-fallback-eligible', async () => {
      mockFetchToken(418, { error: 'teapot' });
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
      expect(err.fallbackEligible).toBe(false);
      expect(err.cause).toBe('token-mint');
    });

    it('treats a network failure on token-mint as fallback-eligible', async () => {
      setFetch(vi.fn(async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch);
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
      expect(err.fallbackEligible).toBe(true);
      expect(err.cause).toBe('token-mint');
    });
  });

  describe('mic permission failures', () => {
    it('surfaces getUserMedia denial as non-fallback-eligible', async () => {
      mockFetchToken();
      installEnvironment({
        getUserMediaImpl: async () => {
          throw new Error('NotAllowedError');
        },
      });
      // Token mock needs to be reapplied because installEnvironment
      // resets fetch via setFetch in some setups — but it doesn't
      // touch fetch. Just ensure it's still set.
      mockFetchToken();

      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
      expect(err.cause).toBe('mic-permission');
      expect(err.fallbackEligible).toBe(false);
    });
  });

  describe('WS lifecycle errors', () => {
    it('mid-stream WS close surfaces a fallback-eligible error', async () => {
      mockFetchToken();
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      expect(result.current.isListening).toBe(true);

      act(() => ws._close({ code: 1006, wasClean: false }));
      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
      expect(err.cause).toBe('ws-close');
      expect(err.fallbackEligible).toBe(true);
      expect(result.current.isListening).toBe(false);
    });

    it('WS error event surfaces a fallback-eligible error and tears down', async () => {
      mockFetchToken();
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1', onError }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      const ctx = FakeAudioContext.instances[0];

      act(() => ws._error());
      const err = onError.mock.calls[0][0] as HostedSpeechRecognitionError;
      expect(err.cause).toBe('ws-error');
      expect(err.fallbackEligible).toBe(true);
      expect(ctx.close).toHaveBeenCalled();
      expect(result.current.isListening).toBe(false);
    });

    it('clean WS close after a final result does NOT surface an error', async () => {
      mockFetchToken();
      const onError = vi.fn();
      const onFinalResult = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({
          deviceId: 'dev-1',
          onError,
          onFinalResult,
        }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      act(() =>
        ws._message({
          type: 'Results',
          is_final: true,
          channel: { alternatives: [{ transcript: 'done' }] },
        }),
      );
      expect(onFinalResult).toHaveBeenCalledWith('done', undefined);
      act(() => ws._close({ code: 1000, wasClean: true }));
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('stopListening and unmount cleanup', () => {
    it('stopListening closes the WS, stops the mic, and reports usage when workspaceId is set', async () => {
      const fetchMock = mockFetchToken();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({
          deviceId: 'dev-1',
          workspaceId: 'ws-1',
        }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());

      const ctx = FakeAudioContext.instances[0];
      const stream = (navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>)
        .mock.results[0].value as Promise<MediaStream>;
      const resolvedStream = await stream;
      const track = resolvedStream.getTracks()[0];

      act(() => result.current.stopListening());
      await flushMicrotasks();

      expect(ws.close).toHaveBeenCalled();
      expect(ctx.close).toHaveBeenCalled();
      expect(track.stop).toHaveBeenCalled();
      expect(result.current.isListening).toBe(false);

      // Usage report fired with the deviceId + workspaceId pair.
      const usageCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/stt/usage'),
      );
      expect(usageCalls).toHaveLength(1);
      const body = JSON.parse((usageCalls[0][1] as RequestInit).body as string) as {
        workspaceId: string;
        deviceId: string;
        minutes: number;
      };
      expect(body.workspaceId).toBe('ws-1');
      expect(body.deviceId).toBe('dev-1');
      expect(body.minutes).toBeGreaterThanOrEqual(1);
    });

    it('skips usage reporting when workspaceId is not provided', async () => {
      const fetchMock = mockFetchToken();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      act(() => result.current.stopListening());
      await flushMicrotasks();

      const usageCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/stt/usage'),
      );
      expect(usageCalls).toHaveLength(0);
    });

    it('stopListening is safe before any startListening call', () => {
      mockFetchToken();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({ deviceId: 'dev-1' }),
      );
      expect(() => act(() => result.current.stopListening())).not.toThrow();
      expect(result.current.isListening).toBe(false);
    });

    it('unmount releases the mic and WebSocket', async () => {
      mockFetchToken();
      const { result, unmount } = renderHook(() =>
        useHostedSpeechRecognition({
          deviceId: 'dev-1',
          workspaceId: 'ws-1',
        }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      const ctx = FakeAudioContext.instances[0];

      unmount();
      await flushMicrotasks();

      expect(ws.close).toHaveBeenCalled();
      expect(ctx.close).toHaveBeenCalled();
    });

    it('swallows usage-report network failures', async () => {
      // Token mock that throws on /usage but succeeds on /token.
      setFetch(
        vi.fn(async (url: string | URL) => {
          const u = String(url);
          if (u.endsWith('/api/stt/token'))
            return jsonResponse(200, {
              engine: 'deepgram',
              token: 't',
              expiresAt: Date.now() + 60_000,
            });
          throw new Error('usage network down');
        }) as unknown as typeof fetch,
      );
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useHostedSpeechRecognition({
          deviceId: 'dev-1',
          workspaceId: 'ws-1',
          onError,
        }),
      );
      await act(async () => {
        await result.current.startListening();
      });
      const ws = FakeWebSocket.instances[0];
      act(() => ws._open());
      act(() => result.current.stopListening());
      await flushMicrotasks();
      // Failure was swallowed — onError must not have fired.
      expect(onError).not.toHaveBeenCalled();
    });
  });
});
