import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface JoinState {
  status: 'checking' | 'joining' | 'success' | 'error';
  message?: string;
  workspaceId?: string;
  workspaceName?: string;
}

/**
 * JoinPage handles the /join/:code route for invite links.
 * 
 * Flow:
 * 1. If not authenticated, redirect to login with returnTo param
 * 2. If authenticated, call join API with the code
 * 3. On success, redirect to workspace
 * 4. On error, show friendly error message
 */
export function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [joinState, setJoinState] = useState<JoinState>({ status: 'checking' });

  const joinWorkspace = useCallback(async (joinCode: string) => {
    setJoinState({ status: 'joining' });

    try {
      const response = await fetch('/api/workspaces/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: joinCode }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorMessage = data.error || `Failed to join (${response.status})`;
        
        // Specific error messages for common cases
        if (response.status === 404) {
          setJoinState({
            status: 'error',
            message: 'This invite link is invalid or has expired. Please ask the workspace owner for a new link.',
          });
        } else if (response.status === 401) {
          // Should not happen since we check auth first, but handle it
          navigate(`/login?returnTo=/join/${encodeURIComponent(joinCode)}`);
        } else {
          setJoinState({
            status: 'error',
            message: errorMessage,
          });
        }
        return;
      }

      const workspace = await response.json();
      setJoinState({
        status: 'success',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });

      // Brief delay to show success message, then redirect
      setTimeout(() => {
        navigate(`/workspace/${workspace.id}`, { replace: true });
      }, 1000);
    } catch (err) {
      console.error('[JoinPage] Join error:', err);
      setJoinState({
        status: 'error',
        message: 'Something went wrong. Please try again or ask for a new invite link.',
      });
    }
  }, [navigate]);

  useEffect(() => {
    // Wait for auth check to complete
    if (authLoading) return;

    // If not authenticated, redirect to login with return URL
    if (!isAuthenticated) {
      const returnTo = code ? `/join/${encodeURIComponent(code)}` : '/dashboard';
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
      return;
    }

    // If no code provided, redirect to dashboard
    if (!code) {
      navigate('/dashboard', { replace: true });
      return;
    }

    // Authenticated with valid code - attempt join
    joinWorkspace(code);
  }, [authLoading, isAuthenticated, code, navigate, joinWorkspace]);

  // Show loading while checking auth
  if (authLoading || joinState.status === 'checking') {
    return (
      <div className="join-page">
        <div className="join-card">
          <div className="loading-spinner">Loading...</div>
        </div>
      </div>
    );
  }

  // Show joining state
  if (joinState.status === 'joining') {
    return (
      <div className="join-page">
        <div className="join-card">
          <h1>🔗 Joining Workspace</h1>
          <p className="join-subtitle">Please wait while we add you to the workspace...</p>
          <div className="loading-spinner">Joining...</div>
        </div>
      </div>
    );
  }

  // Show success state
  if (joinState.status === 'success') {
    return (
      <div className="join-page">
        <div className="join-card">
          <h1>✅ Joined Successfully!</h1>
          <p className="join-subtitle">
            Welcome to <strong>{joinState.workspaceName || 'the workspace'}</strong>
          </p>
          <p className="join-redirect">Redirecting to workspace...</p>
        </div>
      </div>
    );
  }

  // Show error state
  return (
    <div className="join-page">
      <div className="join-card">
        <h1>😔 Unable to Join</h1>
        <p className="join-error-message">{joinState.message}</p>
        <div className="join-actions">
          <button className="join-btn primary" onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </button>
          {code && (
            <button className="join-btn secondary" onClick={() => joinWorkspace(code)}>
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
