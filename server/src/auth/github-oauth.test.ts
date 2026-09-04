import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubOAuth } from './github-oauth.js';

describe('GitHubOAuth', () => {
  const config = {
    githubClientId: 'test-client-id',
    githubClientSecret: 'test-client-secret',
    githubAppSlug: 'test-app-slug',
    callbackUrl: 'http://localhost:3001/auth/github/callback',
  };

  const oauth = new GitHubOAuth(config);

  describe('getIdentifyUrl', () => {
    it('points at the user-authorization endpoint with client_id and state', () => {
      const state = 'random-state-123';
      const url = oauth.getIdentifyUrl(state);

      // Identify-first sign-in (#474) uses `login/oauth/authorize`, which
      // does not force already-installed users through the install screen.
      expect(url).toBe(
        'https://github.com/login/oauth/authorize?client_id=test-client-id&state=random-state-123',
      );
      // Not the install path.
      expect(url).not.toContain('installations/new');
    });

    it('URL-encodes the state parameter', () => {
      const state = 'state with spaces & symbols';
      const url = oauth.getIdentifyUrl(state);
      expect(url).toContain('state=state+with+spaces+%26+symbols');
    });
  });

  describe('getInstallUrl', () => {
    it('points at the GitHub App install URL with state', () => {
      const state = 'random-state-123';
      const url = oauth.getInstallUrl(state);

      // The client_id, redirect_uri, and scopes live on the App settings
      // page, not in the URL, so we explicitly assert they are NOT present.
      expect(url).toBe(
        'https://github.com/apps/test-app-slug/installations/new?state=random-state-123',
      );
      expect(url).not.toContain('client_id');
      expect(url).not.toContain('redirect_uri');
      expect(url).not.toContain('scope');
      expect(url).not.toContain('login/oauth/authorize');
    });

    it('URL-encodes the state parameter', () => {
      const state = 'state with spaces & symbols';
      const url = oauth.getInstallUrl(state);
      expect(url).toContain('state=state+with+spaces+%26+symbols');
    });
  });

  describe('validateState', () => {
    it('returns true for matching states', () => {
      const state = 'random-state-123';
      expect(oauth.validateState(state, state)).toBe(true);
    });

    it('returns false for non-matching states', () => {
      expect(oauth.validateState('state1', 'state2')).toBe(false);
    });
  });

  describe('exchangeCodeForToken', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetAllMocks();
    });

    it('exchanges code for token successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'gho_test_token_123',
          token_type: 'bearer',
          scope: 'read:user,user:email',
        }),
      });

      const token = await oauth.exchangeCodeForToken('auth-code-123');
      
      expect(token).toBe('gho_test_token_123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/json',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('throws on failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(oauth.exchangeCodeForToken('bad-code')).rejects.toThrow(
        'GitHub token exchange failed: 401',
      );
    });

    it('throws when no access token returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'bad_verification_code' }),
      });

      await expect(oauth.exchangeCodeForToken('bad-code')).rejects.toThrow(
        'GitHub did not return an access token',
      );
    });
  });

  describe('getUser', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetAllMocks();
    });

    it('fetches user data successfully', async () => {
      const mockUser = {
        id: 12345,
        login: 'testuser',
        name: 'Test User',
        avatar_url: 'https://github.com/testuser.png',
        email: 'test@example.com',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const user = await oauth.getUser('access-token');

      expect(user).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
            'User-Agent': 'voice-relay',
          }),
        }),
      );
    });

    it('throws on failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(oauth.getUser('bad-token')).rejects.toThrow(
        'GitHub user fetch failed: 401',
      );
    });
  });

  describe('getUserInstallations', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetAllMocks();
    });

    it('returns total_count for an installed user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_count: 2, installations: [{ id: 1 }, { id: 2 }] }),
      });

      const count = await oauth.getUserInstallations('access-token');

      expect(count).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user/installations',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
            'User-Agent': 'voice-relay',
          }),
        }),
      );
    });

    it('returns 0 when the user has no installations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_count: 0, installations: [] }),
      });

      expect(await oauth.getUserInstallations('access-token')).toBe(0);
    });

    it('returns 0 when total_count is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      expect(await oauth.getUserInstallations('access-token')).toBe(0);
    });

    it('throws on failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(oauth.getUserInstallations('bad-token')).rejects.toThrow(
        'GitHub user installations fetch failed: 403',
      );
    });
  });
});
