import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditableDeviceName } from '../WorkspaceHome';
import type { DeviceInfo } from '../../hooks/useDevices';

/**
 * Issue #384 — Workspace page device row should read
 *
 *     <preferredName> (<deviceName>)
 *
 * when the server resolves a primary speaker with a curated preferred
 * name, and fall back to bare `<deviceName>` otherwise. Click-to-edit
 * must continue to work for the device-name portion.
 *
 * The three states required by the AC are:
 *   1. primaryUser with preferredName → person + parenthesized device name.
 *   2. primaryUser present but preferredName is null → bare device name.
 *   3. primaryUser is null (no primary_user_id) → bare device name.
 */

function makeDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'd-1',
    name: 'Mac-7acf1d6',
    mode: 'mobile',
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    isCurrentDevice: false,
    ...overrides,
  };
}

describe('EditableDeviceName (#384)', () => {
  it('renders "<preferredName> (<deviceName>)" when primary speaker is resolved', () => {
    const device = makeDevice({
      primaryUser: { userId: 'u-1', preferredName: 'JP' },
    });
    render(<EditableDeviceName device={device} onRename={vi.fn()} />);

    // Person name shows with primary weight (we just assert presence).
    expect(screen.getByText('JP')).toBeTruthy();
    // Device name is parenthesized.
    const deviceText = screen.getByTestId('device-name-text');
    expect(deviceText.textContent).toContain('(Mac-7acf1d6)');
    // And carries the muted modifier class.
    expect(deviceText.className).toContain('is-secondary');
  });

  it('falls back to the bare device name when preferredName is null', () => {
    const device = makeDevice({
      name: 'JPS iPhone',
      primaryUser: { userId: 'u-2', preferredName: null },
    });
    render(<EditableDeviceName device={device} onRename={vi.fn()} />);

    // No person-name span rendered.
    expect(screen.queryByText('JPS iPhone', { selector: '.person-name' })).toBeNull();
    const deviceText = screen.getByTestId('device-name-text');
    // Bare name, not parenthesized.
    expect(deviceText.textContent).toContain('JPS iPhone');
    expect(deviceText.textContent).not.toContain('(JPS iPhone)');
    // Not muted (primary text).
    expect(deviceText.className).not.toContain('is-secondary');
  });

  it('falls back to the bare device name when primaryUser is null', () => {
    const device = makeDevice({
      name: 'Mac-7acf1d6',
      primaryUser: null,
    });
    render(<EditableDeviceName device={device} onRename={vi.fn()} />);

    const deviceText = screen.getByTestId('device-name-text');
    expect(deviceText.textContent).toContain('Mac-7acf1d6');
    expect(deviceText.textContent).not.toContain('(Mac-7acf1d6)');
    expect(deviceText.className).not.toContain('is-secondary');
  });

  it('falls back to the bare device name when primaryUser is omitted (older server)', () => {
    // A pre-#384 server omits the field entirely. Make sure the
    // optional-chaining path handles that the same as `null`.
    const device = makeDevice({ name: 'Mac-old-server' });
    render(<EditableDeviceName device={device} onRename={vi.fn()} />);

    const deviceText = screen.getByTestId('device-name-text');
    expect(deviceText.textContent).toContain('Mac-old-server');
    expect(deviceText.className).not.toContain('is-secondary');
  });

  it('enters edit mode when the device-name portion is clicked (resolved-speaker case)', () => {
    const device = makeDevice({
      primaryUser: { userId: 'u-1', preferredName: 'JP' },
    });
    render(<EditableDeviceName device={device} onRename={vi.fn()} />);

    const deviceText = screen.getByTestId('device-name-text');
    fireEvent.click(deviceText);

    // Edit mode swaps the span for an <input> initialized to the
    // device name.
    const input = screen.getByDisplayValue('Mac-7acf1d6');
    expect((input as HTMLInputElement).tagName).toBe('INPUT');
  });

  it('enters edit mode when the device-name portion is clicked (bare-name case)', () => {
    const device = makeDevice({ primaryUser: null });
    render(<EditableDeviceName device={device} onRename={vi.fn()} />);

    fireEvent.click(screen.getByTestId('device-name-text'));
    const input = screen.getByDisplayValue('Mac-7acf1d6');
    expect((input as HTMLInputElement).tagName).toBe('INPUT');
  });
});
