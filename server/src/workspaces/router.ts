import { Router, type Request, type Response } from 'express';
import type { WorkspaceRepository } from './workspace-repository.js';
import type { WorkspaceCreateInput, WorkspaceUpdateInput } from './types.js';
import { requireAuth, type AuthMiddlewareConfig } from '../auth/middleware.js';

export interface WorkspaceRouterConfig {
  workspaceRepository: WorkspaceRepository;
  authConfig: AuthMiddlewareConfig;
}

export function createWorkspaceRouter(config: WorkspaceRouterConfig): Router {
  const router = Router();
  const { workspaceRepository, authConfig } = config;
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

      const { ttsVoice, sttLanguage } = req.body as { 
        ttsVoice?: string; 
        sttLanguage?: string;
      };

      // Note: API key encryption would be handled by a service layer
      // For now, we just update non-sensitive settings
      const settings = workspaceRepository.updateSettings(workspace.id, {
        ttsVoice,
        sttLanguage,
      });

      res.json({
        workspaceId: workspace.id,
        hasApiKey: !!settings.openhandsApiKeyEncrypted,
        ttsVoice: settings.ttsVoice,
        sttLanguage: settings.sttLanguage,
        updatedAt: settings.updatedAt,
      });
    } catch (err) {
      console.error('[Workspaces] Update settings error:', err);
      res.status(500).json({ error: 'Failed to update settings' });
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

  return router;
}
