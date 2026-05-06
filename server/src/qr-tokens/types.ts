/** QR token stored in database */
export interface QrToken {
  id: string;
  token: string;
  workspaceId: string;
  sessionId: string;
  expiresAt: string;
  createdAt: string;
}

/** Input for creating a new QR token */
export interface QrTokenCreateInput {
  workspaceId: string;
  sessionId: string;
  /** Token TTL in milliseconds (default: 5 minutes) */
  ttlMs?: number;
}

/** Result of token validation */
export interface QrTokenValidation {
  valid: boolean;
  token?: QrToken;
  error?: 'NOT_FOUND' | 'EXPIRED' | 'WORKSPACE_MISMATCH' | 'SESSION_MISMATCH';
}

/** Default token TTL: 5 minutes */
export const DEFAULT_QR_TOKEN_TTL_MS = 5 * 60 * 1000;
