/**
 * Session settings service (issue #378).
 *
 * Single funnel for every mutation of a session's settings — REST
 * `PATCH /api/sessions/:id/settings` and the legacy WS
 * `'session-tts-settings'` handler both go through {@link applyPatch}, so:
 *
 *   - Validation is centralised (one set of error messages).
 *   - Persistence and the post-write broadcast happen in the same
 *     transaction so listeners can't observe a half-applied state.
 *   - The two WS broadcast shapes (back-compat
 *     `session-tts-settings-changed` + new `session-settings-changed`)
 *     stay in lockstep across all entry points.
 *
 * The service is intentionally repository-driven so it can be unit-tested
 * against an in-memory SQLite — there is no HTTP or WebSocket plumbing
 * here. The accompanying router (`settings-router.ts`) is the HTTP edge.
 */

import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRegistry } from '../registry.js';
import type {
  SessionInputMode,
  SessionMetadata,
  SessionSettingsDTO,
  SessionTtsSettings,
} from './types.js';
import { VALID_SESSION_INPUT_MODES } from './types.js';
import { resolveSessionSystemPrompt } from '../openhands.js';
import { MAX_AGENT_PROMPT_LENGTH } from '../constants.js';
import type {
  SessionSettingsChangedMessage,
  SessionTtsSettingsChangedMessage,
} from '../types.js';

/**
 * Patch input accepted by {@link applyPatch}. Every field is optional;
 * absent fields are left untouched. `agentPrompt: null` clears the
 * per-session override.
 *
 * Validation is strict: unknown top-level fields are rejected with a
 * `ValidationError` so operator mistakes are loud instead of silently
 * dropped. The router applies the same strictness before calling this
 * function so client-side typos surface as 400s.
 */
export interface SessionSettingsPatch {
  tts?: {
    enabled?: boolean;
    outputDeviceId?: string | null;
  };
  inputMode?: SessionInputMode;
  autoSubmit?: boolean;
  agentPrompt?: string | null;
}

/** Top-level keys the patch shape understands. */
export const VALID_SETTINGS_PATCH_KEYS: ReadonlySet<string> = new Set([
  'tts',
  'inputMode',
  'autoSubmit',
  'agentPrompt',
]);

/**
 * Thrown by the service for any 400-class problem. The router converts
 * `ValidationError`s to `400 {error: message}`. Treats validation as a
 * domain concern rather than HTTP plumbing so the same code path runs
 * cleanly under both the WS handler and the REST handler.
 */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

/** Thrown when the session does not exist. Router maps to 404. */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

/** Default per-session settings used when metadata is absent or partial. */
const DEFAULT_TTS: SessionTtsSettings = {
  enabled: true,
  outputDeviceId: null,
};
const DEFAULT_INPUT_MODE: SessionInputMode = 'unified';
const DEFAULT_AUTO_SUBMIT = true;

export interface SessionSettingsServiceOptions {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  /**
   * Optional registry used to fan out the post-write WS broadcasts. When
   * omitted (e.g. headless test setups), persistence still happens; only
   * the broadcast is skipped.
   */
  registry?: DeviceRegistry;
  /**
   * Optional display-line count to feed the prompt resolver. The real
   * value lives on the device registration record; for tests and for
   * `GET /settings` it's fine to leave unset (the resolver tolerates it).
   */
  displayLinesFor?: (sessionId: string) => number | undefined;
}

export interface SessionSettingsService {
  /**
   * Read the current effective settings for a session. Throws
   * {@link SessionNotFoundError} if the session is unknown.
   */
  readSettings(sessionId: string): SessionSettingsDTO;

  /**
   * Apply a partial patch, persist, broadcast, and return the new
   * snapshot. Validates input and throws {@link SettingsValidationError}
   * on malformed payloads.
   */
  applyPatch(sessionId: string, patch: SessionSettingsPatch): SessionSettingsDTO;
}

/**
 * Build a session settings service bound to the supplied repositories
 * and (optional) device registry.
 */
export function createSessionSettingsService(
  options: SessionSettingsServiceOptions,
): SessionSettingsService {
  const { sessionRepository, workspaceRepository, registry, displayLinesFor } = options;

  function computeDto(sessionId: string): SessionSettingsDTO {
    const session = sessionRepository.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const meta: SessionMetadata = session.metadata ?? {};
    const tts: SessionTtsSettings = meta.ttsSettings ?? DEFAULT_TTS;
    const inputMode: SessionInputMode = meta.inputMode ?? DEFAULT_INPUT_MODE;
    const autoSubmit: boolean = meta.autoSubmit ?? DEFAULT_AUTO_SUBMIT;

    const wsSettings = workspaceRepository.getSettings(session.workspaceId);
    const resolved = resolveSessionSystemPrompt({
      sessionMetadata: meta,
      workspaceSettings: wsSettings ?? null,
      sessionId,
      workspaceId: session.workspaceId,
      displayLines: displayLinesFor?.(sessionId),
    });

    return {
      sessionId,
      workspaceId: session.workspaceId,
      tts,
      inputMode,
      autoSubmit,
      agentPrompt: {
        effective: resolved.effective,
        source: resolved.source,
      },
    };
  }

  function validateAndCoalesce(
    patch: SessionSettingsPatch,
    previousTts: SessionTtsSettings,
  ): {
    nextTts?: SessionTtsSettings;
    nextInputMode?: SessionInputMode;
    nextAutoSubmit?: boolean;
    promptKeyPresent: boolean;
    nextPrompt?: string | null;
  } {
    let nextTts: SessionTtsSettings | undefined;
    if (patch.tts !== undefined) {
      if (patch.tts === null || typeof patch.tts !== 'object' || Array.isArray(patch.tts)) {
        throw new SettingsValidationError('tts must be an object');
      }
      const tts = patch.tts;
      const enabled = tts.enabled ?? previousTts.enabled;
      const outputDeviceId = tts.outputDeviceId !== undefined ? tts.outputDeviceId : previousTts.outputDeviceId;
      if (typeof enabled !== 'boolean') {
        throw new SettingsValidationError('tts.enabled must be a boolean');
      }
      if (outputDeviceId !== null && typeof outputDeviceId !== 'string') {
        throw new SettingsValidationError('tts.outputDeviceId must be a string or null');
      }
      nextTts = { enabled, outputDeviceId };
    }

    let nextInputMode: SessionInputMode | undefined;
    if (patch.inputMode !== undefined) {
      if (typeof patch.inputMode !== 'string'
        || !(VALID_SESSION_INPUT_MODES as readonly string[]).includes(patch.inputMode)) {
        throw new SettingsValidationError(
          `inputMode must be one of: ${VALID_SESSION_INPUT_MODES.join(', ')}`,
        );
      }
      nextInputMode = patch.inputMode;
    }

    let nextAutoSubmit: boolean | undefined;
    if (patch.autoSubmit !== undefined) {
      if (typeof patch.autoSubmit !== 'boolean') {
        throw new SettingsValidationError('autoSubmit must be a boolean');
      }
      nextAutoSubmit = patch.autoSubmit;
    }

    const promptKeyPresent = 'agentPrompt' in patch;
    let nextPrompt: string | null | undefined;
    if (promptKeyPresent) {
      const v = patch.agentPrompt;
      if (v !== null && typeof v !== 'string') {
        throw new SettingsValidationError('agentPrompt must be a string or null');
      }
      if (typeof v === 'string' && v.length > MAX_AGENT_PROMPT_LENGTH) {
        throw new SettingsValidationError(
          `agentPrompt exceeds ${MAX_AGENT_PROMPT_LENGTH} character limit`,
        );
      }
      nextPrompt = v;
    }

    return { nextTts, nextInputMode, nextAutoSubmit, promptKeyPresent, nextPrompt };
  }

  function applyPatch(
    sessionId: string,
    patch: SessionSettingsPatch,
  ): SessionSettingsDTO {
    const session = sessionRepository.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // Strict unknown-field rejection.
    for (const key of Object.keys(patch)) {
      if (!VALID_SETTINGS_PATCH_KEYS.has(key)) {
        throw new SettingsValidationError(`Unknown field: ${key}`);
      }
    }

    const existingMeta: SessionMetadata = session.metadata ?? {};
    const previousTts = existingMeta.ttsSettings ?? DEFAULT_TTS;

    const {
      nextTts,
      nextInputMode,
      nextAutoSubmit,
      promptKeyPresent,
      nextPrompt,
    } = validateAndCoalesce(patch, previousTts);

    // Build the new metadata. Spread first so unrelated fields
    // (aiConversationId, displayContent, stats, …) survive untouched.
    const newMeta: SessionMetadata = { ...existingMeta };
    if (nextTts !== undefined) newMeta.ttsSettings = nextTts;
    if (nextInputMode !== undefined) newMeta.inputMode = nextInputMode;
    if (nextAutoSubmit !== undefined) newMeta.autoSubmit = nextAutoSubmit;
    if (promptKeyPresent) {
      if (nextPrompt === null) {
        delete newMeta.agentPrompt;
      } else {
        newMeta.agentPrompt = nextPrompt;
      }
    }

    sessionRepository.update(sessionId, { metadata: newMeta });

    const dto = computeDto(sessionId);

    if (registry) {
      // Back-compat: legacy `session-tts-settings-changed` message for
      // kiosks/mobiles that don't yet know about the unified snapshot.
      if (nextTts !== undefined) {
        const legacyMsg: SessionTtsSettingsChangedMessage = {
          type: 'session-tts-settings-changed',
          sessionId,
          enabled: dto.tts.enabled,
          outputDeviceId: dto.tts.outputDeviceId,
        };
        try {
          registry.broadcastMessageToSession(sessionId, legacyMsg);
        } catch (err) {
          console.error(`[SessionSettings] legacy broadcast failed for ${sessionId}:`, err);
        }
      }

      // New: full-snapshot message for the REST/WS unified path. Always
      // emitted, even when only non-TTS fields changed.
      const snapshotMsg: SessionSettingsChangedMessage = {
        type: 'session-settings-changed',
        sessionId,
        settings: dto,
      };
      try {
        registry.broadcastMessageToSession(sessionId, snapshotMsg);
      } catch (err) {
        console.error(`[SessionSettings] snapshot broadcast failed for ${sessionId}:`, err);
      }
    }

    return dto;
  }

  return {
    readSettings: computeDto,
    applyPatch,
  };
}
