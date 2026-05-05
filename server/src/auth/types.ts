export interface User {
  id: string;
  githubId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
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
  jwtSecret: string;
  jwtExpiresIn?: string; // e.g., '7d'
  callbackUrl: string;
}
