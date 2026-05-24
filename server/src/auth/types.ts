export interface User {
  id: string;
  githubId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /**
   * GitHub App installation ID, populated when the user signs in via the
   * App's install + identify flow. `null` for users who pre-date the
   * GitHub App migration or who returned via a pure identify callback.
   */
  githubInstallationId: number | null;
}

export interface UserCreateInput {
  githubId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
}

export interface JWTPayload {
  sub: string; // user id
  username: string;
  iat: number;
  exp: number;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface AuthConfig {
  githubClientId: string;
  githubClientSecret: string;
  /**
   * Slug of the GitHub App used for auth (e.g. `no-hands-agent-screencast`).
   * Drives the install + identify URL the user is redirected to from
   * `GET /auth/github`. Required in non-test mode.
   */
  githubAppSlug: string;
  jwtSecret: string;
  jwtExpiresIn?: string; // e.g., '7d'
  callbackUrl: string;
}
