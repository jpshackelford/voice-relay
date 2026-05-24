/**
 * Typed client for the persisted agent-event history endpoint
 * (`GET /api/sessions/:sessionId/agent-events`, introduced in PR #266).
 *
 * The server returns the raw OH event JSON as stored; we normalize each
 * entry into the client's `AgentAction` shape (see `normalizeAgentEvent`)
 * so the hydrated history is shape-compatible with the live WS payload
 * (`AgentActionMessage.action`).
 *
 * Reference: issue #269.
 */

import {
  filterKioskTimelineEvents,
  normalizeAgentEvents,
  type RawAgentEvent,
} from '../utils/normalizeAgentEvent';
import type { AgentAction } from '../types';

/** Mode passed to the `?rehydrate=` query param. */
export type RehydrateMode = 'auto' | 'force' | 'never';

export interface FetchAgentEventsOptions {
  /** Session id to fetch history for. */
  sessionId: string;
  /** Max events to return. Defaults to 500 server-side. */
  limit?: number;
  /** Only return events with `event_timestamp > after` (ISO Zulu). */
  after?: string;
  /** Restrict to specific event kinds (comma-joined server-side). */
  kinds?: string[];
  /** Rehydration mode — `auto` (default), `force`, or `never`. */
  rehydrate?: RehydrateMode;
  /** AbortSignal for cancellation on unmount / refetch. */
  signal?: AbortSignal;
}

/**
 * Successful agent-event history response, with raw events already
 * normalized into the client `AgentAction` shape.
 */
export interface AgentEventHistory {
  /** Normalized history events (already mapped from RawAgentEvent). */
  events: AgentAction[];
  /** Total rows in the store for this session (independent of `limit`). */
  total: number;
  /** Whether a REST rehydration was attempted on this request. */
  rehydrated: boolean;
  /** Whether the most recent rehydration completed successfully. */
  rehydrationComplete: boolean;
  /** Server-side rehydration error message (if any). */
  rehydrationError?: string;
  /** OH conversation id mapped to this session, or `null` if none. */
  conversationId: string | null;
  /** Oldest hydrated `event_timestamp` (ISO Zulu) or `null`. */
  hydratedAtOldest: string | null;
  /** Newest hydrated `event_timestamp` (ISO Zulu) or `null`. */
  hydratedAtNewest: string | null;
}

/** Structured fetch error preserving the HTTP status. */
export class AgentEventFetchError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AgentEventFetchError';
    if (status !== undefined) {
      this.status = status;
    }
  }
}

/** Shape of the raw server response — internal use only. */
interface ServerResponse {
  events?: unknown;
  total?: unknown;
  rehydrated?: unknown;
  rehydration_complete?: unknown;
  rehydration_error?: unknown;
  conversation_id?: unknown;
  hydrated_at_oldest?: unknown;
  hydrated_at_newest?: unknown;
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Build the request URL for the agent-events endpoint.
 *
 * TODO(#follow-up): paginate via `after=` when sessions exceed 500 events.
 * For v1 the kiosk only renders the last 50 anyway (see `useAgentActions`
 * `MAX_ACTIONS`), so this is a non-issue in practice.
 */
export function buildAgentEventsUrl(options: FetchAgentEventsOptions): string {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.after !== undefined) {
    params.set('after', options.after);
  }
  if (options.kinds && options.kinds.length > 0) {
    params.set('kind', options.kinds.join(','));
  }
  if (options.rehydrate !== undefined) {
    params.set('rehydrate', options.rehydrate);
  }
  const qs = params.toString();
  const base = `/api/sessions/${encodeURIComponent(options.sessionId)}/agent-events`;
  return qs ? `${base}?${qs}` : base;
}

/**
 * Fetch agent-event history for a session and normalize the response.
 *
 * Throws `AgentEventFetchError` for non-2xx responses (with the HTTP status
 * preserved) and for network failures. The caller (typically
 * `useAgentEventHistory`) decides whether to surface the error to the UI
 * and/or retry. `AbortError` is re-thrown unchanged so callers can detect
 * cancellation.
 */
export async function fetchAgentEventHistory(
  options: FetchAgentEventsOptions,
): Promise<AgentEventHistory> {
  const url = buildAgentEventsUrl(options);
  const init: RequestInit = { credentials: 'include' };
  if (options.signal) {
    init.signal = options.signal;
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new AgentEventFetchError(msg);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as Record<string, unknown>).error === 'string'
        ? ((body as Record<string, unknown>).error as string)
        : null) ?? `Failed to load agent events (HTTP ${res.status})`;
    throw new AgentEventFetchError(message, res.status);
  }

  let json: ServerResponse;
  try {
    json = (await res.json()) as ServerResponse;
  } catch {
    throw new AgentEventFetchError('Invalid agent-events response body');
  }

  const rawEvents = Array.isArray(json.events) ? (json.events as RawAgentEvent[]) : [];
  // Issue #280: defense-in-depth — also filter on the client. The server
  // (`server/src/agent-events/router.ts`) applies the same predicate, but
  // mirroring it here keeps live ↔ refresh parity correct during rolling
  // deploys where an older client may hit a newer server (or vice versa).
  // When the caller specifies explicit `kinds`, we respect that just like the
  // server does — no client-side filter so the override remains usable.
  const visibleEvents = options.kinds && options.kinds.length > 0
    ? rawEvents
    : filterKioskTimelineEvents(rawEvents);
  const events = normalizeAgentEvents(visibleEvents);

  const result: AgentEventHistory = {
    events,
    total: asNumber(json.total, events.length),
    rehydrated: asBoolean(json.rehydrated, false),
    rehydrationComplete: asBoolean(json.rehydration_complete, true),
    conversationId: asNullableString(json.conversation_id),
    hydratedAtOldest: asNullableString(json.hydrated_at_oldest),
    hydratedAtNewest: asNullableString(json.hydrated_at_newest),
  };
  if (typeof json.rehydration_error === 'string') {
    result.rehydrationError = json.rehydration_error;
  }
  return result;
}
