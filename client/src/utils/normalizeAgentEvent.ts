/**
 * Normalize a raw OpenHands V1Event (as returned by
 * `GET /api/sessions/:sessionId/agent-events`) into the client's `AgentAction`
 * shape — the same shape the live WebSocket forwarder emits.
 *
 * The server stores the original OH event JSON verbatim in
 * `agent_events.raw_event`. To keep storage simple and avoid a server-side
 * mapping refactor (option A in issue #269), the client owns the
 * raw → `AgentAction` projection here.
 *
 * The fidelity of the projection only has to be good enough that
 * `getEventContent` / `AgentEventCard` render meaningful content for
 * historical events. The live-WS path already produces the same shape via
 * `extractEventFields` / `formatEventSummary` / `extractEffectiveKind` on the
 * server (`openhands.ts`) — this file mirrors a compact, lossy subset of
 * those helpers.
 */

import { parseOhTimestamp } from './parseOhTimestamp';
import { generateUUID } from './uuid';
import type { AgentAction, ContentPart, TaskItem } from '../types';

/**
 * Raw OpenHands event (V1Event) as persisted on the server. Only the fields
 * the normalizer reads are typed; everything else is opaque.
 */
export interface RawAgentEvent {
  id?: string;
  kind?: string;
  source?: string;
  timestamp?: string;
  summary?: string;

  /** Nested action object on `ActionEvent` wrappers. */
  action?: Record<string, unknown> | string;
  /** Nested observation object on `ObservationEvent` wrappers. */
  observation?: Record<string, unknown>;

  [key: string]: unknown;
}

const MAX_SUMMARY_LEN = 80;

/**
 * Set of OpenHands event kinds that are persisted to `agent_events` for
 * forensics / rehydration but should NEVER appear as cards in the kiosk
 * timeline. Mirrors the server's `shouldSkipForKioskTimeline` predicate in
 * `server/src/openhands.ts` — keep the two in sync. See issues #265, #280.
 *
 * Rationale per kind:
 *   - SystemPromptEvent: agent's system prompt is internal infra.
 *   - MessageEvent (any source): user / environment / agent chat is already
 *     rendered as utterance bubbles via the separate `messages` table; a
 *     second card duplicates the chat bubble.
 *   - ConversationStateUpdateEvent / ConversationErrorEvent / ServerErrorEvent:
 *     status / error scaffolding. The live path log-only's these.
 *
 * Default-show: unknown kinds pass through so new OH event types remain
 * visible until a developer makes an explicit decision.
 */
const KIOSK_TIMELINE_SKIP_KINDS: ReadonlySet<string> = new Set([
  'SystemPromptEvent',
  'MessageEvent',
  'ConversationStateUpdateEvent',
  'ConversationErrorEvent',
  'ServerErrorEvent',
]);

/**
 * Whether a raw OpenHands event should appear as a card in the kiosk timeline.
 * Inverse of the server's `shouldSkipForKioskTimeline`. Defense-in-depth filter
 * applied in `client/src/api/agentEvents.ts` after the server response — keeps
 * older clients hitting newer servers (and vice versa) correct during rolling
 * deploys.
 */
export function shouldShowInKioskTimeline(event: RawAgentEvent | null | undefined): boolean {
  if (!event || typeof event !== 'object') return false;
  const kind = typeof event.kind === 'string' ? event.kind : undefined;
  if (!kind) return true; // default-show — same rule as server.
  return !KIOSK_TIMELINE_SKIP_KINDS.has(kind);
}

/**
 * Filter a list of raw events down to the ones that should be rendered as
 * timeline cards. Preserves order. Convenience wrapper over
 * `shouldShowInKioskTimeline`.
 */
export function filterKioskTimelineEvents(
  events: ReadonlyArray<RawAgentEvent>,
): RawAgentEvent[] {
  return events.filter(shouldShowInKioskTimeline);
}

/** Truncate to `n` chars with an ellipsis when needed. */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + '...';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

function asContent(v: unknown): ContentPart[] | string | undefined {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return undefined;
  const parts: ContentPart[] = [];
  for (const p of v) {
    if (!isRecord(p)) continue;
    const type = p.type;
    if (type !== 'text' && type !== 'image') continue;
    const part: ContentPart = { type };
    if (typeof p.text === 'string') part.text = p.text;
    const urls = p.image_urls;
    if (Array.isArray(urls)) {
      const urlList = urls.filter((u): u is string => typeof u === 'string');
      if (urlList.length > 0) part.image_urls = urlList;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts : undefined;
}

function asTaskList(v: unknown): TaskItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const tasks: TaskItem[] = [];
  for (const t of v) {
    if (
      isRecord(t) &&
      typeof t.title === 'string' &&
      (t.status === 'todo' || t.status === 'in_progress' || t.status === 'done')
    ) {
      tasks.push({
        title: t.title,
        status: t.status,
        ...(typeof t.notes === 'string' ? { notes: t.notes } : {}),
      });
    }
  }
  return tasks.length > 0 ? tasks : undefined;
}

/**
 * Pick the first defined value from a list of (record, key) lookups.
 */
function pickString(
  sources: ReadonlyArray<Record<string, unknown> | undefined>,
  key: string,
): string | undefined {
  for (const s of sources) {
    if (!s) continue;
    const v = asString(s[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickNumber(
  sources: ReadonlyArray<Record<string, unknown> | undefined>,
  key: string,
): number | undefined {
  for (const s of sources) {
    if (!s) continue;
    const v = asNumber(s[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickBoolean(
  sources: ReadonlyArray<Record<string, unknown> | undefined>,
  key: string,
): boolean | undefined {
  for (const s of sources) {
    if (!s) continue;
    const v = asBoolean(s[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickContent(
  sources: ReadonlyArray<Record<string, unknown> | undefined>,
): ContentPart[] | string | undefined {
  for (const s of sources) {
    if (!s) continue;
    const v = asContent(s.content);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Resolve the effective kind for a raw event.
 *
 * For wrapped `ActionEvent` / `ObservationEvent` events, OH stores the actual
 * type on `action.kind` / `observation.kind` (e.g. `TerminalAction`). The
 * client renderer dispatches on those nested kinds (see issue #257), so we
 * unwrap them here. Direct event kinds are returned as-is.
 */
export function getEffectiveKind(event: RawAgentEvent): string {
  const kind = event.kind || 'Unknown';
  if (kind === 'ActionEvent' && isRecord(event.action)) {
    const inner = asString(event.action.kind);
    if (inner) return inner;
  }
  if (kind === 'ObservationEvent' && isRecord(event.observation)) {
    const inner = asString(event.observation.kind);
    if (inner) return inner;
  }
  return kind;
}

/**
 * Best-effort human-readable summary for a raw event.
 *
 * Prefers the OH-supplied `summary` field (real OH `ActionEvent`s carry one).
 * Falls back to the effective kind name with the trailing
 * `Action`/`Observation`/`Event` suffix stripped, since the full content is
 * still rendered in the expanded card.
 */
export function getEventSummary(event: RawAgentEvent): string {
  const eventSummary = asString(event.summary);
  if (eventSummary && eventSummary.trim()) {
    return truncate(eventSummary, MAX_SUMMARY_LEN);
  }
  const action = isRecord(event.action) ? event.action : undefined;
  const observation = isRecord(event.observation) ? event.observation : undefined;
  const effectiveKind = getEffectiveKind(event);

  // Common quick-summaries — keep tiny; richer formatting is the renderer's job.
  const command = pickString([action, observation, event as Record<string, unknown>], 'command');
  const path = pickString([action, observation, event as Record<string, unknown>], 'path');
  const url = pickString([action, observation, event as Record<string, unknown>], 'url');
  const thought = pickString([action, event as Record<string, unknown>], 'thought');

  if (effectiveKind.includes('Terminal') || effectiveKind.includes('Bash') || effectiveKind === 'CmdRunAction') {
    if (command) return truncate(command, MAX_SUMMARY_LEN);
  }
  if (effectiveKind.includes('File') || effectiveKind.includes('Editor')) {
    if (path) return `File: ${truncate(path, MAX_SUMMARY_LEN - 6)}`;
  }
  if (effectiveKind.includes('Browser') || effectiveKind.includes('Browse')) {
    if (url) return `Navigate ${truncate(url, MAX_SUMMARY_LEN - 9)}`;
  }
  if (effectiveKind.includes('Think')) {
    if (thought) return truncate(thought, MAX_SUMMARY_LEN);
  }

  return effectiveKind.replace(/Action$|Observation$|Event$/i, '') || effectiveKind;
}

/**
 * Extract the displayable fields from a raw event, merging top-level and
 * nested `action` / `observation` fields. The renderer consumes these via
 * `getEventContent`, which dispatches on `kind` and reads the snake_case
 * OH field names.
 *
 * This intentionally over-extracts — fields irrelevant to the resolved kind
 * are simply ignored downstream and add negligible memory.
 */
export function extractAgentActionFields(
  event: RawAgentEvent,
): Partial<AgentAction> {
  const top = event as Record<string, unknown>;
  const action = isRecord(event.action) ? event.action : undefined;
  const observation = isRecord(event.observation) ? event.observation : undefined;
  const sources: ReadonlyArray<Record<string, unknown> | undefined> = [top, action, observation];

  const out: Partial<AgentAction> = {};

  // Terminal-ish fields
  const command = pickString(sources, 'command');
  if (command !== undefined) out.command = command;
  const content = pickContent(sources);
  if (content !== undefined) out.content = content;
  const exitCode = pickNumber(sources, 'exit_code');
  if (exitCode !== undefined) out.exit_code = exitCode;
  const timeout = pickBoolean(sources, 'timeout');
  if (timeout !== undefined) out.timeout = timeout;

  // File-ish fields
  const path = pickString(sources, 'path');
  if (path !== undefined) out.path = path;
  const fileText = pickString(sources, 'file_text');
  if (fileText !== undefined) out.file_text = fileText;
  const oldStr = pickString(sources, 'old_str');
  if (oldStr !== undefined) out.old_str = oldStr;
  const newStr = pickString(sources, 'new_str');
  if (newStr !== undefined) out.new_str = newStr;
  const error = pickString(sources, 'error');
  if (error !== undefined) out.error = error;

  // MCP fields
  const toolName = pickString(sources, 'tool_name');
  if (toolName !== undefined) out.tool_name = toolName;
  const data = (() => {
    for (const s of sources) {
      if (s && isRecord(s.data)) return s.data;
    }
    return undefined;
  })();
  if (data !== undefined) out.data = data;
  const isError = pickBoolean(sources, 'is_error');
  if (isError !== undefined) out.is_error = isError;

  // Browser fields
  const url = pickString(sources, 'url');
  if (url !== undefined) out.url = url;
  const index = pickNumber(sources, 'index');
  if (index !== undefined) out.index = index;
  const text = pickString(sources, 'text');
  if (text !== undefined) out.text = text;
  const direction = pickString(sources, 'direction');
  if (direction !== undefined) out.direction = direction;
  const tabId = pickString(sources, 'tab_id');
  if (tabId !== undefined) out.tab_id = tabId;
  const newTab = pickBoolean(sources, 'new_tab');
  if (newTab !== undefined) out.new_tab = newTab;
  const includeScreenshot = pickBoolean(sources, 'include_screenshot');
  if (includeScreenshot !== undefined) out.include_screenshot = includeScreenshot;
  const extractLinks = pickBoolean(sources, 'extract_links');
  if (extractLinks !== undefined) out.extract_links = extractLinks;
  const startFromChar = pickNumber(sources, 'start_from_char');
  if (startFromChar !== undefined) out.start_from_char = startFromChar;

  // Search fields
  const pattern = pickString(sources, 'pattern');
  if (pattern !== undefined) out.pattern = pattern;
  const include = pickString(sources, 'include');
  if (include !== undefined) out.include = include;
  const searchPath = pickString(sources, 'search_path');
  if (searchPath !== undefined) out.search_path = searchPath;
  const files = (() => {
    for (const s of sources) {
      if (!s) continue;
      const v = asStringArray(s.files);
      if (v !== undefined) return v;
    }
    return undefined;
  })();
  if (files !== undefined) out.files = files;
  const matches = (() => {
    for (const s of sources) {
      if (!s) continue;
      const v = asStringArray(s.matches);
      if (v !== undefined) return v;
    }
    return undefined;
  })();
  if (matches !== undefined) out.matches = matches;

  // Think / Finish
  const thought = pickString(sources, 'thought');
  if (thought !== undefined) out.thought = thought;
  const message = pickString(sources, 'message');
  if (message !== undefined) out.message = message;

  // Invoke skill
  // Real events have `name` on the action and `skill_name` on the observation.
  const skillName =
    pickString(sources, 'skill_name') ??
    (() => {
      // Only treat `name` as a skill name on invoke-skill events to avoid
      // bleeding device/tool/user names into unrelated kinds.
      const eff = getEffectiveKind(event);
      if (eff.includes('InvokeSkill') || eff.includes('SkillAction') || eff.includes('SkillObservation')) {
        return pickString(sources, 'name');
      }
      return undefined;
    })();
  if (skillName !== undefined) out.skill_name = skillName;

  // Task tracker
  const taskList = (() => {
    for (const s of sources) {
      if (!s) continue;
      const v = asTaskList(s.task_list);
      if (v !== undefined) return v;
    }
    return undefined;
  })();
  if (taskList !== undefined) out.task_list = taskList;

  // Observation linkage
  const actionId = pickString(sources, 'action_id');
  if (actionId !== undefined) out.action_id = actionId;

  return out;
}

/**
 * Normalize a raw OpenHands V1Event into the client's `AgentAction` shape.
 *
 * Behavioral notes:
 * - `id` falls back to a fresh UUID if the raw event doesn't carry one. This
 *   matches what the server does on the live path (see
 *   `openhands.ts: event.id || crypto.randomUUID()`). Because a synthetic
 *   event with no upstream id gets a *new* UUID on each normalization, the
 *   dedupe-by-id in `useAgentActions` is best-effort for those events. This
 *   is documented in issue #269.
 * - `timestamp` is normalized through `parseOhTimestamp` so non-UTC browsers
 *   sort historical events correctly against utterances (regression guard
 *   for issue #264). Falls back to "now" only when the raw event has no
 *   timestamp at all, which should not happen in practice.
 * - All snake_case OH fields are preserved as-is on the resulting
 *   `AgentAction`, matching the live WS payload shape.
 */
export function normalizeAgentEvent(event: RawAgentEvent): AgentAction {
  const id = asString(event.id) ?? generateUUID();
  const kind = getEffectiveKind(event);
  const source = asString(event.source) ?? 'unknown';
  const summary = getEventSummary(event);

  // parseOhTimestamp accepts naive UTC ISO strings (no Z) and dates them
  // correctly. We re-serialize back to ISO Z so callers downstream can pass
  // the string back through `new Date()` safely. Falling back to "now" keeps
  // the timeline sort stable when the raw event is malformed.
  const parsed = parseOhTimestamp(event.timestamp);
  const timestamp = parsed ? parsed.toISOString() : new Date().toISOString();

  const fields = extractAgentActionFields(event);

  return {
    ...fields,
    id,
    timestamp,
    kind,
    source,
    summary,
  };
}

/**
 * Normalize an array of raw events into `AgentAction[]`, preserving order.
 */
export function normalizeAgentEvents(events: ReadonlyArray<RawAgentEvent>): AgentAction[] {
  return events.map(normalizeAgentEvent);
}
