/**
 * Session settings service (issue #378).
 *
 * Single chokepoint for reading and mutating per-session settings. Both
 * the new REST router (`settings-router.ts`) and the legacy WS
 * `session-tts-settings` handler in `server/src/index.ts` funnel through
 * this module so the persist+broadcast contract is identical on both
 * paths.
 *
 * Broadcasts:
 * - For any TTS change, emits the legacy `session-tts-settings-changed`
 *   message so existing kiosk/mobile clients keep working without the
 *   new wire type.
 * - For every change (TTS or not), emits the new
 *   `session-settings-changed` snapshot so future clients can hydrate
 *   inputMode / autoSubmit / agent-prompt source without protocol
 *   fan-out per field.
 */

import type { SessionRepository } from './session-repository.js';
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js';
import type { DeviceRegistry } from '../registry.js';
import type {
  SessionMetadata,
  SessionInputMode,
} from './types.js';
import { VALID_SESSION_INPUT_MODES } from './types.js';
import type {
  SessionTtsSettingsChangedMessage,
  SessionSettingsChangedMessage,
} from '../types.js';

/** Hard cap on `agentPrompt` length to keep prompt injection storage
 * bounded and within OpenHands' context budget. Matches the 8 KB ceiling
 * documented in the issue. */
export const AGENT_PROMPT_MAX_LENGTH = 8192;

/** Public DTO returned by GET/PATCH `/api/sessions/:id/settings`. */
export interface SessionSettingsDto {
  sessionId: string;
  workspaceId: string;
  tts: {
    enabled: boolean;
    outputDeviceId: string | null;
  };
  inputMode: SessionInputMode | null;
  autoSubmit: boolean | null;
  agentPrompt: {
    /** Full prompt body (post-substitution placeholders left intact). */
    effective: string | null;
    source: 'session' | 'workspace-default' | 'builtin';
  };
}

/**
 * Patch shape accepted by `applyPatch`. All keys optional; partial PATCH
 * semantics. Pass `agentPrompt: null` to explicitly clear the session
 * override. Unknown top-level keys are rejected (see
 * {@link validatePatch}).
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

/** Discriminated union returned by `validatePatch`. */
export type ValidatePatchResult =
  | { ok: true }
  | { ok: false; error: string };

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'tts',
  'inputMode',
  'autoSubmit',
  'agentPrompt',
]);
const KNOWN_TTS_KEYS = new Set(['enabled', 'outputDeviceId']);

/**
 * Validate a raw patch payload (from HTTP body or WS message) against the
 * SessionSettingsPatch contract. Strict: unknown top-level keys and
 * unknown TTS keys return errors so operator typos surface loudly.
 */
export function validatePatch(raw: unknown): ValidatePatchResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }

  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      return { ok: false, error: `Unknown field: ${key}` };
    }
  }

  if ('tts' in obj) {
    const tts = obj.tts;
    if (tts === null || typeof tts !== 'object' || Array.isArray(tts)) {
      return { ok: false, error: 'tts must be an object' };
    }
    const ttsObj = tts as Record<string, unknown>;
    for (const key of Object.keys(ttsObj)) {
      if (!KNOWN_TTS_KEYS.has(key)) {
        return { ok: false, error: `Unknown tts field: ${key}` };
      }
    }
    if ('enabled' in ttsObj && typeof ttsObj.enabled !== 'boolean') {
      return { ok: false, error: 'tts.enabled must be a boolean' };
    }
    if (
      'outputDeviceId' in ttsObj &&
      ttsObj.outputDeviceId !== null &&
      typeof ttsObj.outputDeviceId !== 'string'
    ) {
      return {
        ok: false,
        error: 'tts.outputDeviceId must be a string or null',
      };
    }
  }

  if ('inputMode' in obj) {
    const mode = obj.inputMode;
    if (
      typeof mode !== 'string' ||
      !VALID_SESSION_INPUT_MODES.includes(mode as SessionInputMode)
    ) {
      return {
        ok: false,
        error: `inputMode must be one of: ${VALID_SESSION_INPUT_MODES.join(', ')}`,
      };
    }
  }

  if ('autoSubmit' in obj && typeof obj.autoSubmit !== 'boolean') {
    return { ok: false, error: 'autoSubmit must be a boolean' };
  }

  if ('agentPrompt' in obj) {
    const ap = obj.agentPrompt;
    if (ap !== null && typeof ap !== 'string') {
      return { ok: false, error: 'agentPrompt must be a string or null' };
    }
    if (typeof ap === 'string') {
      if (ap.length === 0) {
        return {
          ok: false,
          error: 'agentPrompt must be a non-empty string (use null to clear the override)',
        };
      }
      if (ap.length > AGENT_PROMPT_MAX_LENGTH) {
        return {
          ok: false,
          error: `agentPrompt exceeds ${AGENT_PROMPT_MAX_LENGTH}-character limit`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Merge a validated patch into existing session metadata. Returns the new
 * metadata object plus a boolean indicating whether the TTS slice was
 * touched (so callers know whether to emit the legacy
 * `session-tts-settings-changed` message).
 */
export function mergePatchIntoMetadata(
  existing: SessionMetadata | null | undefined,
  patch: SessionSettingsPatch,
): { metadata: SessionMetadata; ttsChanged: boolean } {
  const current: SessionMetadata = { ...(existing ?? {}) };
  let ttsChanged = false;

  if (patch.tts !== undefined) {
    const prevTts = current.ttsSettings ?? { enabled: false, outputDeviceId: null };
    current.ttsSettings = {
      enabled: patch.tts.enabled !== undefined ? patch.tts.enabled : prevTts.enabled,
      outputDeviceId:
        patch.tts.outputDeviceId !== undefined
          ? patch.tts.outputDeviceId
          : prevTts.outputDeviceId,
    };
    ttsChanged = true;
  }

  if (patch.inputMode !== undefined) {
    current.inputMode = patch.inputMode;
  }

  if (patch.autoSubmit !== undefined) {
    current.autoSubmit = patch.autoSubmit;
  }

  if (patch.agentPrompt !== undefined) {
    if (patch.agentPrompt === null) {
      delete current.agentPrompt;
    } else {
      current.agentPrompt = patch.agentPrompt;
    }
  }

  return { metadata: current, ttsChanged };
}

/**
 * Build the public DTO returned to GET/PATCH callers. Reads workspace
 * defaults so the `agentPrompt.source` field is accurate.
 */
export function buildSettingsDto(
  sessionId: string,
  workspaceId: string,
  metadata: SessionMetadata | null,
  workspaceDefaultPrompt: string | null,
): SessionSettingsDto {
  const tts = metadata?.ttsSettings ?? { enabled: false, outputDeviceId: null };

  let effective: string | null;
  let source: SessionSettingsDto['agentPrompt']['source'];
  if (metadata?.agentPrompt) {
    effective = metadata.agentPrompt;
    source = 'session';
  } else if (workspaceDefaultPrompt) {
    effective = workspaceDefaultPrompt;
    source = 'workspace-default';
  } else {
    effective = null;
    source = 'builtin';
  }

  return {
    sessionId,
    workspaceId,
    tts: { enabled: tts.enabled, outputDeviceId: tts.outputDeviceId },
    inputMode: metadata?.inputMode ?? null,
    autoSubmit: metadata?.autoSubmit ?? null,
    agentPrompt: { effective, source },
  };
}

export interface ApplyPatchOptions {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  registry?: DeviceRegistry;
}

export type ApplyPatchResult =
  | { ok: true; settings: SessionSettingsDto }
  | { ok: false; status: number; error: string };

/**
 * Apply a validated patch to a session. Single chokepoint shared by REST
 * and WS. Persists metadata + broadcasts the two settings-changed
 * messages.
 *
 * Failure cases (returned, not thrown):
 * - 400: validation error.
 * - 404: session does not exist.
 */
export function applyPatch(
  opts: ApplyPatchOptions,
  sessionId: string,
  rawPatch: unknown,
): ApplyPatchResult {
  const validation = validatePatch(rawPatch);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }

  const session = opts.sessionRepository.findById(sessionId);
  if (!session) {
    return { ok: false, status: 404, error: 'Session not found' };
  }

  const patch = rawPatch as SessionSettingsPatch;
  const { metadata, ttsChanged } = mergePatchIntoMetadata(
    session.metadata,
    patch,
  );

  opts.sessionRepository.update(sessionId, { metadata });

  const workspaceSettings = opts.workspaceRepository.getSettings(
    session.workspaceId,
  );
  const dto = buildSettingsDto(
    sessionId,
    session.workspaceId,
    metadata,
    workspaceSettings?.defaultAgentPrompt ?? null,
  );

  if (opts.registry) {
    if (ttsChanged) {
      const ttsMsg: SessionTtsSettingsChangedMessage = {
        type: 'session-tts-settings-changed',
        sessionId,
        enabled: dto.tts.enabled,
        outputDeviceId: dto.tts.outputDeviceId,
      };
      try {
        opts.registry.broadcastMessageToSession(sessionId, ttsMsg);
      } catch (err) {
        // Non-fatal: REST callers still get the new state in the
        // response body, and the next snapshot broadcast (below) is
        // attempted independently.
        console.error(
          `[SessionSettings] tts broadcast failed for ${sessionId}:`,
          err,
        );
      }
    }

    const snapshotMsg: SessionSettingsChangedMessage = {
      type: 'session-settings-changed',
      sessionId,
      tts: dto.tts,
      inputMode: dto.inputMode,
      autoSubmit: dto.autoSubmit,
      agentPromptSource: dto.agentPrompt.source,
    };
    try {
      opts.registry.broadcastMessageToSession(sessionId, snapshotMsg);
    } catch (err) {
      console.error(
        `[SessionSettings] snapshot broadcast failed for ${sessionId}:`,
        err,
      );
    }
  }

  return { ok: true, settings: dto };
}

/**
 * Resolve the effective system-prompt body for a session, applying
 * substitutions ({{SERVER_URL}}, {{WORKSPACE_ID}}, {{SESSION_ID}},
 * display-line guidance). Precedence:
 *   1. `session.metadata.agentPrompt`
 *   2. `workspace_settings.default_agent_prompt`
 *   3. Built-in `server/prompts/system-prompt.md` (via fallbackLoader).
 *
 * Returns `null` when no session matches `sessionId` — callers should
 * fall back to their previous loadPrompt behaviour in that case.
 */
export function resolveSessionSystemPrompt(opts: {
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  sessionId: string;
  workspaceId: string;
  displayLines: number | undefined;
  /** Substitutes `{{...}}` placeholders into a raw body. */
  applySubstitutions: (
    body: string,
    displayLines: number | undefined,
    workspaceId: string,
    sessionId: string,
  ) => string;
  /** Loads and substitutes the built-in `system-prompt.md` body. */
  loadBuiltinPrompt: (
    displayLines: number | undefined,
    workspaceId: string,
    sessionId: string,
  ) => string;
}): { body: string; source: 'session' | 'workspace-default' | 'builtin' } {
  const session = opts.sessionRepository.findById(opts.sessionId);
  const override = session?.metadata?.agentPrompt;
  if (override && override.length > 0) {
    return {
      body: opts.applySubstitutions(
        override,
        opts.displayLines,
        opts.workspaceId,
        opts.sessionId,
      ),
      source: 'session',
    };
  }

  const ws = opts.workspaceRepository.getSettings(opts.workspaceId);
  const wsDefault = ws?.defaultAgentPrompt;
  if (wsDefault && wsDefault.length > 0) {
    return {
      body: opts.applySubstitutions(
        wsDefault,
        opts.displayLines,
        opts.workspaceId,
        opts.sessionId,
      ),
      source: 'workspace-default',
    };
  }

  return {
    body: opts.loadBuiltinPrompt(
      opts.displayLines,
      opts.workspaceId,
      opts.sessionId,
    ),
    source: 'builtin',
  };
}
