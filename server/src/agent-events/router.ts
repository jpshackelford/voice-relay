import { Router, type Request, type Response } from 'express';
import type { AgentEventRepository } from '../storage/agent-event-repository.js';
import type { AgentEventRehydrator } from './rehydrator.js';
import type { SessionRepository } from '../sessions/index.js';
import type { WorkspaceRepository } from '../workspaces/index.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

export interface AgentEventRouterOptions {
  agentEventRepository: AgentEventRepository;
  rehydrator: AgentEventRehydrator;
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  authConfig: AuthMiddlewareConfig;
}

type RehydrateMode = 'auto' | 'force' | 'never';

function parseRehydrateMode(value: unknown): RehydrateMode {
  if (typeof value !== 'string') return 'auto';
  const lc = value.toLowerCase();
  if (lc === 'force' || lc === 'never' || lc === 'auto') return lc;
  return 'auto';
}

function parseKinds(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const parts = value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/**
 * Read-only API for stored agent events.
 *
 * Mount path: `/api/sessions/:sessionId/agent-events` (top-level, since
 * a session id uniquely identifies the workspace via the sessions table).
 *
 * Query params:
 *   `?limit=N`        default 500
 *   `?after=<iso>`    return only events with event_timestamp > after
 *   `?kind=<csv>`     comma-separated list of event kinds
 *   `?rehydrate=auto|force|never`  default `auto` — fetch from OH iff there
 *                                  are zero stored rows and a conversation
 *                                  id is known.
 */
export function createAgentEventRouter(options: AgentEventRouterOptions): Router {
  const router = Router();
  const auth = requireAuth(options.authConfig);

  router.get('/:sessionId/agent-events', auth, async (req: Request, res: Response) => {
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

    const limit = parseLimit(req.query.limit) ?? 500;
    const after = typeof req.query.after === 'string' ? req.query.after : undefined;
    const kinds = parseKinds(req.query.kind);
    const mode = parseRehydrateMode(req.query.rehydrate);

    const conversationId = session.metadata?.aiConversationId;
    let rehydrated = false;
    let rehydrationComplete = true;
    let rehydrationError: string | undefined;

    if (mode !== 'never' && conversationId) {
      const force = mode === 'force';
      const existing = options.agentEventRepository.countBySession(sessionId);
      if (force || existing === 0) {
        try {
          const result = await options.rehydrator.ensureHydrated({
            sessionId,
            workspaceId: session.workspaceId,
            conversationId,
            force,
          });
          rehydrated = result.rehydrated;
          rehydrationComplete = result.complete;
          if (result.error) rehydrationError = result.error;
        } catch (err) {
          // Defense in depth — rehydrator already swallows its own errors,
          // but we never want a 500 here because rows may already be present.
          rehydrated = true;
          rehydrationComplete = false;
          rehydrationError = (err as Error).message;
          console.error('[AgentEvents] Rehydration threw:', err);
        }
      }
    }

    const events = options.agentEventRepository.findBySession({
      sessionId,
      limit,
      ...(after !== undefined ? { after } : {}),
      ...(kinds !== undefined ? { kinds } : {}),
    });
    const window = options.agentEventRepository.getHydrationWindow(sessionId);

    res.json({
      events: events.map(e => e.rawEvent),
      total: window.total,
      rehydrated,
      rehydration_complete: rehydrationComplete,
      ...(rehydrationError ? { rehydration_error: rehydrationError } : {}),
      conversation_id: conversationId ?? null,
      hydrated_at_oldest: window.oldest,
      hydrated_at_newest: window.newest,
    });
  });

  return router;
}
