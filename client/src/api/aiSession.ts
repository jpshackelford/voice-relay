/**
 * Typed client for the session AI control surface introduced in issue #294.
 *
 * Currently a single endpoint:
 *
 *     POST /api/sessions/:sessionId/ai/restart
 *
 * which drains any in-flight upstream turns and rebinds the agent session.
 * The kiosk wires this to the "Restart agent" button surfaced when the
 * AI indicator is in a degraded state.
 *
 * The legacy `session-ai-status` WS message shape will continue to drive
 * indicator updates until #295 lands the unified `session-state` message;
 * this helper just returns the synchronous body so the caller can decide
 * how to surface inline errors.
 */

/**
 * AI session lifecycle states returned by the driver. Mirrors
 * `server/src/agent-driver/types.ts` (kept narrow on purpose — the client
 * only branches on the strings it actually needs).
 */
export type AISessionState =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'thinking'
  | 'reconnecting'
  | 'degraded';

/** Response body shape for a successful restart. Mirrors `AgentSessionStatus`. */
export interface AISessionStatus {
  sessionId: string;
  state: AISessionState;
  conversationId: string | null;
  error: string | null;
  thinkingSince: string | null;
  startingSince: string | null;
  startupPhase?: string;
}

/** Structured fetch error preserving the HTTP status. */
export class AISessionRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AISessionRequestError';
    if (status !== undefined) this.status = status;
  }
}

/**
 * POST to the restart endpoint and return the new session status.
 *
 * Throws `AISessionRequestError` for non-2xx responses (HTTP status
 * preserved) and for network failures. `AbortError` is re-thrown unchanged
 * so callers can detect cancellation.
 */
export async function restartAISession(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AISessionStatus> {
  const init: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (options.signal) init.signal = options.signal;

  let res: Response;
  try {
    res = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/ai/restart`,
      init,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new AISessionRequestError(msg);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as Record<string, unknown>).error === 'string'
        ? ((body as Record<string, unknown>).error as string)
        : `Restart failed (HTTP ${res.status})`;
    throw new AISessionRequestError(message, res.status);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new AISessionRequestError('Invalid restart response body');
  }

  // Narrow the response into the expected shape. The server always
  // returns these keys (with `null` for absent timestamps), so we mostly
  // need to keep TypeScript happy here.
  const obj = (json ?? {}) as Record<string, unknown>;
  return {
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : sessionId,
    state: (typeof obj.state === 'string' ? obj.state : 'starting') as AISessionState,
    conversationId:
      typeof obj.conversationId === 'string' ? obj.conversationId : null,
    error: typeof obj.error === 'string' ? obj.error : null,
    thinkingSince: typeof obj.thinkingSince === 'string' ? obj.thinkingSince : null,
    startingSince: typeof obj.startingSince === 'string' ? obj.startingSince : null,
    ...(typeof obj.startupPhase === 'string' ? { startupPhase: obj.startupPhase } : {}),
  };
}
