import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  Workspace,
  WorkspaceCreateInput,
  WorkspaceUpdateInput,
  WorkspaceSettings,
  WorkspaceMember,
} from './types.js';
import { generateSlug, makeSlugUnique, generateJoinCode, isValidSlug, isValidWorkspaceName } from './utils.js';

interface WorkspaceRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  join_code: string | null;
  created_at: string;
  updated_at: string | null;
}

interface WorkspaceSettingsRow {
  workspace_id: string;
  openhands_api_key_encrypted: string | null;
  openhands_api_key_iv: string | null;
  openhands_api_key_tag: string | null;
  tts_voice: string | null;
  stt_language: string | null;
  allow_auto_join: number;
  require_qr_token: number;
  updated_at: string | null;
}

interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    joinCode: row.join_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSettings(row: WorkspaceSettingsRow): WorkspaceSettings {
  return {
    workspaceId: row.workspace_id,
    openhandsApiKeyEncrypted: row.openhands_api_key_encrypted,
    openhandsApiKeyIv: row.openhands_api_key_iv,
    openhandsApiKeyTag: row.openhands_api_key_tag,
    ttsVoice: row.tts_voice,
    sttLanguage: row.stt_language,
    allowAutoJoin: row.allow_auto_join === 1,
    requireQrToken: row.require_qr_token === 1,
    updatedAt: row.updated_at,
  };
}

function rowToMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as 'owner' | 'member',
    joinedAt: row.joined_at,
  };
}

export class WorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  // --- Workspace CRUD ---

  findById(id: string): Workspace | null {
    const stmt = this.db.prepare<[string], WorkspaceRow>(`
      SELECT id, owner_id, name, slug, join_code, created_at, updated_at
      FROM workspaces WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToWorkspace(row) : null;
  }

  findBySlug(slug: string): Workspace | null {
    const stmt = this.db.prepare<[string], WorkspaceRow>(`
      SELECT id, owner_id, name, slug, join_code, created_at, updated_at
      FROM workspaces WHERE slug = ?
    `);
    const row = stmt.get(slug);
    return row ? rowToWorkspace(row) : null;
  }

  findByJoinCode(joinCode: string): Workspace | null {
    const stmt = this.db.prepare<[string], WorkspaceRow>(`
      SELECT id, owner_id, name, slug, join_code, created_at, updated_at
      FROM workspaces WHERE join_code = ?
    `);
    const row = stmt.get(joinCode.toUpperCase());
    return row ? rowToWorkspace(row) : null;
  }

  findByOwner(ownerId: string): Workspace[] {
    const stmt = this.db.prepare<[string], WorkspaceRow>(`
      SELECT id, owner_id, name, slug, join_code, created_at, updated_at
      FROM workspaces WHERE owner_id = ? ORDER BY created_at DESC
    `);
    const rows = stmt.all(ownerId);
    return rows.map(rowToWorkspace);
  }

  /**
   * Find all workspaces accessible to a user (owned or member of).
   */
  findAccessible(userId: string): Workspace[] {
    const stmt = this.db.prepare<[string, string], WorkspaceRow>(`
      SELECT DISTINCT w.id, w.owner_id, w.name, w.slug, w.join_code, w.created_at, w.updated_at
      FROM workspaces w
      LEFT JOIN workspace_members m ON w.id = m.workspace_id
      WHERE w.owner_id = ? OR m.user_id = ?
      ORDER BY w.created_at DESC
    `);
    const rows = stmt.all(userId, userId);
    return rows.map(rowToWorkspace);
  }

  create(ownerId: string, input: WorkspaceCreateInput): Workspace {
    // Validate name
    if (!isValidWorkspaceName(input.name)) {
      throw new Error('Invalid workspace name');
    }

    // Generate or validate slug
    let slug = input.slug ?? generateSlug(input.name);
    if (!isValidSlug(slug)) {
      throw new Error('Invalid slug format');
    }

    // Check for slug uniqueness, make unique if needed
    if (this.findBySlug(slug)) {
      slug = makeSlugUnique(slug);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const joinCode = generateJoinCode();

    const stmt = this.db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, ownerId, input.name.trim(), slug, joinCode, now, now);

    // Also add owner as a member with 'owner' role
    this.addMember(id, ownerId, 'owner');

    // Create settings row with allowAutoJoin=0 (security-first for new workspaces)
    // This ensures new workspaces require explicit opt-in for auto-join
    // See migration 007_allow_auto_join.ts for full security posture documentation
    const settingsStmt = this.db.prepare(`
      INSERT INTO workspace_settings (workspace_id, allow_auto_join, updated_at)
      VALUES (?, 0, ?)
    `);
    settingsStmt.run(id, now);

    return {
      id,
      ownerId,
      name: input.name.trim(),
      slug,
      joinCode,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(id: string, input: WorkspaceUpdateInput): Workspace {
    const workspace = this.findById(id);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const now = new Date().toISOString();
    let newSlug = workspace.slug;

    // Validate and update name
    if (input.name !== undefined) {
      if (!isValidWorkspaceName(input.name)) {
        throw new Error('Invalid workspace name');
      }
    }

    // Validate and update slug
    if (input.slug !== undefined) {
      if (!isValidSlug(input.slug)) {
        throw new Error('Invalid slug format');
      }
      // Check uniqueness (except for current workspace)
      const existing = this.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new Error('Slug already taken');
      }
      newSlug = input.slug;
    }

    const stmt = this.db.prepare(`
      UPDATE workspaces
      SET name = COALESCE(?, name),
          slug = ?,
          updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      input.name?.trim() ?? null,
      newSlug,
      now,
      id
    );

    const updated = this.findById(id);
    if (!updated) {
      throw new Error('Workspace not found after update');
    }
    return updated;
  }

  delete(id: string): void {
    // Settings and members are deleted via CASCADE
    const stmt = this.db.prepare('DELETE FROM workspaces WHERE id = ?');
    stmt.run(id);
  }

  regenerateJoinCode(id: string): string {
    const newCode = generateJoinCode();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE workspaces SET join_code = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(newCode, now, id);

    return newCode;
  }

  // --- Workspace Settings ---

  getSettings(workspaceId: string): WorkspaceSettings | null {
    const stmt = this.db.prepare<[string], WorkspaceSettingsRow>(`
      SELECT workspace_id, openhands_api_key_encrypted, openhands_api_key_iv, 
             openhands_api_key_tag, tts_voice, stt_language, allow_auto_join,
             require_qr_token, updated_at
      FROM workspace_settings WHERE workspace_id = ?
    `);
    const row = stmt.get(workspaceId);
    return row ? rowToSettings(row) : null;
  }

  updateSettings(
    workspaceId: string,
    settings: {
      openhandsApiKeyEncrypted?: string | null;
      openhandsApiKeyIv?: string | null;
      openhandsApiKeyTag?: string | null;
      ttsVoice?: string | null;
      sttLanguage?: string | null;
      allowAutoJoin?: boolean;
      requireQrToken?: boolean;
    }
  ): WorkspaceSettings {
    const now = new Date().toISOString();
    const existing = this.getSettings(workspaceId);

    if (existing) {
      // Update
      const stmt = this.db.prepare(`
        UPDATE workspace_settings
        SET openhands_api_key_encrypted = COALESCE(?, openhands_api_key_encrypted),
            openhands_api_key_iv = COALESCE(?, openhands_api_key_iv),
            openhands_api_key_tag = COALESCE(?, openhands_api_key_tag),
            tts_voice = COALESCE(?, tts_voice),
            stt_language = COALESCE(?, stt_language),
            allow_auto_join = COALESCE(?, allow_auto_join),
            require_qr_token = COALESCE(?, require_qr_token),
            updated_at = ?
        WHERE workspace_id = ?
      `);
      stmt.run(
        settings.openhandsApiKeyEncrypted ?? null,
        settings.openhandsApiKeyIv ?? null,
        settings.openhandsApiKeyTag ?? null,
        settings.ttsVoice ?? null,
        settings.sttLanguage ?? null,
        settings.allowAutoJoin !== undefined ? (settings.allowAutoJoin ? 1 : 0) : null,
        settings.requireQrToken !== undefined ? (settings.requireQrToken ? 1 : 0) : null,
        now,
        workspaceId
      );
    } else {
      // Insert with default allowAutoJoin = false for new workspaces (security-first)
      // Existing workspaces keep allowAutoJoin=true via migration default for backward compat
      // requireQrToken defaults to false for backward compatibility
      const stmt = this.db.prepare(`
        INSERT INTO workspace_settings 
        (workspace_id, openhands_api_key_encrypted, openhands_api_key_iv, 
         openhands_api_key_tag, tts_voice, stt_language, allow_auto_join, require_qr_token, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        workspaceId,
        settings.openhandsApiKeyEncrypted ?? null,
        settings.openhandsApiKeyIv ?? null,
        settings.openhandsApiKeyTag ?? null,
        settings.ttsVoice ?? null,
        settings.sttLanguage ?? null,
        settings.allowAutoJoin !== undefined ? (settings.allowAutoJoin ? 1 : 0) : 0,
        settings.requireQrToken !== undefined ? (settings.requireQrToken ? 1 : 0) : 0,
        now
      );
    }

    const result = this.getSettings(workspaceId);
    if (!result) {
      throw new Error('Settings not found after update');
    }
    return result;
  }

  clearApiKey(workspaceId: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workspace_settings
      SET openhands_api_key_encrypted = NULL,
          openhands_api_key_iv = NULL,
          openhands_api_key_tag = NULL,
          updated_at = ?
      WHERE workspace_id = ?
    `);
    stmt.run(now, workspaceId);
  }

  // --- Members ---

  addMember(workspaceId: string, userId: string, role: 'owner' | 'member' = 'member'): WorkspaceMember {
    const now = new Date().toISOString();
    
    // Use INSERT OR REPLACE to handle existing members
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(workspaceId, userId, role, now);

    return {
      workspaceId,
      userId,
      role,
      joinedAt: now,
    };
  }

  removeMember(workspaceId: string, userId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?
    `);
    stmt.run(workspaceId, userId);
  }

  getMembers(workspaceId: string): WorkspaceMember[] {
    const stmt = this.db.prepare<[string], WorkspaceMemberRow>(`
      SELECT workspace_id, user_id, role, joined_at
      FROM workspace_members WHERE workspace_id = ?
    `);
    const rows = stmt.all(workspaceId);
    return rows.map(rowToMember);
  }

  isMember(workspaceId: string, userId: string): boolean {
    const stmt = this.db.prepare<[string, string], { cnt: number }>(`
      SELECT COUNT(*) as cnt FROM workspace_members 
      WHERE workspace_id = ? AND user_id = ?
    `);
    const row = stmt.get(workspaceId, userId);
    return row ? row.cnt > 0 : false;
  }

  isOwner(workspaceId: string, userId: string): boolean {
    const workspace = this.findById(workspaceId);
    return workspace?.ownerId === userId;
  }

  /**
   * Check if a user can access a workspace (owner or member).
   */
  canAccess(workspaceId: string, userId: string): boolean {
    return this.isOwner(workspaceId, userId) || this.isMember(workspaceId, userId);
  }
}
