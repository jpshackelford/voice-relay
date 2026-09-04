import type { GitHubUser, GitHubTokenResponse, AuthConfig } from './types.js';

/**
 * Wrapper around the GitHub App authentication endpoints.
 *
 * Despite the legacy `GitHubOAuth` name, the auth flow is now driven by a
 * GitHub App. Sign-in is identify-first: `GET /auth/github` sends every
 * user to the user-authorization endpoint ({@link getIdentifyUrl}), and
 * GitHub bounces back to our callback with `?code=...&state=...`. Only when
 * the callback finds the App is not installed for that user (via
 * {@link getUserInstallations}) do we redirect to the install page
 * ({@link getInstallUrl}); after installing, GitHub returns to the callback
 * with `installation_id=...&setup_action=install`.
 *
 * This identify-first routing (#474) avoids stranding already-installed
 * returning users on GitHub's terminal "Configure installation" screen.
 *
 * The token-exchange and `GET /user` endpoints are identical for GitHub
 * Apps and classic OAuth Apps, so `exchangeCodeForToken()` and `getUser()`
 * are unchanged.
 */
export class GitHubOAuth {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly appSlug: string;
  private readonly callbackUrl: string;

  private static readonly TOKEN_URL = 'https://github.com/login/oauth/access_token';
  private static readonly USER_API_URL = 'https://api.github.com/user';
  private static readonly IDENTIFY_URL = 'https://github.com/login/oauth/authorize';
  private static readonly USER_INSTALLATIONS_API_URL = 'https://api.github.com/user/installations';

  /**
   * Build the GitHub App install URL for the given slug.
   *
   * GitHub renders the install screen here. With "Request user
   * authorization (OAuth) during installation" enabled, it then redirects
   * back to our callback with `code`, `state`, `installation_id`, and
   * `setup_action=install`.
   */
  private static installUrl(slug: string): string {
    return `https://github.com/apps/${slug}/installations/new`;
  }

  constructor(
    config: Pick<AuthConfig, 'githubClientId' | 'githubClientSecret' | 'githubAppSlug' | 'callbackUrl'>,
  ) {
    this.clientId = config.githubClientId;
    this.clientSecret = config.githubClientSecret;
    this.appSlug = config.githubAppSlug;
    this.callbackUrl = config.callbackUrl;
  }

  /**
   * Generate the GitHub App identify (user authorization) URL.
   *
   * This is the entry point for *all* sign-ins. It uses the user-to-server
   * OAuth endpoint (`login/oauth/authorize`), which identifies the user
   * without forcing them through the App install/configure screen. GitHub
   * redirects back to our callback with `code` + `state`. For a user who
   * has not yet installed the App, the callback detects the missing
   * installation and sends them to {@link getInstallUrl} on demand.
   *
   * Routing returning (already-installed) users here — instead of
   * `installations/new` — is the fix for the install-loop outage in #474:
   * `installations/new` can render a terminal "Configure installation"
   * screen that strands the user on `settings/installations/<id>` and never
   * returns a `code`.
   *
   * `redirect_uri` and granted scopes live on the App settings page; the
   * only query parameters we control are `client_id` and the CSRF `state`,
   * which GitHub echoes back to the callback.
   *
   * @param state Random state parameter to prevent CSRF
   */
  getIdentifyUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      state,
    });
    return `${GitHubOAuth.IDENTIFY_URL}?${params.toString()}`;
  }

  /**
   * Generate the GitHub App install URL.
   *
   * Used only when the callback determines the authenticating user has not
   * installed the App yet. With "Request user authorization (OAuth) during
   * installation" enabled, GitHub redirects back to our callback with
   * `code`, `state`, `installation_id`, and `setup_action=install` after the
   * user installs.
   *
   * @param state Random state parameter to prevent CSRF
   */
  getInstallUrl(state: string): string {
    const params = new URLSearchParams({ state });
    return `${GitHubOAuth.installUrl(this.appSlug)}?${params.toString()}`;
  }

  /**
   * Count the GitHub App installations accessible to the authenticating
   * user, using a user-to-server access token.
   *
   * `GET /user/installations` returns only installations of *this* App that
   * the user can access, so a `total_count > 0` is a sufficient "is the App
   * installed for this user" check — no need to filter by slug.
   *
   * @param accessToken User-to-server access token from the token exchange
   * @returns The `total_count` of accessible installations
   */
  async getUserInstallations(accessToken: string): Promise<number> {
    const response = await fetch(GitHubOAuth.USER_INSTALLATIONS_API_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'voice-relay',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub user installations fetch failed: ${response.status}`);
    }

    const data: { total_count?: number } = await response.json();
    return typeof data.total_count === 'number' ? data.total_count : 0;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch(GitHubOAuth.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub token exchange failed: ${response.status}`);
    }

    const data: GitHubTokenResponse = await response.json();

    if (!data.access_token) {
      throw new Error('GitHub did not return an access token');
    }

    return data.access_token;
  }

  /**
   * Fetch user data from GitHub API using access token
   */
  async getUser(accessToken: string): Promise<GitHubUser> {
    const response = await fetch(GitHubOAuth.USER_API_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'voice-relay',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub user fetch failed: ${response.status}`);
    }

    const user: GitHubUser = await response.json();
    return user;
  }

  /**
   * Validate the state parameter (should match what was sent)
   */
  validateState(expected: string, actual: string): boolean {
    return expected === actual;
  }
}
