import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Validate returnTo URL to prevent open redirect attacks.
 * Only allows relative paths starting with '/'.
 */
function sanitizeReturnTo(returnTo: string | null): string {
  const defaultPath = '/dashboard';
  
  if (!returnTo) return defaultPath;
  
  // Must start with / and not with // (protocol-relative URL)
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return defaultPath;
  }
  
  // Basic check for javascript: or data: schemes embedded in path
  const lowerPath = returnTo.toLowerCase();
  if (lowerPath.includes('javascript:') || lowerPath.includes('data:')) {
    return defaultPath;
  }
  
  return returnTo;
}

export function Login() {
  const { isAuthenticated, loading, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const hasError = searchParams.get('error') === '1';
  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('returnTo')),
    [searchParams]
  );

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, loading, navigate, returnTo]);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="loading-spinner">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>🔊 Voice Relay</h1>
        <p className="login-subtitle">
          Real-time voice and text communication for your workspace
        </p>

        {hasError && (
          <div className="login-error">
            Authentication failed. Please try again.
          </div>
        )}

        <button className="github-login-btn" onClick={login}>
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Sign in with GitHub
        </button>

        <p className="login-note">
          You'll need a GitHub account to create and manage workspaces.
        </p>
      </div>

      <footer className="login-footer">
        <Link to="/tos">Terms of Service</Link>
        <span className="login-footer-divider">•</span>
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}
