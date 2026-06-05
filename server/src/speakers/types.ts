/**
 * Workspace-scoped speaker profile (#383).
 *
 * A `Speaker` is the agent's persistent learning about a single human
 * within a workspace. Profiles survive across sessions so the agent
 * remembers preferred names, pronouns, and free-text notes between
 * conversations.
 *
 * - `userId` is nullable: the agent can record an "anonymous" speaker
 *   it learned by voice or context before any of the humans behind it
 *   has authenticated against a workspace.
 * - `preferredName` is the only field intended for display; the agent
 *   should ask for one on first contact when it is `null`.
 * - `notes` is free-form, agent-curated. Treat it as soft data — do not
 *   parse or schemify it.
 */
export interface Speaker {
  id: string;
  workspaceId: string;
  userId: string | null;
  preferredName: string | null;
  pronouns: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpeakerCreateInput {
  workspaceId: string;
  userId?: string | null;
  preferredName?: string | null;
  pronouns?: string | null;
  notes?: string | null;
}

export interface SpeakerUpdateInput {
  preferredName?: string | null;
  pronouns?: string | null;
  notes?: string | null;
  /**
   * Optional: re-link / unlink the speaker from a `users.id`.
   * Owner-only via the REST surface; the WS device-claim flow uses the
   * dedicated `upsertForUser` helper instead.
   */
  userId?: string | null;
}
