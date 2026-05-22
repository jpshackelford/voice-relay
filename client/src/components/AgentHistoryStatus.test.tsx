import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentHistoryStatus } from './AgentHistoryStatus';

describe('AgentHistoryStatus', () => {
  it('renders the loading state when loading is true', () => {
    render(
      <AgentHistoryStatus
        loading={true}
        error={null}
        rehydrationComplete={true}
        conversationId={undefined}
        actionCount={0}
      />,
    );
    expect(screen.getByText(/loading agent activity/i)).toBeTruthy();
  });

  it('renders the error state with a Retry button', () => {
    const onRetry = vi.fn();
    render(
      <AgentHistoryStatus
        loading={false}
        error="Server unavailable"
        rehydrationComplete={true}
        conversationId="conv-1"
        actionCount={3}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/couldn't load agent activity history/i)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /retry/i });
    btn.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders the partial-rehydration banner when rehydrationComplete is false', () => {
    const onRetry = vi.fn();
    render(
      <AgentHistoryStatus
        loading={false}
        error={null}
        rehydrationComplete={false}
        conversationId="conv-1"
        actionCount={5}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/showing partial history/i)).toBeTruthy();
    screen.getByRole('button', { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders the "no agent activity" notice when conversationId is null + zero actions', () => {
    render(
      <AgentHistoryStatus
        loading={false}
        error={null}
        rehydrationComplete={true}
        conversationId={null}
        actionCount={0}
      />,
    );
    expect(screen.getByText(/no agent activity recorded for this session/i)).toBeTruthy();
  });

  it('renders nothing in the steady-state success case', () => {
    const { container } = render(
      <AgentHistoryStatus
        loading={false}
        error={null}
        rehydrationComplete={true}
        conversationId="conv-1"
        actionCount={3}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders nothing during initial mount when conversationId is undefined (avoids flicker)', () => {
    const { container } = render(
      <AgentHistoryStatus
        loading={false}
        error={null}
        rehydrationComplete={true}
        conversationId={undefined}
        actionCount={0}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('error takes precedence over partial', () => {
    render(
      <AgentHistoryStatus
        loading={false}
        error="Network down"
        rehydrationComplete={false}
        conversationId={null}
        actionCount={0}
      />,
    );
    expect(screen.queryByText(/showing partial history/i)).toBeNull();
    expect(screen.getByText(/couldn't load agent activity history/i)).toBeTruthy();
  });

  it('loading takes precedence over partial and error', () => {
    render(
      <AgentHistoryStatus
        loading={true}
        error="something"
        rehydrationComplete={false}
        conversationId={null}
        actionCount={0}
      />,
    );
    expect(screen.getByText(/loading agent activity/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't load/i)).toBeNull();
  });

  it('does not render a Retry button on error if onRetry is omitted', () => {
    render(
      <AgentHistoryStatus
        loading={false}
        error="boom"
        rehydrationComplete={true}
        conversationId="conv-1"
        actionCount={0}
      />,
    );
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
