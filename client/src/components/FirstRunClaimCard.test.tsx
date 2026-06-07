/**
 * Tests for `FirstRunClaimCard` (#433).
 *
 * The card is purely presentational, so we hand-roll the hook-shaped
 * props rather than wire up the real hook. That keeps the test focused
 * on UI affordances (which buttons appear, what gets called with what
 * args) without touching `fetch` or `localStorage`.
 *
 * No `@testing-library/jest-dom` matchers — the client repo doesn't
 * register them in `vite.config.ts:test.setupFiles`, so we use plain
 * DOM assertions.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirstRunClaimCard } from './FirstRunClaimCard';
import type { User } from '../contexts/AuthContext';

function makeUser(): User {
  return {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    email: null,
  } as User;
}

interface RenderArgs {
  user?: User | null;
  busy?: boolean;
  error?: string | null;
  onClaimForUser?: () => Promise<void> | void;
  onClaimForName?: (name: string, pronouns?: string) => Promise<void> | void;
  onDismiss?: () => void;
}

function renderCard(args: RenderArgs = {}) {
  const props = {
    user: args.user === undefined ? makeUser() : args.user,
    busy: args.busy ?? false,
    error: args.error ?? null,
    onClaimForUser: args.onClaimForUser ?? vi.fn(),
    onClaimForName: args.onClaimForName ?? vi.fn(),
    onDismiss: args.onDismiss ?? vi.fn(),
  };
  return { ...render(<FirstRunClaimCard {...props} />), props };
}

describe('FirstRunClaimCard', () => {
  it('renders the dialog and primary actions when signed in', () => {
    renderCard();
    expect(
      screen.getByRole('dialog', { name: /Who's using this device/i })
    ).not.toBeNull();
    const claim = screen.getByTestId('first-run-claim-claim-btn');
    expect(claim.textContent).toMatch(/Claim for me/i);
    expect(screen.queryByTestId('first-run-claim-open-name-form-btn')).not.toBeNull();
    expect(screen.queryByTestId('first-run-claim-dismiss-btn')).not.toBeNull();
  });

  it('hides the "Claim for me" button when not signed in', () => {
    renderCard({ user: null });
    expect(screen.queryByTestId('first-run-claim-claim-btn')).toBeNull();
    // Anonymous-mode hint instructs sign-in.
    expect(screen.queryByText(/Sign in to claim it/i)).not.toBeNull();
  });

  it('calls onClaimForUser when "Claim for me" is clicked', () => {
    const onClaimForUser = vi.fn();
    renderCard({ onClaimForUser });
    fireEvent.click(screen.getByTestId('first-run-claim-claim-btn'));
    expect(onClaimForUser).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when "Not now" is clicked', () => {
    const onDismiss = vi.fn();
    renderCard({ onDismiss });
    fireEvent.click(screen.getByTestId('first-run-claim-dismiss-btn'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('opens the name form on "Just remember a name"', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('first-run-claim-open-name-form-btn'));
    expect(screen.queryByTestId('first-run-claim-name-form')).not.toBeNull();
    expect(screen.queryByTestId('first-run-claim-name-input')).not.toBeNull();
    expect(screen.queryByTestId('first-run-claim-pronouns-input')).not.toBeNull();
  });

  it('pre-fills name input with the signed-in user displayName', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('first-run-claim-open-name-form-btn'));
    const input = screen.getByTestId(
      'first-run-claim-name-input'
    ) as HTMLInputElement;
    expect(input.value).toBe('Alice');
  });

  it('submits the form with trimmed name and pronouns', () => {
    const onClaimForName = vi.fn();
    renderCard({ onClaimForName });
    fireEvent.click(screen.getByTestId('first-run-claim-open-name-form-btn'));

    const nameInput = screen.getByTestId(
      'first-run-claim-name-input'
    ) as HTMLInputElement;
    const pronounsInput = screen.getByTestId(
      'first-run-claim-pronouns-input'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Pat' } });
    fireEvent.change(pronounsInput, { target: { value: 'they/them' } });

    fireEvent.click(screen.getByTestId('first-run-claim-save-name-btn'));
    expect(onClaimForName).toHaveBeenCalledWith('Pat', 'they/them');
  });

  it('disables Save when name input is blank', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('first-run-claim-open-name-form-btn'));
    const nameInput = screen.getByTestId(
      'first-run-claim-name-input'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '   ' } });
    const save = screen.getByTestId(
      'first-run-claim-save-name-btn'
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('renders the error region when error prop is set', () => {
    renderCard({ error: 'Claim failed (HTTP 500)' });
    const errEl = screen.getByTestId('first-run-claim-error');
    expect(errEl.textContent).toMatch(/Claim failed/);
  });

  it('disables buttons while busy', () => {
    renderCard({ busy: true });
    const claim = screen.getByTestId(
      'first-run-claim-claim-btn'
    ) as HTMLButtonElement;
    const openName = screen.getByTestId(
      'first-run-claim-open-name-form-btn'
    ) as HTMLButtonElement;
    const dismiss = screen.getByTestId(
      'first-run-claim-dismiss-btn'
    ) as HTMLButtonElement;
    expect(claim.disabled).toBe(true);
    expect(openName.disabled).toBe(true);
    expect(dismiss.disabled).toBe(true);
    expect(claim.textContent).toMatch(/Claiming/i);
  });

  it('returns to the actions row when "Back" is clicked in the form', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('first-run-claim-open-name-form-btn'));
    expect(screen.queryByTestId('first-run-claim-name-form')).not.toBeNull();
    fireEvent.click(screen.getByTestId('first-run-claim-back-btn'));
    expect(screen.queryByTestId('first-run-claim-name-form')).toBeNull();
    expect(screen.queryByTestId('first-run-claim-claim-btn')).not.toBeNull();
  });
});
