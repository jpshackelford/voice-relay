/**
 * REST surface for per-session settings (issue #378).
 *
 * Mounted at `/api/sessions` so the full path is
 * `GET|PATCH /api/sessions/:sessionId/settings`. The route uses a dual
 * auth model that mirrors the rest of the session API:
 *
 *   1. `Bearer DISPLAY_API_SECRET` — the per-session secret already
 *      issued by `sessions.display_api_secret_*`. Lets off-browser agents
 *      (OpenHands conversations, automations) read/write settings using
 *      the same token they use for `POST /api/display`.
 *   2. JWT workspace-member — falls back to the standard `requireAuth`
 *      flow so the UI can call these endpoints with the user's cookie.
 *
 * The service (`settings-service.ts`) is the single funnel for all
 * persistence + broadcast. This router only translates HTTP <-> service.
 *
 * Error mapping:
 *   - missing auth                        → 401
 *   - JWT for the wrong workspace         → 403
 *   - unknown session id                  → 404
 *   - malformed body / unknown field      → 400
 *   - everything else                     → 500 (with logged context)
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type {
  SessionSettingsPatch,
  SessionSettingsService,
} from './settings-service.js';
import {
  SessionNotFoundError,
  SettingsValidationError,
} from './settings-service.js';
import { authenticateDisplayRequest } from '../display-api/index.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

export interface SessionSettingsRouterOptions {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  settingsService: SessionSettingsService;
  authConfig: AuthMiddlewareConfig;
}

/**
 * Express middleware that authenticates a session-settings request via
 * either the per-session `DISPLAY_API_SECRET` (preferred for agents) or a
 * JWT belonging to a workspace member (preferred for the UI).
 *
 * On success it stashes the resolved `workspaceId` on `res.locals` so the
 * handler can build the response without a second lookup. On failure it
 * writes the appropriate 4xx and ends the request.
 */
function authenticateSessionRequest(
  options: SessionSettingsRouterOptions,
  jwtMiddleware: ReturnType<typeof requireAuth>,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { sessionId } = req.params;
    const session = options.sessionRepository.findById(sessionId);
    // 404 takes precedence over 401: leaking "session exists but you're
    // unauthed" is fine here — the session id is opaque and only known
    // to operators with prior access. Matches the existing
    // `/api/sessions/:id/ai/restart` behaviour.
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const authHeader = req.headers.authorization;
    const hasBearer = authHeader?.startsWith('Bearer ');

    // Try DISPLAY_API_SECRET first if a Bearer header is present *and*
    // the bearer value differs from a candidate JWT (the heuristic just
    // attempts the secret path; on failure we still try JWT).
    if (hasBearer) {
      const auth = await authenticateDisplayRequest(
        authHeader,
        sessionId,
        options.sessionRepository,
      );
      if (auth.authenticated) {
        res.locals.workspaceId = auth.workspaceId;
        res.locals.authMode = 'display-secret';
        next();
        return;
      }
      // Fall through to JWT path if the bearer wasn't a valid
      // display secret. This lets the same `Authorization: Bearer …`
      // header be reused with a real JWT (e.g. the SPA fetch path).
    }

    // JWT fallback. `requireAuth` is async: it either calls our `next`
    // callback (success) or writes a 401 directly and returns without
    // calling it. Await the returned promise so both paths settle before
    // we proceed.
    let jwtPassed = false;
    await jwtMiddleware(req, res, () => {
      jwtPassed = true;
    });

    if (!jwtPassed) {
      // `requireAuth` already wrote a 401 response. Defensive fallback
      // for the (theoretical) case where neither branch wrote.
      if (!res.headersSent) {
        res.status(401).json({ error: 'Authentication required' });
      }
      return;
    }

    // JWT verified; check workspace membership.
    const userId = req.user?.id;
    if (!userId || !options.workspaceRepository.canAccess(session.workspaceId, userId)) {
      res.status(403).json({ error: 'Access denied to session' });
      return;
    }

    res.locals.workspaceId = session.workspaceId;
    res.locals.authMode = 'jwt';
    next();
  };
}

export function createSessionSettingsRouter(
  options: SessionSettingsRouterOptions,
): Router {
  const router = Router();
  const jwtMiddleware = requireAuth(options.authConfig);
  const auth = authenticateSessionRequest(options, jwtMiddleware);

  router.get('/:sessionId/settings', auth, (req: Request, res: Response) => {
    try {
      const dto = options.settingsService.readSettings(req.params.sessionId);
      res.json(dto);
    } catch (err) {
      handleServiceError(err, res, req.params.sessionId);
    }
  });

  router.patch('/:sessionId/settings', auth, (req: Request, res: Response) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }

    try {
      const dto = options.settingsService.applyPatch(
        req.params.sessionId,
        body as SessionSettingsPatch,
      );
      res.json(dto);
    } catch (err) {
      handleServiceError(err, res, req.params.sessionId);
    }
  });

  return router;
}

function handleServiceError(err: unknown, res: Response, sessionId: string): void {
  if (err instanceof SettingsValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof SessionNotFoundError) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  console.error(`[SessionSettings] handler error for ${sessionId}:`, err);
  res.status(500).json({ error: 'Internal server error' });
}
