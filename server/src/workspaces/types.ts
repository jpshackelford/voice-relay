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
  /** Whether to require signed QR tokens for auto-join (default: false for backward compat) */
  requireQrToken: boolean;
  /** Encrypted ElevenLabs API key for TTS */
  elevenlabsApiKeyEncrypted: string | null;
  elevenlabsApiKeyIv: string | null;
  elevenlabsApiKeyTag: string | null;
  /** Selected ElevenLabs voice ID (default: Aria voice Xb7hH8MSUJpSbSDYk0k2) */
  elevenlabsVoiceId: string | null;
  /** Whether server-side TTS is enabled for this workspace */
  elevenlabsTtsEnabled: boolean;
  /**
   * Whether the kiosk display shows the new footer ticker strips
   * (transcription + AI action). Disabled by default to preserve the
   * current UX; see issue #340.
   */
  kioskFooterTickersEnabled: boolean;
  updatedAt: string | null;
}

export interface WorkspaceSettingsInput {
  openhandsApiKey?: string; // Plain text - will be encrypted before storage
  ttsVoice?: string;
  sttLanguage?: string;
  allowAutoJoin?: boolean;
  requireQrToken?: boolean;
  elevenlabsApiKey?: string; // Plain text - will be encrypted before storage
  elevenlabsVoiceId?: string;
  elevenlabsTtsEnabled?: boolean;
  kioskFooterTickersEnabled?: boolean;
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
