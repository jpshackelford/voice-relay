/**
 * REST surface for the hosted-STT token broker (#386).
 *
 * Mounted at `/api/stt`. The voice-relay server never sees raw audio —
 * the kiosk talks directly to Deepgram. This router only mints
 * short-lived Deepgram keys and records minute usage at session end.
 *
 *   POST /api/stt/token              — mint a short-lived Deepgram key
 *   POST /api/stt/usage              — record minutes used (session end)
 *   GET  /api/stt/usage              — read current-month usage + cap
 *
 * Auth model: JWT workspace-member only. Kiosk pages are loaded by an
 * authenticated user (the operator), so the same cookie flow used by
 * the rest of the SPA applies. Device JWTs would be an option once
 * anonymous kiosks need hosted STT; deferred to a follow-up.
 *
 * Error mapping:
 *   - missing / invalid JWT             → 401
 *   - JWT user not a workspace member   → 403
 *   - hosted STT disabled for workspace → 403
 *   - monthly cap exhausted             → 402 (RFC: Payment Required)
 *   - no Deepgram key configured        → 503
 *   - Deepgram upstream error           → 502 (with status logged)
 *   - everything else                   → 500
 */

import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import { decryptApiKey } from '../workspaces/encryption.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';
import {
  fetchProjectId,
  mintEphemeralKey,
  DeepgramApiError,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  type DeepgramProjectInfo,
} from './deepgram-token.js';
import {
  StttUsageRepository,
} from './usage-repository.js';

export interface TranscriptionRouterOptions {
  workspaceRepository: WorkspaceRepository;
  /**
   * Optional device repository. When provided, the broker honours
   * per-device `config.stt_engine` overrides (a device set to
   * `'web-speech'` is refused even if the workspace default is
   * `'deepgram'`).
   */
  deviceRepository?: DeviceRepository;
  usageRepository: StttUsageRepository;
  authConfig: AuthMiddlewareConfig;
  /**
   * Custom fetch implementation, primarily for tests. Defaults to
   * `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Override the Deepgram base URL (staging endpoints, regional
   * deployments). Defaults to `https://api.deepgram.com`.
   */
  deepgramBaseUrl?: string;
}

interface TokenRequestBody {
  deviceId?: string;
  /** Caller may request a shorter TTL; capped server-side. */
  ttlSeconds?: number;
}

interface UsageRequestBody {
  /** Minutes streamed in the just-ended session. */
  minutes?: number;
}

/**
 * In-process cache of `SHA256(apiKey) -> project_id` so we don't hit
 * Deepgram's `/v1/projects` endpoint on every token mint. Cache
 * lifetime is the process lifetime — workspaces rotate keys rarely
 * enough that an eviction policy isn't worth the complexity.
 *
 * We hash the key before using it as the Map key so the plaintext
 * Deepgram secret is never held in a structure that could leak via a
 * heap dump, error report, or accidental `console.log(map)`.
 */
const projectIdCache = new Map<string, string>();

function cacheKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

async function resolveProject(
  apiKey: string,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<DeepgramProjectInfo> {
  const key = cacheKey(apiKey);
  const cached = projectIdCache.get(key);
  if (cached) return { projectId: cached };
  const id = await fetchProjectId(apiKey, { fetchImpl, baseUrl });
  projectIdCache.set(key, id);
  return { projectId: id };
}

/** Test-only hook to clear the per-process project-id cache. */
export function _clearProjectIdCacheForTests(): void {
  projectIdCache.clear();
}

/**
 * Resolve the effective STT engine for `(workspaceId, deviceId)`:
 *   device override (`devices.config.stt_engine`) > workspace default
 *
 * Returns `'web-speech'` when the device override is set to it even
 * if the workspace default is `'deepgram'` — the per-device override
 * is final.
 */
function resolveEngine(
  workspaceSetting: 'web-speech' | 'deepgram',
  device: { config: Record<string, unknown> | null } | null,
): 'web-speech' | 'deepgram' {
  const override = device?.config?.stt_engine;
  if (override === 'deepgram') return 'deepgram';
  if (override === 'web-speech') return 'web-speech';
  return workspaceSetting;
}

export function createTranscriptionRouter(
  options: TranscriptionRouterOptions,
): Router {
  const router = Router();
  const {
    workspaceRepository,
    deviceRepository,
    usageRepository,
    authConfig,
  } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.deepgramBaseUrl ?? 'https://api.deepgram.com';
  const auth = requireAuth(authConfig);

  /**
   * Resolve the workspace + device the request is targeting and
   * authorise the calling user as a workspace member.
   *
   * Returns the resolved workspace settings on success; ends the
   * response with a 4xx and returns `null` on failure.
   */
  function authoriseAndResolve(req: Request, res: Response, deviceId: string | undefined) {
    if (!deviceId || typeof deviceId !== 'string') {
      res.status(400).json({ error: 'deviceId is required' });
      return null;
    }
    if (!deviceRepository) {
      // The router was wired without a device repo, so we can't validate
      // the deviceId. Refuse rather than silently trusting the client.
      res.status(503).json({ error: 'Device registry unavailable' });
      return null;
    }
    const device = deviceRepository.findById(deviceId);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return null;
    }
    if (!workspaceRepository.canAccess(device.workspaceId, req.user!.id)) {
      res.status(403).json({ error: 'Access denied to workspace' });
      return null;
    }
    const settings = workspaceRepository.getSettings(device.workspaceId);
    return { device, settings };
  }

  router.post('/token', auth, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as TokenRequestBody;
      const resolved = authoriseAndResolve(req, res, body.deviceId);
      if (!resolved) return;
      const { device, settings } = resolved;

      const engine = resolveEngine(
        settings?.sttEngine ?? 'web-speech',
        device,
      );
      if (engine !== 'deepgram') {
        res.status(403).json({
          error: 'Hosted STT is not enabled for this device',
          engine,
        });
        return;
      }

      if (
        !settings?.deepgramApiKeyEncrypted ||
        !settings.deepgramApiKeyIv ||
        !settings.deepgramApiKeyTag
      ) {
        res.status(503).json({ error: 'Deepgram API key not configured' });
        return;
      }

      // Cap check. `null` cap means "no cap"; non-null cap is enforced
      // in whole minutes against the REAL counter.
      //
      // Note: there is a small time-of-check / time-of-use gap between
      // reading the counter and minting the token. Concurrent requests
      // racing through this check can push usage a few minutes over
      // the cap. This is acceptable for a soft billing guardrail —
      // serialising with a per-workspace lock would add real
      // complexity for marginal benefit when the actual cost ceiling
      // (Deepgram's own usage limits) is set well above this cap.
      const cap = settings.sttMonthlyMinuteCap;
      if (cap !== null && cap !== undefined) {
        const used = usageRepository.getCurrentMonthMinutes(device.workspaceId);
        if (used >= cap) {
          res.status(402).json({
            error: 'Monthly STT minute cap reached',
            cap,
            minutesUsed: used,
          });
          return;
        }
      }

      let apiKey: string;
      try {
        apiKey = decryptApiKey({
          encrypted: settings.deepgramApiKeyEncrypted,
          iv: settings.deepgramApiKeyIv,
          tag: settings.deepgramApiKeyTag,
        });
      } catch (err) {
        console.error('[STT] Failed to decrypt Deepgram key:', err);
        res.status(500).json({ error: 'Failed to access Deepgram key' });
        return;
      }

      const ttl = clampTtl(body.ttlSeconds);

      try {
        const project = await resolveProject(apiKey, fetchImpl, baseUrl);
        const minted = await mintEphemeralKey(
          {
            apiKey,
            ttlSeconds: ttl,
            fetchImpl,
            baseUrl,
          },
          project,
        );
        res.json({
          engine: 'deepgram',
          token: minted.token,
          expiresAt: minted.expiresAt,
        });
      } catch (err) {
        if (err instanceof DeepgramApiError) {
          console.warn(
            `[STT] Deepgram upstream error (${err.status}) for workspace ${device.workspaceId}`,
          );
          res.status(502).json({
            error: 'Deepgram upstream error',
            upstreamStatus: err.status,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      console.error('[STT] Token broker error:', err);
      res.status(500).json({ error: 'Failed to mint STT token' });
    }
  });

  // KNOWN LIMITATION — client-reported usage (#386 follow-up).
  //
  // Minutes are self-reported by the kiosk at session end. A
  // malicious or buggy client can under-report (to dodge the cap) or
  // over-report (to nudge a workspace toward its cap). We accept this
  // because the JWT auth model already restricts callers to workspace
  // members, and the monthly cap is a soft guardrail rather than a
  // hard billing boundary — Deepgram itself enforces the real spend
  // ceiling on the upstream account.
  //
  // For SaaS hardening we plan to reconcile this counter against
  // Deepgram's `/v1/projects/:id/usage` API on a periodic schedule;
  // see issue #386 follow-up. Server-side session tracking (mint =>
  // session id, expire => recorded minutes) is the other option if
  // workspace-member trust ever stops being acceptable.
  router.post('/usage', auth, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as TokenRequestBody & UsageRequestBody;
      const resolved = authoriseAndResolve(req, res, body.deviceId);
      if (!resolved) return;
      const { device } = resolved;

      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes) || minutes < 0) {
        res.status(400).json({ error: 'minutes must be a non-negative number' });
        return;
      }

      const updated = usageRepository.incrementMinutes(
        device.workspaceId,
        minutes,
      );
      res.json({
        workspaceId: device.workspaceId,
        minutesUsedThisMonth: updated,
      });
    } catch (err) {
      console.error('[STT] Usage record error:', err);
      res.status(500).json({ error: 'Failed to record STT usage' });
    }
  });

  router.get('/usage', auth, async (req: Request, res: Response) => {
    try {
      const workspaceId =
        typeof req.query.workspaceId === 'string'
          ? req.query.workspaceId
          : undefined;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId query parameter is required' });
        return;
      }
      if (!workspaceRepository.canAccess(workspaceId, req.user!.id)) {
        res.status(403).json({ error: 'Access denied to workspace' });
        return;
      }
      const settings = workspaceRepository.getSettings(workspaceId);
      const used = usageRepository.getCurrentMonthMinutes(workspaceId);
      res.json({
        workspaceId,
        minutesUsedThisMonth: used,
        cap: settings?.sttMonthlyMinuteCap ?? null,
        engine: settings?.sttEngine ?? 'web-speech',
      });
    } catch (err) {
      console.error('[STT] Usage read error:', err);
      res.status(500).json({ error: 'Failed to read STT usage' });
    }
  });

  return router;
}

function clampTtl(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.trunc(requested));
}
