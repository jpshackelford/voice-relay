import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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

  describe('layout (regression #390)', () => {
    it('renders the footer as a sibling after the login card', async () => {
      await act(async () => {
        renderLogin();
      });

      const card = document.querySelector('.login-card');
      const footer = document.querySelector('.login-footer');
      expect(card).not.toBeNull();
      expect(footer).not.toBeNull();
      // Card and footer share the same parent (.login-page wrapper)
      expect(card!.parentElement).toBe(footer!.parentElement);
      expect(card!.parentElement?.classList.contains('login-page')).toBe(true);
      // Footer comes after card in document order so a column flex stacks it below
      expect(
        card!.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('stacks .login-page children vertically (flex-direction: column)', () => {
      // CSS-only regression: in a row layout the footer renders beside the card
      // instead of below it (see issue #390). Assert the rule directly from
      // App.css so the fix can't be silently removed.
      const here = dirname(fileURLToPath(import.meta.url));
      const css = readFileSync(resolve(here, '../App.css'), 'utf8');
      const match = css.match(/\.login-page\s*{([^}]*)}/);
      expect(match, '.login-page rule not found in App.css').not.toBeNull();
      const body = match![1];
      expect(body).toMatch(/display\s*:\s*flex\s*;/);
      expect(body).toMatch(/flex-direction\s*:\s*column\s*;/);
    });
  });
});
