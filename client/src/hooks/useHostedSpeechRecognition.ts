/**
 * Hosted-STT client hook (Deepgram) — companion to
 * {@link ./useSpeechRecognition.ts} for the Web Speech API path.
 *
 * Surface mirrors `useSpeechRecognition` so the engine-selection
 * follow-up (#410) can swap implementations without conditional-hook
 * violations. The returned object adds an `error` field carrying a
 * `fallbackEligible` flag so the wrapper can decide whether to
 * downgrade to Web Speech on a per-error basis.
 *
 * Audio path: `getUserMedia` → `AudioContext` (downsampled to 16 kHz
 * Int16 PCM) → WebSocket directly to Deepgram. The voice-relay server
 * NEVER sees audio — it only brokers short-lived Deepgram keys via
 * `POST /api/stt/token` and records minute usage via
 * `POST /api/stt/usage`.
 *
 * Issue #409 (umbrella #386). PR #402 shipped the server side.
 *
 * Design note: this hook uses `ScriptProcessorNode` rather than
 * `AudioWorkletNode` (the issue's technical-approach mentions
 * AudioWorklet). `ScriptProcessorNode` is what `useAudioStreaming`
 * already uses, works without shipping a separate worklet asset,
 * and yields equivalent 16 kHz Int16 frames over the WS. The trade-off
 * (main-thread audio processing) is acceptable for the short
 * kiosk/mobile sessions this hook serves; the deprecation is decades
 * away and the browser support matrix is wider. A future switch to
 * AudioWorklet is a drop-in replacement of `createProcessor()`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { reportClientError } from '../utils/reportClientError';

/** Default Deepgram realtime endpoint. Override via options for tests. */
const DEFAULT_DEEPGRAM_WS_URL =
  'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&diarize=true';

/** Output sample rate we send to Deepgram. */
const TARGET_SAMPLE_RATE = 16000;

/** ScriptProcessor buffer size — 4096 frames @ context rate. */
const PROCESSOR_BUFFER_SIZE = 4096;

/** Cause categories surfaced to callers (mostly used by the engine-selection wrapper). */
export type HostedSpeechRecognitionErrorCause =
  | 'token-mint'
  | 'ws-close'
  | 'ws-error'
  | 'mic-permission'
  | 'unsupported';

export interface HostedSpeechRecognitionError {
  message: string;
  /**
   * True when the engine-selection wrapper should consider downgrading
   * to Web Speech in response to this error. See the error matrix in
   * issue #409 for the per-status-code mapping.
   */
  fallbackEligible: boolean;
  /**
   * True when the engine-selection wrapper should additionally surface
   * this error to the operator via the kiosk/mobile `sttError` banner,
   * even though we're also auto-falling-back transparently. Set for the
   * "operator-actionable" cases — cap-exhausted (402) and missing-key
   * (503) — where silently downgrading would hide a billing or config
   * problem the operator needs to fix.
   *
   * This is the explicit replacement for the substring matching the
   * wrapper used to do on `message`; keeping the banner-eligibility
   * decision next to the status-code switch keeps both ends honest at
   * compile time (review feedback on PR #423).
   */
  bannerEligible?: boolean;
  cause: HostedSpeechRecognitionErrorCause;
}

export interface UseHostedSpeechRecognitionOptions {
  /**
   * Device ID the kiosk/mobile page is running as. Required — the
   * token broker uses it to look up the workspace + engine override.
   */
  deviceId: string;
  /**
   * Workspace ID, used for `POST /api/stt/usage` reporting. When
   * omitted, usage tracking is skipped — the rest of the hook still
   * works. The token-mint endpoint resolves the workspace from
   * `deviceId` server-side, so it is not strictly required for
   * minting.
   */
  workspaceId?: string;
  /**
   * Called with interim (in-progress) transcripts. `speakerLabel` is
   * `S1`, `S2`, … when Deepgram diarization yields a dominant speaker
   * for the result, `undefined` otherwise.
   */
  onInterimResult?: (text: string, speakerLabel?: string) => void;
  onFinalResult?: (text: string, speakerLabel?: string) => void;
  onError?: (error: HostedSpeechRecognitionError) => void;
  /**
   * Issue #455: optional session ID. When present (along with
   * `deviceId` + `workspaceId`), errors raised by `surfaceError` are
   * forwarded to `POST /api/client-errors` for server-side logging.
   */
  sessionId?: string;
  /** Override the Deepgram WS URL (tests, staging). */
  deepgramWsUrl?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

export interface UseHostedSpeechRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  /** Current error, cleared at the start of the next `startListening`. */
  error: HostedSpeechRecognitionError | null;
}

interface TokenMintResponse {
  engine: 'deepgram';
  token: string;
  expiresAt: number;
}

interface DeepgramWord {
  word: string;
  speaker?: number;
}

interface DeepgramAlternative {
  transcript: string;
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives?: DeepgramAlternative[];
}

interface DeepgramResultMessage {
  type?: string;
  is_final?: boolean;
  channel?: DeepgramChannel;
}

/** Pick the most frequent speaker number in a result's words, if any. */
function dominantSpeakerLabel(words: DeepgramWord[] | undefined): string | undefined {
  if (!words || words.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const w of words) {
    if (typeof w.speaker !== 'number') continue;
    counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  let best = -1;
  let bestCount = -1;
  for (const [speaker, count] of counts) {
    if (count > bestCount) {
      best = speaker;
      bestCount = count;
    }
  }
  // Deepgram speakers are zero-indexed; we surface them as S1-relative
  // so the relay/UI shows the human-readable label the design uses.
  return `S${best + 1}`;
}

/**
 * Classify a non-2xx `/api/stt/token` response as `fallback-eligible`
 * or not. Network failures upstream of an HTTP status are classified
 * by the caller (always `fallback-eligible: true`).
 */
function tokenMintErrorFromStatus(status: number, fallbackText: string): HostedSpeechRecognitionError {
  let fallbackEligible: boolean;
  // bannerEligible defaults to false; only the operator-actionable
  // cases (cap-exhausted, missing-key) flip it on so the wrapper
  // surfaces them in addition to the transparent fallback.
  let bannerEligible = false;
  let message: string;
  switch (status) {
    case 401:
      // Auth bug — falling back to Web Speech won't fix it; surface as hard error.
      fallbackEligible = false;
      message = 'Hosted STT auth failed — please re-sign in.';
      break;
    case 402:
      fallbackEligible = true;
      bannerEligible = true;
      message = 'Hosted STT monthly minute cap reached.';
      break;
    case 403:
      fallbackEligible = true;
      message = 'Hosted STT not enabled for this device.';
      break;
    case 404:
      // Misconfiguration; the wrapper has nothing better to do, but
      // dropping back to Web Speech would just confuse the operator.
      fallbackEligible = false;
      message = 'Device not registered for hosted STT.';
      break;
    case 502:
      fallbackEligible = true;
      message = 'Hosted STT upstream (Deepgram) error.';
      break;
    case 503:
      fallbackEligible = true;
      bannerEligible = true;
      message = fallbackText || 'Hosted STT temporarily unavailable.';
      break;
    default:
      // 4xx other than the above: treat as config error.
      // 5xx other than the above: treat as transient, fallback-eligible.
      fallbackEligible = status >= 500;
      message = `Hosted STT token request failed (HTTP ${status}).`;
  }
  return { message, fallbackEligible, bannerEligible, cause: 'token-mint' };
}

function detectSupport(): boolean {
  const w = window as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
    WebSocket?: unknown;
  };
  const hasAudioContext = typeof w.AudioContext === 'function' || typeof w.webkitAudioContext === 'function';
  const hasWebSocket = typeof w.WebSocket === 'function';
  const hasGetUserMedia =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
  return hasAudioContext && hasWebSocket && hasGetUserMedia;
}

/**
 * Downsample a Float32 buffer (assumed mono, sourceRate Hz) to 16 kHz
 * and convert to little-endian Int16 PCM. Returns the underlying
 * ArrayBuffer ready to send over WebSocket.
 *
 * Simple drop-sample downsample — sufficient for speech recognition
 * (Deepgram tolerates the aliasing introduced).
 */
function downsampleToInt16PCM(input: Float32Array, sourceRate: number): ArrayBuffer {
  if (sourceRate === TARGET_SAMPLE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out.buffer;
  }
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, input[srcIndex]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

export function useHostedSpeechRecognition(
  options: UseHostedSpeechRecognitionOptions,
): UseHostedSpeechRecognitionReturn {
  const {
    deviceId,
    workspaceId,
    sessionId,
    onInterimResult,
    onFinalResult,
    onError,
    deepgramWsUrl = DEFAULT_DEEPGRAM_WS_URL,
    fetchImpl,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<HostedSpeechRecognitionError | null>(null);
  // Memoise the support flag at mount; happy-dom / SSR scenarios are
  // stable for the life of the component.
  const [isSupported] = useState(detectSupport);

  // Live refs into running infrastructure. All cleared by `cleanup()`.
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // We need `gotFinalRef` so a close-after-final isn't surfaced as an error.
  const gotFinalRef = useRef(false);
  // Latest callback refs so the cleanup path doesn't capture stale closures.
  const onInterimRef = useRef(onInterimResult);
  const onFinalRef = useRef(onFinalResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onInterimRef.current = onInterimResult;
    onFinalRef.current = onFinalResult;
    onErrorRef.current = onError;
  }, [onInterimResult, onFinalResult, onError]);

  /**
   * Tear down every piece of infrastructure this hook owns. Safe to
   * call repeatedly. Reports usage on the way out as best-effort —
   * billing is a soft guardrail, not a correctness invariant.
   */
  const cleanup = useCallback(
    (opts: { reportUsage: boolean } = { reportUsage: true }) => {
      try {
        processorNodeRef.current?.disconnect();
      } catch {
        // disconnect() throws on already-disconnected nodes in some browsers; ignore.
      }
      processorNodeRef.current = null;

      try {
        sourceNodeRef.current?.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;

      const ctx = audioContextRef.current;
      audioContextRef.current = null;
      if (ctx && ctx.state !== 'closed') {
        // Closing returns a Promise; we don't await — the hook unmount
        // path can't be async, and a stuck close is harmless.
        void ctx.close().catch(() => {
          /* ignore */
        });
      }

      const stream = mediaStreamRef.current;
      mediaStreamRef.current = null;
      if (stream) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // ignore
          }
        }
      }

      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }

      const startedAt = startedAtRef.current;
      startedAtRef.current = null;
      if (opts.reportUsage && startedAt !== null && workspaceId) {
        // Round up to whole minutes. We floor at 1 because a session
        // that opened the mic at all consumed at least a fractional
        // minute and the cap is denominated in whole minutes.
        const minutes = Math.max(1, Math.ceil((Date.now() - startedAt) / 60000));
        if (minutes > 0) {
          const fetchFn = fetchImpl ?? globalThis.fetch;
          // Fire-and-forget; do NOT surface failures to the user.
          void fetchFn('/api/stt/usage', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, deviceId, minutes }),
          }).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[HostedSTT] Usage report failed (ignored):', err);
          });
        }
      }
    },
    [workspaceId, deviceId, fetchImpl],
  );

  // We need refs into the reporting-ID props so surfaceError doesn't
  // capture stale values when consumers re-render with new IDs.
  const sessionIdRef = useRef(sessionId);
  const workspaceIdRef = useRef(workspaceId);
  const deviceIdRef = useRef(deviceId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
    workspaceIdRef.current = workspaceId;
    deviceIdRef.current = deviceId;
  }, [sessionId, workspaceId, deviceId]);

  const surfaceError = useCallback((next: HostedSpeechRecognitionError) => {
    setError(next);
    setIsListening(false);
    // Issue #455: fire-and-forget diagnostic report so the server log
    // captures hosted-STT failures (token-mint 5xx, mic-permission,
    // WS close) alongside Web Speech ones.
    reportClientError({
      sessionId: sessionIdRef.current,
      workspaceId: workspaceIdRef.current,
      deviceId: deviceIdRef.current,
      source: 'useHostedSpeechRecognition',
      errorCode: next.cause,
      message: next.message,
      context: {
        fallbackEligible: next.fallbackEligible,
        bannerEligible: next.bannerEligible,
      },
    });
    try {
      onErrorRef.current?.(next);
    } catch (cbErr) {
      // eslint-disable-next-line no-console
      console.warn('[HostedSTT] onError callback threw:', cbErr);
    }
  }, []);

  const handleWsMessage = useCallback((ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return;
    let parsed: DeepgramResultMessage;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!parsed || (parsed.type && parsed.type !== 'Results')) return;
    const alt = parsed.channel?.alternatives?.[0];
    if (!alt) return;
    const transcript = (alt.transcript ?? '').trim();
    if (!transcript) return;
    const speaker = dominantSpeakerLabel(alt.words);
    if (parsed.is_final) {
      gotFinalRef.current = true;
      onFinalRef.current?.(transcript, speaker);
    } else {
      onInterimRef.current?.(transcript, speaker);
    }
  }, []);

  const startListening = useCallback(async (): Promise<void> => {
    if (!isSupported) {
      surfaceError({
        message: 'Hosted speech recognition is not supported in this browser.',
        fallbackEligible: false,
        cause: 'unsupported',
      });
      return;
    }
    // Reset error from any prior attempt before kicking off a new one.
    setError(null);
    gotFinalRef.current = false;

    // 1) Mint short-lived Deepgram token via VR server.
    let mint: TokenMintResponse;
    try {
      const fetchFn = fetchImpl ?? globalThis.fetch;
      const res = await fetchFn('/api/stt/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) {
        let serverMsg = '';
        try {
          const body = (await res.json()) as { error?: string };
          serverMsg = body?.error ?? '';
        } catch {
          /* body may not be JSON */
        }
        surfaceError(tokenMintErrorFromStatus(res.status, serverMsg));
        return;
      }
      mint = (await res.json()) as TokenMintResponse;
    } catch (err) {
      // Network failure reaching the VR server — always fallback-eligible.
      surfaceError({
        message: `Hosted STT token request failed: ${(err as Error)?.message ?? 'network error'}`,
        fallbackEligible: true,
        cause: 'token-mint',
      });
      return;
    }

    // 2) Acquire mic. Permission errors are NOT fallback-eligible —
    //    Web Speech also requires a mic, so falling back won't help.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      surfaceError({
        message: `Microphone access denied: ${(err as Error)?.message ?? 'unknown'}`,
        fallbackEligible: false,
        cause: 'mic-permission',
      });
      return;
    }
    mediaStreamRef.current = stream;

    // 3) Open WebSocket to Deepgram.
    //    Browser WebSocket clients can't set HTTP headers; per
    //    Deepgram's browser docs the token is passed via the
    //    sub-protocol field.
    let ws: WebSocket;
    try {
      ws = new WebSocket(deepgramWsUrl, ['token', mint.token]);
    } catch (err) {
      // Failure to construct the WS (e.g. invalid URL).
      cleanup({ reportUsage: false });
      surfaceError({
        message: `Failed to open hosted STT connection: ${(err as Error)?.message ?? 'unknown'}`,
        fallbackEligible: true,
        cause: 'ws-error',
      });
      return;
    }
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    // 4) Wire audio graph as soon as the WS is open. Holding off until
    //    onopen avoids buffering Int16 chunks the WS would drop anyway.
    ws.onopen = () => {
      const AC: typeof AudioContext =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
      const ctx = new AC();
      audioContextRef.current = ctx;
      const sourceRate = ctx.sampleRate;
      const sourceNode = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;
      const processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      processorNodeRef.current = processor;
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = downsampleToInt16PCM(input, sourceRate);
        wsRef.current.send(pcm);
      };
      sourceNode.connect(processor);
      // A ScriptProcessorNode must be connected to the destination
      // for onaudioprocess to fire reliably in some browsers; the
      // destination output is silent because we never write to it.
      processor.connect(ctx.destination);
      startedAtRef.current = Date.now();
      setIsListening(true);
    };

    ws.onmessage = handleWsMessage;

    ws.onerror = () => {
      // The error event itself has no useful info in browser WS.
      // Surface as fallback-eligible.
      cleanup({ reportUsage: false });
      surfaceError({
        message: 'Hosted STT connection error.',
        fallbackEligible: true,
        cause: 'ws-error',
      });
    };

    ws.onclose = (closeEvent: CloseEvent) => {
      // A clean 1000 close AFTER we received a final result is the
      // normal path (stopListening), no error.
      if (closeEvent.code === 1000 && gotFinalRef.current) {
        return;
      }
      // If we were never listening, this fires as part of a failure
      // higher up (which already surfaced an error); avoid double-firing.
      if (!startedAtRef.current) return;
      cleanup({ reportUsage: true });
      surfaceError({
        message: `Hosted STT connection closed (${closeEvent.code}).`,
        fallbackEligible: true,
        cause: 'ws-close',
      });
    };
  }, [
    isSupported,
    deviceId,
    deepgramWsUrl,
    fetchImpl,
    surfaceError,
    cleanup,
    handleWsMessage,
  ]);

  const stopListening = useCallback(() => {
    // A user-initiated stop is the "normal path"; mark as final-seen
    // so a 1000 close from Deepgram doesn't surface a spurious error.
    gotFinalRef.current = true;
    cleanup({ reportUsage: true });
    setIsListening(false);
  }, [cleanup]);

  // Unmount safety net — releases mic + WS even if the component is
  // torn down without an explicit stop.
  useEffect(() => {
    return () => {
      cleanup({ reportUsage: true });
    };
    // We intentionally only run cleanup at unmount. `cleanup` captures
    // `workspaceId`/`deviceId` via closure (its own `useCallback` deps),
    // so adding it here would re-run teardown whenever those change —
    // a spurious mid-session teardown. The empty deps array ensures
    // cleanup runs once at unmount with whatever cleanup instance was
    // current then. (This is unrelated to the callback live-ref pattern
    // around lines 263–271, which solves a different staleness problem
    // for the user-supplied callbacks.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isListening, isSupported, startListening, stopListening, error };
}
