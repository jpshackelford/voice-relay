/**
 * Tests for the "Restart agent" affordance (issue #294).
 *
 * Covers the spec rows T-3.5.C.1 .. T-3.5.C.6 from the issue's technical
 * approach. The button reads its visibility/loading flags from the
 * `AIState` shape exposed by `useAI`, so the tests pass minimal hand-rolled
 * state objects rather than spinning up the full hook.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { AIRestartButton } from './AIRestartButton';
import type { AIState, RestartResult } from '../hooks/useAI';

function buildAIState(partial: Partial<AIState> = {}): AIState {
  return {
    connected: false,
    connecting: false,
    thinking: false,
    degraded: false,
    restarting: false,
    restartError: null,
    conversationId: null,
    error: null,
    restart: vi.fn(async () => ({ ok: true, status: {
      sessionId: 's1',
      state: 'starting',
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: null,
    } } as RestartResult)),
    ...partial,
  };
}

describe('AIRestartButton', () => {
  // T-3.5.C.1: ready → no button
  it('does not render when ai is connected (ready)', () => {
    const ai = buildAIState({ connected: true, degraded: false });
    render(<AIRestartButton ai={ai} />);
    expect(screen.queryByRole('button', { name: /restart agent/i })).toBeNull();
  });

  // T-3.5.C.2: thinking → no button
  it('does not render when ai is thinking', () => {
    const ai = buildAIState({ connected: true, thinking: true, degraded: false });
    render(<AIRestartButton ai={ai} />);
    expect(screen.queryByRole('button', { name: /restart agent/i })).toBeNull();
  });

  // T-3.5.C.3: absent → no button
  it('does not render when ai is absent (no session)', () => {
    const ai = buildAIState();
    render(<AIRestartButton ai={ai} />);
    expect(screen.queryByRole('button', { name: /restart agent/i })).toBeNull();
  });

  it('does not render when ai is connecting', () => {
    const ai = buildAIState({ connecting: true });
    render(<AIRestartButton ai={ai} />);
    expect(screen.queryByRole('button', { name: /restart agent/i })).toBeNull();
  });

  it('does not render when ai prop is missing', () => {
    render(<AIRestartButton />);
    expect(screen.queryByRole('button', { name: /restart agent/i })).toBeNull();
  });

  // T-3.5.C.4: degraded → button visible & enabled
  it('renders an enabled button when ai is degraded', () => {
    const ai = buildAIState({ degraded: true, error: 'Agent stuck' });
    render(<AIRestartButton ai={ai} />);
    const btn = screen.getByRole('button', { name: /restart agent/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the button and shows a busy label while restarting', () => {
    const ai = buildAIState({ degraded: true, restarting: true });
    render(<AIRestartButton ai={ai} />);
    const btn = screen.getByRole('button', { name: /restarting/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  // T-3.5.C.5: click triggers restart()
  it('invokes ai.restart() on click', async () => {
    const restart = vi.fn(async () => ({ ok: true, status: {
      sessionId: 's1',
      state: 'starting',
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: null,
    } } as RestartResult));
    const ai = buildAIState({ degraded: true, restart });
    render(<AIRestartButton ai={ai} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /restart agent/i }));
    });

    expect(restart).toHaveBeenCalledTimes(1);
    // Inline error should NOT be shown on success.
    expect(screen.queryByText(/restart failed/i)).toBeNull();
  });

  // T-3.5.C.6: failed POST shows inline error
  it('shows inline error message when restart fails', async () => {
    const restart = vi.fn(async (): Promise<RestartResult> => ({
      ok: false,
      error: 'driver boom',
      status: 503,
    }));
    const ai = buildAIState({ degraded: true, restart });
    render(<AIRestartButton ai={ai} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /restart agent/i }));
    });

    expect(restart).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/restart failed — try again/i)).toBeTruthy();
  });

  it('clears stale inline error on subsequent successful click', async () => {
    const calls: RestartResult[] = [
      { ok: false, error: 'boom', status: 503 },
      { ok: true, status: {
        sessionId: 's1',
        state: 'starting',
        conversationId: null,
        error: null,
        thinkingSince: null,
        startingSince: null,
      } },
    ];
    const restart = vi.fn(async () => calls.shift()!);
    const ai = buildAIState({ degraded: true, restart });
    render(<AIRestartButton ai={ai} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /restart agent/i }));
    });
    expect(screen.getByText(/restart failed — try again/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /restart agent/i }));
    });
    expect(screen.queryByText(/restart failed — try again/i)).toBeNull();
  });

  it('auto-clears the inline error after the visibility window', async () => {
    vi.useFakeTimers();
    try {
      const restart = vi.fn(async (): Promise<RestartResult> => ({
        ok: false,
        error: 'boom',
        status: 503,
      }));
      const ai = buildAIState({ degraded: true, restart });
      render(<AIRestartButton ai={ai} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /restart agent/i }));
      });
      expect(screen.getByText(/restart failed — try again/i)).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.queryByText(/restart failed — try again/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the optional className to the wrapper', () => {
    const ai = buildAIState({ degraded: true });
    const { container } = render(<AIRestartButton ai={ai} className="custom-layout" />);
    const wrapper = container.querySelector('.ai-restart');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains('custom-layout')).toBe(true);
  });
});
