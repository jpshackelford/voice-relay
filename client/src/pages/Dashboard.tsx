import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces, type Workspace } from '../hooks/useWorkspaces';

export function Dashboard() {
  const { user, logout } = useAuth();
  const { workspaces, loading, error, createWorkspace, deleteWorkspace, joinWorkspace, refresh } = useWorkspaces();
  const navigate = useNavigate();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    setFormLoading(true);
    setFormError(null);

    try {
      const workspace = await createWorkspace(newWorkspaceName.trim());
      setNewWorkspaceName('');
      setShowCreateForm(false);
      // Navigate to the new workspace
      navigate(`/workspace/${workspace.id}`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleJoinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setFormLoading(true);
    setFormError(null);

    try {
      const workspace = await joinWorkspace(joinCode.trim().toUpperCase());
      setJoinCode('');
      setShowJoinForm(false);
      // Navigate to the joined workspace
      navigate(`/workspace/${workspace.id}`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    if (!confirm(`Are you sure you want to delete "${workspace.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteWorkspace(workspace.id);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleEnterWorkspace = (workspace: Workspace) => {
    navigate(`/workspace/${workspace.id}`);
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard-loading">Loading workspaces...</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-title">
          <h1>🔊 Voice Relay</h1>
        </div>
        <div className="dashboard-user">
          {user && (
            <>
              {user.avatarUrl && (
                <img src={user.avatarUrl} alt={user.username} className="user-avatar" />
              )}
              <span className="user-name">{user.displayName || user.username}</span>
            </>
          )}
          <button className="logout-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-actions">
          <button
            className="action-btn primary"
            onClick={() => {
              setShowCreateForm(true);
              setShowJoinForm(false);
              setFormError(null);
            }}
          >
            + Create Workspace
          </button>
          <button
            className="action-btn secondary"
            onClick={() => {
              setShowJoinForm(true);
              setShowCreateForm(false);
              setFormError(null);
            }}
          >
            🔗 Join with Code
          </button>
          <button className="action-btn tertiary" onClick={refresh}>
            ↻ Refresh
          </button>
        </div>

        {showCreateForm && (
          <div className="form-card">
            <h3>Create New Workspace</h3>
            <form onSubmit={handleCreateWorkspace}>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Workspace name (e.g., Kitchen Kiosk)"
                autoFocus
                disabled={formLoading}
              />
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-buttons">
                <button type="submit" disabled={!newWorkspaceName.trim() || formLoading}>
                  {formLoading ? 'Creating...' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowCreateForm(false)} disabled={formLoading}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {showJoinForm && (
          <div className="form-card">
            <h3>Join Workspace</h3>
            <form onSubmit={handleJoinWorkspace}>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter join code (e.g., ABC123)"
                autoFocus
                disabled={formLoading}
                maxLength={20}
              />
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-buttons">
                <button type="submit" disabled={!joinCode.trim() || formLoading}>
                  {formLoading ? 'Joining...' : 'Join'}
                </button>
                <button type="button" onClick={() => setShowJoinForm(false)} disabled={formLoading}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {error && <div className="dashboard-error">{error}</div>}

        <div className="workspaces-list">
          <h2>Your Workspaces</h2>
          {workspaces.length === 0 ? (
            <div className="no-workspaces">
              <p>You don't have any workspaces yet.</p>
              <p>Create one to get started!</p>
            </div>
          ) : (
            <div className="workspace-cards">
              {workspaces.map((workspace) => (
                <div key={workspace.id} className="workspace-card">
                  <div className="workspace-info">
                    <h3>{workspace.name}</h3>
                    <div className="workspace-meta">
                      {workspace.isOwner ? (
                        <span className="owner-badge">Owner</span>
                      ) : (
                        <span className="member-badge">Member</span>
                      )}
                      {workspace.joinCode && workspace.isOwner && (
                        <span className="join-code" title="Join code">
                          Code: {workspace.joinCode}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="workspace-actions">
                    <button
                      className="enter-btn"
                      onClick={() => handleEnterWorkspace(workspace)}
                    >
                      Enter →
                    </button>
                    {workspace.isOwner && (
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteWorkspace(workspace)}
                        title="Delete workspace"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
