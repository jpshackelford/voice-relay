import type { GitHubUser, GitHubTokenResponse, AuthConfig } from './types.js';

/**
 * Wrapper around the GitHub App authentication endpoints.
 *
 * Despite the legacy `GitHubOAuth` name, the auth flow is now driven by a
 * GitHub App with "Request user authorization (OAuth) during installation"
 * enabled. The user is redirected to the App's `installations/new` page,
 * which combines install + identify in a single step, and GitHub bounces
 * back to our callback with `?code=...&state=...` (plus, on a fresh
 * install, `installation_id=...&setup_action=install`).
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

  /**
   * Build the GitHub App install + identify URL for the given slug.
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
   * Generate the GitHub App install + identify URL.
   *
   * The `client_id`, `redirect_uri`, and granted scopes all live in the
   * GitHub App settings (not in this URL). The only query parameter we
   * control here is the CSRF `state`, which GitHub echoes back to the
   * callback.
   *
   * @param state Random state parameter to prevent CSRF
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({ state });
    return `${GitHubOAuth.installUrl(this.appSlug)}?${params.toString()}`;
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
