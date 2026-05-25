import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ReleaseNotes } from './ReleaseNotes';

const mockChangelog = {
  generatedAt: '2026-05-17T22:00:00Z',
  entries: [
    {
      commit: 'd8456a1',
      deployedAt: '2026-05-17T22:49:31Z',
      changes: [
        {
          type: 'feat' as const,
          scope: 'mobile',
          description: 'Add quick-toggle button for voice mode',
          prNumber: 223,
        },
      ],
    },
    {
      commit: '5a25916',
      deployedAt: '2026-05-17T20:06:54Z',
      changes: [
        { type: 'fix' as const, description: 'Remove kiosk mode navigation' },
        { type: 'feat' as const, scope: 'tts', description: 'Improve voice synthesis', prNumber: 220 },
      ],
    },
  ],
};

describe('ReleaseNotes', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch to return test data
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockChangelog),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('visibility', () => {
    it('renders when isOpen is true', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);
      expect(screen.getByText("What's New")).toBeDefined();
    });

    it('does not render when isOpen is false', async () => {
      const { rerender } = render(<ReleaseNotes {...defaultProps} isOpen={false} />);

      // Wait for animation timeout
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });

      rerender(<ReleaseNotes {...defaultProps} isOpen={false} />);
      expect(screen.queryByText("What's New")).toBeNull();
    });
  });

  describe('data loading', () => {
    it('shows loading state initially', async () => {
      // Delay fetch to see loading state
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve(mockChangelog),
                }),
              100
            )
          )
      );

      render(<ReleaseNotes {...defaultProps} isOpen={true} />);
      expect(screen.getByText('Loading changelog...')).toBeDefined();
    });

    it('displays changelog entries after loading', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      expect(screen.getByText(/5a25916/)).toBeDefined();
    });

    it('displays feat changes with sparkles icon', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('Add quick-toggle button for voice mode')).toBeDefined();
      });

      // Check that sparkles emoji is present
      expect(screen.getAllByText('✨').length).toBeGreaterThan(0);
    });

    it('displays fix changes with bug icon', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('Remove kiosk mode navigation')).toBeDefined();
      });

      // Check that bug emoji is present
      expect(screen.getAllByText('🐛').length).toBeGreaterThan(0);
    });

    it('displays scope when present', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('mobile:')).toBeDefined();
      });
    });

    it('displays PR links for changes with prNumber', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('#223')).toBeDefined();
      });

      const prLink = screen.getByText('#223');
      expect(prLink.tagName).toBe('A');
      expect(prLink.getAttribute('href')).toBe(
        'https://github.com/jpshackelford/voice-relay/pull/223'
      );
      expect(prLink.getAttribute('target')).toBe('_blank');
      expect(prLink.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('does not display PR link for changes without prNumber', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('Remove kiosk mode navigation')).toBeDefined();
      });

      // The fix entry without prNumber should not have a PR link
      const changeText = screen.getByText('Remove kiosk mode navigation');
      const parentSpan = changeText.closest('.change-text');
      expect(parentSpan?.querySelector('.change-pr-link')).toBeNull();
    });

    it('PR links have correct styling class', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('#223')).toBeDefined();
      });

      const prLink = screen.getByText('#223');
      expect(prLink.classList.contains('change-pr-link')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('shows error state on fetch failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load changelog')).toBeDefined();
      });
    });

    it('provides retry button on error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeDefined();
      });

      // Mock successful retry
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockChangelog),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Retry'));
      });

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state when no entries', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ generatedAt: null, entries: [] }),
      });

      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText('No releases yet')).toBeDefined();
      });
    });
  });

  describe('back button', () => {
    it('calls onClose when back button clicked', async () => {
      const onClose = vi.fn();
      render(<ReleaseNotes {...defaultProps} onClose={onClose} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      fireEvent.click(screen.getByText('← Back'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when overlay clicked', async () => {
      const onClose = vi.fn();
      render(<ReleaseNotes {...defaultProps} onClose={onClose} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      // Click overlay (the parent element with the open class)
      const overlay = document.querySelector('.release-notes-overlay.open');
      if (overlay) {
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('timestamp toggling', () => {
    it('shows relative time by default', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      // Should show relative time (contains "ago")
      const timestamps = document.querySelectorAll('.release-timestamp');
      expect(timestamps.length).toBeGreaterThan(0);
    });

    it('toggles to absolute time on click', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      // Click on the first release header to toggle timestamp
      const headers = document.querySelectorAll('.release-header');
      expect(headers.length).toBeGreaterThan(0);

      fireEvent.click(headers[0]);

      // After click, timestamp should be in absolute format (contains "May")
      const timestamp = headers[0].querySelector('.release-timestamp');
      expect(timestamp?.textContent).toMatch(/May/);
    });

    it('toggles back to relative time on second click', async () => {
      render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      const headers = document.querySelectorAll('.release-header');

      // First click - switch to absolute
      fireEvent.click(headers[0]);
      expect(headers[0].querySelector('.release-timestamp')?.textContent).toMatch(/May/);

      // Second click - switch back to relative (matches various relative time formats)
      fireEvent.click(headers[0]);
      const timestamp = headers[0].querySelector('.release-timestamp')?.textContent;
      // Relative time strings come from the browser's Intl.RelativeTimeFormat and
      // can be things like "yesterday", "2 days ago", "last week", "in 3 months",
      // "just now", etc. — match the full vocabulary the formatter emits.
      expect(timestamp).toMatch(
        /ago|yesterday|today|just now|last|next|in \d|second|minute|hour|day|week|month|year/i,
      );
    });
  });

  describe('data freshness', () => {
    it('fetches fresh data on each modal open', async () => {
      const { rerender } = render(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByText(/d8456a1/)).toBeDefined();
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Close modal
      rerender(<ReleaseNotes {...defaultProps} isOpen={false} />);

      // Re-open modal - should fetch again
      rerender(<ReleaseNotes {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });
  });
});
