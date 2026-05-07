import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { JoinPage } from './JoinPage';

// Mock useAuth
const mockNavigate = vi.fn();
let mockIsAuthenticated = false;
let mockAuthLoading = false;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    loading: mockAuthLoading,
  }),
}));

// Mock fetch for join API calls
const mockFetch = vi.fn();

describe('JoinPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = false;
    mockAuthLoading = false;
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderJoinPage(code: string = 'TEST-CODE') {
    return render(
      <MemoryRouter initialEntries={[`/join/${code}`]}>
        <Routes>
          <Route path="/join/:code" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  describe('when auth is loading', () => {
    it('shows loading state', async () => {
      mockAuthLoading = true;
      await act(async () => {
        renderJoinPage();
      });
      expect(screen.getByText('Loading...')).toBeDefined();
    });
  });

  describe('when not authenticated', () => {
    it('redirects to login with returnTo param', async () => {
      mockIsAuthenticated = false;
      mockAuthLoading = false;

      await act(async () => {
        renderJoinPage('ABC-1234');
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/login?returnTo=%2Fjoin%2FABC-1234',
          { replace: true }
        );
      });
    });
  });

  describe('when authenticated', () => {
    beforeEach(() => {
      mockIsAuthenticated = true;
      mockAuthLoading = false;
    });

    it('shows joining state while calling API', async () => {
      // Never resolve the fetch to keep it in joining state
      mockFetch.mockImplementation(() => new Promise(() => {}));

      await act(async () => {
        renderJoinPage('TEST-CODE');
      });

      await waitFor(() => {
        expect(screen.getByText('🔗 Joining Workspace')).toBeDefined();
      });
    });

    it('calls join API with the code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'ws-123', name: 'Test Workspace' }),
      });

      await act(async () => {
        renderJoinPage('ABC-1234');
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code: 'ABC-1234' }),
        });
      });
    });

    it('shows success state on successful join', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'ws-123', name: 'Test Workspace' }),
      });

      await act(async () => {
        renderJoinPage('ABC-1234');
      });

      await waitFor(() => {
        expect(screen.getByText('✅ Joined Successfully!')).toBeDefined();
        expect(screen.getByText(/Test Workspace/)).toBeDefined();
      });
    });

    it('redirects to workspace after successful join', async () => {
      vi.useFakeTimers();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'ws-123', name: 'Test Workspace' }),
      });

      await act(async () => {
        renderJoinPage('ABC-1234');
      });

      await act(async () => {
        vi.advanceTimersByTime(1100); // Just over 1 second delay
      });

      expect(mockNavigate).toHaveBeenCalledWith('/workspace/ws-123', { replace: true });
      
      vi.useRealTimers();
    });

    it('shows error state on 404 (invalid code)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Invalid join code' }),
      });

      await act(async () => {
        renderJoinPage('INVALID');
      });

      await waitFor(() => {
        expect(screen.getByText('😔 Unable to Join')).toBeDefined();
        expect(screen.getByText(/invalid or has expired/i)).toBeDefined();
      });
    });

    it('shows error state on other API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      await act(async () => {
        renderJoinPage('TEST-CODE');
      });

      await waitFor(() => {
        expect(screen.getByText('😔 Unable to Join')).toBeDefined();
        expect(screen.getByText('Server error')).toBeDefined();
      });
    });

    it('shows error state on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        renderJoinPage('TEST-CODE');
      });

      await waitFor(() => {
        expect(screen.getByText('😔 Unable to Join')).toBeDefined();
        expect(screen.getByText(/Something went wrong/i)).toBeDefined();
      });
    });

    it('includes Go to Dashboard button on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Invalid join code' }),
      });

      await act(async () => {
        renderJoinPage('INVALID');
      });

      await waitFor(() => {
        expect(screen.getByText('Go to Dashboard')).toBeDefined();
      });
    });

    it('includes Try Again button on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      await act(async () => {
        renderJoinPage('TEST-CODE');
      });

      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeDefined();
      });
    });
  });

  describe('when no code provided', () => {
    it('redirects to dashboard', async () => {
      mockIsAuthenticated = true;
      mockAuthLoading = false;

      render(
        <MemoryRouter initialEntries={['/join/']}>
          <Routes>
            <Route path="/join/" element={<JoinPage />} />
            <Route path="/join/:code" element={<JoinPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
      });
    });
  });
});
