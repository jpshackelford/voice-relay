import { Router, type Request, type Response, type NextFunction } from 'express';
import type { SpeakerRepository } from './speaker-repository.js';
import type { WorkspaceRepository } from '../workspaces/index.js';
import {
  requireAuth,
  type AuthMiddlewareConfig,
} from '../auth/middleware.js';
import type { SpeakerCreateInput, SpeakerUpdateInput } from './types.js';

export interface SpeakerRouterOptions {
  speakerRepository: SpeakerRepository;
  workspaceRepository: WorkspaceRepository;
  authConfig: AuthMiddlewareConfig;
}

/** Validate a string field; returns the trimmed value or `null` for blanks. */
function normalizeOptionalString(
  raw: unknown,
  maxLen: number
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error('expected string');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) {
    throw new Error(`too long (max ${maxLen})`);
  }
  return trimmed;
}

const MAX_NAME_LEN = 200;
const MAX_PRONOUNS_LEN = 64;
const MAX_NOTES_LEN = 4000;

interface SpeakerWriteBody {
  preferredName?: unknown;
  pronouns?: unknown;
  notes?: unknown;
  userId?: unknown;
}

function parseWriteBody(body: unknown): {
  preferredName: string | null | undefined;
  pronouns: string | null | undefined;
  notes: string | null | undefined;
  userId: string | null | undefined;
  error?: string;
} {
  if (body === null || typeof body !== 'object') {
    return {
      preferredName: undefined,
      pronouns: undefined,
      notes: undefined,
      userId: undefined,
      error: 'body must be a JSON object',
    };
  }
  const b = body as SpeakerWriteBody;
  try {
    return {
      preferredName: normalizeOptionalString(b.preferredName, MAX_NAME_LEN),
      pronouns: normalizeOptionalString(b.pronouns, MAX_PRONOUNS_LEN),
      notes: normalizeOptionalString(b.notes, MAX_NOTES_LEN),
      userId: normalizeOptionalString(b.userId, MAX_NAME_LEN),
    };
  } catch (err) {
    return {
      preferredName: undefined,
      pronouns: undefined,
      notes: undefined,
      userId: undefined,
      error:
        err instanceof Error
          ? err.message
          : 'invalid speaker field',
    };
  }
}

/**
 * REST surface for the per-workspace `speakers` table (#383).
 *
 * Mounted at `/api/workspaces/:workspaceId/speakers`. The agent uses
 * `PUT /:speakerId` to write back facts it has learned (preferred
 * name, pronouns, notes); workspace owners can also curate speakers
 * via the same endpoints. Non-owner members may **read** speakers
 * (`GET`) but cannot mutate them — the agent itself acts on behalf of
 * the workspace, not on behalf of any individual member.
 */
export function createSpeakerRouter({
  speakerRepository,
  workspaceRepository,
  authConfig,
}: SpeakerRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const auth = requireAuth(authConfig);

  const requireWorkspaceAccess = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const { workspaceId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!workspaceRepository.canAccess(workspaceId, userId)) {
      res.status(403).json({ error: 'Access denied to workspace' });
      return;
    }
    next();
  };

  const requireWorkspaceOwner = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const { workspaceId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!workspaceRepository.isOwner(workspaceId, userId)) {
      res.status(403).json({ error: 'Workspace owner required' });
      return;
    }
    next();
  };

  router.get(
    '/',
    auth,
    requireWorkspaceAccess,
    (req: Request, res: Response) => {
      const { workspaceId } = req.params;
      const speakers = speakerRepository.listForWorkspace(workspaceId);
      res.json({ speakers });
    }
  );

  router.get(
    '/:speakerId',
    auth,
    requireWorkspaceAccess,
    (req: Request, res: Response) => {
      const { workspaceId, speakerId } = req.params;
      const speaker = speakerRepository.findById(workspaceId, speakerId);
      if (!speaker) {
        res.status(404).json({ error: 'Speaker not found' });
        return;
      }
      res.json({ speaker });
    }
  );

  router.post(
    '/',
    auth,
    requireWorkspaceOwner,
    (req: Request, res: Response) => {
      const { workspaceId } = req.params;
      const parsed = parseWriteBody(req.body);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const input: SpeakerCreateInput = {
        workspaceId,
        userId: parsed.userId ?? null,
        preferredName: parsed.preferredName ?? null,
        pronouns: parsed.pronouns ?? null,
        notes: parsed.notes ?? null,
      };
      try {
        const speaker = speakerRepository.create(input);
        res.status(201).json({ speaker });
      } catch (err) {
        // Most likely a UNIQUE-index violation on (workspace_id, user_id).
        const message = err instanceof Error ? err.message : 'create failed';
        if (/UNIQUE/i.test(message)) {
          res
            .status(409)
            .json({ error: 'Speaker already exists for this user' });
          return;
        }
        console.error('[Speakers] create failed:', err);
        res.status(500).json({ error: 'Failed to create speaker' });
      }
    }
  );

  const writeHandler = (req: Request, res: Response): void => {
    const { workspaceId, speakerId } = req.params;
    const parsed = parseWriteBody(req.body);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const input: SpeakerUpdateInput = {
      preferredName: parsed.preferredName,
      pronouns: parsed.pronouns,
      notes: parsed.notes,
      userId: parsed.userId,
    };
    const updated = speakerRepository.update(workspaceId, speakerId, input);
    if (!updated) {
      res.status(404).json({ error: 'Speaker not found' });
      return;
    }
    res.json({ speaker: updated });
  };

  router.put('/:speakerId', auth, requireWorkspaceOwner, writeHandler);
  router.patch('/:speakerId', auth, requireWorkspaceOwner, writeHandler);

  router.delete(
    '/:speakerId',
    auth,
    requireWorkspaceOwner,
    (req: Request, res: Response) => {
      const { workspaceId, speakerId } = req.params;
      const removed = speakerRepository.delete(workspaceId, speakerId);
      if (!removed) {
        res.status(404).json({ error: 'Speaker not found' });
        return;
      }
      res.status(204).end();
    }
  );

  return router;
}
