import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, joinWorkspace, getWorkspaceByJoinCode } from '../auth';

export function JoinPage() {
  const { joinCode } = useParams<{ joinCode: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch workspace info (doesn't require auth)
  useEffect(() => {
    if (!joinCode) return;
    
    const fetchWorkspace = async () => {
      try {
        const workspace = await getWorkspaceByJoinCode(joinCode);
        setWorkspaceName(workspace.name);
      } catch (err) {
        setError('Invalid or expired join code');
      }
    };
    
    fetchWorkspace();
  }, [joinCode]);

  const handleJoin = async () => {
    if (!joinCode) return;
    
    if (!isAuthenticated) {
      login(`/join/${joinCode}`);
      return;
    }

    setJoining(true);
    setError(null);
    
    try {
      const workspace = await joinWorkspace(joinCode);
      navigate(`/workspace/${workspace.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  };

  if (authLoading) {
    return (
      <div className="join-page">
        <div className="join-card">
          <h1>🔊 Voice Relay</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <div className="join-card">
        <h1>🔊 Voice Relay</h1>
        
        {error ? (
          <>
            <p className="join-error">⚠️ {error}</p>
            <button className="secondary-btn" onClick={() => navigate('/dashboard')}>
              Go to Dashboard
            </button>
          </>
        ) : (
          <>
            <p>You've been invited to join:</p>
            <h2 className="workspace-preview">
              {workspaceName || 'Loading...'}
            </h2>
            
            <button 
              className="join-btn primary" 
              onClick={handleJoin}
              disabled={!workspaceName || joining}
            >
              {!isAuthenticated ? 'Sign in & Join' : joining ? 'Joining...' : 'Join Workspace'}
            </button>
            
            {!isAuthenticated && (
              <p className="join-info">
                You'll need to sign in with GitHub to join this workspace.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
