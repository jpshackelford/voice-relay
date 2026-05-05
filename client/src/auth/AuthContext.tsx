import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User, AuthState } from './types';
import { getStoredToken, clearStoredToken, extractAndStoreTokenFromUrl } from './storage';
import { getCurrentUser, logout as apiLogout } from './api';

// E2E test mode - bypass authentication entirely
const isE2EMode = import.meta.env.VITE_E2E_MODE === 'true';

// Mock user and token for E2E tests
const E2E_MOCK_USER: User = {
  id: 'e2e-test-user',
  githubId: 12345,
  username: 'e2e-tester',
  displayName: 'E2E Test User',
  avatarUrl: 'https://example.com/avatar.png',
  email: 'e2e-tester@test.com',
};
const E2E_MOCK_TOKEN = 'e2e-test-token';

interface AuthContextValue extends AuthState {
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(isE2EMode ? E2E_MOCK_USER : null);
  const [token, setToken] = useState<string | null>(isE2EMode ? E2E_MOCK_TOKEN : null);
  const [isLoading, setIsLoading] = useState(!isE2EMode);

  const refreshUser = useCallback(async () => {
    // In E2E mode, always use mock user
    if (isE2EMode) {
      setUser(E2E_MOCK_USER);
      setToken(E2E_MOCK_TOKEN);
      setIsLoading(false);
      return;
    }

    const currentToken = getStoredToken();
    if (!currentToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const userData = await getCurrentUser();
      setUser(userData);
      setToken(currentToken);
    } catch {
      // Token invalid or expired
      clearStoredToken();
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // In E2E mode, skip token extraction
    if (isE2EMode) {
      setIsLoading(false);
      return;
    }

    // Check for token in URL first (OAuth callback)
    const urlToken = extractAndStoreTokenFromUrl();
    if (urlToken) {
      setToken(urlToken);
    }
    
    // Then verify the token with the server
    refreshUser();
  }, [refreshUser]);

  const login = useCallback((returnTo?: string) => {
    // In E2E mode, just navigate to the return URL
    if (isE2EMode) {
      window.location.href = returnTo || '/dashboard';
      return;
    }
    const params = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    window.location.href = `/auth/github${params}`;
  }, []);

  const logout = useCallback(async () => {
    // In E2E mode, do nothing
    if (isE2EMode) {
      return;
    }
    try {
      await apiLogout();
    } catch {
      // Ignore logout errors, clear local state anyway
    }
    clearStoredToken();
    setUser(null);
    setToken(null);
  }, []);

  const value: AuthContextValue = {
    user,
    token,
    isLoading,
    isAuthenticated: isE2EMode || (!!user && !!token),
    login,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
