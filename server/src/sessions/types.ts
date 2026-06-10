/**
 * Session status
 */
export type SessionStatus = 'active' | 'ended' | 'archived';

/**
 * Session-level TTS settings (synced across all devices in session)
 */
export interface SessionTtsSettings {
  /** Whether TTS is enabled for this session */
  enabled: boolean;
  /** Which device should play audio (null = all kiosks) */
  outputDeviceId: string | null;
}

/**
 * Per-session input mode. Mirrors the React state historically held by
 * `MobileMode.tsx` and `KioskMode.tsx`; lifted to server-side metadata so
 * REST and WS clients agree on what's active (issue #378).
 */
export type SessionInputMode = 'voice' | 'unified' | 'visualizer';

/** Valid input-mode literals; exported for runtime validation. */
export const VALID_SESSION_INPUT_MODES: readonly SessionInputMode[] = [
  'voice',
  'unified',
  'visualizer',
] as const;

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
  /** Session-level TTS settings (synced across all devices) */
  ttsSettings?: SessionTtsSettings;
  /**
   * Which input UI the session is using (issue #378). Persisted so a
   * device that joins after another device flipped the toggle sees the
   * current mode rather than the React default.
   */
  inputMode?: SessionInputMode;
  /**
   * Whether final transcriptions auto-submit. Same rationale as
   * `inputMode` — lifted out of React state into the server record.
   */
  autoSubmit?: boolean;
  /**
   * Per-session override for the agent system prompt. Overrides the
   * workspace-level `default_agent_prompt`. NULL/absent means "use
   * the workspace default (or the built-in prompt if that's also
   * unset)". See `resolveSessionSystemPrompt` in `openhands.ts`.
   */
  agentPrompt?: string | null;
  /**
   * Issue #470: when `true`, the client's `useSpeechRecognition` hook
   * fires a `POST /api/client-errors` for every Web Speech lifecycle
   * event (`onstart`, `onresult-interim`, `onend`, restart retries,
   * …). When `false` (the default), only structural-error lifecycle
   * events are reported. Always-on events (real `onerror`, throws,
   * suppressed-aborts, `no-onstart`) ignore this flag.
   *
   * Lifted out of React state so the AI agent can toggle the firehose
   * on/off via PATCH when a user reports a flaky STT bug.
   */
  verboseSttLogging?: boolean;
}

/**
 * Source of the effective agent prompt returned by `GET /settings`.
 * - `session`: per-session `metadata.agentPrompt` override is in effect.
 * - `workspace-default`: `workspace_settings.default_agent_prompt` applies.
 * - `builtin`: neither is set; the built-in `system-prompt.md` is used.
 */
export type AgentPromptSource = 'session' | 'workspace-default' | 'builtin';

/**
 * DTO returned by `GET /api/sessions/:id/settings` and used as the
 * payload of the `session-settings-changed` WS broadcast (issue #378).
 */
export interface SessionSettingsDTO {
  sessionId: string;
  workspaceId: string;
  tts: SessionTtsSettings;
  inputMode: SessionInputMode;
  autoSubmit: boolean;
  agentPrompt: {
    /** The prompt string the agent will actually receive on its next bind. */
    effective: string;
    source: AgentPromptSource;
  };
  /**
   * Issue #470: when `true`, clients stream every Web Speech lifecycle
   * event to `/api/client-errors` for debugging. Default `false`.
   */
  verboseSttLogging: boolean;
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
  /** Encrypted display API secret (base64) */
  displayApiSecretEncrypted: string | null;
  /** IV for display API secret encryption (base64) */
  displayApiSecretIv: string | null;
  /** Auth tag for display API secret encryption (base64) */
  displayApiSecretTag: string | null;
  /**
   * Optional kiosk anchor for this session (issue #393). When set, the
   * session represents "the conversation owned by that kiosk" — the
   * mobile kiosk picker uses this to give every kiosk its own
   * idle/in-session pill, its own `metadata.displayContent`, and its
   * own Join-in-progress affordance. `null` means the session is not
   * bound to a specific kiosk and resolves via the legacy
   * workspace-wide single-active rule.
   */
  targetKioskDeviceId: string | null;
}

/**
 * Input for creating a session
 */
export interface SessionCreateInput {
  workspaceId: string;
  name?: string;
  /**
   * Optional kiosk to anchor the session to (issue #393). When provided,
   * the session is created with `target_kiosk_device_id = kioskDeviceId`
   * so that `getActiveSessionForKiosk` can find it on the next mobile
   * register. Leave undefined for the legacy workspace-wide flow.
   */
  targetKioskDeviceId?: string | null;
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
  /** Last message timestamp in this session, or startedAt if no messages */
  lastActiveAt: string;
}
