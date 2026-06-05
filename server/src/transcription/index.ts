/**
 * Transcription module.
 *
 * Hosts the server-side bits of the hosted-STT pipeline (#386):
 * the Deepgram token broker, the per-month minute counter, and the
 * `(session, device, engine-label) -> speakers.id` mapping repo. The
 * audio-buffer phase-1 helpers are still exported for use by future
 * server-side fallback STT engines.
 */

export { AudioBufferManager, type AudioBufferOptions } from './audio-buffer.js';
export {
  createTranscriptionRouter,
  type TranscriptionRouterOptions,
} from './router.js';
export {
  fetchProjectId,
  mintEphemeralKey,
  DeepgramApiError,
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
  DEFAULT_SCOPES,
  type DeepgramProjectInfo,
  type MintEphemeralKeyOptions,
  type MintedToken,
} from './deepgram-token.js';
export {
  StttUsageRepository,
  currentUtcMonth,
  type StttUsageRow,
} from './usage-repository.js';
export {
  SessionEngineSpeakersRepository,
  type EngineSpeakerMapping,
} from './session-engine-speakers-repository.js';
