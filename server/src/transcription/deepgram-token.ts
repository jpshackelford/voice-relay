/**
 * Deepgram short-lived token broker (#386).
 *
 * The voice-relay server never sees raw audio. To let the kiosk talk
 * to Deepgram directly without ever exposing the workspace's long-lived
 * Deepgram API key, we mint a *short-lived* key via Deepgram's
 * `POST /v1/projects/{project_id}/keys` endpoint
 * (https://developers.deepgram.com/reference/create-key) with
 * `time_to_live_in_seconds: 60` and the `usage:write` scope (which
 * Deepgram requires for streaming transcription).
 *
 * If Deepgram changes their API surface, the only piece of this module
 * that needs updating is `mintEphemeralKey` — the route layer is
 * transport-agnostic and the workspace settings layer doesn't care
 * what the token looks like.
 *
 * This module is intentionally side-effect-free and unit-testable:
 * the `fetch` implementation is injected so tests can stub out network
 * calls without monkey-patching the global.
 */

/** Resolved Deepgram project to mint keys against. */
export interface DeepgramProjectInfo {
  projectId: string;
}

/** Caller-controlled options for token lifetime + scopes. */
export interface MintEphemeralKeyOptions {
  /**
   * The encrypted-then-decrypted, plain-text Deepgram API key for the
   * workspace. Never log or echo this.
   */
  apiKey: string;
  /**
   * How many seconds the short-lived key is valid for. Capped at 60
   * server-side by `MAX_TTL_SECONDS` regardless of what callers pass.
   * Default: 30s.
   */
  ttlSeconds?: number;
  /**
   * Scopes to grant the short-lived key. Defaults to the minimum
   * required for streaming transcription.
   */
  scopes?: string[];
  /**
   * Custom fetch implementation, primarily so unit tests can avoid
   * hitting the real Deepgram API. Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Optional alternate base URL — useful for staging endpoints or
   * regional Deepgram deployments. Defaults to `https://api.deepgram.com`.
   */
  baseUrl?: string;
}

/** What we return to the route layer (and ultimately the client). */
export interface MintedToken {
  /** The short-lived API key. */
  token: string;
  /**
   * ISO-8601 Zulu timestamp at which the token expires. The client
   * should renew well before this.
   */
  expiresAt: string;
}

/** Hard upper bound on token lifetime — matches the acceptance criteria. */
export const MAX_TTL_SECONDS = 60;

/** Default lifetime when callers don't specify one. */
export const DEFAULT_TTL_SECONDS = 30;

/**
 * Default scopes. Deepgram's `usage:write` scope is what their streaming
 * docs require for the `/v1/listen` WebSocket endpoint.
 */
export const DEFAULT_SCOPES: readonly string[] = ['usage:write'];

/**
 * Look up the first project on the Deepgram account that owns
 * `apiKey`. Most workspaces only have a single project; we cache the
 * id in memory so we don't pay for the lookup on every token mint.
 */
export async function fetchProjectId(
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.deepgram.com';
  const res = await fetchImpl(`${baseUrl}/v1/projects`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) {
    throw new DeepgramApiError(
      `Deepgram /v1/projects returned HTTP ${res.status}`,
      res.status,
    );
  }
  const body = (await res.json()) as {
    projects?: Array<{ project_id?: string }>;
  };
  const id = body.projects?.[0]?.project_id;
  if (!id) {
    throw new DeepgramApiError(
      'Deepgram /v1/projects returned no projects',
      res.status,
    );
  }
  return id;
}

/**
 * Mint a single-use, short-lived Deepgram API key.
 *
 * Throws `DeepgramApiError` (with the upstream HTTP status) if Deepgram
 * rejects the request — the route layer can map those to a 502 / 503
 * without leaking the API key in the error message.
 */
export async function mintEphemeralKey(
  options: MintEphemeralKeyOptions,
  project: DeepgramProjectInfo,
): Promise<MintedToken> {
  const ttlRequested = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  // Cap server-side. The token broker must not issue tokens longer
  // than `MAX_TTL_SECONDS` regardless of caller input.
  const ttl = Math.min(MAX_TTL_SECONDS, Math.max(1, Math.trunc(ttlRequested)));
  const scopes = options.scopes ?? Array.from(DEFAULT_SCOPES);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? 'https://api.deepgram.com';

  const res = await fetchImpl(
    `${baseUrl}/v1/projects/${encodeURIComponent(project.projectId)}/keys`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Deepgram allows free-form comments on minted keys; tagging
        // them as VR-issued makes auditing the upstream usage easier.
        comment: 'voice-relay-ephemeral',
        scopes,
        time_to_live_in_seconds: ttl,
      }),
    },
  );

  if (!res.ok) {
    throw new DeepgramApiError(
      `Deepgram key mint returned HTTP ${res.status}`,
      res.status,
    );
  }

  const body = (await res.json()) as {
    key?: string;
  };
  if (!body.key) {
    throw new DeepgramApiError(
      'Deepgram key mint returned no key',
      res.status,
    );
  }

  // We trust Deepgram's TTL window; compute the absolute expiry on our
  // own clock so the client doesn't need to know about server-Deepgram
  // skew.
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  return { token: body.key, expiresAt };
}

export class DeepgramApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DeepgramApiError';
    this.status = status;
  }
}
