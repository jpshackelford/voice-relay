/**
 * Register-time replay of persisted display content (issue #338).
 *
 * When a kiosk (re)registers on a WebSocket, the server's register handler
 * catches it up on other session state (message history, TTS settings, AI
 * status). Before this helper landed, the last `POST /api/display` payload
 * was *not* persisted to `SessionMetadata.displayContent`, so a refreshing
 * kiosk would fall back to the default "Session ready" placeholder. With
 * persistence wired up (see `POST /api/display` in `index.ts`), this helper
 * reconstructs a `DisplayMessage` from the persisted metadata and sends it
 * to the joining socket so the kiosk renders the last content immediately.
 *
 * Isolating the lookup-and-send into a single function makes the behavior
 * unit-testable with a `vi.fn`-backed mock socket plus a stub repository,
 * mirroring the `resyncAgentSessionStatus` pattern (#290).
 */

import { ANONYMOUS_SESSION_ID } from './constants.js';
import type { Session } from './sessions/types.js';
import type { DisplayMessage } from './types.js';

/**
 * Minimal WebSocket-like shape used by this helper.
 *
 * We intentionally avoid pulling in the full `ws` package's `WebSocket`
 * type so tests can pass a plain mock (`{ send: vi.fn() }`).
 */
export interface ReplayTarget {
  send(data: string): void;
}

/**
 * Minimal session-repository shape used by this helper. Only the read
 * operation is required.
 */
export interface SessionLookup {
  findById(id: string): Session | null;
}

/**
 * Send the most recently persisted display payload to the (re)registering
 * WebSocket, if any.
 *
 * - No-op for the anonymous session (no persistent identity to key
 *   display content off of).
 * - No-op when no repository is wired (`undefined`), so callers can pass
 *   the same conditional gate as the TTS-settings replay.
 * - No-op when the session has no persisted `displayContent` (e.g. either
 *   nothing has been displayed yet, or the last call was `type: 'clear'`).
 * - Targets only the passed-in `ws`; other devices in the session already
 *   observed the live `broadcastToKiosks` and rebroadcasting would emit
 *   duplicates.
 */
export function replayDisplayContent(
  ws: ReplayTarget,
  sessionId: string,
  sessionRepository: SessionLookup | null | undefined,
): void {
  if (!sessionRepository) return;
  if (sessionId === ANONYMOUS_SESSION_ID) return;

  const session = sessionRepository.findById(sessionId);
  const display = session?.metadata?.displayContent;
  if (!display) return;

  // Reconstruct the wire shape. `displayContent` is persisted as
  // `'markdown' | 'image'` only — `'clear'` is wire-only and is handled by
  // `clearDisplayContent` removing the key entirely, so the persisted
  // shape already matches `DisplayContent`'s narrowed form here.
  const message: DisplayMessage = {
    type: 'display',
    display: {
      type: display.type,
      content: display.content,
      ...(display.title ? { title: display.title } : {}),
    },
  };
  ws.send(JSON.stringify(message));
}
