/**
 * Tests for the kiosk picker shown on Mobile when ≥2 kiosks are in the
 * workspace (issue #393). The picker has no internal state — its inputs
 * are the enriched `device-list` entries from the server plus the
 * latest `displayContent` for the preview thumbnail.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KioskPicker } from './KioskPicker';
import type { DeviceInfo, DisplayContent } from '../types';

function kiosk(
  id: string,
  name: string,
  extras: Partial<DeviceInfo> = {},
): DeviceInfo {
  return { id, displayName: name, mode: 'kiosk', ...extras };
}

describe('KioskPicker (issue #393)', () => {
  it('renders one card per kiosk, sorted alphabetically by display name', () => {
    const onSelect = vi.fn();
    render(
      <KioskPicker
        kiosks={[
          kiosk('k1', 'Zebra Room'),
          kiosk('k2', 'Apple Conf'),
          kiosk('k3', 'Mango Room'),
        ]}
        onSelect={onSelect}
      />,
    );

    const cards = screen.getAllByRole('radio');
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('Apple Conf');
    expect(cards[1].textContent).toContain('Mango Room');
    expect(cards[2].textContent).toContain('Zebra Room');
  });

  it('shows the in-session pill when a kiosk has activeSessionId', () => {
    render(
      <KioskPicker
        kiosks={[
          kiosk('k1', 'Busy', { activeSessionId: 'sess-1' }),
          kiosk('k2', 'Free'),
        ]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kiosk-picker-pill-k1').textContent ?? '').toMatch('In session');
    // Busy kiosk gets "Join in progress" action; free gets "Start here".
    expect(screen.getByTestId('kiosk-picker-card-k1').textContent ?? '').toMatch('Join in progress');
    expect(screen.getByTestId('kiosk-picker-card-k2').textContent ?? '').toMatch('Start here');
  });

  it('renders relative-time "last used" when lastUsedAt is set', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'Recent', { lastUsedAt: tenMinutesAgo })]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kiosk-picker-card-k1').textContent ?? '').toMatch(/10m ago/);
  });

  it('omits the "last used" line when lastUsedAt is null', () => {
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'New', { lastUsedAt: null })]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kiosk-picker-card-k1').textContent ?? '').not.toMatch(/last used/);
  });

  it('invokes onSelect with the kiosk id when a card is clicked', () => {
    const onSelect = vi.fn();
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'Alpha'), kiosk('k2', 'Bravo')]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('kiosk-picker-card-k2'));
    expect(onSelect).toHaveBeenCalledWith('k2');
  });

  it('marks the currently selected kiosk with aria-checked=true', () => {
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'Alpha'), kiosk('k2', 'Bravo')]}
        selectedKioskId="k2"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kiosk-picker-card-k1').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('kiosk-picker-card-k2').getAttribute('aria-checked')).toBe('true');
  });

  it('renders an image preview when displayContent is an image', () => {
    const display: DisplayContent = {
      type: 'image',
      content: 'https://example.com/img.png',
      title: 'Charter',
    };
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'A')]}
        onSelect={vi.fn()}
        displayContent={display}
      />,
    );
    const img = screen.getByTestId('kiosk-picker-preview') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.src).toBe('https://example.com/img.png');
  });

  it('renders a markdown preview snippet when displayContent is markdown', () => {
    const display: DisplayContent = {
      type: 'markdown',
      content: 'Long body...',
      title: 'Headline',
    };
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'A')]}
        onSelect={vi.fn()}
        displayContent={display}
      />,
    );
    expect(screen.getByTestId('kiosk-picker-preview').textContent ?? '').toMatch('Headline');
  });

  it('renders nothing for displayContent of type clear', () => {
    render(
      <KioskPicker
        kiosks={[kiosk('k1', 'A')]}
        onSelect={vi.fn()}
        displayContent={{ type: 'clear' }}
      />,
    );
    expect(screen.queryByTestId('kiosk-picker-preview')).toBeNull();
  });
});
