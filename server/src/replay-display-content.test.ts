/**
 * Unit tests for `replayDisplayContent` (issue #338).
 *
 * Mirrors the `resync-agent-status.test.ts` pattern: a stub repository +
 * `vi.fn`-backed mock socket lets us assert exact wire payloads without
 * standing up a real WebSocket server.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { replayDisplayContent } from './replay-display-content.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import type { Session } from './sessions/types.js';

interface MockWs {
  send: Mock<(data: string) => void>;
}

function makeWs(): MockWs {
  return { send: vi.fn<(data: string) => void>() };
}

function sessionWithDisplay(
  id: string,
  display: Session['metadata'] extends infer M
    ? M extends { displayContent?: infer D }
      ? D
      : never
    : never,
  extra: Partial<NonNullable<Session['metadata']>> = {},
): Session {
  return {
    id,
    workspaceId: 'ws-1',
    name: null,
    status: 'active',
    startedAt: '2026-05-28T00:00:00Z',
    endedAt: null,
    metadata: { ...extra, displayContent: display } as Session['metadata'],
    displayApiSecretEncrypted: null,
    displayApiSecretIv: null,
    displayApiSecretTag: null,
    targetKioskDeviceId: null,
  };
}

function bareSession(id: string, metadata: Session['metadata'] = null): Session {
  return {
    id,
    workspaceId: 'ws-1',
    name: null,
    status: 'active',
    startedAt: '2026-05-28T00:00:00Z',
    endedAt: null,
    metadata,
    displayApiSecretEncrypted: null,
    displayApiSecretIv: null,
    displayApiSecretTag: null,
    targetKioskDeviceId: null,
  };
}

describe('replayDisplayContent', () => {
  it('sends a DisplayMessage reconstructed from persisted markdown content', () => {
    const ws = makeWs();
    const session = sessionWithDisplay('sess-1', {
      type: 'markdown',
      content: '# Hello',
      title: 'Greeting',
    });

    replayDisplayContent(ws, 'sess-1', {
      findById: vi.fn().mockReturnValue(session),
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
      type: 'display',
      display: {
        type: 'markdown',
        content: '# Hello',
        title: 'Greeting',
      },
    });
  });

  it('omits title when the persisted content has none', () => {
    const ws = makeWs();
    const session = sessionWithDisplay('sess-1', {
      type: 'image',
      content: 'https://example.com/chart.png',
    });

    replayDisplayContent(ws, 'sess-1', {
      findById: vi.fn().mockReturnValue(session),
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(ws.send.mock.calls[0][0]) as {
      type: string;
      display: Record<string, unknown>;
    };
    expect(payload.type).toBe('display');
    expect(payload.display).toEqual({
      type: 'image',
      content: 'https://example.com/chart.png',
    });
    // Title key must not be present at all (not just undefined), to keep
    // the wire shape minimal and match how live `broadcastToKiosks` sends.
    expect(Object.keys(payload.display)).not.toContain('title');
  });

  it('is a no-op for the anonymous session', () => {
    const ws = makeWs();
    const findById = vi.fn();

    replayDisplayContent(ws, ANONYMOUS_SESSION_ID, { findById });

    expect(ws.send).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('is a no-op when no session repository is wired', () => {
    const ws = makeWs();

    replayDisplayContent(ws, 'sess-1', undefined);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('is a no-op when the session has no displayContent (nothing displayed yet)', () => {
    const ws = makeWs();
    const findById = vi.fn().mockReturnValue(bareSession('sess-1', null));

    replayDisplayContent(ws, 'sess-1', { findById });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('is a no-op when the session has metadata but no displayContent (e.g. only ttsSettings)', () => {
    const ws = makeWs();
    const session = bareSession('sess-1', {
      ttsSettings: { enabled: true, outputDeviceId: null },
    });
    const findById = vi.fn().mockReturnValue(session);

    replayDisplayContent(ws, 'sess-1', { findById });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('is a no-op when the session does not exist', () => {
    const ws = makeWs();
    const findById = vi.fn().mockReturnValue(null);

    replayDisplayContent(ws, 'sess-missing', { findById });

    expect(ws.send).not.toHaveBeenCalled();
  });
});
