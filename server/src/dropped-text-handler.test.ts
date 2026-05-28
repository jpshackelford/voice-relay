/**
 * Tests for `reportDroppedText` — the dropped-text observability hatch from
 * issue #341 § D.
 *
 * The pre-fix path silently dropped a final `text` message whenever the
 * agent driver had no live session for the device's sessionId. Post-fix
 * we log a warning and broadcast a unified `session-state` with
 * `state: 'degraded'` so the kiosk surfaces "AI not attached — try
 * restarting the session" and the #294 restart action becomes
 * discoverable.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportDroppedText } from './dropped-text-handler.js';
import { ANONYMOUS_SESSION_ID } from './constants.js';
import type { DeviceRegistry } from './registry.js';

function createMockRegistry() {
  return {
    broadcastMessageToSession: vi.fn(),
  } as unknown as DeviceRegistry;
}

describe('reportDroppedText (#341 § D)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('warn-logs and broadcasts degraded for a final dropped text', () => {
    const registry = createMockRegistry();
    const result = reportDroppedText({
      sessionId: 'session-abc',
      utteranceId: 'utt-1',
      partial: false,
      registry,
    });

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dropped message: no AI session for session-abc'),
    );
    expect(registry.broadcastMessageToSession).toHaveBeenCalledWith(
      'session-abc',
      expect.objectContaining({
        type: 'session-state',
        sessionId: 'session-abc',
        ai: expect.objectContaining({
          sessionId: 'session-abc',
          state: 'degraded',
          conversationId: null,
          error: expect.stringContaining('restart'),
        }),
      }),
    );
  });

  test('returns false and does nothing for partial frames', () => {
    const registry = createMockRegistry();
    const result = reportDroppedText({
      sessionId: 'session-abc',
      utteranceId: 'utt-1',
      partial: true,
      registry,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
  });

  test('returns false and does nothing for anonymous session', () => {
    const registry = createMockRegistry();
    const result = reportDroppedText({
      sessionId: ANONYMOUS_SESSION_ID,
      utteranceId: 'utt-1',
      partial: false,
      registry,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
  });

  test('returns false and does nothing for undefined sessionId', () => {
    const registry = createMockRegistry();
    const result = reportDroppedText({
      sessionId: undefined,
      utteranceId: 'utt-1',
      partial: false,
      registry,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(registry.broadcastMessageToSession).not.toHaveBeenCalled();
  });

  test('includes the utterance id in the warn log for correlation', () => {
    const registry = createMockRegistry();
    reportDroppedText({
      sessionId: 'session-xyz',
      utteranceId: 'utt-abc-123',
      partial: false,
      registry,
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('utt-abc-123'));
  });
});
