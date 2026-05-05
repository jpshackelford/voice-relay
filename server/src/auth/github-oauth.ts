import type { GitHubUser, GitHubTokenResponse, AuthConfig } from './types.js';

export class GitHubOAuth {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;
  
  private static readonly AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
  private static readonly TOKEN_URL = 'https://github.com/login/oauth/access_token';
  private static readonly USER_API_URL = 'https://api.github.com/user';

  constructor(config: Pick<AuthConfig, 'githubClientId' | 'githubClientSecret' | 'callbackUrl'>) {
    this.clientId = config.githubClientId;
    this.clientSecret = config.githubClientSecret;
    this.callbackUrl = config.callbackUrl;
  }

  /**
   * Generate the GitHub authorization URL
   * @param state Random state parameter to prevent CSRF
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: 'read:user user:email',
      state,
    });
    
    return `${GitHubOAuth.AUTHORIZE_URL}?${params.toString()}`;
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
