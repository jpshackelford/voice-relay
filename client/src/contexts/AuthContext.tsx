import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Token refresh interval
// - We use httpOnly cookies, so JS cannot read the token to check expiry
// - Server returns 401 if token is expired, triggering logout
// - 30-minute refresh interval keeps session alive for long-running usage
// - For short JWT_EXPIRES_IN values (< 30min), server will reject refresh
//   attempts on expired tokens, and user will be redirected to login
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch current user using httpOnly cookie auth
  const fetchUser = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/auth/me', {
        credentials: 'include', // Include httpOnly cookies
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        return true;
      } else {
        setUser(null);
        return false;
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setUser(null);
      return false;
    }
  }, []);

  // Refresh tokens to keep session alive
  const refreshTokens = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include', // Include httpOnly cookies
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
        }
        return true;
      } else {
        // Refresh failed, user needs to re-authenticate
        setUser(null);
        return false;
      }
    } catch (err) {
      console.error('Token refresh failed:', err);
      return false;
    }
  }, []);

  // Set up periodic token refresh
  const startRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
    }
    
    refreshTimerRef.current = setInterval(async () => {
      const success = await refreshTokens();
      if (!success) {
        // Stop refreshing if it fails
        if (refreshTimerRef.current) {
          clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      }
    }, REFRESH_INTERVAL_MS);
  }, [refreshTokens]);

  // Initial auth check on mount
  useEffect(() => {
    async function initAuth() {
      const authenticated = await fetchUser();
      setLoading(false);
      
      if (authenticated) {
        startRefreshTimer();
      }
    }

    initAuth();

    // Cleanup on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [fetchUser, startRefreshTimer]);

  const login = useCallback(() => {
    // Redirect to GitHub OAuth
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/auth/github?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  const logout = useCallback(async () => {
    // Stop refresh timer
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include', // Include httpOnly cookies
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    
    setUser(null);
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
