import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';

// Mock useAuth
let mockIsAuthenticated = false;
let mockAuthLoading = false;
const mockLogin = vi.fn();
const mockNavigate = vi.fn();

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
    login: mockLogin,
  }),
}));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = false;
    mockAuthLoading = false;
  });

  function renderLogin(returnTo?: string) {
    const search = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    return render(
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <Login />
      </MemoryRouter>
    );
  }

  describe('returnTo validation', () => {
    beforeEach(() => {
      mockIsAuthenticated = true;
    });

    it('allows valid relative path', async () => {
      await act(async () => {
        renderLogin('/join/ABC-1234');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/join/ABC-1234', { replace: true });
    });

    it('allows nested relative paths', async () => {
      await act(async () => {
        renderLogin('/workspace/123/session/456');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/workspace/123/session/456', { replace: true });
    });

    it('blocks protocol-relative URLs (//)', async () => {
      await act(async () => {
        renderLogin('//evil.com/steal-cookies');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('blocks absolute URLs', async () => {
      await act(async () => {
        renderLogin('https://evil.com/phishing');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('blocks javascript: scheme in path', async () => {
      await act(async () => {
        renderLogin('/redirect?url=javascript:alert(1)');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('blocks data: scheme in path', async () => {
      await act(async () => {
        renderLogin('/data:text/html,<script>alert(1)</script>');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('uses /dashboard when no returnTo provided', async () => {
      await act(async () => {
        renderLogin();
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('uses /dashboard for empty returnTo', async () => {
      await act(async () => {
        renderLogin('');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });

  describe('loading state', () => {
    it('shows loading spinner when auth is loading', async () => {
      mockAuthLoading = true;
      await act(async () => {
        renderLogin();
      });

      expect(screen.getByText('Loading...')).toBeDefined();
    });
  });

  describe('login form', () => {
    it('renders login button', async () => {
      await act(async () => {
        renderLogin();
      });

      expect(screen.getByText('Sign in with GitHub')).toBeDefined();
    });

    it('shows error message when error=1 param present', async () => {
      render(
        <MemoryRouter initialEntries={['/login?error=1']}>
          <Login />
        </MemoryRouter>
      );

      expect(screen.getByText('Authentication failed. Please try again.')).toBeDefined();
    });
  });
});
