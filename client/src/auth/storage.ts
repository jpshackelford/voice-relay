const TOKEN_KEY = 'voice-relay-token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Extract token from URL query param (after OAuth callback) and store it.
 * Returns the token if found and stored, null otherwise.
 */
export function extractAndStoreTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  
  if (token) {
    setStoredToken(token);
    // Remove token from URL without page reload
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
    return token;
  }
  
  return null;
}
