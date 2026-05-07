import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { WorkspaceRepository } from './workspace-repository.js';
import type { JoinRequestRepository } from './join-request-repository.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import type { QrTokenRepository } from '../qr-tokens/index.js';
import type { WorkspaceCreateInput, WorkspaceUpdateInput } from './types.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';
import { encryptApiKey, decryptApiKey, isValidApiKeyFormat } from './encryption.js';

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
  authConfig: AuthMiddlewareConfig;
  /** Callback to broadcast join request to owner's kiosk devices */
  onJoinRequest?: (workspaceId: string, request: {
    id: string;
    workspaceId: string;
    user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
    createdAt: string;
  }, deviceId?: string) => void;
  /** Callback to send join-resolved to the requesting user's device */
  onJoinResolved?: (requestId: string, approved: boolean, workspace?: {
    id: string;
    name: string;
    slug: string;
  }, error?: string) => void;
}

export function createWorkspaceRouter(config: WorkspaceRouterConfig): Router {
  const router = Router();
  const { 
    workspaceRepository, 
    joinRequestRepository, 
    deviceRepository, 
    qrTokenRepository, 
    authConfig,
    onJoinRequest,
    onJoinResolved,
  } = config;
  const auth = requireAuth(authConfig);

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

      workspaceRepository.delete(workspace.id);
      res.status(204).send();
    } catch (err) {
      console.error('[Workspaces] Delete error:', err);
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

  // Get workspace settings (owner only, API key masked)
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
      
      // Return settings with API key presence indicator (but not the key itself)
      res.json({
        workspaceId: workspace.id,
        hasApiKey: !!settings?.openhandsApiKeyEncrypted,
        ttsVoice: settings?.ttsVoice ?? null,
        sttLanguage: settings?.sttLanguage ?? null,
        allowAutoJoin: settings?.allowAutoJoin ?? false,  // Default to false (security-first)
        requireQrToken: settings?.requireQrToken ?? false,  // Default to false (backward compat)
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

      const { ttsVoice, sttLanguage, allowAutoJoin, requireQrToken } = req.body as { 
        ttsVoice?: string; 
        sttLanguage?: string;
        allowAutoJoin?: boolean;
        requireQrToken?: boolean;
      };

      // Note: API key encryption would be handled by a service layer
      // For now, we just update non-sensitive settings
      const settings = workspaceRepository.updateSettings(workspace.id, {
        ttsVoice,
        sttLanguage,
        allowAutoJoin,
        requireQrToken,
      });

      res.json({
        workspaceId: workspace.id,
        hasApiKey: !!settings.openhandsApiKeyEncrypted,
        ttsVoice: settings.ttsVoice,
        sttLanguage: settings.sttLanguage,
        allowAutoJoin: settings.allowAutoJoin,
        requireQrToken: settings.requireQrToken,
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

      // Get deviceId from request body (for WebSocket notifications)
      const { deviceId } = req.body as { deviceId?: string };

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
        }, deviceId);
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

      // Approve the request
      const updated = joinRequestRepository.approve(request.id, req.user!.id);
      if (!updated) {
        res.status(500).json({ error: 'Failed to approve request' });
        return;
      }

      // Add user as member
      workspaceRepository.addMember(workspace.id, request.userId);

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
