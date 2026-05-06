export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  joinCode: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface WorkspaceCreateInput {
  name: string;
  slug?: string; // Auto-generated from name if not provided
}

export interface WorkspaceUpdateInput {
  name?: string;
  slug?: string;
}

export interface WorkspaceSettings {
  workspaceId: string;
  openhandsApiKeyEncrypted: string | null;
  openhandsApiKeyIv: string | null;
  openhandsApiKeyTag: string | null;
  ttsVoice: string | null;
  sttLanguage: string | null;
  /** Whether to allow auto-join via QR code links (default: true for backward compat) */
  allowAutoJoin: boolean;
  updatedAt: string | null;
}

export interface WorkspaceSettingsInput {
  openhandsApiKey?: string; // Plain text - will be encrypted before storage
  ttsVoice?: string;
  sttLanguage?: string;
  allowAutoJoin?: boolean;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

/** Workspace with ownership info included */
export interface WorkspaceWithOwner extends Workspace {
  isOwner: boolean;
}
