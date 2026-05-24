/**
 * Session AI control router.
 *
 * Provides the user-driven recovery surface for an AI session that has
 * fallen into a `degraded` state (see #293 for the state-mapping work and
 * #294 for the kiosk affordance that drives this endpoint).
 *
 * Mount path: `/api/sessions/:sessionId/ai/*` (top-level — a session id
 * resolves to its workspace via `SessionRepository.findById`, so we don't
 * need the redundant `/api/workspaces/:workspaceId` prefix here, matching
 * the pattern established by `server/src/agent-events/router.ts`).
 *
 * Endpoints
 * ---------
 * `POST /:sessionId/ai/restart` — Reset the agent session cleanly.
 *
 *   The handler delegates to `AgentDriver.restartSession`, which drains any
 *   in-flight turns with a recoverable error and rebinds upstream. The
 *   driver's own single-flight slot (`lazyBindSession`) keeps two
 *   concurrent clicks from spawning duplicate upstream conversations.
 *
 *   Server-pushed `session-ai-status` updates are broadcast through the
 *   `DeviceRegistry` so other devices in the same session see the
 *   transition without needing to refresh.
 *
 *   Response shape mirrors `AgentSessionStatus` (see
 *   `server/src/agent-driver/types.ts`):
 *
 *     {
 *       sessionId, state, conversationId, error,
 *       thinkingSince, startingSince, startupPhase?
 *     }
 *
 *   - `401`: not authenticated.
 *   - `403`: authenticated but not a workspace member.
 *   - `404`: session does not exist.
 *   - `503`: driver layer threw — kiosk surfaces a transient inline error.
 */

import { Router, type Request, type Response } from 'express';
import type { AgentDriver, AgentSessionStatus } from '../agent-driver/index.js';
import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/index.js';
import type { DeviceRegistry } from '../registry.js';
import type { SessionAIStatusMessage } from '../types.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

export interface SessionAIRouterOptions {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  agentDriver: AgentDriver;
  /**
   * Optional device registry. When provided, restart progress is broadcast
   * to all devices in the session as `session-ai-status` messages. Tests
   * and lean dev setups may omit it; the endpoint still functions.
   */
  registry?: DeviceRegistry;
  authConfig: AuthMiddlewareConfig;
}

/**
 * Translate an `AgentSessionStatus` into the legacy `session-ai-status`
 * wire shape. Mirrors the mapping used by `resync-agent-status.ts` so
 * clients see the same fields whether they joined fresh or were already
 * connected during a restart.
 *
 * Will be superseded by #295's unified `session-state` message; until then
 * we use the existing shape.
 */
function statusToWireMessage(
  sessionId: string,
  status: AgentSessionStatus,
): SessionAIStatusMessage {
  const connected = status.state === 'ready' || status.state === 'thinking';
  const connecting = status.state === 'starting' || status.state === 'reconnecting';
  const msg: SessionAIStatusMessage = {
    type: 'session-ai-status',
    sessionId,
    connected,
    connecting,
  };
  if (status.conversationId) msg.conversationId = status.conversationId;
  if (status.error) msg.error = status.error;
  return msg;
}

export function createSessionAIRouter(options: SessionAIRouterOptions): Router {
  const router = Router();
  const auth = requireAuth(options.authConfig);

  router.post('/:sessionId/ai/restart', auth, async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const session = options.sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!options.workspaceRepository.canAccess(session.workspaceId, userId)) {
      res.status(403).json({ error: 'Access denied to session' });
      return;
    }

    // Optimistically announce the restart so other devices in the session
    // see the indicator transition immediately. `session-ai-status` with
    // `connecting:true` matches the auto-connect broadcast shape.
    if (options.registry) {
      const announce: SessionAIStatusMessage = {
        type: 'session-ai-status',
        sessionId,
        connecting: true,
        connected: false,
      };
      try {
        options.registry.broadcastMessageToSession(sessionId, announce);
      } catch (broadcastErr) {
        // Broadcast failures are non-fatal — the restart should still
        // proceed and the eventual broadcast (or the client's optimistic
        // local transition) will reconcile state.
        console.error(
          `[AI Restart] Broadcast (announce) failed for session ${sessionId}:`,
          broadcastErr,
        );
      }
    }

    let status: AgentSessionStatus;
    try {
      status = await options.agentDriver.restartSession(sessionId);
    } catch (err) {
      console.error(`[AI Restart] driver.restartSession failed for ${sessionId}:`, err);
      const message =
        err instanceof Error ? err.message : 'Failed to restart agent session';
      // Surface a final session-ai-status carrying the error so other
      // devices clear their "connecting" indicator. The 503 returned to
      // the caller drives the kiosk's inline error copy.
      if (options.registry) {
        const errMsg: SessionAIStatusMessage = {
          type: 'session-ai-status',
          sessionId,
          connecting: false,
          connected: false,
          error: message,
        };
        try {
          options.registry.broadcastMessageToSession(sessionId, errMsg);
        } catch (broadcastErr) {
          console.error(
            `[AI Restart] Broadcast (error) failed for session ${sessionId}:`,
            broadcastErr,
          );
        }
      }
      res.status(503).json({ error: message });
      return;
    }

    // Broadcast the final state so peer devices reconcile. The caller gets
    // the same data in the response body.
    if (options.registry) {
      try {
        options.registry.broadcastMessageToSession(
          sessionId,
          statusToWireMessage(sessionId, status),
        );
      } catch (broadcastErr) {
        console.error(
          `[AI Restart] Broadcast (final) failed for session ${sessionId}:`,
          broadcastErr,
        );
      }
    }

    res.json(status);
  });

  return router;
}
