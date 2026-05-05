/**
 * Session status
 */
export type SessionStatus = 'active' | 'ended' | 'archived';

/**
 * Session metadata (stored as JSON)
 */
export interface SessionMetadata {
  aiConversationId?: string;
  displayContent?: {
    type: 'markdown' | 'image';
    content: string;
    title?: string;
  };
  stats?: {
    messageCount: number;
    deviceCount: number;
  };
}

/**
 * Session record in database
 */
export interface Session {
  id: string;
  workspaceId: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  metadata: SessionMetadata | null;
}

/**
 * Input for creating a session
 */
export interface SessionCreateInput {
  workspaceId: string;
  name?: string;
}

/**
 * Input for updating a session
 */
export interface SessionUpdateInput {
  name?: string;
  status?: SessionStatus;
  metadata?: SessionMetadata;
}

/**
 * Session device membership
 */
export interface SessionDevice {
  sessionId: string;
  deviceId: string;
  joinedAt: string;
}

/**
 * Session summary for listing
 */
export interface SessionSummary {
  id: string;
  workspaceId: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  deviceCount: number;
}
