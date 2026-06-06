import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { WorkspaceRepository } from './workspace-repository.js';
import type { JoinRequestRepository } from './join-request-repository.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import type { QrTokenRepository } from '../qr-tokens/index.js';
import type { WorkspaceCreateInput, WorkspaceUpdateInput } from './types.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';
import { encryptApiKey, decryptApiKey, isValidApiKeyFormat } from './encryption.js';
import { MAX_AGENT_PROMPT_LENGTH } from '../constants.js';

// Rate limiter for auto-join endpoint to prevent enumeration/abuse
const autoJoinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // limit each user to 10 auto-joins per window
  message: { error: 'Too many join attempts, please try again later' },
  // Use authenticated user ID for rate limiting - endpoint requires auth middleware
  // so req.user is guaranteed to exist (non-null assertion is safe here)
  keyGenerator: (req: Request) => req.user!.id,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // Skip in tests
  validate: { xForwardedForHeader: false }, // Disable IP-related validation since we use user ID
});

// Rate limiter for request-join endpoint (same limits as auto-join)
const requestJoinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // limit each user to 10 join requests per window
  message: { error: 'Too many join requests, please try again later' },
  keyGenerator: (req: Request) => req.user!.id,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  validate: { xForwardedForHeader: false },
});

export interface WorkspaceRouterConfig {
  workspaceRepository: WorkspaceRepository;
  joinRequestRepository?: JoinRequestRepository;
  deviceRepository?: DeviceRepository;
  qrTokenRepository?: QrTokenRepository;
  sessionRepository?: import('../sessions/session-repository.js').SessionRepository;
  /**
   * Optional speaker repository (#383). When provided, the workspace
   * `join` / `auto-join` / `request-join` resolve paths upsert a
   * workspace-scoped speaker row for the joining user so the agent
   * has a place to write learned facts (preferred name, pronouns,
   * notes) from the very first session.
   */
  speakerRepository?: import('../speakers/speaker-repository.js').SpeakerRepository;
  authConfig: AuthMiddlewareConfig;
  /** Callback to broadcast join request to owner's kiosk devices */
  onJoinRequest?: (workspaceId: string, request: {
    id: string;
    workspaceId: string;
    user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
    createdAt: string;
  }) => void;
  /** Callback to send join-resolved to the requesting user's device */
  onJoinResolved?: (requestId: string, approved: boolean, workspace?: {
    id: string;
    name: string;
    slug: string;
  }, error?: string) => void;
  /** Callback to handle device removal (send notification, disconnect WebSocket, broadcast device list) */
  onDeviceRemoved?: (deviceId: string, workspaceId: string) => void;
  /** Callback to disconnect all devices when a workspace is deleted */
  onWorkspaceDeleted?: (workspaceId: string) => void;
}

export function createWorkspaceRouter(config: WorkspaceRouterConfig): Router {
  const router = Router();
  const { 
    workspaceRepository, 
    joinRequestRepository, 
    deviceRepository,
    sessionRepository,
    qrTokenRepository,
    speakerRepository,
    authConfig,
    onJoinRequest,
    onJoinResolved,
    onDeviceRemoved,
    onWorkspaceDeleted,
  } = config;
  const auth = requireAuth(authConfig);

  /**
   * Best-effort speaker upsert (#383). Wrapped so every join-path
   * call-site is a one-liner and we never let speaker-bookkeeping
   * break a workspace join.
   *
   * `seedName` is used only when the row is being created for the
   * first time; an existing speaker row already carries the agent's
   * preferred-name learnings and we don't want to clobber them.
   */
  const tryUpsertSpeaker = (
    workspaceId: string,
    userId: string,
    seedName: string | null
  ): void => {
    if (!speakerRepository) return;
    try {
      speakerRepository.upsertForUser(workspaceId, userId, {
        preferredName: seedName,
      });
    } catch (err) {
      console.warn('[Workspaces] Speaker upsert failed (non-fatal):', err);
    }
  };

  // Public kiosk-facing client config (no auth required).
  //
  // Returns only flags safe to expose without authentication so that anonymous
  // kiosk displays can adapt their UI. Currently exposes the issue #340
  // footer-ticker toggle and the issue #410 STT-engine selector. Mirrors WS
  // auth-less access: kiosks register over WebSocket without a session.
  //
  // Issue #410: `sttEngine` is the workspace default. The kiosk/mobile mode
  // resolves the effective engine as `device.config.stt_engine ?? sttEngine
  // ?? 'web-speech'`. The engine name itself is not sensitive — the
  // Deepgram API key never leaves the server, and any hosted-STT session
  // is gated independently by the auth'd `POST /api/stt/token` broker.
  router.get('/:id/kiosk-config', async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      const settings = workspaceRepository.getSettings(workspace.id);
      res.json({
        workspaceId: workspace.id,
        kioskFooterTickersEnabled: settings?.kioskFooterTickersEnabled ?? false,
        sttEngine: settings?.sttEngine ?? 'web-speech',
      });
    } catch (err) {
      console.error('[Workspaces] Get kiosk-config error:', err);
      res.status(500).json({ error: 'Failed to get kiosk config' });
    }
  });

  // List user's workspaces
  router.get('/', auth, async (req: Request, res: Response) => {
    try {
      const workspaces = workspaceRepository.findAccessible(req.user!.id);
      const result = workspaces.map(w => ({
        ...w,
        isOwner: w.ownerId === req.user!.id,
      }));
      res.json(result);
    } catch (err) {
      console.error('[Workspaces] List error:', err);
      res.status(500).json({ error: 'Failed to list workspaces' });
    }
  });

  // Create workspace
  router.post('/', auth, async (req: Request, res: Response) => {
    try {
      const input = req.body as WorkspaceCreateInput;
      
      if (!input.name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const workspace = workspaceRepository.create(req.user!.id, input);
      res.status(201).json(workspace);
    } catch (err) {
      console.error('[Workspaces] Create error:', err);
      const message = (err as Error).message;
      if (message.includes('Invalid')) {
        res.status(400).json({ error: message });
      } else {
        res.status(500).json({ error: 'Failed to create workspace' });
      }
    }
  });

  // Get workspace by ID
  router.get('/:id', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.canAccess(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      res.json({
        ...workspace,
        isOwner: workspace.ownerId === req.user!.id,
      });
    } catch (err) {
      console.error('[Workspaces] Get error:', err);
      res.status(500).json({ error: 'Failed to get workspace' });
    }
  });

  // Update workspace
  router.patch('/:id', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can update workspace' });
        return;
      }

      const input = req.body as WorkspaceUpdateInput;
      const updated = workspaceRepository.update(workspace.id, input);
      
      res.json({
        ...updated,
        isOwner: true,
      });
    } catch (err) {
      console.error('[Workspaces] Update error:', err);
      const message = (err as Error).message;
      if (message.includes('Invalid') || message.includes('taken')) {
        res.status(400).json({ error: message });
      } else {
        res.status(500).json({ error: 'Failed to update workspace' });
      }
    }
  });

  // Get deletion preview (counts of items to be deleted)
  router.get('/:id/deletion-preview', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can view deletion preview' });
        return;
      }

      const counts = workspaceRepository.getDeletionCounts(workspace.id);
      res.json(counts);
    } catch (err) {
      console.error('[Workspaces] Deletion preview error:', err);
      res.status(500).json({ error: 'Failed to get deletion preview' });
    }
  });

  // Delete workspace
  router.delete('/:id', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can delete workspace' });
        return;
      }

      // Log deletion initiation before any changes
      console.log('[Audit] Workspace deletion initiated:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ownerId: workspace.ownerId,
        deletedBy: req.user!.id,
      });

      // Delete messages and workspace atomically in a transaction
      const deletedMessages = workspaceRepository.deleteWorkspaceWithMessages(workspace.id);

      // Disconnect active WebSocket connections AFTER successful DB transaction
      // This ensures we only disconnect devices if the workspace was actually deleted
      if (onWorkspaceDeleted) {
        try {
          onWorkspaceDeleted(workspace.id);
        } catch (err) {
          // Log but don't fail the request - workspace is already deleted
          console.error('[Audit] Error disconnecting workspace devices:', {
            workspaceId: workspace.id,
            error: err,
          });
        }
      }

      // Log deletion completion
      console.log('[Audit] Workspace deletion completed:', {
        workspaceId: workspace.id,
        deletedMessages,
      });

      res.status(204).send();
    } catch (err) {
      console.error('[Audit] Workspace deletion failed:', {
        workspaceId: req.params.id,
        error: err,
      });
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  });

  // Regenerate join code
  router.post('/:id/regenerate-code', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can regenerate join code' });
        return;
      }

      const newCode = workspaceRepository.regenerateJoinCode(workspace.id);
      res.json({ joinCode: newCode });
    } catch (err) {
      console.error('[Workspaces] Regenerate code error:', err);
      res.status(500).json({ error: 'Failed to regenerate join code' });
    }
  });

  // Join workspace via code
  router.post('/join', auth, async (req: Request, res: Response) => {
    try {
      const { code } = req.body as { code: string };
      
      if (!code) {
        res.status(400).json({ error: 'Join code is required' });
        return;
      }

      const workspace = workspaceRepository.findByJoinCode(code);
      
      if (!workspace) {
        res.status(404).json({ error: 'Invalid join code' });
        return;
      }

      // Add user as member if not already
      if (!workspaceRepository.canAccess(workspace.id, req.user!.id)) {
        workspaceRepository.addMember(workspace.id, req.user!.id);
      }
      // Seed (or touch) the workspace-scoped speaker row for this user
      // (#383). Best-effort — never block the join on speaker bookkeeping.
      tryUpsertSpeaker(workspace.id, req.user!.id, req.user!.displayName ?? req.user!.username);

      res.json({
        ...workspace,
        isOwner: workspace.ownerId === req.user!.id,
      });
    } catch (err) {
      console.error('[Workspaces] Join error:', err);
      res.status(500).json({ error: 'Failed to join workspace' });
    }
  });

  // Auto-join workspace by ID (for QR code session links)
  // Automatically adds the authenticated user as a member if they're not already
  // Security: Checks workspace's allowAutoJoin setting before allowing join
  // Security: Validates QR token if workspace.requireQrToken is enabled
  // Rate limited to prevent workspace ID enumeration and bulk joining
  router.post('/:id/auto-join', auth, autoJoinLimiter, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Check if user is already a member
      const wasAlreadyMember = workspaceRepository.canAccess(workspace.id, req.user!.id);
      
      if (!wasAlreadyMember) {
        // Check if auto-join is allowed for this workspace
        const settings = workspaceRepository.getSettings(workspace.id);
        // Security fallback behavior:
        // - Old workspaces with settings: respect explicit setting (migration sets 1)
        // - Old workspaces without settings: deny (security-first fallback)
        // - New workspaces: WorkspaceRepository.create() sets allowAutoJoin=0
        // 
        // NOTE: The false fallback ensures security-first for any edge case where
        // a workspace exists without a settings row. While migration 007 adds
        // DEFAULT 1 for existing settings rows, any workspace without a settings
        // row (e.g., data corruption, manual DB edits) will default to secure.
        const allowAutoJoin = settings?.allowAutoJoin ?? false;
        
        if (!allowAutoJoin) {
          console.log('[Workspaces] Auto-join denied - disabled for workspace:', {
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            userId: req.user!.id,
          });
          res.status(403).json({ 
            error: 'Auto-join is disabled for this workspace. Please use a join code.' 
          });
          return;
        }

        // Check if QR token is required for this workspace
        const requireQrToken = settings?.requireQrToken ?? false;
        if (requireQrToken) {
          const qrTokenParam = req.query.qr as string | undefined;
          
          if (!qrTokenParam) {
            console.log('[Workspaces] Auto-join denied - QR token required but not provided:', {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              userId: req.user!.id,
            });
            res.status(403).json({
              error: 'Invalid or expired QR code. Please scan a valid QR code to join.',
              code: 'QR_TOKEN_REQUIRED',
            });
            return;
          }

          // Validate QR token
          if (!qrTokenRepository) {
            console.error('[Workspaces] QR token repository not configured but requireQrToken is enabled');
            res.status(500).json({ error: 'QR token validation not available' });
            return;
          }

          const validation = qrTokenRepository.validate(qrTokenParam, workspace.id);
          if (!validation.valid) {
            const errorMessages: Record<string, string> = {
              NOT_FOUND: 'Invalid or expired QR code. Please scan again.',
              EXPIRED: 'QR code has expired. Please scan a new QR code.',
              WORKSPACE_MISMATCH: 'This QR code is for a different workspace.',
              SESSION_MISMATCH: 'This QR code is for a different session.',
            };
            
            console.log('[Workspaces] Auto-join denied - QR token validation failed:', {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              userId: req.user!.id,
              error: validation.error,
            });
            
            res.status(403).json({
              error: errorMessages[validation.error!] || 'Invalid QR code.',
              code: `QR_TOKEN_${validation.error}`,
            });
            return;
          }
          
          console.log('[Workspaces] QR token validated successfully:', {
            workspaceId: workspace.id,
            tokenId: validation.token?.id,
            userId: req.user!.id,
          });
        }

        // Add user as member
        try {
          workspaceRepository.addMember(workspace.id, req.user!.id);
        } catch (err) {
          console.error('[Workspaces] Failed to add member:', err);
          res.status(500).json({ error: 'Failed to join workspace. Please try again.' });
          return;
        }
        // Seed (or touch) the workspace-scoped speaker row for this user
        // (#383). Best-effort — never block the join on speaker bookkeeping.
        tryUpsertSpeaker(workspace.id, req.user!.id, req.user!.displayName ?? req.user!.username);
        
        // Audit log for successful auto-join
        console.log('[Workspaces] Auto-join successful:', {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          userId: req.user!.id,
          hadQrToken: !!req.query.qr,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...workspace,
        isOwner: workspace.ownerId === req.user!.id,
        joined: !wasAlreadyMember,
      });
    } catch (err) {
      console.error('[Workspaces] Auto-join error:', err);
      res.status(500).json({ error: 'Failed to join workspace' });
    }
  });

  // Get workspace settings (owner only, API keys masked)
  router.get('/:id/settings', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can view settings' });
        return;
      }

      const settings = workspaceRepository.getSettings(workspace.id);
      
      // Return settings with API key presence indicators (but not the keys themselves)
      res.json({
        workspaceId: workspace.id,
        hasApiKey: !!settings?.openhandsApiKeyEncrypted,
        ttsVoice: settings?.ttsVoice ?? null,
        sttLanguage: settings?.sttLanguage ?? null,
        allowAutoJoin: settings?.allowAutoJoin ?? false,  // Default to false (security-first)
        requireQrToken: settings?.requireQrToken ?? false,  // Default to false (backward compat)
        hasElevenlabsApiKey: !!settings?.elevenlabsApiKeyEncrypted,
        elevenlabsVoiceId: settings?.elevenlabsVoiceId ?? null,
        elevenlabsTtsEnabled: settings?.elevenlabsTtsEnabled ?? false,
        kioskFooterTickersEnabled: settings?.kioskFooterTickersEnabled ?? false,
        defaultAgentPrompt: settings?.defaultAgentPrompt ?? null,
        // Issue #386: hosted-STT settings. The API key itself is masked
        // and only reported via the boolean `hasDeepgramApiKey` flag.
        sttEngine: settings?.sttEngine ?? 'web-speech',
        sttMonthlyMinuteCap: settings?.sttMonthlyMinuteCap ?? null,
        hasDeepgramApiKey: !!settings?.deepgramApiKeyEncrypted,
        updatedAt: settings?.updatedAt ?? null,
      });
    } catch (err) {
      console.error('[Workspaces] Get settings error:', err);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  // Update workspace settings
  router.patch('/:id/settings', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can update settings' });
        return;
      }

      const body = req.body as {
        ttsVoice?: string;
        sttLanguage?: string;
        allowAutoJoin?: boolean;
        requireQrToken?: boolean;
        elevenlabsVoiceId?: string;
        elevenlabsTtsEnabled?: boolean;
        kioskFooterTickersEnabled?: boolean;
        defaultAgentPrompt?: string | null;
        // Issue #386
        sttEngine?: 'web-speech' | 'deepgram';
        sttMonthlyMinuteCap?: number | null;
      };
      const {
        ttsVoice,
        sttLanguage,
        allowAutoJoin,
        requireQrToken,
        elevenlabsVoiceId,
        elevenlabsTtsEnabled,
        kioskFooterTickersEnabled,
        sttEngine,
      } = body;

      // Issue #386: validate engine + cap shape. The repo layer accepts
      // any string in the column, but we want to reject typos before
      // they land in the DB.
      if (sttEngine !== undefined && sttEngine !== 'web-speech' && sttEngine !== 'deepgram') {
        res.status(400).json({
          error: "sttEngine must be 'web-speech' or 'deepgram'",
        });
        return;
      }
      const capProvided = 'sttMonthlyMinuteCap' in body;
      if (capProvided) {
        const cap = body.sttMonthlyMinuteCap;
        if (
          cap !== null &&
          (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0)
        ) {
          res.status(400).json({
            error: 'sttMonthlyMinuteCap must be a non-negative number or null',
          });
          return;
        }
      }

      // Validate workspace-default agent prompt (issue #378). String or
      // null only; over-cap values are rejected with 400.
      const promptKeyProvided = 'defaultAgentPrompt' in body;
      if (promptKeyProvided) {
        const v = body.defaultAgentPrompt;
        if (v !== null && typeof v !== 'string') {
          res.status(400).json({ error: 'defaultAgentPrompt must be a string or null' });
          return;
        }
        if (typeof v === 'string' && v.length > MAX_AGENT_PROMPT_LENGTH) {
          res.status(400).json({
            error: `defaultAgentPrompt exceeds ${MAX_AGENT_PROMPT_LENGTH} character limit`,
          });
          return;
        }
      }

      // Note: API key encryption is handled by separate endpoints
      // This updates non-sensitive settings
      const settings = workspaceRepository.updateSettings(workspace.id, {
        ttsVoice,
        sttLanguage,
        allowAutoJoin,
        requireQrToken,
        elevenlabsVoiceId,
        elevenlabsTtsEnabled,
        kioskFooterTickersEnabled,
        // Forward the explicit-null intent. The repository checks
        // `'defaultAgentPrompt' in settings` to distinguish "leave alone"
        // from "set to null".
        ...(promptKeyProvided ? { defaultAgentPrompt: body.defaultAgentPrompt ?? null } : {}),
        ...(sttEngine !== undefined ? { sttEngine } : {}),
        // Same explicit-null dance as `defaultAgentPrompt`: forwarding
        // the key only when present preserves "leave alone" semantics
        // for callers that omit the cap field entirely.
        ...(capProvided ? { sttMonthlyMinuteCap: body.sttMonthlyMinuteCap ?? null } : {}),
      });

      res.json({
        workspaceId: workspace.id,
        hasApiKey: !!settings.openhandsApiKeyEncrypted,
        ttsVoice: settings.ttsVoice,
        sttLanguage: settings.sttLanguage,
        allowAutoJoin: settings.allowAutoJoin,
        requireQrToken: settings.requireQrToken,
        hasElevenlabsApiKey: !!settings.elevenlabsApiKeyEncrypted,
        elevenlabsVoiceId: settings.elevenlabsVoiceId,
        elevenlabsTtsEnabled: settings.elevenlabsTtsEnabled,
        kioskFooterTickersEnabled: settings.kioskFooterTickersEnabled,
        defaultAgentPrompt: settings.defaultAgentPrompt,
        sttEngine: settings.sttEngine,
        sttMonthlyMinuteCap: settings.sttMonthlyMinuteCap,
        hasDeepgramApiKey: !!settings.deepgramApiKeyEncrypted,
        updatedAt: settings.updatedAt,
      });
    } catch (err) {
      console.error('[Workspaces] Update settings error:', err);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Set API key (encrypted storage)
  router.put('/:id/settings/api-key', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can set API key' });
        return;
      }

      const { apiKey } = req.body as { apiKey: string };
      
      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'API key is required' });
        return;
      }

      if (!isValidApiKeyFormat(apiKey)) {
        res.status(400).json({ error: 'Invalid API key format' });
        return;
      }

      // Encrypt and store the API key
      const encrypted = encryptApiKey(apiKey);
      workspaceRepository.updateSettings(workspace.id, {
        openhandsApiKeyEncrypted: encrypted.encrypted,
        openhandsApiKeyIv: encrypted.iv,
        openhandsApiKeyTag: encrypted.tag,
      });

      // Audit log (without revealing the key)
      console.log('[Workspaces] API key set:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: req.user!.id,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, hasApiKey: true });
    } catch (err) {
      console.error('[Workspaces] Set API key error:', err);
      res.status(500).json({ error: 'Failed to set API key' });
    }
  });

  // Test API key connectivity
  router.post('/:id/settings/api-key/test', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can test API key' });
        return;
      }

      // Use provided API key or get stored one
      const { apiKey: providedKey } = req.body as { apiKey?: string };
      let apiKeyToTest: string | null = null;

      if (providedKey) {
        apiKeyToTest = providedKey;
      } else {
        // Get stored API key
        const settings = workspaceRepository.getSettings(workspace.id);
        if (settings?.openhandsApiKeyEncrypted && settings?.openhandsApiKeyIv && settings?.openhandsApiKeyTag) {
          try {
            apiKeyToTest = decryptApiKey({
              encrypted: settings.openhandsApiKeyEncrypted,
              iv: settings.openhandsApiKeyIv,
              tag: settings.openhandsApiKeyTag,
            });
          } catch (decryptErr) {
            console.error('[Workspaces] Failed to decrypt API key:', decryptErr);
            res.json({ valid: false, message: 'Failed to decrypt stored API key' });
            return;
          }
        }
      }

      if (!apiKeyToTest) {
        res.json({ valid: false, message: 'No API key configured' });
        return;
      }

      // Test the API key by making a lightweight request to OpenHands
      try {
        const response = await fetch('https://app.all-hands.dev/api/conversations', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKeyToTest}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          res.json({ valid: true, message: 'API key is valid' });
        } else if (response.status === 401 || response.status === 403) {
          res.json({ valid: false, message: 'Invalid or expired API key' });
        } else {
          res.json({ valid: false, message: `OpenHands API returned status ${response.status}` });
        }
      } catch (fetchErr) {
        const message = fetchErr instanceof Error ? fetchErr.message : 'Unknown error';
        console.error('[Workspaces] API key test fetch error:', message);
        res.json({ valid: false, message: 'Failed to connect to OpenHands API' });
      }
    } catch (err) {
      console.error('[Workspaces] Test API key error:', err);
      res.status(500).json({ error: 'Failed to test API key' });
    }
  });

  // Remove API key
  router.delete('/:id/settings/api-key', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can remove API key' });
        return;
      }

      workspaceRepository.clearApiKey(workspace.id);

      // Audit log
      console.log('[Workspaces] API key removed:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: req.user!.id,
        timestamp: new Date().toISOString(),
      });

      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Remove API key error:', err);
      res.status(500).json({ error: 'Failed to remove API key' });
    }
  });

  // Set ElevenLabs API key (encrypted storage)
  router.put('/:id/settings/elevenlabs-api-key', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can set ElevenLabs API key' });
        return;
      }

      const { apiKey } = req.body as { apiKey?: string };

      if (!apiKey) {
        res.status(400).json({ error: 'API key is required' });
        return;
      }

      // Basic format validation (ElevenLabs keys are typically 32 characters)
      if (apiKey.length < 20 || apiKey.length > 100) {
        res.status(400).json({ error: 'Invalid ElevenLabs API key format' });
        return;
      }

      // Encrypt and store the API key
      const encrypted = encryptApiKey(apiKey);
      workspaceRepository.updateSettings(workspace.id, {
        elevenlabsApiKeyEncrypted: encrypted.encrypted,
        elevenlabsApiKeyIv: encrypted.iv,
        elevenlabsApiKeyTag: encrypted.tag,
      });

      // Audit log (don't log the actual key)
      console.log('[Workspaces] ElevenLabs API key updated:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: req.user!.id,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Workspaces] Set ElevenLabs API key error:', err);
      res.status(500).json({ error: 'Failed to set ElevenLabs API key' });
    }
  });

  // Test ElevenLabs API key
  router.post('/:id/settings/elevenlabs-api-key/test', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can test ElevenLabs API key' });
        return;
      }

      const { apiKey } = req.body as { apiKey?: string };
      let keyToTest: string | undefined = apiKey;

      // If no key provided in request, use stored key
      if (!keyToTest) {
        const settings = workspaceRepository.getSettings(workspace.id);
        if (settings?.elevenlabsApiKeyEncrypted && settings?.elevenlabsApiKeyIv && settings?.elevenlabsApiKeyTag) {
          try {
            keyToTest = decryptApiKey({
              encrypted: settings.elevenlabsApiKeyEncrypted,
              iv: settings.elevenlabsApiKeyIv,
              tag: settings.elevenlabsApiKeyTag,
            });
          } catch (err) {
            res.status(500).json({ valid: false, message: 'Failed to decrypt stored key' });
            return;
          }
        }
      }

      if (!keyToTest) {
        res.status(400).json({ valid: false, message: 'No ElevenLabs API key available to test' });
        return;
      }

      // Import the test function from TTS module
      const { testApiKey: testElevenlabsKey } = await import('../tts/elevenlabs.js');
      const result = await testElevenlabsKey(keyToTest);

      res.json(result);
    } catch (err) {
      console.error('[Workspaces] Test ElevenLabs API key error:', err);
      res.status(500).json({ valid: false, message: 'Failed to test ElevenLabs API key' });
    }
  });

  // Remove ElevenLabs API key
  router.delete('/:id/settings/elevenlabs-api-key', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can remove ElevenLabs API key' });
        return;
      }

      workspaceRepository.clearElevenlabsApiKey(workspace.id);

      // Audit log
      console.log('[Workspaces] ElevenLabs API key removed:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: req.user!.id,
        timestamp: new Date().toISOString(),
      });

      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Remove ElevenLabs API key error:', err);
      res.status(500).json({ error: 'Failed to remove ElevenLabs API key' });
    }
  });

  // Issue #386: Set the workspace's Deepgram API key (encrypted at rest).
  //
  // Mirrors the ElevenLabs endpoint shape. The plaintext key never
  // touches storage; only the AES-256-GCM ciphertext + IV + auth tag
  // are persisted. Audit logging is by key presence only — the key
  // itself is never written to logs.
  router.put('/:id/settings/deepgram-api-key', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can set Deepgram API key' });
        return;
      }

      const { apiKey } = req.body as { apiKey?: string };
      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'API key is required' });
        return;
      }
      // Deepgram keys are ~40-character base64-ish strings; reuse the
      // generic length sanity check from the existing
      // `isValidApiKeyFormat` helper.
      if (!isValidApiKeyFormat(apiKey)) {
        res.status(400).json({ error: 'Invalid Deepgram API key format' });
        return;
      }

      const encrypted = encryptApiKey(apiKey);
      workspaceRepository.updateSettings(workspace.id, {
        deepgramApiKeyEncrypted: encrypted.encrypted,
        deepgramApiKeyIv: encrypted.iv,
        deepgramApiKeyTag: encrypted.tag,
      });

      console.log('[Workspaces] Deepgram API key set:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: req.user!.id,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, hasDeepgramApiKey: true });
    } catch (err) {
      console.error('[Workspaces] Set Deepgram API key error:', err);
      res.status(500).json({ error: 'Failed to set Deepgram API key' });
    }
  });

  // Issue #386: Remove the workspace's Deepgram API key. This also
  // resets the engine to `'web-speech'` (handled in the repository) so
  // the next token-broker request returns 403 rather than 503.
  router.delete('/:id/settings/deepgram-api-key', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can remove Deepgram API key' });
        return;
      }
      workspaceRepository.clearDeepgramApiKey(workspace.id);
      console.log('[Workspaces] Deepgram API key removed:', {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: req.user!.id,
        timestamp: new Date().toISOString(),
      });
      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Remove Deepgram API key error:', err);
      res.status(500).json({ error: 'Failed to remove Deepgram API key' });
    }
  });

  // Fetch available ElevenLabs voices
  router.get('/:id/settings/elevenlabs-voices', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can view ElevenLabs voices' });
        return;
      }

      // Get stored key
      const settings = workspaceRepository.getSettings(workspace.id);
      if (!settings?.elevenlabsApiKeyEncrypted || !settings?.elevenlabsApiKeyIv || !settings?.elevenlabsApiKeyTag) {
        res.status(400).json({ error: 'ElevenLabs API key not configured' });
        return;
      }

      const apiKey = decryptApiKey({
        encrypted: settings.elevenlabsApiKeyEncrypted,
        iv: settings.elevenlabsApiKeyIv,
        tag: settings.elevenlabsApiKeyTag,
      });

      // Import and use the fetch voices function
      const { fetchVoices } = await import('../tts/elevenlabs.js');
      const voices = await fetchVoices(apiKey);

      res.json({ voices });
    } catch (err) {
      console.error('[Workspaces] Fetch ElevenLabs voices error:', err);
      res.status(500).json({ error: 'Failed to fetch ElevenLabs voices' });
    }
  });

  // Generate voice preview (synthesize dad joke with selected voice)
  router.post('/:id/settings/voice-preview', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can generate voice previews' });
        return;
      }

      const { voiceId } = req.body as { voiceId?: string };
      if (!voiceId) {
        res.status(400).json({ error: 'voiceId is required' });
        return;
      }

      // Get stored ElevenLabs API key
      const settings = workspaceRepository.getSettings(workspace.id);
      if (!settings?.elevenlabsApiKeyEncrypted || !settings?.elevenlabsApiKeyIv || !settings?.elevenlabsApiKeyTag) {
        res.status(400).json({ error: 'ElevenLabs API key not configured' });
        return;
      }

      const apiKey = decryptApiKey({
        encrypted: settings.elevenlabsApiKeyEncrypted,
        iv: settings.elevenlabsApiKeyIv,
        tag: settings.elevenlabsApiKeyTag,
      });

      // Get a random dad joke and synthesize it
      const { synthesizeToBuffer, getRandomJoke } = await import('../tts/index.js');
      const joke = getRandomJoke();
      
      console.log(`[Workspaces] Generating voice preview for workspace ${workspace.id}: "${joke.substring(0, 30)}..."`);
      
      const audioBuffer = await synthesizeToBuffer(joke, apiKey, voiceId);
      const audioBase64 = audioBuffer.toString('base64');

      res.json({ audio: audioBase64 });
    } catch (err) {
      console.error('[Workspaces] Voice preview error:', err);
      const message = (err as Error).message;
      if (message.includes('timeout')) {
        res.status(504).json({ error: 'Voice synthesis timed out' });
      } else {
        res.status(500).json({ error: 'Failed to generate voice preview' });
      }
    }
  });

  // List workspace members
  router.get('/:id/members', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.canAccess(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const members = workspaceRepository.getMembers(workspace.id);
      res.json(members);
    } catch (err) {
      console.error('[Workspaces] List members error:', err);
      res.status(500).json({ error: 'Failed to list members' });
    }
  });

  // Remove member (owner only)
  router.delete('/:id/members/:userId', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can remove members' });
        return;
      }

      // Cannot remove owner
      if (req.params.userId === workspace.ownerId) {
        res.status(400).json({ error: 'Cannot remove workspace owner' });
        return;
      }

      workspaceRepository.removeMember(workspace.id, req.params.userId);
      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Remove member error:', err);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  });

  // List devices in workspace
  router.get('/:id/devices', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (!workspaceRepository.canAccess(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (!deviceRepository) {
        res.status(503).json({ error: 'Device repository not available' });
        return;
      }

      const devices = deviceRepository.findByWorkspace(workspace.id);
      res.json({
        devices: devices.map(d => ({
          id: d.id,
          name: d.name,
          mode: d.mode,
          lastSeenAt: d.lastSeenAt,
          createdAt: d.createdAt,
        })),
      });
    } catch (err) {
      console.error('[Workspaces] List devices error:', err);
      res.status(500).json({ error: 'Failed to list devices' });
    }
  });

  // Remove device from workspace (owner only)
  router.delete('/:id/devices/:deviceId', auth, async (req: Request, res: Response) => {
    try {
      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Only owner can remove devices
      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can remove devices' });
        return;
      }

      if (!deviceRepository) {
        res.status(503).json({ error: 'Device repository not available' });
        return;
      }

      const device = deviceRepository.findById(req.params.deviceId);
      if (!device || device.workspaceId !== workspace.id) {
        res.status(404).json({ error: 'Device not found in workspace' });
        return;
      }

      // 1. Remove from all sessions (if session repository available)
      if (sessionRepository) {
        sessionRepository.removeDeviceFromAll(req.params.deviceId);
      }

      // 2. Notify device via WebSocket before deleting (if callback provided)
      // The callback sends the removal notification, disconnects WebSocket, and broadcasts device list
      if (onDeviceRemoved) {
        onDeviceRemoved(req.params.deviceId, workspace.id);
      }

      // 3. Delete device record (implicitly revokes token)
      deviceRepository.delete(req.params.deviceId);

      console.log('[Workspaces] Device removed:', {
        deviceId: req.params.deviceId,
        workspaceId: workspace.id,
        removedBy: req.user!.id,
      });

      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Remove device error:', err);
      res.status(500).json({ error: 'Failed to remove device' });
    }
  });

  // === Join Request Endpoints ===

  // Create join request (when allowAutoJoin=false)
  // Rate limited to prevent spam
  router.post('/:id/request-join', auth, requestJoinLimiter, async (req: Request, res: Response) => {
    try {
      if (!joinRequestRepository) {
        res.status(503).json({ error: 'Join request feature not available' });
        return;
      }

      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Check if user is already a member - no need for request
      if (workspaceRepository.canAccess(workspace.id, req.user!.id)) {
        res.status(400).json({ 
          error: 'Already a member of this workspace',
          alreadyMember: true,
        });
        return;
      }

      // Check if auto-join is enabled - should use auto-join instead
      const settings = workspaceRepository.getSettings(workspace.id);
      if (settings?.allowAutoJoin) {
        res.status(400).json({
          error: 'Auto-join is enabled for this workspace. Use auto-join endpoint instead.',
          code: 'AUTO_JOIN_ENABLED',
        });
        return;
      }

      // Create the join request
      const request = joinRequestRepository.create(workspace.id, req.user!.id);

      // NOTE: We intentionally do NOT accept deviceId from request body.
      // Tracking is by userId (from authenticated JWT) to prevent spoofing.
      // WebSocket notification will be sent to all connected devices in the workspace
      // when the request is resolved.

      // Fetch user info for the notification
      const user = {
        id: req.user!.id,
        username: req.user!.username,
        displayName: (req.user as { displayName?: string | null }).displayName ?? null,
        avatarUrl: (req.user as { avatarUrl?: string | null }).avatarUrl ?? null,
      };

      // Broadcast to owner's kiosk devices via WebSocket
      if (onJoinRequest) {
        onJoinRequest(workspace.id, {
          id: request.id,
          workspaceId: workspace.id,
          user,
          createdAt: request.createdAt,
        });
      }

      // Audit log
      console.log('[Workspaces] Join request created:', {
        requestId: request.id,
        workspaceId: workspace.id,
        userId: req.user!.id,
        timestamp: request.createdAt,
      });

      res.status(201).json({
        requestId: request.id,
        status: request.status,
        createdAt: request.createdAt,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });
    } catch (err) {
      console.error('[Workspaces] Request join error:', err);
      res.status(500).json({ error: 'Failed to create join request' });
    }
  });

  // List pending join requests for a workspace (owner only)
  router.get('/:id/requests', auth, async (req: Request, res: Response) => {
    try {
      if (!joinRequestRepository) {
        res.status(503).json({ error: 'Join request feature not available' });
        return;
      }

      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Only owner can view join requests
      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can view join requests' });
        return;
      }

      const requests = joinRequestRepository.findPendingByWorkspace(workspace.id);
      res.json({
        requests: requests.map(r => ({
          id: r.id,
          user: r.user,
          status: r.status,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      console.error('[Workspaces] List requests error:', err);
      res.status(500).json({ error: 'Failed to list join requests' });
    }
  });

  // Approve a join request (owner only)
  router.post('/:id/requests/:requestId/approve', auth, async (req: Request, res: Response) => {
    try {
      if (!joinRequestRepository) {
        res.status(503).json({ error: 'Join request feature not available' });
        return;
      }

      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Only owner can approve requests
      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can approve join requests' });
        return;
      }

      const request = joinRequestRepository.findById(req.params.requestId);
      if (!request || request.workspaceId !== workspace.id) {
        res.status(404).json({ error: 'Join request not found' });
        return;
      }

      if (request.status !== 'pending') {
        res.status(400).json({ error: `Request already ${request.status}` });
        return;
      }

      // Check if request has expired (>5 minutes old)
      if (joinRequestRepository.isExpired(request)) {
        joinRequestRepository.expire(request.id);
        res.status(400).json({ error: 'Request has expired' });
        return;
      }

      // Approve the request
      const updated = joinRequestRepository.approve(request.id, req.user!.id);
      if (!updated) {
        res.status(500).json({ error: 'Failed to approve request' });
        return;
      }

      // Add user as member
      workspaceRepository.addMember(workspace.id, request.userId);
      // Seed (or touch) the workspace-scoped speaker row (#383).
      tryUpsertSpeaker(workspace.id, request.userId, null);

      // Notify the requesting user via WebSocket
      if (onJoinResolved) {
        onJoinResolved(
          request.id,
          true,
          {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
          }
        );
      }

      res.json({
        success: true,
        request: {
          id: updated.id,
          status: updated.status,
          resolvedAt: updated.resolvedAt,
        },
      });
    } catch (err) {
      console.error('[Workspaces] Approve request error:', err);
      res.status(500).json({ error: 'Failed to approve join request' });
    }
  });

  // Deny a join request (owner only)
  router.post('/:id/requests/:requestId/deny', auth, async (req: Request, res: Response) => {
    try {
      if (!joinRequestRepository) {
        res.status(503).json({ error: 'Join request feature not available' });
        return;
      }

      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Only owner can deny requests
      if (!workspaceRepository.isOwner(workspace.id, req.user!.id)) {
        res.status(403).json({ error: 'Only owner can deny join requests' });
        return;
      }

      const request = joinRequestRepository.findById(req.params.requestId);
      if (!request || request.workspaceId !== workspace.id) {
        res.status(404).json({ error: 'Join request not found' });
        return;
      }

      if (request.status !== 'pending') {
        res.status(400).json({ error: `Request already ${request.status}` });
        return;
      }

      // Check if request has expired (>5 minutes old)
      if (joinRequestRepository.isExpired(request)) {
        joinRequestRepository.expire(request.id);
        res.status(400).json({ error: 'Request has expired' });
        return;
      }

      // Deny the request
      const updated = joinRequestRepository.deny(request.id, req.user!.id);
      if (!updated) {
        res.status(500).json({ error: 'Failed to deny request' });
        return;
      }

      // Notify the requesting user via WebSocket
      if (onJoinResolved) {
        onJoinResolved(
          request.id,
          false,
          undefined,
          'Request denied by workspace owner'
        );
      }

      res.json({
        success: true,
        request: {
          id: updated.id,
          status: updated.status,
          resolvedAt: updated.resolvedAt,
        },
      });
    } catch (err) {
      console.error('[Workspaces] Deny request error:', err);
      res.status(500).json({ error: 'Failed to deny join request' });
    }
  });

  // Cancel own join request (requesting user only)
  router.delete('/:id/requests/:requestId', auth, async (req: Request, res: Response) => {
    try {
      if (!joinRequestRepository) {
        res.status(503).json({ error: 'Join request feature not available' });
        return;
      }

      const workspace = workspaceRepository.findById(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const request = joinRequestRepository.findById(req.params.requestId);
      if (!request || request.workspaceId !== workspace.id) {
        res.status(404).json({ error: 'Join request not found' });
        return;
      }

      // Only the requesting user can cancel their own request
      if (request.userId !== req.user!.id) {
        res.status(403).json({ error: 'Can only cancel your own join request' });
        return;
      }

      const success = joinRequestRepository.cancel(request.id, req.user!.id);
      if (!success) {
        res.status(400).json({ error: 'Request cannot be cancelled (already resolved or not yours)' });
        return;
      }

      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Cancel request error:', err);
      res.status(500).json({ error: 'Failed to cancel join request' });
    }
  });

  // Get status of a specific join request (for polling by requesting user)
  router.get('/:id/requests/:requestId/status', auth, async (req: Request, res: Response) => {
    try {
      if (!joinRequestRepository) {
        res.status(503).json({ error: 'Join request feature not available' });
        return;
      }

      const request = joinRequestRepository.findById(req.params.requestId);
      if (!request || request.workspaceId !== req.params.id) {
        res.status(404).json({ error: 'Join request not found' });
        return;
      }

      // Only the requesting user or workspace owner can check status
      const workspace = workspaceRepository.findById(req.params.id);
      const isOwner = workspace && workspaceRepository.isOwner(workspace.id, req.user!.id);
      
      if (request.userId !== req.user!.id && !isOwner) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Check if expired (but not yet marked as such in DB)
      if (request.status === 'pending' && joinRequestRepository.isExpired(request)) {
        joinRequestRepository.expire(request.id);
        res.json({
          id: request.id,
          status: 'expired',
          createdAt: request.createdAt,
          resolvedAt: new Date().toISOString(),
        });
        return;
      }

      res.json({
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
        resolvedAt: request.resolvedAt,
        ...(request.status === 'approved' && workspace ? {
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
          },
        } : {}),
      });
    } catch (err) {
      console.error('[Workspaces] Get request status error:', err);
      res.status(500).json({ error: 'Failed to get request status' });
    }
  });

  return router;
}
