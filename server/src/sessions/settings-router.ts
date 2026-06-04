/**
 * Session settings REST router (issue #378).
 *
 * Mount path: `/api/sessions/:sessionId/settings` (top-level — a
 * sessionId resolves to its workspace via `SessionRepository.findById`,
 * so we don't need the redundant `/api/workspaces/:workspaceId` prefix;
 * matches the pattern established by `ai-router.ts` and
 * `agent-events/router.ts`).
 *
 * Endpoints
 * ---------
 * `GET    /:sessionId/settings`
 * `PATCH  /:sessionId/settings`
 *
 * Auth:
 *   - `Authorization: Bearer <DISPLAY_API_SECRET>` (session-scoped
 *     credential — same one used by `POST /api/display`), OR
 *   - JWT workspace-member (existing `requireAuth` middleware).
 *
 * The DISPLAY_API_SECRET path is intentional: it lets an agent that
 * already controls a session's display flip its own behaviour
 * (TTS/agent-prompt) without needing a new credential.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRegistry } from '../registry.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';
import { authenticateDisplayRequest } from '../display-api/index.js';
import { applyPatch, buildSettingsDto } from './settings-service.js';

export interface SessionSettingsRouterOptions {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  /**
   * Optional device registry; when provided, PATCH broadcasts the two
   * settings-changed messages to peers. Tests may omit it.
   */
  registry?: DeviceRegistry;
  authConfig: AuthMiddlewareConfig;
}

/**
 * Augments the request with an `authenticatedWorkspaceId` field when
 * either auth path succeeds. We don't use `req.user` for the display-
 * secret path because there is no user — only a session secret.
 */
interface SettingsRequest extends Request {
  authenticatedWorkspaceId?: string;
}

/**
 * Auth chain: try DISPLAY_API_SECRET first (cheaper, scoped to one
 * session); if absent or the header isn't a Bearer, fall back to JWT
 * workspace-member access. Both paths set `authenticatedWorkspaceId` and
 * also verify the secret/JWT matches the URL `:sessionId` workspace.
 */
function makeAuthMiddleware(opts: SessionSettingsRouterOptions) {
  const jwtMiddleware = requireAuth(opts.authConfig);

  return async (req: SettingsRequest, res: Response, next: NextFunction) => {
    const { sessionId } = req.params;
    const session = opts.sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const authHeader = req.headers.authorization;
    const hasBearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

    // Try DISPLAY_API_SECRET only when the request looks like one (Bearer
    // header AND no cookie). Cookie-bearing requests are JWT users.
    if (hasBearer && !req.cookies?.voice_relay_auth) {
      const result = await authenticateDisplayRequest(
        authHeader,
        sessionId,
        opts.sessionRepository,
      );
      if (result.authenticated) {
        req.authenticatedWorkspaceId = result.workspaceId;
        next();
        return;
      }
      // If the Bearer header was present but didn't match a session
      // secret, also try JWT before giving up — agents that hold a JWT
      // and pass it via Authorization header still need to work.
      const looksLikeJwt = authHeader.slice(7).split('.').length === 3;
      if (!looksLikeJwt) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }
    }

    // Fall through to JWT auth. requireAuth handles 401 responses.
    jwtMiddleware(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (!req.user) {
        // requireAuth already sent the response on the error path; in
        // theory we shouldn't get here, but guard anyway.
        return;
      }
      if (!opts.workspaceRepository.canAccess(session.workspaceId, req.user.id)) {
        res.status(403).json({ error: 'Access denied to session' });
        return;
      }
      req.authenticatedWorkspaceId = session.workspaceId;
      next();
    });
  };
}

export function createSessionSettingsRouter(
  options: SessionSettingsRouterOptions,
): Router {
  const router = Router();
  const auth = makeAuthMiddleware(options);

  router.get(
    '/:sessionId/settings',
    auth,
    async (req: SettingsRequest, res: Response) => {
      const { sessionId } = req.params;
      const session = options.sessionRepository.findById(sessionId);
      if (!session) {
        // Re-check (theoretically already handled by auth middleware,
        // but session could have been deleted concurrently).
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      try {
        const workspaceSettings = options.workspaceRepository.getSettings(
          session.workspaceId,
        );
        const dto = buildSettingsDto(
          sessionId,
          session.workspaceId,
          session.metadata,
          workspaceSettings?.defaultAgentPrompt ?? null,
        );
        res.json(dto);
      } catch (err) {
        console.error(
          `[SessionSettings] GET failed for ${sessionId}:`,
          err,
        );
        res.status(500).json({ error: 'Failed to read session settings' });
      }
    },
  );

  router.patch(
    '/:sessionId/settings',
    auth,
    async (req: SettingsRequest, res: Response) => {
      const { sessionId } = req.params;
      try {
        const result = applyPatch(
          {
            sessionRepository: options.sessionRepository,
            workspaceRepository: options.workspaceRepository,
            registry: options.registry,
          },
          sessionId,
          req.body,
        );
        if (!result.ok) {
          res.status(result.status).json({ error: result.error });
          return;
        }
        res.json(result.settings);
      } catch (err) {
        console.error(
          `[SessionSettings] PATCH failed for ${sessionId}:`,
          err,
        );
        res.status(500).json({ error: 'Failed to update session settings' });
      }
    },
  );

  return router;
}
